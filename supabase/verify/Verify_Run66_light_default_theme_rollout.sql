-- Run66 verification: expected default_theme is Light and authenticated users
-- cannot call the retired global theme setter.

SELECT
  column_default,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'platform_settings'
  AND column_name = 'default_theme';

SELECT singleton, default_theme
FROM public.platform_settings
WHERE singleton = true;

SELECT
  has_function_privilege('authenticated', 'public.platform_admin_set_default_theme(text)', 'EXECUTE')
    AS authenticated_can_set_global_theme,
  has_function_privilege('anon', 'public.platform_admin_set_default_theme(text)', 'EXECUTE')
    AS anon_can_set_global_theme;

-- Expected: column_default='light', setting row default_theme='light',
-- authenticated_can_set_global_theme=false, anon_can_set_global_theme=false.
