-- Hostel Life Run34 — Super Admin runtime health + readable audit targets.
-- Additive and read-only endpoints. Does not alter or delete application data.
-- Apply after Run33. This migration intentionally does not touch Storage buckets.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.platform_audit_log') IS NULL
     OR to_regclass('public.hostels') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Run34 preflight failed: required Super Admin objects are missing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='platform_audit_log'
      AND column_name IN ('id','actor_user_id','action','target_type','target_id','reason','details','created_at')
    GROUP BY table_name
    HAVING count(*)=8
  ) THEN
    RAISE EXCEPTION 'Run34 preflight failed: platform_audit_log contract is incomplete.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name IN ('id','full_name')
    GROUP BY table_name HAVING count(*)=2
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='hostels'
      AND column_name IN ('id','name')
    GROUP BY table_name HAVING count(*)=2
  ) THEN
    RAISE EXCEPTION 'Run34 preflight failed: profile/hostel display-name contract is incomplete.';
  END IF;
END;
$$;

-- Live PostgreSQL resource snapshot. Supabase billing-plan quotas, edge-function
-- invocation counts, egress and dashboard billing metrics are not exposed by
-- PostgreSQL catalogs and are explicitly not fabricated here.
CREATE OR REPLACE FUNCTION public.platform_admin_get_database_runtime_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_db_size bigint;
  v_max_connections integer;
  v_connection_count bigint;
  v_active_connections bigint;
  v_idle_connections bigint;
  v_long_queries bigint;
  v_lock_waits bigint;
  v_ungranted_locks bigint;
  v_deadlocks bigint;
  v_commits bigint;
  v_rollbacks bigint;
  v_cache_hit_ratio numeric;
  v_stats_reset_at timestamptz;
  v_top_tables jsonb := '[]'::jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='শুধু Super Admin Database Health দেখতে পারবেন।', ERRCODE='42501';
  END IF;

  SELECT pg_catalog.pg_database_size(current_database())::bigint,
         COALESCE(NULLIF(current_setting('max_connections',true),''),'0')::integer
  INTO v_db_size,v_max_connections;

  SELECT count(*)::bigint,
         count(*) FILTER (WHERE state='active')::bigint,
         count(*) FILTER (WHERE state='idle')::bigint,
         count(*) FILTER (WHERE state='active' AND query_start < now()-interval '5 minutes')::bigint,
         count(*) FILTER (WHERE wait_event_type='Lock')::bigint
  INTO v_connection_count,v_active_connections,v_idle_connections,v_long_queries,v_lock_waits
  FROM pg_catalog.pg_stat_activity
  WHERE datname=current_database()
    AND pid <> pg_backend_pid();

  SELECT count(*)::bigint INTO v_ungranted_locks
  FROM pg_catalog.pg_locks l
  JOIN pg_catalog.pg_stat_activity a ON a.pid=l.pid
  WHERE NOT l.granted AND a.datname=current_database();

  SELECT COALESCE(deadlocks,0)::bigint,
         COALESCE(xact_commit,0)::bigint,
         COALESCE(xact_rollback,0)::bigint,
         CASE WHEN COALESCE(blks_hit,0)+COALESCE(blks_read,0)=0 THEN NULL
              ELSE round(100.0*blks_hit/(blks_hit+blks_read),2) END,
         stats_reset
  INTO v_deadlocks,v_commits,v_rollbacks,v_cache_hit_ratio,v_stats_reset_at
  FROM pg_catalog.pg_stat_database
  WHERE datname=current_database();


  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema',q.nspname,
    'table',q.relname,
    'total_bytes',pg_catalog.pg_total_relation_size(q.oid),
    'table_bytes',pg_catalog.pg_relation_size(q.oid)
  ) ORDER BY pg_catalog.pg_total_relation_size(q.oid) DESC),'[]'::jsonb)
  INTO v_top_tables
  FROM (
    SELECT c.oid,n.nspname,c.relname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
    ORDER BY pg_catalog.pg_total_relation_size(c.oid) DESC
    LIMIT 10
  ) q;

  RETURN jsonb_build_object(
    'database_name',current_database(),
    'captured_at',now(),
    'database_size_bytes',COALESCE(v_db_size,0),
    'max_connections',COALESCE(v_max_connections,0),
    'connection_count',COALESCE(v_connection_count,0),
    'active_connections',COALESCE(v_active_connections,0),
    'idle_connections',COALESCE(v_idle_connections,0),
    'connection_usage_percent',CASE WHEN COALESCE(v_max_connections,0)>0
      THEN round(100.0*COALESCE(v_connection_count,0)/v_max_connections,2) ELSE NULL END,
    'long_running_queries_over_5m',COALESCE(v_long_queries,0),
    'lock_waiting_sessions',COALESCE(v_lock_waits,0),
    'ungranted_locks',COALESCE(v_ungranted_locks,0),
    'deadlocks_since_stats_reset',COALESCE(v_deadlocks,0),
    'transactions_committed_since_stats_reset',COALESCE(v_commits,0),
    'transactions_rolled_back_since_stats_reset',COALESCE(v_rollbacks,0),
    'buffer_cache_hit_percent',v_cache_hit_ratio,
    'statistics_reset_at',v_stats_reset_at,
    'top_tables',v_top_tables,
    'plan_quota_available',false,
    'plan_quota_note','Supabase billing-plan quota, bandwidth/egress and Edge Function usage are not exposed by PostgreSQL runtime catalogs.'
  );
END;
$$;

-- Same audit RPC contract with an additional human-readable target_label.
-- target_id remains in the response for support/debugging, but the UI can show
-- the readable label instead of exposing UUIDs as the primary description.
CREATE OR REPLACE FUNCTION public.platform_admin_list_audit_logs(
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_action text DEFAULT NULL,
  p_target_type text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit,25),1),100);
  v_offset integer := LEAST(GREATEST(COALESCE(p_offset,0),0),1000000);
  v_action text := NULLIF(LEFT(BTRIM(COALESCE(p_action,'')),80),'');
  v_target text := NULLIF(LEFT(BTRIM(COALESCE(p_target_type,'')),50),'');
  v_search text := LOWER(NULLIF(LEFT(BTRIM(COALESCE(p_search,'')),120),''));
  v_total bigint := 0;
  v_items jsonb := '[]'::jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='শুধু Super Admin Audit Log দেখতে পারবেন।', ERRCODE='42501';
  END IF;

  WITH rows AS (
    SELECT a.*,actor.full_name AS actor_name,
      CASE
        WHEN a.target_type='hostel' THEN COALESCE(
          (SELECT h.name FROM public.hostels h
           WHERE h.id=CASE WHEN a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN a.target_id::uuid END),
          NULLIF(a.details->>'name',''),'মুছে ফেলা মেস')
        WHEN a.target_type='user' THEN COALESCE(
          (SELECT p.full_name FROM public.profiles p
           WHERE p.id=CASE WHEN a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN a.target_id::uuid END),
          'মুছে ফেলা/অজানা অ্যাকাউন্ট')
        WHEN a.target_type='member' THEN COALESCE(
          NULLIF(a.details->>'name',''),
          (SELECT p.full_name FROM public.profiles p
           WHERE p.id=CASE WHEN a.details->>'user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (a.details->>'user_id')::uuid END),
          'সদস্য রেকর্ড')
        WHEN a.target_type='access_code' THEN CASE a.details->>'purpose'
          WHEN 'registration' THEN 'Registration Code'
          WHEN 'hostel_creation' THEN 'মেস তৈরির Code'
          ELSE 'Access Code' END
        WHEN a.target_type='platform_settings' THEN 'প্ল্যাটফর্ম সেটিংস'
        WHEN a.target_type='platform_retention_policy' THEN 'ডেটা সংরক্ষণ নীতি'
        WHEN a.target_type='monthly_periods' THEN COALESCE(NULLIF(a.details->>'period_label',''),'মাসের আর্কাইভ')
        ELSE COALESCE(NULLIF(a.details->>'name',''),a.target_type,'অনির্দিষ্ট লক্ষ্য')
      END AS target_label
    FROM public.platform_audit_log a
    LEFT JOIN public.profiles actor ON actor.id=a.actor_user_id
  )
  SELECT count(*) INTO v_total
  FROM rows r
  WHERE (v_action IS NULL OR r.action=v_action)
    AND (v_target IS NULL OR r.target_type=v_target)
    AND (v_search IS NULL OR POSITION(v_search IN LOWER(CONCAT_WS(' ',
      r.action,r.target_type,r.target_id,r.target_label,r.reason,r.actor_name,r.details::text
    )))>0);

  WITH rows AS (
    SELECT a.*,actor.full_name AS actor_name,
      CASE
        WHEN a.target_type='hostel' THEN COALESCE(
          (SELECT h.name FROM public.hostels h
           WHERE h.id=CASE WHEN a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN a.target_id::uuid END),
          NULLIF(a.details->>'name',''),'মুছে ফেলা মেস')
        WHEN a.target_type='user' THEN COALESCE(
          (SELECT p.full_name FROM public.profiles p
           WHERE p.id=CASE WHEN a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN a.target_id::uuid END),
          'মুছে ফেলা/অজানা অ্যাকাউন্ট')
        WHEN a.target_type='member' THEN COALESCE(
          NULLIF(a.details->>'name',''),
          (SELECT p.full_name FROM public.profiles p
           WHERE p.id=CASE WHEN a.details->>'user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (a.details->>'user_id')::uuid END),
          'সদস্য রেকর্ড')
        WHEN a.target_type='access_code' THEN CASE a.details->>'purpose'
          WHEN 'registration' THEN 'Registration Code'
          WHEN 'hostel_creation' THEN 'মেস তৈরির Code'
          ELSE 'Access Code' END
        WHEN a.target_type='platform_settings' THEN 'প্ল্যাটফর্ম সেটিংস'
        WHEN a.target_type='platform_retention_policy' THEN 'ডেটা সংরক্ষণ নীতি'
        WHEN a.target_type='monthly_periods' THEN COALESCE(NULLIF(a.details->>'period_label',''),'মাসের আর্কাইভ')
        ELSE COALESCE(NULLIF(a.details->>'name',''),a.target_type,'অনির্দিষ্ট লক্ষ্য')
      END AS target_label
    FROM public.platform_audit_log a
    LEFT JOIN public.profiles actor ON actor.id=a.actor_user_id
  )
  SELECT COALESCE(jsonb_agg(q.item ORDER BY q.created_at DESC,q.id DESC),'[]'::jsonb)
  INTO v_items
  FROM (
    SELECT r.id,r.created_at,jsonb_build_object(
      'id',r.id,
      'created_at',r.created_at,
      'action',r.action,
      'target_type',r.target_type,
      'target_id',r.target_id,
      'target_label',r.target_label,
      'actor_name',COALESCE(NULLIF(r.actor_name,''),'অজানা/মুছে ফেলা অ্যাকাউন্ট'),
      'reason',NULLIF(LEFT(COALESCE(r.reason,''),240),''),
      'details',jsonb_strip_nulls(jsonb_build_object(
        'purpose',r.details->'purpose',
        'required',r.details->'required',
        'max_uses',r.details->'max_uses',
        'expires_at',r.details->'expires_at',
        'member_accounts_deleted',r.details->'member_accounts_deleted',
        'auth_account_deleted',r.details->'auth_account_deleted',
        'final_summary_preserved',r.details->'final_summary_preserved',
        'flag',r.details->'flag',
        'enabled',r.details->'enabled',
        'verified',r.details->'verified',
        'previous',r.details->'previous',
        'detail_months',r.details->'detail_months',
        'summary_months',r.details->'summary_months',
        'period_label',r.details->'period_label',
        'end_date',r.details->'end_date',
        'retention_expiry',r.details->'retention_expiry'
      ))
    ) AS item
    FROM rows r
    WHERE (v_action IS NULL OR r.action=v_action)
      AND (v_target IS NULL OR r.target_type=v_target)
      AND (v_search IS NULL OR POSITION(v_search IN LOWER(CONCAT_WS(' ',
        r.action,r.target_type,r.target_id,r.target_label,r.reason,r.actor_name,r.details::text
      )))>0)
    ORDER BY r.created_at DESC,r.id DESC
    OFFSET v_offset LIMIT v_limit
  ) q;

  RETURN jsonb_build_object('items',v_items,'total_count',v_total,'limit',v_limit,'offset',v_offset,
    'has_more',(v_offset+jsonb_array_length(v_items))<v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.platform_admin_get_database_runtime_health() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_database_runtime_health() TO authenticated;
COMMENT ON FUNCTION public.platform_admin_get_database_runtime_health() IS
  'Super Admin-only read-only PostgreSQL database runtime metrics; does not expose Supabase plan billing quotas.';

REVOKE ALL ON FUNCTION public.platform_admin_list_audit_logs(integer,integer,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_audit_logs(integer,integer,text,text,text) TO authenticated;

COMMIT;
