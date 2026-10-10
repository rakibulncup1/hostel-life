# Hostel Life — Manager Feature & Reporting Recovery V1

## Purpose
This package restores manager-feature visibility and functional routing without rebuilding the database. The primary manager role from AuthContext is treated as the immediate authoritative UI fallback while the richer management context loads.

## Included fixes
- Primary manager menu is visible immediately from the authenticated active membership role.
- Management-context RPC failure no longer makes manager controls disappear.
- Dining manager actions remain visible to the primary manager and assistant manager.
- Manager member data is still loaded for Market Entry/Deposit/Other Expense.
- Manager guards have an Auth-role fallback, preventing false "manager permission required" screens.
- Reports are no longer manager-only; every authenticated active member can open the report center.
- Meal Sheet supports member filtering plus CSV / print-PDF for the selected member.
- Public Khala Money summary copy is simplified.

## Intentionally unchanged
- No Supabase migration is included in this package.
- No data is deleted or rewritten by this frontend recovery package.
- Super Admin is not included here.
- Existing Phase 1 / Phase 3 / Core Recovery backend SQL remains the source of truth.

## First-run test order
1. Login as the current primary manager.
2. Open the 3-line menu: verify all manager features appear.
3. Open Dining: verify the six manager actions appear.
4. Open Market Entry and save one controlled test entry.
5. Open Manager → Meal Request and verify existing requests appear.
6. Open Manager → Khala Money, add a test entry, verify it appears, then void/delete the test entry.
7. Open Reports as a normal member and as the manager; verify the permission gate is gone.
8. Open Meal Sheet, select a member, export CSV and open Print/PDF.

## Build validation limitation
Static checks and import/path checks were performed. The environment did not complete `npm ci`, so a production `vite build` could not be truthfully reported as passed.
