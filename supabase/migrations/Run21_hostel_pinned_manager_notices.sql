-- HOSTEL LIFE — Run 21: Hostel-scoped pinned manager notices
-- Purpose: show one persistent in-app banner to all current and future active
-- members of the SAME hostel. It is separate from platform-wide announcements.
-- Existing manager notification inbox copies remain supported.
-- Run once after the existing Run1–Run20 migrations have been applied.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF to_regclass('public.notifications') IS NULL
     OR to_regclass('public.hostels') IS NULL THEN
    RAISE EXCEPTION 'Run21 preflight failed: expected notifications/hostels tables are missing. No changes applied.';
  END IF;
  IF to_regprocedure('private.my_hostel_id()') IS NULL
     OR to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.assert_hostel_manager(uuid,uuid,boolean,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Run21 preflight failed: expected identity/manager helpers are missing. No changes applied.';
  END IF;
END
$preflight$;

-- A single current announcement row per hostel guarantees that newly joined
-- members also see the current pinned message without copying old notices again.
CREATE TABLE IF NOT EXISTS public.hostel_pinned_announcements (
  hostel_id uuid PRIMARY KEY REFERENCES public.hostels(id) ON DELETE CASCADE,
  announcement_batch_id uuid NOT NULL UNIQUE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 3000),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hostel_pinned_announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hostel_pinned_announcements FROM PUBLIC, anon, authenticated;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS announcement_batch_id uuid;
CREATE INDEX IF NOT EXISTS hostel_notifications_announcement_batch_idx
  ON public.notifications(hostel_id, announcement_batch_id)
  WHERE announcement_batch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_notifications(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'notification_id', n.id,
        'id', n.id,
        'title', n.title,
        'body', n.body,
        'created_at', n.created_at,
        'seen_at', n.seen_at,
        'is_seen', n.seen_at IS NOT NULL,
        'created_by', n.created_by,
        'announcement_batch_id', n.announcement_batch_id,
        'is_pinned', EXISTS (
          SELECT 1 FROM public.hostel_pinned_announcements a
          WHERE a.hostel_id = n.hostel_id
            AND a.announcement_batch_id = n.announcement_batch_id
        )
      ) ORDER BY n.created_at DESC
    ), '[]'::jsonb
  )
  INTO v_result
  FROM (
    SELECT *
    FROM public.notifications
    WHERE hostel_id = v_hostel
      AND recipient_user_id = auth.uid()
      AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  ) n;
  RETURN v_result;
END
$function$;

-- This endpoint reads the current hostel-level announcement, not the recipient's
-- inbox copy. It therefore works for members who join after the manager posts it.
CREATE OR REPLACE FUNCTION public.get_hostel_pinned_announcement()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF v_hostel IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'announcement_batch_id', a.announcement_batch_id,
    'title', a.title,
    'body', a.body,
    'created_at', a.created_at,
    'updated_at', a.updated_at,
    'created_by', a.created_by,
    'is_pinned', true
  )
  INTO v_result
  FROM public.hostel_pinned_announcements a
  WHERE a.hostel_id = v_hostel
  LIMIT 1;
  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION public.manager_send_notification(p_title text, p_body text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_count integer := 0;
  v_title text := btrim(COALESCE(p_title, ''));
  v_body text := btrim(COALESCE(p_body, ''));
  v_batch_id uuid := gen_random_uuid();
BEGIN
  PERFORM private.assert_signed_in();
  PERFORM private.assert_hostel_manager(v_hostel, NULL, false, false);

  IF v_title = '' OR length(v_title) > 160 THEN
    RAISE EXCEPTION USING MESSAGE = 'নোটিশের শিরোনাম ১ থেকে ১৬০ অক্ষরের হতে হবে।', ERRCODE = '22023';
  END IF;
  IF v_body = '' OR length(v_body) > 3000 THEN
    RAISE EXCEPTION USING MESSAGE = 'নোটিশের বিবরণ ১ থেকে ৩০০০ অক্ষরের হতে হবে।', ERRCODE = '22023';
  END IF;

  -- Serialize manager sends to make replacement atomic per hostel.
  PERFORM pg_advisory_xact_lock(hashtextextended('hostel-life-pinned-notice:' || v_hostel::text, 0));

  INSERT INTO public.hostel_pinned_announcements(
    hostel_id, announcement_batch_id, title, body, created_by, created_at, updated_at
  ) VALUES (
    v_hostel, v_batch_id, v_title, v_body, auth.uid(), now(), now()
  )
  ON CONFLICT (hostel_id) DO UPDATE SET
    announcement_batch_id = EXCLUDED.announcement_batch_id,
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    created_by = EXCLUDED.created_by,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

  -- Keep the normal bell inbox too; banner visibility itself uses one hostel row.
  INSERT INTO public.notifications(
    hostel_id, recipient_user_id, title, body, created_by, announcement_batch_id
  )
  SELECT v_hostel, m.user_id, v_title, v_body, auth.uid(), v_batch_id
  FROM public.hostel_memberships m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.hostel_id = v_hostel
    AND m.status = 'active'
    AND NOT p.is_blocked;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'এই মেসে নোটিশ পাওয়ার মতো কোনো সক্রিয় সদস্য পাওয়া যায়নি।', ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'sent_count', v_count,
    'is_pinned', true,
    'announcement_batch_id', v_batch_id
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.manager_clear_hostel_pinned_announcement()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_batch_id uuid;
  v_deleted bigint := 0;
BEGIN
  PERFORM private.assert_signed_in();
  PERFORM private.assert_hostel_manager(v_hostel, NULL, false, false);

  DELETE FROM public.hostel_pinned_announcements
  WHERE hostel_id = v_hostel
  RETURNING announcement_batch_id INTO v_batch_id;

  IF v_batch_id IS NULL THEN
    RETURN jsonb_build_object('status', 'no_announcement', 'deleted_count', 0);
  END IF;

  DELETE FROM public.notifications
  WHERE hostel_id = v_hostel AND announcement_batch_id = v_batch_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('status', 'cleared', 'deleted_count', v_deleted);
END
$function$;

-- A member may clear ordinary inbox notifications, but cannot dismiss the active
-- pinned notice that is shown to the whole hostel. A manager controls its removal.
CREATE OR REPLACE FUNCTION public.delete_my_notification(p_notification_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_batch_id uuid;
  v_pinned boolean := false;
BEGIN
  PERFORM private.assert_signed_in();
  SELECT n.announcement_batch_id,
         EXISTS (
           SELECT 1 FROM public.hostel_pinned_announcements a
           WHERE a.hostel_id = n.hostel_id
             AND a.announcement_batch_id = n.announcement_batch_id
         )
  INTO v_batch_id, v_pinned
  FROM public.notifications n
  WHERE n.id = p_notification_id
    AND n.recipient_user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'নোটিফিকেশনটি পাওয়া যায়নি বা এটি আপনার জন্য নয়।', ERRCODE = 'P0002';
  END IF;
  IF v_pinned THEN
    RAISE EXCEPTION USING MESSAGE = 'এটি ম্যানেজারের পিন করা মেস নোটিশ। সরাতে হলে ম্যানেজারকে বলতে হবে।', ERRCODE = '42501';
  END IF;

  DELETE FROM public.notifications
  WHERE id = p_notification_id AND recipient_user_id = auth.uid();
  RETURN jsonb_build_object('status', 'deleted', 'notification_id', p_notification_id, 'deleted_count', 1);
END
$function$;

-- Manager deletion removes the complete batch and clears the banner only when
-- the selected batch is the currently pinned notice. Ordinary messages keep the
-- previous own-inbox behavior.
CREATE OR REPLACE FUNCTION public.manager_delete_notification(p_notification_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_batch_id uuid;
  v_count bigint := 0;
BEGIN
  PERFORM private.assert_signed_in();
  PERFORM private.assert_hostel_manager(v_hostel, NULL, false, false);

  SELECT n.announcement_batch_id INTO v_batch_id
  FROM public.notifications n
  WHERE n.id = p_notification_id
    AND n.hostel_id = v_hostel
    AND n.recipient_user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'নোটিফিকেশনটি আপনার ইনবক্সে পাওয়া যায়নি।', ERRCODE = 'P0002';
  END IF;

  IF v_batch_id IS NOT NULL THEN
    DELETE FROM public.hostel_pinned_announcements
    WHERE hostel_id = v_hostel AND announcement_batch_id = v_batch_id;
    DELETE FROM public.notifications
    WHERE hostel_id = v_hostel AND announcement_batch_id = v_batch_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSE
    DELETE FROM public.notifications
    WHERE id = p_notification_id AND hostel_id = v_hostel AND recipient_user_id = auth.uid();
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('status', 'deleted', 'notification_id', p_notification_id, 'deleted_count', v_count);
END
$function$;

-- Clear all personal inbox items except the current hostel's pinned notice copy.
CREATE OR REPLACE FUNCTION public.delete_all_my_notifications()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_count bigint := 0;
  v_pinned_count bigint := 0;
BEGIN
  PERFORM private.assert_signed_in();
  SELECT count(*) INTO v_pinned_count
  FROM public.notifications n
  JOIN public.hostel_pinned_announcements a
    ON a.hostel_id = n.hostel_id AND a.announcement_batch_id = n.announcement_batch_id
  WHERE n.recipient_user_id = auth.uid();

  DELETE FROM public.notifications n
  WHERE n.recipient_user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.hostel_pinned_announcements a
      WHERE a.hostel_id = n.hostel_id
        AND a.announcement_batch_id = n.announcement_batch_id
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'success',
    'deleted_count', v_count,
    'pinned_preserved_count', v_pinned_count
  );
END
$function$;

REVOKE ALL ON FUNCTION public.get_notifications(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_hostel_pinned_announcement() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.manager_send_notification(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.manager_clear_hostel_pinned_announcement() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_my_notification(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.manager_delete_notification(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_all_my_notifications() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_notifications(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hostel_pinned_announcement() TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_send_notification(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_clear_hostel_pinned_announcement() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_notification(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_delete_notification(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_all_my_notifications() TO authenticated;

COMMIT;
