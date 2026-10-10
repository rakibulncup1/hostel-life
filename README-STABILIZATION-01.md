# Hostel Life — STABILIZATION-01 README

This release restores the core operational data path after cumulative regressions.

### Backend changes
- Adds `public.get_member_directory_v2()` with direct, resilient accounting calculations and all active/inactive members.
- Adds `public.get_running_period_context()` to avoid client `maybeSingle()` failures when more than one running period exists.
- Adds `public.get_khala_entry_periods_v2()` for explicit running/archived Khala permission selection.
- Adds read-only `public.get_month_close_preflight()` for future request/overlap diagnostics.
- Hardens `private.start_next_period()` so a second running period cannot be created.

No table data is deleted, reset, or truncated by this SQL.

### Frontend changes
- Member-directory consumers now use `get_member_directory_v2()`.
- Dining/market/deposit/report running-period lookup now uses `get_running_period_context()`.
- Khala period selection uses the resilient v2 period RPC.
- Current-month close no longer performs an unnecessary end-date mutation before calling the close RPC for today's close; it directly confirms and closes.
- Manager/assistant member selection, member management, market buyer selection and archive member selection all use the same stable member loader.
- Existing report/history screens keep their existing data semantics; this patch changes the fragile shared loading path rather than redefining accounting rules.

### Intentionally not changed
- Master schema
- RLS model except function-level access through the new RPCs
- Meal pricing rules
- Month calendar rules
- Existing meal-request overlap protection
- Existing market/deposit/Khala write RPCs
- Super Admin

### Validation status
Static syntax/import checks are performed before release. A live Supabase query is not available in this environment, so the included verification SQL must be run against the actual project after installation.
