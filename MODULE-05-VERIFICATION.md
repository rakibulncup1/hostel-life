# Module 05 Source Verification

## Checked
- All newly referenced local files exist.
- New services use existing Supabase RPC/function names from the Master SQL.
- `hostel_documents` upload path follows the existing storage policy: first path segment is the authenticated user UUID.
- Profile upload enforces 2 MiB in the client and updates the existing profile through `update_my_profile`.
- Notification functions match existing grants:
  - `get_notifications(integer)`
  - `mark_notification_seen(uuid)`
  - `delete_my_notification(uuid)`
  - `manager_send_notification(text,text)`
  - `manager_delete_notification(uuid)`
- History functions match existing grants:
  - `get_market_history(uuid,integer)`
  - `get_market_detail(uuid)`
  - `get_account_history(uuid,uuid,integer)`
  - `get_khala_money_history(uuid,integer)`
  - `get_previous_months()`
  - `get_archived_month_detail(uuid)`
- Ranking functions match existing grants:
  - `get_top_eaters()`
  - `get_top_shoppers()`
- App routes for Module 05 menu pages are wired into the existing SPA navigation.
- Module 05 remains online-only outside the existing Dashboard Meal Card offline feature.

## Runtime limitation
The build environment used for packaging did not have npm dependencies installed and `npm install` timed out, so a full Vite production build was not completed in the packaging environment. Run `npm install` / `npm run build` on the prepared Windows development machine for final runtime verification.
