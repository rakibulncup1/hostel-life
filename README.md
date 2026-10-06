# Hostel Life — Module 06

## Final Manager Power + Archive + Reports + Final Integration

Module 06 is the cumulative final integration layer on top of Module 05. It completes the manager-only controls, archive permissions, month lifecycle, member status management, cook/khala money management, reports, manager-side history corrections, and final route integration.

### Included
- New month start / archive transition
- Manager change with immediate role refresh
- Member deactivate / reactivate
- Hostel name update and Join Code regeneration
- Temporary archived-month edit permissions
- Khala/cook money add, edit, void
- Manager corrections for market entries, eligible ledger transactions and khala entries
- Current running-month meal sheet
- CSV report downloads
- Print / browser PDF flow
- Manager-only protected screens
- Service worker cache version `v6`

### Database patch included
Module 06 includes `supabase/MODULE-06-DATABASE-PATCH.sql`. Run this small patch once in the Supabase SQL Editor before testing Manager market edit/void. It makes repeated market corrections safe without rerunning the full Master SQL.

**Do not rerun the full Master SQL just for this module.**

### Run

```powershell
cd "D:\MY PROJECTS\Hostel Life"
npm install
npm run dev
```

For a production-like PWA test:

```powershell
npm run build
npm run preview
```

### Important
- Keep `.env.local` in place and never commit secret/service-role keys.
- Reports are generated on demand and are not permanently stored in Supabase.
- Only the Dashboard Meal Card is offline-capable; all Module 06 management/report operations require internet.
- The SQL patch is an additive function replacement and does not require a schema reset.
