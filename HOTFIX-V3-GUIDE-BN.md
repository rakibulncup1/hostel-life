# Hostel Life — Hotfix V3 (Super Admin route + market History edit)

## Confirmed source-code findings

1. `vercel.json` did not rewrite `/super-admin` to `/index.html`. On Vercel, a direct visit to this SPA path can return a host-level 404 before React runs. This package adds rewrites for `/super-admin`, `/super-admin/`, and `/super-admin/(.*)`. **Redeploy is required** for the route change to take effect.
2. The prior market V2 authorization helper allowed the running-period manager only when `hostel_memberships.role='manager'` (or assistant). But this project also determines the primary manager from `monthly_periods.primary_manager_membership_id`, while a primary manager's membership role may remain `member`. The helper could therefore deny the real primary manager. V3 allows the active membership referenced by the selected running period, or a role-manager, and continues to use existing `private.can_manage_period()` for archived periods.

## Apply steps

1. Back up Supabase first.
2. Run `supabase/HOSTEL_LIFE_FIX_MARKET_MANAGER_AUTH_V3.sql` once in Supabase SQL Editor. It uses `CREATE OR REPLACE` for existing same-signature functions, no `DROP FUNCTION`, no `CASCADE`, and no direct business-table row updates/deletes. It does update the SQL definitions of the market edit/void RPCs to call the market-specific helper.
3. Deploy this project to Vercel. Do not only copy `vercel.json`; deploy the whole new build.
4. Test while logged in as the primary manager of a running period: open History → Market History → a non-void entry → Edit → change a small test field/amount and save. Then verify totals and the ledger if `credit_to_buyer` is enabled.
5. If it still fails, copy the exact toast/error text from the app and paste it back. Do not repeatedly run the Core all-in-one migration.

## Super Admin path diagnosis

- If direct URL showed Vercel `404 NOT_FOUND`, the missing rewrite was the blocker. After deploying, try `https://YOUR-DOMAIN/super-admin`.
- If the app opens and says role is not `super_admin`, run the role check query below with your own Auth UUID in SQL Editor:

```sql
SELECT p.id, p.email, p.role
FROM public.profiles p
WHERE p.id = 'YOUR-AUTH-USER-UUID'::uuid;
```

Expected exactly one row and `role = 'super_admin'`. Ensure you are signed in using the same email / Auth UID.
- If you see the password re-authentication screen, type the main account password. If password validation fails, ensure the Auth account has an email and that this is the correct password (it re-authenticates against Supabase Auth).
- SQL role promotion alone does not deploy frontend routing; this package must be deployed.

## Validation note

This patch was checked against the bundled project source. It has not been executed against your live Supabase instance. Confirm the SQL reports success and test on a non-critical market entry before relying on it.
