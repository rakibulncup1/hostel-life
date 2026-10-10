# Hostel Life — FIX-05

## Reports + History Completion

This release is cumulative on top of `Hostel-Life-Frontend-Fix-04.zip`.

### What FIX-05 solves

- Converts the existing manager report page into a real report center.
- Adds member-wise settlement view using the server-calculated member directory.
- Adds current-month daily meal report with final → actual → planned fallback.
- Adds current-month market/account/member CSV exports.
- Adds a full printable/PDF report containing summary + member settlement + daily meals.
- Prevents ordinary members from opening the manager financial report center.
- Improves History CSV export for market/account history.
- Sorts account history primarily by business `entry_date`, then creation time.
- Adds archive month CSV/PDF export from the existing archive detail modal.
- Excludes void Khala entries from financial summary totals while retaining them in history.
- Keeps void market rows visible but excludes them from active market totals.
- Keeps all changes frontend-only; no new write migration is required.

### Before applying

1. Keep a backup/commit of your current working project.
2. Confirm FIX-04 is already built successfully.
3. Merge/replace the current project with this cumulative package.

### Supabase

No migration is required for the frontend changes in FIX-05.

`supabase/FIX-05-READONLY-PREFLIGHT.sql` is optional and READ-ONLY. It can be run to confirm that the existing report/history RPC dependencies and authenticated execute grants are present.

Do NOT rerun Master SQL or Repair V2.0.2 for FIX-05.

### Build

```bash
npm install
npm run build
```

### Recommended smoke test

- Manager: open Report Center.
- Verify member settlement totals, market total, inflow/outflow and net.
- Download all four CSV reports.
- Open full PDF/print report.
- History → Market → CSV.
- History → Account → CSV.
- History → Previous Month → open a month → CSV/PDF.
- Ordinary member: verify `/app/menu/reports` shows a manager permission notice rather than the financial report.
- Verify void market/Khala rows remain visible in history but do not inflate active financial totals.
