-- READ ONLY: Run20 Khala recipient-history verification.
-- This query reads PostgreSQL catalogs and aggregate counts only.
SELECT
  'history function exists' AS check_group,
  'public.get_khala_money_history_v2(uuid,integer)' AS object_name,
  to_regprocedure('public.get_khala_money_history_v2(uuid,integer)') IS NOT NULL AS passed,
  CASE WHEN to_regprocedure('public.get_khala_money_history_v2(uuid,integer)') IS NOT NULL THEN 'OK' ELSE 'CHECK' END AS result
UNION ALL
SELECT
  'trigger helper exists',
  'private.hl_preserve_khala_recipient()',
  to_regprocedure('private.hl_preserve_khala_recipient()') IS NOT NULL,
  CASE WHEN to_regprocedure('private.hl_preserve_khala_recipient()') IS NOT NULL THEN 'OK' ELSE 'CHECK' END
UNION ALL
SELECT
  'recipient trigger enabled',
  'public.khala_money_entries.hl_preserve_khala_recipient_on_insert',
  EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid='public.khala_money_entries'::regclass
      AND t.tgname='hl_preserve_khala_recipient_on_insert'
      AND t.tgfoid='private.hl_preserve_khala_recipient()'::regprocedure
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  ),
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid='public.khala_money_entries'::regclass
      AND t.tgname='hl_preserve_khala_recipient_on_insert'
      AND t.tgfoid='private.hl_preserve_khala_recipient()'::regprocedure
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  ) THEN 'OK' ELSE 'CHECK' END
UNION ALL
SELECT
  'authenticated execute',
  'authenticated → public.get_khala_money_history_v2(uuid,integer)',
  has_function_privilege('authenticated','public.get_khala_money_history_v2(uuid,integer)','EXECUTE'),
  CASE WHEN has_function_privilege('authenticated','public.get_khala_money_history_v2(uuid,integer)','EXECUTE') THEN 'OK' ELSE 'CHECK' END
UNION ALL
SELECT
  'anonymous execute denied',
  'anon → public.get_khala_money_history_v2(uuid,integer)',
  NOT has_function_privilege('anon','public.get_khala_money_history_v2(uuid,integer)','EXECUTE'),
  CASE WHEN NOT has_function_privilege('anon','public.get_khala_money_history_v2(uuid,integer)','EXECUTE') THEN 'OK' ELSE 'CHECK' END;

-- Aggregate-only data coverage; no member names, emails, IDs, or amounts exposed.
SELECT
  count(*) AS total_entries,
  count(*) FILTER (WHERE member_id IS NOT NULL) AS entries_with_member_link,
  count(*) FILTER (WHERE NULLIF(NULLIF(btrim(member_name_snapshot),''),'খালার পারিশ্রমিক') IS NOT NULL) AS entries_with_name_snapshot,
  count(*) FILTER (WHERE member_id IS NULL AND NULLIF(NULLIF(btrim(member_name_snapshot),''),'খালার পারিশ্রমিক') IS NULL) AS legacy_entries_without_recipient_identity
FROM public.khala_money_entries;
