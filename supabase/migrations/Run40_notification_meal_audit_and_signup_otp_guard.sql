-- HOSTEL LIFE RUN40
-- Notification amount timing, per-day final-meal audit, and signup OTP resend throttling.
-- Requires the verified Run39 v2 migration to be installed first.
-- No existing financial or meal records are rewritten by this migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $run40_preflight$
DECLARE v_missing text[] := ARRAY[]::text[]; v_column record;
BEGIN
  IF to_regclass('public.market_entries') IS NULL THEN v_missing := array_append(v_missing,'public.market_entries'); END IF;
  IF to_regclass('public.ledger_transactions') IS NULL THEN v_missing := array_append(v_missing,'public.ledger_transactions'); END IF;
  IF to_regclass('public.notifications') IS NULL THEN v_missing := array_append(v_missing,'public.notifications'); END IF;
  IF to_regclass('public.platform_notification_preferences') IS NULL THEN v_missing := array_append(v_missing,'public.platform_notification_preferences'); END IF;
  IF to_regclass('public.daily_meal_records') IS NULL THEN v_missing := array_append(v_missing,'public.daily_meal_records'); END IF;
  IF to_regclass('public.daily_meal_days') IS NULL THEN v_missing := array_append(v_missing,'public.daily_meal_days'); END IF;
  IF to_regclass('public.archive_period_audit') IS NULL THEN v_missing := array_append(v_missing,'public.archive_period_audit'); END IF;
  IF to_regclass('public.meal_requests') IS NULL THEN v_missing := array_append(v_missing,'public.meal_requests'); END IF;
  IF to_regclass('public.monthly_periods') IS NULL THEN v_missing := array_append(v_missing,'public.monthly_periods'); END IF;
  IF to_regclass('public.hostel_memberships') IS NULL THEN v_missing := array_append(v_missing,'public.hostel_memberships'); END IF;
  IF to_regclass('public.profiles') IS NULL THEN v_missing := array_append(v_missing,'public.profiles'); END IF;
  IF to_regclass('private.hl_security_events') IS NULL THEN v_missing := array_append(v_missing,'private.hl_security_events'); END IF;
  IF to_regprocedure('private.assert_signed_in()') IS NULL THEN v_missing := array_append(v_missing,'private.assert_signed_in()'); END IF;
  IF to_regprocedure('private.my_hostel_id()') IS NULL THEN v_missing := array_append(v_missing,'private.my_hostel_id()'); END IF;
  IF to_regprocedure('private.assert_hostel_manager(uuid,uuid,boolean,boolean)') IS NULL THEN v_missing := array_append(v_missing,'private.assert_hostel_manager(uuid,uuid,boolean,boolean)'); END IF;
  IF to_regprocedure('private.hl_notify_market_insert()') IS NULL OR to_regprocedure('private.hl_notify_ledger_insert()') IS NULL THEN
    v_missing := array_append(v_missing,'Run39 notification functions');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='market_entries' AND column_name='total_amount') THEN v_missing := array_append(v_missing,'market_entries.total_amount'); END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='daily_meal_records' AND column_name='finalization_source') THEN v_missing := array_append(v_missing,'daily_meal_records.finalization_source'); END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='attempt_email') THEN v_missing := array_append(v_missing,'hl_security_events.attempt_email (Run39 v2)'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='private.hl_security_events'::regclass AND conname='hl_security_events_event_type_run39_check') THEN v_missing := array_append(v_missing,'Run39 security event type constraint'); END IF;

  -- Check every column referenced by the replacement trigger and the audit/quota RPCs.
  FOR v_column IN
    SELECT * FROM (VALUES
      ('public','market_entries','status'),('public','market_entries','buyer_membership_id'),('public','market_entries','buyer_name_snapshot'),('public','market_entries','credit_to_buyer'),('public','market_entries','created_by'),('public','market_entries','hostel_id'),('public','market_entries','entry_date'),
      ('public','ledger_transactions','status'),('public','ledger_transactions','ledger_type'),('public','ledger_transactions','member_id'),('public','ledger_transactions','member_name_snapshot'),('public','ledger_transactions','amount'),('public','ledger_transactions','created_by'),('public','ledger_transactions','entry_date'),('public','ledger_transactions','description'),('public','ledger_transactions','hostel_id'),
      ('public','notifications','hostel_id'),('public','notifications','recipient_user_id'),('public','notifications','title'),('public','notifications','body'),('public','notifications','created_by'),('public','notifications','notification_kind'),
      ('public','platform_notification_preferences','singleton'),('public','platform_notification_preferences','market_activity_enabled'),('public','platform_notification_preferences','ledger_activity_enabled'),
      ('public','daily_meal_records','daily_meal_day_id'),('public','daily_meal_records','member_id'),('public','daily_meal_records','cancelled'),('public','daily_meal_records','member_name_snapshot'),('public','daily_meal_records','finalized_by'),('public','daily_meal_records','finalized_at'),('public','daily_meal_records','final_breakfast'),('public','daily_meal_records','final_lunch'),('public','daily_meal_records','final_dinner'),
      ('public','daily_meal_days','id'),('public','daily_meal_days','hostel_id'),('public','daily_meal_days','period_id'),('public','daily_meal_days','meal_date'),('public','daily_meal_days','status'),('public','daily_meal_days','finalized_at'),
      ('public','archive_period_audit','hostel_id'),('public','archive_period_audit','period_id'),('public','archive_period_audit','actor_user_id'),('public','archive_period_audit','action'),('public','archive_period_audit','summary'),('public','archive_period_audit','details'),('public','archive_period_audit','created_at'),
      ('public','meal_requests','hostel_id'),('public','meal_requests','period_id'),('public','meal_requests','membership_id'),('public','meal_requests','status'),('public','meal_requests','days'),('public','meal_requests','reviewed_by'),('public','meal_requests','reviewed_at'),('public','meal_requests','submitted_at'),
      ('public','monthly_periods','id'),('public','monthly_periods','hostel_id'),('public','monthly_periods','status'),('public','monthly_periods','start_date'),('public','monthly_periods','end_date'),
      ('public','hostel_memberships','id'),('public','hostel_memberships','hostel_id'),('public','hostel_memberships','user_id'),('public','hostel_memberships','joined_at'),('public','hostel_memberships','deactivated_at'),
      ('public','profiles','id'),('public','profiles','full_name'),('public','profiles','is_blocked'),
      ('private','hl_security_events','event_type'),('private','hl_security_events','ip_address'),('private','hl_security_events','identity_fingerprint'),('private','hl_security_events','attempt_email'),('private','hl_security_events','user_agent'),('private','hl_security_events','request_origin'),('private','hl_security_events','country_code'),('private','hl_security_events','city'),('private','hl_security_events','region'),('private','hl_security_events','region_code'),('private','hl_security_events','created_at')
    ) AS required_columns(table_schema,table_name,column_name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema=v_column.table_schema AND c.table_name=v_column.table_name AND c.column_name=v_column.column_name) THEN
      v_missing := array_append(v_missing,v_column.table_schema||'.'||v_column.table_name||'.'||v_column.column_name);
    END IF;
  END LOOP;

  IF cardinality(v_missing)>0 THEN
    RAISE EXCEPTION 'Run40 stopped: prerequisites missing: %; no changes committed.', array_to_string(v_missing, ', ')
      USING ERRCODE='P0001';
  END IF;
END;
$run40_preflight$;

-- ---------------------------------------------------------------------------
-- 1) Market notification: fire only after the calculated total is written.
-- create_market_entry inserts a 0-value parent row, writes item rows, then updates
-- total_amount. An AFTER INSERT trigger therefore observed 0. This trigger runs
-- on the first 0 -> positive total transition only, avoiding duplicate messages.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.hl_notify_market_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_buyer text; v_actor text; v_title text; v_body text;
BEGIN
  IF NOT COALESCE((SELECT market_activity_enabled FROM public.platform_notification_preferences WHERE singleton),false) THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM 'active' OR NEW.total_amount IS NULL OR NEW.total_amount <= 0 THEN RETURN NEW; END IF;
  SELECT COALESCE(NULLIF(pg_catalog.btrim(p.full_name),''),NULLIF(NEW.buyer_name_snapshot,''),'একজন সদস্য') INTO v_buyer
  FROM public.hostel_memberships m LEFT JOIN public.profiles p ON p.id=m.user_id WHERE m.id=NEW.buyer_membership_id;
  v_buyer:=COALESCE(v_buyer,NULLIF(NEW.buyer_name_snapshot,''),'একজন সদস্য');
  SELECT NULLIF(pg_catalog.btrim(full_name),'') INTO v_actor FROM public.profiles WHERE id=NEW.created_by;
  v_title:='নতুন বাজার · '||v_buyer;
  v_body:=v_buyer||' এর নামে ৳'||pg_catalog.to_char(NEW.total_amount,'FM999,999,999,990.00')||' টাকার বাজার এন্ট্রি হয়েছে। এন্ট্রি করেছেন '||COALESCE(v_actor,'একজন ম্যানেজার')||'। তারিখ: '||pg_catalog.to_char(NEW.entry_date,'DD Mon YYYY')||CASE WHEN NEW.credit_to_buyer THEN '। বাজারের টাকা সদস্যের হিসাবে যুক্ত হয়েছে।' ELSE '। বাজারের টাকা সদস্যের হিসাবে যুক্ত হয়নি।' END;
  INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by,notification_kind)
  SELECT NEW.hostel_id,m.user_id,v_title,v_body,NEW.created_by,'market_entry'
  FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
  WHERE m.hostel_id=NEW.hostel_id AND m.status='active' AND NOT COALESCE(p.is_blocked,false);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.hl_notify_market_insert() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS hl_market_notification_ins ON public.market_entries;
DROP TRIGGER IF EXISTS hl_market_notification_total_upd ON public.market_entries;
CREATE TRIGGER hl_market_notification_total_upd
AFTER UPDATE OF total_amount ON public.market_entries
FOR EACH ROW
WHEN (OLD.total_amount IS NOT DISTINCT FROM 0 AND NEW.total_amount > 0 AND NEW.status='active')
EXECUTE FUNCTION private.hl_notify_market_insert();

-- Deposit copy makes clear whose account received the deposit and who entered it.
CREATE OR REPLACE FUNCTION private.hl_notify_ledger_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_member text; v_actor text; v_title text; v_body text; v_kind text; v_amount text;
BEGIN
  IF NOT COALESCE((SELECT ledger_activity_enabled FROM public.platform_notification_preferences WHERE singleton),false) THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM 'active' OR NEW.ledger_type NOT IN ('deposit','other_expense','adjustment') THEN RETURN NEW; END IF;
  SELECT COALESCE(NULLIF(pg_catalog.btrim(p.full_name),''),NULLIF(NEW.member_name_snapshot,''),'একজন সদস্য') INTO v_member
  FROM public.hostel_memberships m LEFT JOIN public.profiles p ON p.id=m.user_id WHERE m.id=NEW.member_id;
  v_member:=COALESCE(v_member,NULLIF(NEW.member_name_snapshot,''),'মেসের হিসাব');
  SELECT NULLIF(pg_catalog.btrim(full_name),'') INTO v_actor FROM public.profiles WHERE id=NEW.created_by;
  v_amount:=pg_catalog.to_char(abs(NEW.amount),'FM999,999,999,990.00');
  IF NEW.ledger_type='deposit' THEN
    v_kind:='deposit'; v_title:='জমা যুক্ত · '||v_member;
    v_body:=v_member||'-এর নামে ৳'||v_amount||' জমা যুক্ত হয়েছে। এন্ট্রি করেছেন '||COALESCE(v_actor,'একজন ম্যানেজার')||'। তারিখ: '||pg_catalog.to_char(NEW.entry_date,'DD Mon YYYY')||CASE WHEN NULLIF(NEW.description,'') IS NOT NULL THEN '। বিবরণ: '||NEW.description ELSE '' END;
  ELSIF NEW.ledger_type='other_expense' THEN
    v_kind:='other_expense'; v_title:='নতুন খরচের হিসাব';
    v_body:='৳'||v_amount||' টাকার অন্যান্য খরচ এন্ট্রি করেছেন '||COALESCE(v_actor,'একজন ম্যানেজার')||'। তারিখ: '||pg_catalog.to_char(NEW.entry_date,'DD Mon YYYY')||CASE WHEN NULLIF(NEW.description,'') IS NOT NULL THEN '। বিবরণ: '||NEW.description ELSE '' END;
  ELSE
    v_kind:='ledger_adjustment'; v_title:='হিসাব সংশোধন · '||v_member;
    v_body:=v_member||' এর হিসাবে '||CASE WHEN NEW.amount>=0 THEN '+' ELSE '−' END||'৳'||v_amount||' সংশোধন করেছেন '||COALESCE(v_actor,'একজন ম্যানেজার')||'। তারিখ: '||pg_catalog.to_char(NEW.entry_date,'DD Mon YYYY')||CASE WHEN NULLIF(NEW.description,'') IS NOT NULL THEN '। কারণ: '||NEW.description ELSE '' END;
  END IF;
  INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by,notification_kind)
  SELECT NEW.hostel_id,m.user_id,v_title,v_body,NEW.created_by,v_kind
  FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
  WHERE m.hostel_id=NEW.hostel_id AND m.status='active' AND NOT COALESCE(p.is_blocked,false);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.hl_notify_ledger_insert() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS hl_ledger_notification_ins ON public.ledger_transactions;
CREATE TRIGGER hl_ledger_notification_ins AFTER INSERT ON public.ledger_transactions FOR EACH ROW EXECUTE FUNCTION private.hl_notify_ledger_insert();

-- ---------------------------------------------------------------------------
-- 2) Read-only, manager-scoped per-day final-meal provenance and audit RPC.
-- It reads existing finalization_source/finalized_by/at, approved requests and
-- archive_period_audit; it does not create a second audit store or alter records.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hl_get_final_meal_audit(p_meal_date date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_period public.monthly_periods%ROWTYPE;
  v_day public.daily_meal_days%ROWTYPE;
  v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF p_meal_date IS NULL THEN RAISE EXCEPTION USING MESSAGE='একটি বৈধ তারিখ নির্বাচন করুন।',ERRCODE='22023'; END IF;
  SELECT * INTO v_period FROM public.monthly_periods
    WHERE hostel_id=v_hostel AND status='running' AND p_meal_date BETWEEN start_date AND end_date
    ORDER BY start_date DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('available',false,'message','নির্বাচিত তারিখটি চলমান মাসের মধ্যে নেই।');
  END IF;
  PERFORM private.assert_hostel_manager(v_hostel,v_period.id,false,false);
  SELECT * INTO v_day FROM public.daily_meal_days WHERE hostel_id=v_hostel AND period_id=v_period.id AND meal_date=p_meal_date;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('available',false,'message','এই তারিখের ফাইনাল মিলের রেকর্ড নেই।');
  END IF;

  WITH base AS (
    SELECT r.member_id,
      COALESCE(NULLIF(pg_catalog.btrim(p.full_name),''),NULLIF(r.member_name_snapshot,''),'সদস্য') AS member_name,
      r.finalization_source,
      r.finalized_by,
      r.finalized_at,
      req.id AS approved_request_id,
      req.reviewed_by AS request_reviewed_by,
      req.reviewed_at AS request_reviewed_at,
      COALESCE(NULLIF(pg_catalog.btrim(actor.full_name),''),NULLIF(pg_catalog.btrim(request_actor.full_name),''),'স্বয়ংক্রিয় সিস্টেম') AS actor_name,
      CASE
        WHEN r.finalization_source IN ('manager_edit','archive_correction','emergency_override') THEN 'manual'
        WHEN r.finalization_source='request_approval' THEN 'request'
        WHEN req.id IS NOT NULL THEN 'request'
        ELSE 'system'
      END AS source_kind,
      CASE
        WHEN r.finalization_source='manager_edit' THEN 'ম্যানেজারের সরাসরি এন্ট্রি/সংশোধন'
        WHEN r.finalization_source='archive_correction' THEN 'আর্কাইভ সংশোধন'
        WHEN r.finalization_source='emergency_override' THEN 'ম্যানেজারের জরুরি সংশোধন'
        WHEN r.finalization_source='request_approval' THEN 'অনুরোধ অনুমোদনের মাধ্যমে'
        WHEN r.finalization_source='auto_cutoff' AND req.id IS NOT NULL THEN 'অনুরোধ অনুমোদিত; নির্ধারিত সময়ে ফাইনাল'
        WHEN req.id IS NOT NULL THEN 'অনুরোধ অনুমোদনের মাধ্যমে'
        WHEN r.finalization_source='auto_cutoff' THEN 'নির্ধারিত সময়ে স্বয়ংক্রিয় ফাইনাল'
        ELSE COALESCE(r.finalization_source,'সিস্টেম ফাইনাল')
      END AS source_label,
      CASE WHEN req.id IS NOT NULL THEN COALESCE(req.reviewed_at,r.finalized_at,v_day.finalized_at)
           ELSE COALESCE(r.finalized_at,v_day.finalized_at) END AS event_at
    FROM public.daily_meal_records r
    LEFT JOIN public.hostel_memberships m ON m.id=r.member_id
    LEFT JOIN public.profiles p ON p.id=m.user_id
    LEFT JOIN public.profiles actor ON actor.id=r.finalized_by
    LEFT JOIN LATERAL (
      SELECT mr.id,mr.reviewed_by,mr.reviewed_at,mr.request_type
      FROM public.meal_requests mr
      WHERE mr.hostel_id=v_hostel AND mr.period_id=v_period.id AND mr.membership_id=r.member_id
        AND mr.status='approved'
        AND (r.finalization_source IN ('request_approval','auto_cutoff') OR r.finalization_source IS NULL)
        AND EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(mr.days) AS day_item(value) WHERE day_item.value->>'meal_date'=p_meal_date::text)
      ORDER BY COALESCE(mr.reviewed_at,mr.submitted_at) DESC LIMIT 1
    ) req ON true
    LEFT JOIN public.profiles request_actor ON request_actor.id=req.reviewed_by
    WHERE r.daily_meal_day_id=v_day.id AND NOT r.cancelled
      AND (r.finalized_at IS NOT NULL OR r.final_breakfast IS NOT NULL OR r.final_lunch IS NOT NULL OR r.final_dinner IS NOT NULL)
  ),
  active_total AS (
    -- Reconstruct the selected day's roster from the membership lifecycle dates.
    -- This includes members who left after the selected date and excludes members
    -- who joined later; the base schema does not keep a full reactivation timeline.
    SELECT count(*)::integer AS total FROM public.hostel_memberships m
    LEFT JOIN public.profiles p ON p.id=m.user_id
    WHERE m.hostel_id=v_hostel AND NOT COALESCE(p.is_blocked,false)
      AND (m.joined_at AT TIME ZONE 'Asia/Dhaka')::date <= p_meal_date
      AND (deactivated_at IS NULL OR (deactivated_at AT TIME ZONE 'Asia/Dhaka')::date >= p_meal_date)
  ),
  pending_members AS (
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('member_id',x.id,'member_name',x.member_name) ORDER BY x.member_name),'[]'::jsonb) AS items
    FROM (
      SELECT m.id,COALESCE(NULLIF(pg_catalog.btrim(p.full_name),''),'সদস্য') AS member_name
      FROM public.hostel_memberships m LEFT JOIN public.profiles p ON p.id=m.user_id
      LEFT JOIN base b ON b.member_id=m.id
      WHERE m.hostel_id=v_hostel AND NOT COALESCE(p.is_blocked,false)
        AND (m.joined_at AT TIME ZONE 'Asia/Dhaka')::date <= p_meal_date
        AND (m.deactivated_at IS NULL OR (m.deactivated_at AT TIME ZONE 'Asia/Dhaka')::date >= p_meal_date)
        AND b.member_id IS NULL
    ) x
  ),
  record_summary AS (
    SELECT count(DISTINCT member_id)::integer AS finalized,
      count(DISTINCT member_id) FILTER(WHERE source_kind='request')::integer AS requested,
      count(DISTINCT member_id) FILTER(WHERE source_kind='manual')::integer AS manual,
      count(DISTINCT member_id) FILTER(WHERE source_kind='system')::integer AS system,
      COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'member_id',member_id,'member_name',member_name,'source_kind',source_kind,'source_label',source_label,
        'actor_name',actor_name,'finalized_at',event_at,'finalization_source',finalization_source,
        'request_id',approved_request_id
      ) ORDER BY member_name),'[]'::jsonb) AS records
    FROM base
  ),
  audit_events AS (
    SELECT a.actor_user_id,
      COALESCE(NULLIF(pg_catalog.btrim(ap.full_name),''),'অজানা ম্যানেজার') AS actor_name,
      a.created_at,
      a.action,
      CASE WHEN a.action='update:meal_correction' THEN 'অনুরোধ অনুমোদনের মাধ্যমে সংশোধন' ELSE COALESCE(a.summary,'ম্যানেজারের সরাসরি ফাইনাল মিল এন্ট্রি/সংশোধন') END AS event_label,
      count(DISTINCT COALESCE(m.id,r.member_id))::integer AS member_count,
      COALESCE(pg_catalog.jsonb_agg(DISTINCT pg_catalog.jsonb_build_object(
        'member_id',m.id,
        'member_name',COALESCE(NULLIF(pg_catalog.btrim(mp.full_name),''),r.member_name_snapshot,'সদস্য')
      )) FILTER(WHERE COALESCE(m.id,r.member_id) IS NOT NULL),'[]'::jsonb) AS members
    FROM public.archive_period_audit a
    LEFT JOIN public.profiles ap ON ap.id=a.actor_user_id
    LEFT JOIN public.hostel_memberships m ON m.id::text=COALESCE(a.details->>'member_id',a.details->>'membership_id')
    LEFT JOIN public.profiles mp ON mp.id=m.user_id
    LEFT JOIN public.daily_meal_records r ON r.daily_meal_day_id=v_day.id AND r.member_id=m.id
    WHERE a.hostel_id=v_hostel AND a.period_id=v_period.id
      AND a.action IN ('update:final_meal','update:meal_correction')
      AND a.details->>'meal_date'=p_meal_date::text
    GROUP BY a.actor_user_id,ap.full_name,a.created_at,a.action,a.summary
  )
  SELECT pg_catalog.jsonb_build_object(
    'available',true,'meal_date',p_meal_date,'day_status',v_day.status,
    'active_member_count',(SELECT total FROM active_total),
    'finalized_member_count',record_summary.finalized,
    'request_member_count',record_summary.requested,
    'manual_member_count',record_summary.manual,
    'system_member_count',record_summary.system,
    'pending_member_count',GREATEST(0,(SELECT total FROM active_total)-record_summary.finalized),
    'records',record_summary.records,
    'pending_members',(SELECT items FROM pending_members),
    'events',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'actor_user_id',e.actor_user_id,'actor_name',e.actor_name,'created_at',e.created_at,
      'action',e.action,'event_label',e.event_label,'member_count',e.member_count,'members',e.members
    ) ORDER BY e.created_at DESC) FROM audit_events e),'[]'::jsonb)
  ) INTO v_result
  FROM record_summary;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.hl_get_final_meal_audit(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hl_get_final_meal_audit(date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Signup OTP resend quota using the existing security-event store.
-- No extra table and no OTP value is stored. Limits mirror the existing
-- password-reset pattern: 2 resends per email per Dhaka day and 2 per IP/hour.
-- ---------------------------------------------------------------------------
ALTER TABLE private.hl_security_events
  DROP CONSTRAINT IF EXISTS hl_security_events_event_type_run39_check;
ALTER TABLE private.hl_security_events
  ADD CONSTRAINT hl_security_events_event_type_run40_check
  CHECK (event_type IN ('login_failed','login_success','signup_failed','signup_submitted','signup_verified','signup_otp_resend','password_reset_failed','password_reset_requested')) NOT VALID;
ALTER TABLE private.hl_security_events VALIDATE CONSTRAINT hl_security_events_event_type_run40_check;

CREATE INDEX IF NOT EXISTS hl_security_events_signup_otp_email_idx
  ON private.hl_security_events(identity_fingerprint,created_at DESC)
  WHERE event_type='signup_otp_resend';
CREATE INDEX IF NOT EXISTS hl_security_events_signup_otp_ip_idx
  ON private.hl_security_events(ip_address,created_at DESC)
  WHERE event_type='signup_otp_resend';

CREATE OR REPLACE FUNCTION public.hl_consume_signup_otp_resend(
  p_email_fingerprint text,
  p_attempt_email text,
  p_request_ip inet,
  p_country_code text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_region_code text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_request_origin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz:=pg_catalog.clock_timestamp();
  v_email_count integer:=0;
  v_ip_count integer:=0;
  v_first timestamptz;
  v_retry timestamptz;
  v_local_now timestamp without time zone;
  v_day_start timestamptz;
  v_country text:=upper(nullif(pg_catalog.btrim(COALESCE(p_country_code,'')),''));
  v_city text:=nullif(pg_catalog.left(pg_catalog.regexp_replace(pg_catalog.btrim(COALESCE(p_city,'')),'[[:cntrl:]]','','g'),100),'');
  v_region text:=nullif(pg_catalog.left(pg_catalog.regexp_replace(pg_catalog.btrim(COALESCE(p_region,'')),'[[:cntrl:]]','','g'),100),'');
  v_region_code text:=nullif(pg_catalog.left(pg_catalog.regexp_replace(pg_catalog.btrim(COALESCE(p_region_code,'')),'[[:cntrl:]]','','g'),20),'');
  v_email text:=lower(nullif(pg_catalog.btrim(COALESCE(p_attempt_email,'')),''));
BEGIN
  IF p_request_ip IS NULL THEN RETURN pg_catalog.jsonb_build_object('allowed',false,'reason','client_ip_unavailable'); END IF;
  IF p_email_fingerprint IS NULL OR p_email_fingerprint !~ '^[0-9a-f]{64}$' OR v_email IS NULL OR length(v_email)>254 THEN
    RAISE EXCEPTION USING MESSAGE='ইমেইল পরিচয় যাচাই করা যায়নি।',ERRCODE='22023';
  END IF;
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN v_country:=NULL; END IF;

  -- Keep lock order stable (IP first, then email) to avoid quota races.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hostel-life-signup-otp-ip:'||pg_catalog.host(p_request_ip),0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hostel-life-signup-otp-email:'||p_email_fingerprint,0));

  SELECT count(*)::integer,min(created_at) INTO v_ip_count,v_first
  FROM private.hl_security_events
  WHERE event_type='signup_otp_resend' AND ip_address=p_request_ip
    AND created_at>v_now-interval '1 hour';
  IF v_ip_count>=2 THEN
    v_retry:=v_first+interval '1 hour';
    RETURN pg_catalog.jsonb_build_object('allowed',false,'reason','ip_hourly_limit','retry_at',v_retry,
      'retry_after_seconds',GREATEST(1,ceil(extract(epoch FROM (v_retry-v_now)))::integer));
  END IF;

  v_local_now:=v_now AT TIME ZONE 'Asia/Dhaka';
  v_day_start:=pg_catalog.date_trunc('day',v_local_now) AT TIME ZONE 'Asia/Dhaka';
  SELECT count(*)::integer INTO v_email_count
  FROM private.hl_security_events
  WHERE event_type='signup_otp_resend' AND identity_fingerprint=p_email_fingerprint
    AND created_at>=v_day_start;
  IF v_email_count>=2 THEN
    v_retry:=(pg_catalog.date_trunc('day',v_local_now)+interval '1 day') AT TIME ZONE 'Asia/Dhaka';
    RETURN pg_catalog.jsonb_build_object('allowed',false,'reason','email_daily_limit','retry_at',v_retry,
      'retry_after_seconds',GREATEST(1,ceil(extract(epoch FROM (v_retry-v_now)))::integer));
  END IF;

  INSERT INTO private.hl_security_events(event_type,ip_address,identity_fingerprint,attempt_email,
    user_agent,request_origin,country_code,city,region,region_code)
  VALUES('signup_otp_resend',p_request_ip,p_email_fingerprint,v_email,
    nullif(pg_catalog.left(COALESCE(p_user_agent,''),512),''),
    nullif(pg_catalog.left(COALESCE(p_request_origin,''),200),''),
    v_country,v_city,v_region,v_region_code);
  RETURN pg_catalog.jsonb_build_object('allowed',true,'email_remaining',GREATEST(0,1-v_email_count),'ip_remaining',GREATEST(0,1-v_ip_count));
END;
$function$;
REVOKE ALL ON FUNCTION public.hl_consume_signup_otp_resend(text,text,inet,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hl_consume_signup_otp_resend(text,text,inet,text,text,text,text,text,text) TO service_role;

COMMIT;
