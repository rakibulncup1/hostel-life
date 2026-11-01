-- ============================================================================
-- HOSTEL LIFE — PHASE 1: SUPER ADMIN OVERVIEW, AUDIT LOG & CODE HISTORY
-- Run after Run23. Read-only reporting endpoints; no business data is altered.
-- No tables/columns are added. Only two indexes and seven RPC definitions change.
-- ============================================================================
BEGIN;

-- Fail early if the expected Run1/Run5 platform schema is incomplete.
DO $preflight$
DECLARE
  v_missing_tables text;
  v_missing_columns text;
BEGIN
  SELECT string_agg(x.table_name, ', ' ORDER BY x.table_name)
    INTO v_missing_tables
  FROM (VALUES
    ('platform_audit_log'),('platform_access_codes'),('profiles'),('hostels'),
    ('hostel_memberships'),('platform_settings'),('monthly_periods'),
    ('hl_archived_final_summaries'),('ledger_transactions'),('market_entries'),
    ('khala_money_entries'),('daily_meal_records')
  ) AS x(table_name)
  WHERE to_regclass('public.' || x.table_name) IS NULL;
  IF v_missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Run24 blocked: required public tables are missing: %', v_missing_tables;
  END IF;

  SELECT string_agg(x.table_name || '.' || x.column_name, ', ' ORDER BY x.table_name, x.column_name)
    INTO v_missing_columns
  FROM (VALUES
    ('platform_audit_log','actor_user_id'),('platform_audit_log','action'),('platform_audit_log','target_type'),
    ('platform_audit_log','target_id'),('platform_audit_log','reason'),('platform_audit_log','details'),('platform_audit_log','created_at'),
    ('platform_access_codes','purpose'),('platform_access_codes','max_uses'),('platform_access_codes','use_count'),
    ('platform_access_codes','expires_at'),('platform_access_codes','revoked_at'),('platform_access_codes','created_by'),('platform_access_codes','created_at'),
    ('profiles','full_name'),('profiles','role'),('profiles','is_blocked'),('profiles','flags'),('profiles','updated_at'),
    ('hostels','flags'),('hostels','updated_at'),
    ('hl_archived_final_summaries','period_id'),('hl_archived_final_summaries','hostel_id'),('hl_archived_final_summaries','hostel_name'),
    ('hl_archived_final_summaries','period_label'),('hl_archived_final_summaries','start_date'),('hl_archived_final_summaries','end_date'),
    ('hl_archived_final_summaries','summary'),('hl_archived_final_summaries','archived_by'),('hl_archived_final_summaries','archived_at'),
    ('hl_archived_final_summaries','purged_at'),('hl_archived_final_summaries','verified_at'),('hl_archived_final_summaries','verified_by')
  ) AS x(table_name,column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name=x.table_name AND c.column_name=x.column_name
  );
  IF v_missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Run24 blocked: required columns are missing: %', v_missing_columns;
  END IF;

  IF to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'Run24 blocked: Super Admin security helpers are missing.';
  END IF;
END;
$preflight$;

-- Support stable newest-first browsing as these history tables grow.
CREATE INDEX IF NOT EXISTS platform_audit_log_action_created_idx
  ON public.platform_audit_log(action, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS platform_access_codes_history_idx
  ON public.platform_access_codes(created_at DESC, id DESC);

-- Repair the Overview contract. These values already exist in the schema;
-- the previous function omitted user_count even though the UI expected it.
CREATE OR REPLACE FUNCTION public.platform_admin_get_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='শুধু Super Admin এই তথ্য দেখতে পারবেন।', ERRCODE='42501';
  END IF;

  SELECT jsonb_build_object(
    'hostel_count', (SELECT count(*) FROM public.hostels),
    'active_hostel_count', (SELECT count(*) FROM public.hostels WHERE platform_status='active'),
    'suspended_hostel_count', (SELECT count(*) FROM public.hostels WHERE platform_status='suspended'),
    'user_count', (SELECT count(*) FROM auth.users),
    'member_count', (SELECT count(*) FROM public.hostel_memberships WHERE status='active'),
    'inactive_member_count', (SELECT count(*) FROM public.hostel_memberships WHERE status='inactive'),
    'blocked_user_count', (SELECT count(*) FROM public.profiles WHERE is_blocked),
    'super_admin_count', (SELECT count(*) FROM public.profiles WHERE role='super_admin'),
    'recent_hostels', (SELECT count(*) FROM public.hostels WHERE created_at > now()-interval '30 days'),
    'announcement_enabled', (SELECT announcement_enabled FROM public.platform_settings WHERE singleton=true)
  ) INTO v;
  RETURN v;
END;
$$;

-- Paginated audit read. Only a deliberately allowlisted subset of details is
-- returned; code hashes, emails, phones, names and arbitrary JSON are excluded.
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

  SELECT count(*) INTO v_total
  FROM public.platform_audit_log a
  LEFT JOIN public.profiles actor ON actor.id=a.actor_user_id
  WHERE (v_action IS NULL OR a.action=v_action)
    AND (v_target IS NULL OR a.target_type=v_target)
    AND (v_search IS NULL OR POSITION(v_search IN LOWER(CONCAT_WS(' ',
      a.action, a.target_type, a.target_id, a.reason, actor.full_name, a.details::text
    ))) > 0);

  SELECT COALESCE(jsonb_agg(q.item ORDER BY q.created_at DESC, q.id DESC),'[]'::jsonb)
  INTO v_items
  FROM (
    SELECT a.id, a.created_at,
      jsonb_build_object(
        'id',a.id,
        'created_at',a.created_at,
        'action',a.action,
        'target_type',a.target_type,
        'target_id',a.target_id,
        'actor_name',COALESCE(NULLIF(actor.full_name,''),'অজানা/মুছে ফেলা অ্যাকাউন্ট'),
        'reason',NULLIF(LEFT(COALESCE(a.reason,''),240),''),
        'details',jsonb_strip_nulls(jsonb_build_object(
          'purpose',a.details->'purpose',
          'required',a.details->'required',
          'max_uses',a.details->'max_uses',
          'expires_at',a.details->'expires_at',
          'member_accounts_deleted',a.details->'member_accounts_deleted',
          'auth_account_deleted',a.details->'auth_account_deleted',
          'final_summary_preserved',a.details->'final_summary_preserved',
          'flag',a.details->'flag',
          'enabled',a.details->'enabled',
          'verified',a.details->'verified',
          'previous',a.details->'previous',
          'detail_months',a.details->'detail_months',
          'summary_months',a.details->'summary_months',
          'period_label',a.details->'period_label',
          'end_date',a.details->'end_date',
          'retention_expiry',a.details->'retention_expiry'
        ))
      ) AS item
    FROM public.platform_audit_log a
    LEFT JOIN public.profiles actor ON actor.id=a.actor_user_id
    WHERE (v_action IS NULL OR a.action=v_action)
      AND (v_target IS NULL OR a.target_type=v_target)
      AND (v_search IS NULL OR POSITION(v_search IN LOWER(CONCAT_WS(' ',
        a.action, a.target_type, a.target_id, a.reason, actor.full_name, a.details::text
      ))) > 0)
    ORDER BY a.created_at DESC, a.id DESC
    OFFSET v_offset LIMIT v_limit
  ) q;

  RETURN jsonb_build_object(
    'items',v_items,
    'total_count',v_total,
    'limit',v_limit,
    'offset',v_offset,
    'has_more',(v_offset + jsonb_array_length(v_items)) < v_total
  );
END;
$$;

-- Security-code history is metadata-only. The plaintext code is never stored,
-- and code_hash is intentionally never selected or returned by this function.
CREATE OR REPLACE FUNCTION public.platform_admin_list_access_code_history(
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_purpose text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit,20),1),100);
  v_offset integer := LEAST(GREATEST(COALESCE(p_offset,0),0),1000000);
  v_purpose text := NULLIF(BTRIM(COALESCE(p_purpose,'')),'');
  v_total bigint := 0;
  v_items jsonb := '[]'::jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='শুধু Super Admin Security Code History দেখতে পারবেন।', ERRCODE='42501';
  END IF;
  IF v_purpose IS NOT NULL AND v_purpose NOT IN ('registration','hostel_creation') THEN
    RAISE EXCEPTION USING MESSAGE='Security Code-এর ধরন সঠিক নয়।', ERRCODE='22023';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.platform_access_codes c
  WHERE v_purpose IS NULL OR c.purpose=v_purpose;

  SELECT COALESCE(jsonb_agg(q.item ORDER BY q.created_at DESC, q.id DESC),'[]'::jsonb)
  INTO v_items
  FROM (
    SELECT c.id, c.created_at,
      jsonb_build_object(
        'id',c.id,
        'purpose',c.purpose,
        'max_uses',c.max_uses,
        'use_count',c.use_count,
        'expires_at',c.expires_at,
        'revoked_at',c.revoked_at,
        'created_at',c.created_at,
        'created_by_name',COALESCE(NULLIF(p.full_name,''),'অজানা/মুছে ফেলা অ্যাকাউন্ট'),
        'status',CASE
          WHEN c.revoked_at IS NOT NULL THEN 'revoked'
          WHEN c.expires_at <= now() THEN 'expired'
          WHEN c.use_count >= c.max_uses THEN 'exhausted'
          ELSE 'available'
        END
      ) AS item
    FROM public.platform_access_codes c
    LEFT JOIN public.profiles p ON p.id=c.created_by
    WHERE v_purpose IS NULL OR c.purpose=v_purpose
    ORDER BY c.created_at DESC, c.id DESC
    OFFSET v_offset LIMIT v_limit
  ) q;

  RETURN jsonb_build_object(
    'items',v_items,
    'total_count',v_total,
    'limit',v_limit,
    'offset',v_offset,
    'has_more',(v_offset + jsonb_array_length(v_items)) < v_total
  );
END;
$$;

-- Make favorite/trusted changes visible in the existing audit trail.
-- No-op assignments are not logged, preventing noisy duplicate events.
CREATE OR REPLACE FUNCTION public.platform_admin_set_hostel_flag(p_hostel_id uuid,p_flag text,p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_hostel public.hostels%rowtype;
  v_previous boolean;
  v_enabled boolean := COALESCE(p_enabled,false);
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='শুধু Super Admin মেসের লেবেল পরিবর্তন করতে পারবেন।', ERRCODE='42501';
  END IF;
  IF p_flag IS NULL OR p_flag NOT IN ('favorite','trusted') THEN
    RAISE EXCEPTION USING MESSAGE='অনুমোদিত flag নির্বাচন করুন।', ERRCODE='22023';
  END IF;
  SELECT * INTO v_hostel FROM public.hostels WHERE id=p_hostel_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='মেসটি পাওয়া যায়নি।', ERRCODE='P0002'; END IF;
  v_previous := COALESCE((v_hostel.flags->>p_flag)::boolean,false);
  UPDATE public.hostels
    SET flags=jsonb_set(COALESCE(flags,'{}'::jsonb),ARRAY[p_flag],to_jsonb(v_enabled),true), updated_at=now()
    WHERE id=p_hostel_id RETURNING * INTO v_hostel;
  IF v_previous IS DISTINCT FROM v_enabled THEN
    INSERT INTO public.platform_audit_log(actor_user_id,action,target_type,target_id,details)
    VALUES(auth.uid(),'hostel_flag_changed','hostel',p_hostel_id::text,
      jsonb_build_object('flag',p_flag,'previous',v_previous,'enabled',v_enabled));
  END IF;
  RETURN jsonb_build_object('hostel_id',v_hostel.id,'flag',p_flag,'enabled',v_enabled,'flags',v_hostel.flags);
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_set_user_flag(p_user_id uuid,p_flag text,p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_profile public.profiles%rowtype;
  v_previous boolean;
  v_enabled boolean := COALESCE(p_enabled,false);
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='শুধু Super Admin ব্যবহারকারীর লেবেল পরিবর্তন করতে পারবেন।', ERRCODE='42501';
  END IF;
  IF p_flag IS NULL OR p_flag NOT IN ('favorite','trusted') THEN
    RAISE EXCEPTION USING MESSAGE='অনুমোদিত flag নির্বাচন করুন।', ERRCODE='22023';
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='ব্যবহারকারী পাওয়া যায়নি।', ERRCODE='P0002'; END IF;
  v_previous := COALESCE((v_profile.flags->>p_flag)::boolean,false);
  UPDATE public.profiles
    SET flags=jsonb_set(COALESCE(flags,'{}'::jsonb),ARRAY[p_flag],to_jsonb(v_enabled),true), updated_at=now()
    WHERE id=p_user_id RETURNING * INTO v_profile;
  IF v_previous IS DISTINCT FROM v_enabled THEN
    INSERT INTO public.platform_audit_log(actor_user_id,action,target_type,target_id,details)
    VALUES(auth.uid(),'user_flag_changed','user',p_user_id::text,
      jsonb_build_object('flag',p_flag,'previous',v_previous,'enabled',v_enabled));
  END IF;
  RETURN jsonb_build_object('user_id',v_profile.id,'flag',p_flag,'enabled',v_enabled,'flags',v_profile.flags);
END;
$$;

-- Record archive-summary creation and verification as Super Admin actions.
-- The underlying snapshots and safety checks are unchanged from Run5.
CREATE OR REPLACE FUNCTION public.platform_admin_finalize_archive_summary(p_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_period public.monthly_periods%rowtype;
  v_hostel_name text;
  v_doc jsonb;
  v_inserted integer := 0;
BEGIN
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION 'Super Admin only' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_period FROM public.monthly_periods WHERE id=p_period_id FOR UPDATE;
  IF NOT FOUND OR v_period.status NOT IN ('closed','archived') THEN
    RAISE EXCEPTION 'Closed/archived period required' USING ERRCODE='22023';
  END IF;
  SELECT h.name INTO v_hostel_name FROM public.hostels h WHERE h.id=v_period.hostel_id;
  SELECT jsonb_build_object(
    'schema_version',2,'period_id',v_period.id,'hostel_id',v_period.hostel_id,
    'label',v_period.label,'start_date',v_period.start_date,'end_date',v_period.end_date,
    'ledger_totals',(
      SELECT coalesce(jsonb_agg(jsonb_build_object('type',q.ledger_type,'status',q.status,'count',q.n,'amount',q.total)),'[]'::jsonb)
      FROM (SELECT ledger_type,status,count(*) n,sum(amount) total FROM public.ledger_transactions
        WHERE period_id=v_period.id GROUP BY ledger_type,status ORDER BY ledger_type,status) q),
    'member_totals',(
      SELECT coalesce(jsonb_agg(jsonb_build_object('member_id',q.member_id,'name',q.name,
        'deposits',q.deposits,'market_deposits',q.market_deposits,'adjustments',q.adjustments,
        'other_expenses',q.other_expenses)),'[]'::jsonb)
      FROM (SELECT l.member_id,coalesce(max(l.member_name_snapshot),'সদস্য') name,
        coalesce(sum(l.amount) FILTER (WHERE ledger_type='deposit'),0) deposits,
        coalesce(sum(l.amount) FILTER (WHERE ledger_type='market_deposit'),0) market_deposits,
        coalesce(sum(l.amount) FILTER (WHERE ledger_type='adjustment'),0) adjustments,
        coalesce(sum(l.amount) FILTER (WHERE ledger_type='other_expense'),0) other_expenses
        FROM public.ledger_transactions l WHERE period_id=v_period.id AND status='active'
        GROUP BY l.member_id) q),
    'market_total',(SELECT coalesce(sum(total_amount),0) FROM public.market_entries WHERE period_id=v_period.id AND status='active'),
    'khala_total',(SELECT coalesce(sum(amount),0) FROM public.khala_money_entries WHERE period_id=v_period.id AND status='active'),
    'meal_total',(
      SELECT jsonb_build_object('breakfast',coalesce(sum(final_breakfast),0),
        'lunch',coalesce(sum(final_lunch),0),'dinner',coalesce(sum(final_dinner),0))
      FROM public.daily_meal_records WHERE period_id=v_period.id AND NOT cancelled)
  ) INTO v_doc;
  INSERT INTO public.hl_archived_final_summaries
    (period_id,hostel_id,hostel_name,period_label,start_date,end_date,summary,archived_by)
  VALUES(v_period.id,v_period.hostel_id,v_hostel_name,v_period.label,
    v_period.start_date,v_period.end_date,v_doc,auth.uid())
  ON CONFLICT(period_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted > 0 THEN
    INSERT INTO public.platform_audit_log(actor_user_id,action,target_type,target_id,details)
    VALUES(auth.uid(),'archive_summary_saved','monthly_periods',v_period.id::text,
      jsonb_build_object('period_label',v_period.label,'end_date',v_period.end_date));
  END IF;
  RETURN jsonb_build_object('period_id',v_period.id,'summary_saved',true,
    'already_existed',(SELECT archived_at < now()-interval '1 second'
      FROM public.hl_archived_final_summaries WHERE period_id=v_period.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_verify_archive_summary(p_period_id uuid,p_confirmation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION 'Super Admin only' USING ERRCODE='42501'; END IF;
  IF p_confirmation IS DISTINCT FROM 'VERIFY '||p_period_id::text THEN
    RAISE EXCEPTION 'Explicit VERIFY confirmation is required' USING ERRCODE='22023';
  END IF;
  UPDATE public.hl_archived_final_summaries
    SET verified_at=now(),verified_by=auth.uid()
    WHERE period_id=p_period_id AND purged_at IS NULL
    RETURNING period_id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Unpurged summary not found' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.platform_audit_log(actor_user_id,action,target_type,target_id,details)
  VALUES(auth.uid(),'archive_summary_verified','monthly_periods',v_id::text,
    jsonb_build_object('verified',true));
  RETURN jsonb_build_object('verified',true,'period_id',v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.platform_admin_get_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_admin_list_audit_logs(integer,integer,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_admin_list_access_code_history(integer,integer,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_admin_set_hostel_flag(uuid,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_admin_set_user_flag(uuid,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_admin_finalize_archive_summary(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_admin_verify_archive_summary(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_audit_logs(integer,integer,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_access_code_history(integer,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_set_hostel_flag(uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_set_user_flag(uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_finalize_archive_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_verify_archive_summary(uuid,text) TO authenticated;

COMMIT;
