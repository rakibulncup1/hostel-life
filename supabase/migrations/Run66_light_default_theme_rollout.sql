-- Run66: make Light the platform default and retire the Super Admin global theme setter.
-- Scope is intentionally limited to one settings field and one RPC permission.
-- Existing users' browser-local preferences are migrated once by src/app/theme.js.

BEGIN;

ALTER TABLE public.platform_settings
  ALTER COLUMN default_theme SET DEFAULT 'light';

UPDATE public.platform_settings
SET default_theme = 'light',
    updated_at = now()
WHERE singleton = true
  AND default_theme IS DISTINCT FROM 'light';

-- Personal theme selection remains client-side in the member Profile/AppShell.
-- Keep the legacy RPC definition for rollback/audit compatibility, but prevent
-- authenticated clients (including Super Admin sessions) from invoking it.
REVOKE EXECUTE ON FUNCTION public.platform_admin_set_default_theme(text)
  FROM PUBLIC, anon, authenticated;

COMMIT;
