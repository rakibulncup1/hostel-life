-- Hostel Life — Archive Role, Reopen Safety, Role Badges & Member Management Repair
-- Idempotent, data-preserving migration. No business rows or historical summaries are deleted.
-- Reopening a period does not automatically recreate future requests cancelled at close.
BEGIN;

ALTER TABLE public.monthly_periods
  ADD COLUMN IF NOT EXISTS pre_close_end_date date;

CREATE TABLE IF NOT EXISTS private.archive_period_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id uuid NOT NULL,
  period_id uuid NOT NULL,
  actor_membership_id uuid,
  actor_name_snapshot text NOT NULL DEFAULT 'সিস্টেম',
  action text NOT NULL,
  entity_table text NOT NULL,
  entity_id text,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_archive_period_audit_period_created
  ON private.archive_period_audit(period_id, created_at DESC);

ALTER TABLE private.archive_period_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.archive_period_audit FROM PUBLIC, anon, authenticated;

-- Preserve the original period end before the close function replaces it with today's date.
CREATE OR REPLACE FUNCTION private.capture_period_pre_close_end()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF OLD.status = 'running' AND NEW.status = 'archived' THEN
    NEW.pre_close_end_date := OLD.end_date;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_capture_period_pre_close_end ON public.monthly_periods;
CREATE TRIGGER trg_capture_period_pre_close_end
BEFORE UPDATE OF status, end_date ON public.monthly_periods
FOR EACH ROW EXECUTE FUNCTION private.capture_period_pre_close_end();

CREATE OR REPLACE FUNCTION private.audit_archive_period_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_payload jsonb;
  v_period_id uuid;
  v_hostel_id uuid;
  v_entity_id text;
  v_action text;
  v_summary text;
  v_actor_id uuid;
  v_actor_name text;
  v_period_label text;
  v_period_status text;
BEGIN
  IF TG_TABLE_NAME = 'monthly_periods' THEN
    IF TG_OP <> 'UPDATE' OR OLD.status IS DISTINCT FROM 'running' OR NEW.status IS DISTINCT FROM 'archived' THEN
      RETURN NEW;
    END IF;
    v_period_id := NEW.id;
    v_hostel_id := NEW.hostel_id;
    v_entity_id := NEW.id::text;
    v_action := 'period_closed';
    v_summary := format('“%s” মাস বন্ধ করা হয়েছে', NEW.label);
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_payload := to_jsonb(OLD);
    ELSE
      v_payload := to_jsonb(NEW);
    END IF;

    v_entity_id := COALESCE(v_payload->>'id', v_payload->>'market_entry_id', v_payload->>'request_id');
    v_action := lower(TG_OP) || ':' || TG_TABLE_NAME;
    v_summary := CASE TG_TABLE_NAME
      WHEN 'market_entries' THEN 'আর্কাইভের বাজার এন্ট্রি পরিবর্তন হয়েছে'
      WHEN 'market_items' THEN 'আর্কাইভের বাজার আইটেম পরিবর্তন হয়েছে'
      WHEN 'ledger_transactions' THEN 'আর্কাইভের লেনদেন পরিবর্তন হয়েছে'
      WHEN 'khala_money_entries' THEN 'আর্কাইভের খালার টাকা এন্ট্রি পরিবর্তন হয়েছে'
      WHEN 'daily_meal_days' THEN 'আর্কাইভের দৈনিক মিল-দিন পরিবর্তন হয়েছে'
      WHEN 'daily_meal_records' THEN 'আর্কাইভের মিল রেকর্ড পরিবর্তন হয়েছে'
      WHEN 'meal_requests' THEN 'আর্কাইভের মিল রিকোয়েস্ট পরিবর্তন হয়েছে'
      WHEN 'meal_request_days' THEN 'আর্কাইভের রিকোয়েস্টের দিনের তথ্য পরিবর্তন হয়েছে'
      ELSE 'আর্কাইভের তথ্য পরিবর্তন হয়েছে'
    END;

    IF TG_TABLE_NAME = 'market_items' THEN
      SELECT me.period_id, me.hostel_id INTO v_period_id, v_hostel_id
      FROM public.market_entries me
      WHERE me.id = NULLIF(v_payload->>'market_entry_id', '')::uuid;
    ELSIF TG_TABLE_NAME = 'meal_request_days' THEN
      SELECT mr.period_id, mr.hostel_id INTO v_period_id, v_hostel_id
      FROM public.meal_requests mr
      WHERE mr.id = NULLIF(v_payload->>'request_id', '')::uuid;
    ELSE
      v_period_id := NULLIF(v_payload->>'period_id', '')::uuid;
      v_hostel_id := NULLIF(v_payload->>'hostel_id', '')::uuid;
    END IF;
  END IF;

  IF v_period_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT mp.hostel_id, mp.label, mp.status::text
    INTO v_hostel_id, v_period_label, v_period_status
  FROM public.monthly_periods mp
  WHERE mp.id = v_period_id;

  IF v_hostel_id IS NULL OR v_period_status <> 'archived' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT hm.id, p.full_name INTO v_actor_id, v_actor_name
  FROM public.hostel_memberships hm
  LEFT JOIN public.profiles p ON p.id = hm.user_id
  WHERE hm.hostel_id = v_hostel_id
    AND hm.user_id = auth.uid()
    AND hm.status = 'active'
  ORDER BY hm.created_at
  LIMIT 1;

  INSERT INTO private.archive_period_audit(
    hostel_id, period_id, actor_membership_id, actor_name_snapshot,
    action, entity_table, entity_id, summary
  ) VALUES (
    v_hostel_id, v_period_id, v_actor_id, COALESCE(v_actor_name, 'সিস্টেম'),
    v_action, TG_TABLE_NAME, v_entity_id,
    COALESCE(v_summary, 'আর্কাইভের তথ্য পরিবর্তন হয়েছে')
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
EXCEPTION WHEN OTHERS THEN
  -- Audit failure must not cancel the business write; emit a server-side warning for diagnosis.
  RAISE WARNING 'Hostel Life archive audit could not write for %.%: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_archive_periods ON public.monthly_periods;
CREATE TRIGGER trg_audit_archive_periods
AFTER UPDATE OF status ON public.monthly_periods
FOR EACH ROW EXECUTE FUNCTION private.audit_archive_period_changes();

DO $triggers$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'market_entries','market_items','ledger_transactions','khala_money_entries',
    'daily_meal_days','daily_meal_records','meal_requests','meal_request_days'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_archive_audit_' || v_table, v_table);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.audit_archive_period_changes()',
      'trg_archive_audit_' || v_table, v_table
    );
  END LOOP;
END;
$triggers$;

-- Resolve primary authority from the running period pointer. With no running period,
-- fall back to the active membership that has the legacy manager role.
CREATE OR REPLACE FUNCTION private.is_primary_manager_for_hostel(p_hostel_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.monthly_periods mp WHERE mp.hostel_id=p_hostel_id AND mp.status='running')
    THEN EXISTS (
      SELECT 1
      FROM public.monthly_periods mp
      JOIN public.hostel_memberships hm
        ON hm.id=mp.primary_manager_membership_id
       AND hm.hostel_id=mp.hostel_id AND hm.status='active' AND hm.role='manager'
      WHERE mp.hostel_id=p_hostel_id AND mp.status='running'
        AND hm.id=private.current_membership_id(true)
    )
    ELSE EXISTS (
      SELECT 1 FROM public.hostel_memberships hm
      WHERE hm.id=private.current_membership_id(true)
        AND hm.hostel_id=p_hostel_id AND hm.status='active' AND hm.role='manager'
    )
  END;
$function$;
REVOKE ALL ON FUNCTION private.is_primary_manager_for_hostel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_primary_manager_for_hostel(uuid) TO authenticated;

-- Repair stale running-period pointers only if exactly one active role-manager exists.
-- Ambiguous zero/multiple-role cases are never guessed or rewritten.
DO $primary_manager_reconcile$
BEGIN
  WITH active_managers AS (
    SELECT hm.hostel_id,
           array_agg(hm.id ORDER BY hm.created_at, hm.id) AS manager_ids,
           count(*) AS manager_count
    FROM public.hostel_memberships hm
    WHERE hm.status='active' AND hm.role='manager'
    GROUP BY hm.hostel_id
  )
  UPDATE public.monthly_periods mp
     SET primary_manager_membership_id=active_managers.manager_ids[1], updated_at=now()
    FROM active_managers
   WHERE active_managers.manager_count=1
     AND mp.hostel_id=active_managers.hostel_id AND mp.status='running'
     AND mp.primary_manager_membership_id IS DISTINCT FROM active_managers.manager_ids[1];
END;
$primary_manager_reconcile$;

-- Only the month closer (if still the primary manager) or that specific closer with
-- a grant from the current primary manager may edit an archived period.
CREATE OR REPLACE FUNCTION private.can_manage_period(p_period_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.monthly_periods mp
    JOIN public.hostel_memberships me
      ON me.hostel_id = mp.hostel_id
     AND me.user_id = auth.uid()
     AND me.status = 'active'
    WHERE mp.id = p_period_id
      AND (
        (mp.status = 'running' AND (
          me.id = mp.primary_manager_membership_id
          OR EXISTS (
            SELECT 1 FROM public.period_assistant_managers pam
            WHERE pam.period_id = mp.id AND pam.membership_id = me.id
          )
        ))
        OR
        (mp.status = 'archived' AND (
          (me.id = mp.manager_at_close_membership_id AND me.status = 'active' AND ((EXISTS (SELECT 1 FROM public.monthly_periods current_period WHERE current_period.hostel_id=mp.hostel_id AND current_period.status='running' AND current_period.primary_manager_membership_id=me.id)) OR (NOT EXISTS (SELECT 1 FROM public.monthly_periods current_period WHERE current_period.hostel_id=mp.hostel_id AND current_period.status='running') AND me.role='manager')))
          OR EXISTS (
            SELECT 1
            FROM public.archive_edit_permissions aep
            JOIN public.hostel_memberships current_manager
              ON current_manager.id = aep.granted_by
             AND current_manager.hostel_id = mp.hostel_id
             AND current_manager.role = 'manager'
             AND current_manager.status = 'active'
             AND ((EXISTS (SELECT 1 FROM public.monthly_periods current_period WHERE current_period.hostel_id=mp.hostel_id AND current_period.status='running' AND current_period.primary_manager_membership_id=current_manager.id)) OR (NOT EXISTS (SELECT 1 FROM public.monthly_periods current_period WHERE current_period.hostel_id=mp.hostel_id AND current_period.status='running')))
            WHERE aep.period_id = mp.id
              AND aep.membership_id = mp.manager_at_close_membership_id
              AND aep.membership_id = me.id
              AND aep.revoked_at IS NULL
              AND aep.expires_at IS NOT NULL
              AND aep.expires_at > now()
          )
        ))
      )
  );
$function$;
REVOKE ALL ON FUNCTION private.can_manage_period(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_manage_period(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.grant_archive_edit_permission(
  p_period_id uuid,
  p_membership_id uuid,
  p_expires_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_hostel_id uuid;
  v_manager uuid;
  v_closer uuid;
  v_closer_name text;
  v_permission_id uuid;
  v_actor_name text;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel_id := private.current_hostel_id(true);
  v_manager := private.current_membership_id(true);

  IF NOT private.is_primary_manager_for_hostel(v_hostel_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'শুধু বর্তমান প্রধান ম্যানেজার আর্কাইভ সম্পাদনার অনুমতি দিতে পারবেন।';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION USING MESSAGE = 'নিরাপত্তার জন্য অনুমতির মেয়াদ শেষ হওয়ার সময় নির্ধারণ করুন।';
  END IF;

  SELECT mp.manager_at_close_membership_id, p.full_name
    INTO v_closer, v_closer_name
  FROM public.monthly_periods mp
  LEFT JOIN public.hostel_memberships hm ON hm.id = mp.manager_at_close_membership_id
  LEFT JOIN public.profiles p ON p.id = hm.user_id
  WHERE mp.id = p_period_id AND mp.hostel_id = v_hostel_id AND mp.status = 'archived';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'এই আর্কাইভ করা মাসটি পাওয়া যায়নি।';
  END IF;
  IF v_closer IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'এই মাসের closing manager রেকর্ড নেই; নিরাপদে অনুমতি দেওয়া যাচ্ছে না।';
  END IF;
  IF p_membership_id IS DISTINCT FROM v_closer THEN
    RAISE EXCEPTION USING MESSAGE = 'শুধু এই মাস যিনি বন্ধ করেছেন, তাকেই সম্পাদনার অনুমতি দেওয়া যাবে।';
  END IF;
  IF v_closer = v_manager THEN
    RAISE EXCEPTION USING MESSAGE = 'আপনি নিজেই এই মাস বন্ধ করেছেন; আলাদা permission না দিয়েই সম্পাদনা করতে পারবেন।';
  END IF;
  PERFORM private.assert_membership(v_closer, v_hostel_id, true);

  UPDATE public.archive_edit_permissions
     SET revoked_at = now(), revoked_by = v_manager
   WHERE hostel_id = v_hostel_id AND period_id = p_period_id
     AND membership_id = v_closer AND revoked_at IS NULL;

  INSERT INTO public.archive_edit_permissions(
    hostel_id, period_id, membership_id, granted_by, reason, expires_at
  ) VALUES (
    v_hostel_id, p_period_id, v_closer, v_manager,
    nullif(trim(coalesce(p_reason, '')), ''), p_expires_at
  ) RETURNING id INTO v_permission_id;

  SELECT p.full_name INTO v_actor_name
  FROM public.hostel_memberships hm JOIN public.profiles p ON p.id=hm.user_id
  WHERE hm.id=v_manager;
  INSERT INTO private.archive_period_audit(
    hostel_id, period_id, actor_membership_id, actor_name_snapshot,
    action, entity_table, entity_id, summary
  ) VALUES (
    v_hostel_id, p_period_id, v_manager, COALESCE(v_actor_name, 'ম্যানেজার'),
    'archive_edit_granted', 'archive_edit_permissions', v_permission_id::text,
    format('%s-কে %s পর্যন্ত আর্কাইভ সম্পাদনার অনুমতি দেওয়া হয়েছে', COALESCE(v_closer_name,'আগের মাসের ম্যানেজার'), to_char(p_expires_at AT TIME ZONE 'Asia/Dhaka','DD Mon YYYY HH12:MI AM'))
  );

  INSERT INTO public.notifications(
    hostel_id, notification_type, title, body, reference_type,
    reference_id, created_by, target_membership_id
  ) VALUES (
    v_hostel_id, 'system', 'আর্কাইভ সম্পাদনার অনুমতি দেওয়া হয়েছে',
    format('“%s” মাসের হিসাব %s পর্যন্ত সম্পাদনা করতে পারবেন। মেনু থেকে “আর্কাইভ সম্পাদনা” খুলুন.',
      (SELECT mp.label FROM public.monthly_periods mp WHERE mp.id=p_period_id),
      to_char(p_expires_at AT TIME ZONE 'Asia/Dhaka','DD Mon YYYY HH12:MI AM')),
    'archive_period', p_period_id, v_manager, v_closer
  );
  RETURN v_permission_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_archive_edit_permission(p_permission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_hostel_id uuid;
  v_manager uuid;
  v_period_id uuid;
  v_member_id uuid;
  v_actor_name text;
  v_target_name text;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel_id := private.current_hostel_id(true);
  v_manager := private.current_membership_id(true);
  IF NOT private.is_primary_manager_for_hostel(v_hostel_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'শুধু বর্তমান ম্যানেজার permission বাতিল করতে পারবেন।';
  END IF;

  SELECT period_id, membership_id INTO v_period_id, v_member_id
  FROM public.archive_edit_permissions
  WHERE id=p_permission_id AND hostel_id=v_hostel_id AND revoked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'Permission পাওয়া যায়নি বা ইতিমধ্যে বাতিল।';
  END IF;

  UPDATE public.archive_edit_permissions
     SET revoked_at=now(), revoked_by=v_manager
   WHERE id=p_permission_id;

  SELECT p.full_name INTO v_actor_name FROM public.hostel_memberships hm JOIN public.profiles p ON p.id=hm.user_id WHERE hm.id=v_manager;
  SELECT p.full_name INTO v_target_name FROM public.hostel_memberships hm JOIN public.profiles p ON p.id=hm.user_id WHERE hm.id=v_member_id;
  INSERT INTO private.archive_period_audit(
    hostel_id, period_id, actor_membership_id, actor_name_snapshot,
    action, entity_table, entity_id, summary
  ) VALUES (
    v_hostel_id,v_period_id,v_manager,COALESCE(v_actor_name,'ম্যানেজার'),
    'archive_edit_revoked','archive_edit_permissions',p_permission_id::text,
    format('%s-এর আর্কাইভ সম্পাদনার অনুমতি বাতিল করা হয়েছে',COALESCE(v_target_name,'closing manager'))
  );

  INSERT INTO public.notifications(
    hostel_id, notification_type, title, body, reference_type,
    reference_id, created_by, target_membership_id
  ) VALUES (
    v_hostel_id, 'system', 'আর্কাইভ সম্পাদনার অনুমতি বাতিল হয়েছে',
    format('“%s” মাসের হিসাব সম্পাদনার অস্থায়ী অনুমতি বাতিল করা হয়েছে.',
      (SELECT mp.label FROM public.monthly_periods mp WHERE mp.id=v_period_id)),
    'archive_period', v_period_id, v_manager, v_member_id
  );
END;
$function$;

-- Accidental-close recovery. Allowed only to the exact closing manager, only while
-- no newer/current period exists and during that period's calendar month.
CREATE OR REPLACE FUNCTION public.reopen_archived_period(p_period_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_hostel uuid;
  v_actor uuid;
  v_today date;
  v_period public.monthly_periods;
  v_month_start date;
  v_month_end date;
  v_restore_end date;
  v_actor_name text;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  v_actor := private.current_membership_id(true);
  v_today := private.current_local_date(v_hostel);

  IF NOT EXISTS (
    SELECT 1 FROM public.hostel_memberships hm
    WHERE hm.id=v_actor AND hm.hostel_id=v_hostel AND hm.status='active' AND hm.role='manager'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'মাস পুনরায় চালু করতে বর্তমান প্রধান ম্যানেজার হতে হবে।';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('hostel-period-reopen:' || v_hostel::text, 0));
  SELECT * INTO v_period FROM public.monthly_periods
  WHERE id=p_period_id AND hostel_id=v_hostel FOR UPDATE;
  IF NOT FOUND OR v_period.status <> 'archived' THEN
    RAISE EXCEPTION USING MESSAGE = 'শুধু আর্কাইভে থাকা মাস পুনরায় চালু করা যাবে।';
  END IF;
  IF v_period.manager_at_close_membership_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION USING MESSAGE = 'নিরাপত্তার জন্য যে প্রধান ম্যানেজার মাসটি বন্ধ করেছেন, শুধু তিনিই সেটি পুনরায় চালু করতে পারবেন।';
  END IF;
  IF EXISTS (SELECT 1 FROM public.monthly_periods mp WHERE mp.hostel_id=v_hostel AND mp.status='running') THEN
    RAISE EXCEPTION USING MESSAGE = 'ইতিমধ্যে একটি চলমান মাস আছে। আগে সেটির অবস্থা যাচাই করুন।';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.monthly_periods newer
    WHERE newer.hostel_id=v_hostel
      AND (newer.start_date>v_period.start_date OR (newer.start_date=v_period.start_date AND newer.created_at>v_period.created_at))
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'এই মাসের পরে নতুন period তৈরি হয়েছে; পুরোনো মাস সরাসরি reopen করা যাবে না।';
  END IF;

  v_month_start := date_trunc('month',v_period.start_date::timestamp)::date;
  v_month_end := (date_trunc('month',v_period.start_date::timestamp) + interval '1 month - 1 day')::date;
  IF v_today < v_month_start OR v_today > v_month_end THEN
    RAISE EXCEPTION USING MESSAGE = 'শুধু একই calendar month-এর মধ্যে ভুলবশত বন্ধ করা মাস পুনরায় চালু করা যাবে।';
  END IF;

  -- For periods closed before this migration, the original end date was not retained.
  -- Use the calendar month end as the documented fallback; extend at least through today.
  v_restore_end := LEAST(v_month_end, GREATEST(COALESCE(v_period.pre_close_end_date,v_month_end),v_today));
  IF v_restore_end < v_today THEN
    RAISE EXCEPTION USING MESSAGE = 'পুনরায় চালুর জন্য period end date বৈধ নয়।';
  END IF;

  -- Preserve the cached summary row. The close workflow's existing upsert refreshes it on the next close.
  UPDATE public.monthly_periods
     SET status='running', end_date=v_restore_end, archived_at=NULL,
         primary_manager_membership_id=v_actor, updated_at=now()
   WHERE id=v_period.id;

  PERFORM private.ensure_period_days(v_period.id);
  SELECT p.full_name INTO v_actor_name FROM public.hostel_memberships hm JOIN public.profiles p ON p.id=hm.user_id WHERE hm.id=v_actor;
  INSERT INTO private.archive_period_audit(
    hostel_id,period_id,actor_membership_id,actor_name_snapshot,action,entity_table,entity_id,summary
  ) VALUES (
    v_hostel,v_period.id,v_actor,COALESCE(v_actor_name,'ম্যানেজার'),
    'period_reopened','monthly_periods',v_period.id::text,
    format('%s মাস পুনরায় চালু করা হয়েছে। বাতিল হওয়া ভবিষ্যৎ request স্বয়ংক্রিয়ভাবে ফেরত আসে না।',v_period.label)
  );
  INSERT INTO public.notifications(hostel_id,notification_type,title,body,created_by)
  VALUES(v_hostel,'system','মাস পুনরায় চালু হয়েছে',v_period.label||' মাস আবার চালু করা হয়েছে। ভবিষ্যৎ request প্রয়োজন হলে পুনরায় জমা দিন।',v_actor);

  RETURN jsonb_build_object(
    'period_id',v_period.id,'label',v_period.label,'status','running',
    'start_date',v_period.start_date,'end_date',v_restore_end,
    'cancelled_requests_restored',false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_archive_management_items()
RETURNS TABLE(
  period_id uuid,
  label text,
  start_date date,
  end_date date,
  detail_available boolean,
  manager_at_close_membership_id uuid,
  manager_at_close_name text,
  closer_is_active boolean,
  current_manager_is_closer boolean,
  can_grant_closer_edit boolean,
  can_reopen boolean,
  archived_at timestamptz,
  last_edit_at timestamptz,
  last_edit_by text,
  last_edit_summary text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_hostel uuid;
  v_actor uuid;
  v_today date;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  v_actor := private.current_membership_id(true);
  v_today := private.current_local_date(v_hostel);
  IF NOT private.is_primary_manager_for_hostel(v_hostel) THEN
    RAISE EXCEPTION USING MESSAGE = 'শুধু প্রধান ম্যানেজার archive management দেখতে পারবেন।';
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT mp.*, row_number() OVER (ORDER BY mp.end_date DESC,mp.created_at DESC) AS rn
    FROM public.monthly_periods mp
    WHERE mp.hostel_id=v_hostel AND mp.status='archived'
  )
  SELECT
    r.id, r.label, r.start_date, r.end_date, (r.rn<=3),
    r.manager_at_close_membership_id, closer_profile.full_name,
    COALESCE(closer.status='active',false),
    (r.manager_at_close_membership_id=v_actor AND actor.role='manager' AND actor.status='active'),
    (r.manager_at_close_membership_id IS NOT NULL
      AND r.manager_at_close_membership_id<>v_actor
      AND actor.role='manager' AND actor.status='active'
      AND closer.status='active'),
    (r.manager_at_close_membership_id=v_actor
      AND actor.role='manager' AND actor.status='active')
      AND NOT EXISTS (SELECT 1 FROM public.monthly_periods cur WHERE cur.hostel_id=v_hostel AND cur.status='running')
      AND NOT EXISTS (
        SELECT 1 FROM public.monthly_periods newer WHERE newer.hostel_id=v_hostel
          AND (newer.start_date>r.start_date OR (newer.start_date=r.start_date AND newer.created_at>r.created_at))
      )
      AND v_today >= date_trunc('month',r.start_date::timestamp)::date
      AND v_today <= (date_trunc('month',r.start_date::timestamp)+interval '1 month - 1 day')::date,
    r.archived_at,
    last_audit.created_at,
    last_audit.actor_name_snapshot,
    last_audit.summary
  FROM ranked r
  LEFT JOIN public.hostel_memberships closer ON closer.id=r.manager_at_close_membership_id AND closer.hostel_id=v_hostel
  LEFT JOIN public.profiles closer_profile ON closer_profile.id=closer.user_id
  LEFT JOIN public.hostel_memberships actor ON actor.id=v_actor AND actor.hostel_id=v_hostel
  LEFT JOIN LATERAL (
    SELECT a.created_at,a.actor_name_snapshot,a.summary
    FROM private.archive_period_audit a
    WHERE a.period_id=r.id
    ORDER BY a.created_at DESC,a.id DESC
    LIMIT 1
  ) last_audit ON true
  ORDER BY r.end_date DESC,r.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_archive_period_audit(p_period_id uuid)
RETURNS TABLE(
  created_at timestamptz,
  actor_name text,
  action text,
  entity_table text,
  entity_id text,
  summary text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_hostel uuid;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  IF NOT EXISTS (SELECT 1 FROM public.monthly_periods mp WHERE mp.id=p_period_id AND mp.hostel_id=v_hostel) THEN
    RAISE EXCEPTION USING MESSAGE = 'এই period-এর history পাওয়া যায়নি।';
  END IF;
  RETURN QUERY
  SELECT a.created_at,a.actor_name_snapshot,a.action,a.entity_table,a.entity_id,a.summary
  FROM private.archive_period_audit a
  WHERE a.hostel_id=v_hostel AND a.period_id=p_period_id
  ORDER BY a.created_at DESC,a.id DESC
  LIMIT 100;
END;
$function$;

-- Return only archived periods the caller is currently authorized to edit.
-- This supports the previous closer's visible navigation without exposing other archives.
CREATE OR REPLACE FUNCTION public.get_my_archive_editable_periods()
RETURNS TABLE(
  period_id uuid,
  label text,
  start_date date,
  end_date date,
  manager_at_close_name text,
  expires_at timestamptz,
  access_kind text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_hostel uuid;
  v_actor uuid;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  v_actor := private.current_membership_id(true);

  RETURN QUERY
  SELECT mp.id, mp.label, mp.start_date, mp.end_date,
         COALESCE(closer_profile.full_name, 'আগের মাসের ম্যানেজার'),
         CASE WHEN mp.manager_at_close_membership_id = v_actor THEN NULL::timestamptz ELSE aep.expires_at END,
         CASE WHEN mp.manager_at_close_membership_id = v_actor THEN 'নিজে মাস বন্ধ করেছেন' ELSE 'অস্থায়ী অনুমতি' END
  FROM public.monthly_periods mp
  LEFT JOIN public.hostel_memberships closer ON closer.id = mp.manager_at_close_membership_id
  LEFT JOIN public.profiles closer_profile ON closer_profile.id = closer.user_id
  LEFT JOIN LATERAL (
    SELECT p.expires_at
    FROM public.archive_edit_permissions p
    WHERE p.period_id = mp.id AND p.membership_id = v_actor
      AND p.revoked_at IS NULL AND p.expires_at > now()
    ORDER BY p.created_at DESC LIMIT 1
  ) aep ON true
  WHERE mp.hostel_id = v_hostel
    AND mp.status = 'archived'
    AND private.can_manage_period(mp.id)
  ORDER BY mp.end_date DESC, mp.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_archive_editable_periods() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_archive_editable_periods() TO authenticated;

-- Member deactivation/reactivation must still work for the current primary manager when
-- no running period exists. When a period is running, period-primary identity remains authoritative.
CREATE OR REPLACE FUNCTION public.deactivate_member(p_membership_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_hostel uuid;
  v_actor uuid;
  v_role public.membership_role;
  v_status public.membership_status;
  v_today date;
  v_period_id uuid;
  v_period_primary uuid;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel:=private.current_hostel_id(true);
  v_actor:=private.current_membership_id(true);
  v_today:=private.current_local_date(v_hostel);

  SELECT id,primary_manager_membership_id INTO v_period_id,v_period_primary
  FROM public.monthly_periods WHERE hostel_id=v_hostel AND status='running'
  ORDER BY start_date DESC,created_at DESC LIMIT 1;

  IF v_period_id IS NOT NULL THEN
    IF v_period_primary IS DISTINCT FROM v_actor OR NOT EXISTS (
      SELECT 1 FROM public.hostel_memberships hm WHERE hm.id=v_actor AND hm.hostel_id=v_hostel AND hm.status='active' AND hm.role='manager'
    ) THEN
      RAISE EXCEPTION USING MESSAGE='চলমান মাসে শুধু বর্তমান প্রধান ম্যানেজার সদস্য নিষ্ক্রিয় করতে পারবেন।';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.hostel_memberships hm
    WHERE hm.id=v_actor AND hm.hostel_id=v_hostel AND hm.status='active' AND hm.role='manager'
  ) THEN
    RAISE EXCEPTION USING MESSAGE='শুধু প্রধান ম্যানেজার সদস্য নিষ্ক্রিয় করতে পারবেন।';
  END IF;

  SELECT role,status INTO v_role,v_status FROM public.hostel_memberships
  WHERE id=p_membership_id AND hostel_id=v_hostel FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION USING MESSAGE='সদস্য পাওয়া যায়নি।'; END IF;
  IF p_membership_id=v_actor THEN RAISE EXCEPTION USING MESSAGE='নিজেকে নিষ্ক্রিয় করা যাবে না।'; END IF;
  IF v_role='manager' AND v_status='active' THEN RAISE EXCEPTION USING MESSAGE='ম্যানেজারকে নিষ্ক্রিয় করার আগে ম্যানেজার পরিবর্তন করুন।'; END IF;
  IF v_status='inactive' THEN RAISE EXCEPTION USING MESSAGE='সদস্যটি ইতিমধ্যে নিষ্ক্রিয়।'; END IF;

  UPDATE public.hostel_memberships
     SET status='inactive',deactivated_at=now(),deactivated_by=auth.uid(),updated_at=now()
   WHERE id=p_membership_id AND hostel_id=v_hostel;
  PERFORM private.cancel_member_future_meals(p_membership_id,v_hostel,v_today+1);
  DELETE FROM public.period_assistant_managers
   WHERE membership_id=p_membership_id
     AND period_id IN (SELECT id FROM public.monthly_periods WHERE hostel_id=v_hostel AND status='running');
  INSERT INTO public.notifications(hostel_id,notification_type,title,body,created_by)
  VALUES(v_hostel,'system','সদস্য নিষ্ক্রিয় করা হয়েছে','একজন সদস্যকে নিষ্ক্রিয় করা হয়েছে।',v_actor);
  RETURN jsonb_build_object('membership_id',p_membership_id,'status','inactive');
END;
$function$;

CREATE OR REPLACE FUNCTION public.reactivate_member(p_membership_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_hostel uuid;
  v_actor uuid;
  v_status public.membership_status;
  v_period_id uuid;
  v_period_primary uuid;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel:=private.current_hostel_id(true);
  v_actor:=private.current_membership_id(true);
  SELECT id,primary_manager_membership_id INTO v_period_id,v_period_primary
  FROM public.monthly_periods WHERE hostel_id=v_hostel AND status='running'
  ORDER BY start_date DESC,created_at DESC LIMIT 1;

  IF v_period_id IS NOT NULL THEN
    IF v_period_primary IS DISTINCT FROM v_actor OR NOT EXISTS (
      SELECT 1 FROM public.hostel_memberships hm WHERE hm.id=v_actor AND hm.hostel_id=v_hostel AND hm.status='active' AND hm.role='manager'
    ) THEN
      RAISE EXCEPTION USING MESSAGE='চলমান মাসে শুধু বর্তমান প্রধান ম্যানেজার সদস্য পুনরায় সক্রিয় করতে পারবেন।';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.hostel_memberships hm
    WHERE hm.id=v_actor AND hm.hostel_id=v_hostel AND hm.status='active' AND hm.role='manager'
  ) THEN
    RAISE EXCEPTION USING MESSAGE='শুধু প্রধান ম্যানেজার সদস্য পুনরায় সক্রিয় করতে পারবেন।';
  END IF;

  SELECT status INTO v_status FROM public.hostel_memberships
  WHERE id=p_membership_id AND hostel_id=v_hostel FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION USING MESSAGE='সদস্য পাওয়া যায়নি।'; END IF;
  IF p_membership_id=v_actor THEN RAISE EXCEPTION USING MESSAGE='নিজেকে পুনরায় সক্রিয় করার দরকার নেই।'; END IF;
  IF v_status='active' THEN RAISE EXCEPTION USING MESSAGE='সদস্যটি ইতিমধ্যে সক্রিয় আছে।'; END IF;

  UPDATE public.hostel_memberships
     SET status='active',reactivated_at=now(),reactivated_by=auth.uid(),updated_at=now()
   WHERE id=p_membership_id AND hostel_id=v_hostel;
  INSERT INTO public.notifications(hostel_id,notification_type,title,body,created_by)
  VALUES(v_hostel,'system','সদস্য পুনরায় সক্রিয় করা হয়েছে','একজন সদস্যকে পুনরায় সক্রিয় করা হয়েছে।',v_actor);
  RETURN jsonb_build_object('membership_id',p_membership_id,'status','active');
END;
$function$;

-- New directory response adds a safe current-period assistant flag without changing v2's return type.
CREATE OR REPLACE FUNCTION public.get_member_directory_v3()
RETURNS TABLE(
  membership_id uuid,
  member_name text,
  member_status public.membership_status,
  role public.membership_role,
  meal_activity text,
  final_meals numeric,
  deposit numeric,
  meal_cost numeric,
  other_expense numeric,
  balance numeric,
  is_assistant_manager boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT d.membership_id,d.member_name,d.member_status,d.role,d.meal_activity,
         d.final_meals,d.deposit,d.meal_cost,d.other_expense,d.balance,
         EXISTS (
           SELECT 1
           FROM public.period_assistant_managers pam
           JOIN public.monthly_periods mp ON mp.id=pam.period_id AND mp.status='running'
           WHERE pam.membership_id=d.membership_id
             AND mp.hostel_id=private.current_hostel_id(true)
         ) AS is_assistant_manager
  FROM public.get_member_directory_v2() d;
$function$;

-- v4 adds period-authoritative primary-manager identity separately from the legacy
-- membership role. This avoids showing stale manager power after a period manager change.
CREATE OR REPLACE FUNCTION public.get_member_directory_v4()
RETURNS TABLE(
  membership_id uuid,
  member_name text,
  member_status public.membership_status,
  role public.membership_role,
  meal_activity text,
  final_meals numeric,
  deposit numeric,
  meal_cost numeric,
  other_expense numeric,
  balance numeric,
  is_assistant_manager boolean,
  is_primary_manager boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT d.membership_id,
         d.member_name,
         d.member_status,
         d.role,
         d.meal_activity,
         d.final_meals,
         d.deposit,
         d.meal_cost,
         d.other_expense,
         d.balance,
         EXISTS (
           SELECT 1
           FROM public.period_assistant_managers pam
           JOIN public.monthly_periods mp ON mp.id = pam.period_id AND mp.status = 'running'
           WHERE pam.membership_id = d.membership_id
             AND mp.hostel_id = private.current_hostel_id(true)
         ) AS is_assistant_manager,
         CASE WHEN running.primary_manager_membership_id IS NULL THEN (d.role = 'manager') ELSE (running.primary_manager_membership_id = d.membership_id) END AS is_primary_manager
  FROM public.get_member_directory_v2() d
  LEFT JOIN LATERAL (
    SELECT mp.primary_manager_membership_id
    FROM public.monthly_periods mp
    WHERE mp.hostel_id = private.current_hostel_id(true)
      AND mp.status = 'running'
    ORDER BY mp.start_date DESC, mp.created_at DESC
    LIMIT 1
  ) running ON true;
$function$;

REVOKE ALL ON FUNCTION public.get_member_directory_v3() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_directory_v3() TO authenticated;
REVOKE ALL ON FUNCTION public.get_member_directory_v4() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_directory_v4() TO authenticated;
REVOKE ALL ON FUNCTION public.get_archive_management_items() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_archive_management_items() TO authenticated;
REVOKE ALL ON FUNCTION public.get_archive_period_audit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_archive_period_audit(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.reopen_archived_period(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_archived_period(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.grant_archive_edit_permission(uuid,uuid,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_archive_edit_permission(uuid,uuid,timestamptz,text) TO authenticated;
REVOKE ALL ON FUNCTION public.revoke_archive_edit_permission(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_archive_edit_permission(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.deactivate_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_member(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.reactivate_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_member(uuid) TO authenticated;

COMMIT;

SELECT 'ARCHIVE_ROLE_RECOVERY' AS check_name, 'committed' AS result
UNION ALL SELECT 'PRE_CLOSE_END_DATE_COLUMN', CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='monthly_periods' AND column_name='pre_close_end_date'
) THEN 'present' ELSE 'missing' END
UNION ALL SELECT 'ARCHIVE_AUDIT_TABLE', CASE WHEN to_regclass('private.archive_period_audit') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL SELECT 'ARCHIVE_AUDIT_ROW_TRIGGERS', count(*)::text
  FROM pg_trigger t
  JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND t.tgname LIKE 'trg_archive_audit_%' AND NOT t.tgisinternal AND t.tgenabled='O'
UNION ALL SELECT 'TARGETED_NOTIFICATION_COLUMN', CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='target_membership_id'
) THEN 'present' ELSE 'missing' END
UNION ALL SELECT 'ARCHIVE_MANAGEMENT_RPC', CASE WHEN to_regprocedure('public.get_archive_management_items()') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL SELECT 'REOPEN_ARCHIVED_PERIOD_RPC', CASE WHEN to_regprocedure('public.reopen_archived_period(uuid)') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL SELECT 'MEMBER_DIRECTORY_V3', CASE WHEN to_regprocedure('public.get_member_directory_v3()') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL SELECT 'MEMBER_DIRECTORY_V4', CASE WHEN to_regprocedure('public.get_member_directory_v4()') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL SELECT 'MY_ARCHIVE_EDITABLE_PERIODS_RPC', CASE WHEN to_regprocedure('public.get_my_archive_editable_periods()') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL SELECT 'CURRENT_RUNNING_PERIODS', count(*)::text FROM public.monthly_periods WHERE status='running'
UNION ALL SELECT 'RUNNING_PRIMARY_POINTER_MISMATCHES', count(*)::text
  FROM public.monthly_periods mp
  WHERE mp.status='running'
    AND EXISTS (SELECT 1 FROM public.hostel_memberships hm WHERE hm.hostel_id=mp.hostel_id AND hm.status='active' AND hm.role='manager')
    AND NOT EXISTS (SELECT 1 FROM public.hostel_memberships hm WHERE hm.id=mp.primary_manager_membership_id AND hm.hostel_id=mp.hostel_id AND hm.status='active' AND hm.role='manager')
UNION ALL SELECT 'HOSTELS_WITH_MULTIPLE_ACTIVE_ROLE_MANAGERS', count(*)::text
  FROM (SELECT hostel_id FROM public.hostel_memberships WHERE status='active' AND role='manager' GROUP BY hostel_id HAVING count(*)>1) duplicates
UNION ALL SELECT 'ARCHIVED_PERIODS_WITHOUT_CLOSER', count(*)::text
  FROM public.monthly_periods WHERE status='archived' AND manager_at_close_membership_id IS NULL;
