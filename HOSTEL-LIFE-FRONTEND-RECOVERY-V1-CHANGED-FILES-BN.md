# Changed files — Hostel Life Frontend Recovery V1

Application source changes:
- `src/features/dining/DiningPage.jsx`
- `src/features/dashboard/DashboardPage.jsx`
- `src/features/history/HistoryPage.jsx` — manager account row detail modal; eligible entries detail থেকেই edit করা যাবে.
- `src/features/menu/MenuPages.jsx`
- `src/components/Icon.jsx`
- `src/styles/ui-refresh.css` — ইতিহাস, account detail modal, late-request card/detail, arrears red state, member account rows ও Khala view-এর targeted styling.

Added database scripts (not auto-run):
- `supabase/HOSTEL_LIFE_ACCOUNT_HISTORY_SCOPE_V1.sql` — function-level change required for same-hostel all-history scope; preserves return type; no business table DML.
- `supabase/READ_ONLY_MARKET_DIAGNOSTIC_V2.sql` — read-only diagnostics only; does not repair market writes by itself.

Added documentation:
- `HOSTEL-LIFE-FRONTEND-RECOVERY-V1-README-BN.md`
- `HOSTEL-LIFE-FRONTEND-RECOVERY-V1-TEST-CHECKLIST-BN.md`
- `HOSTEL-LIFE-FRONTEND-RECOVERY-V1-CHANGED-FILES-BN.md`
