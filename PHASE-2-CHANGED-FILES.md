# Phase 2 — Changed Files

## Source changes
- `src/app/App.jsx`
  - Added the general-member Khala Money viewer route.
  - Added explicit routes/titles for current-month close and assistant-manager pages already present in the current working tree.

- `src/app/AppShell.jsx`
  - Added navigation mapping for the member Khala view.
  - Uses primary/assistant management context for role presentation in the shell.

- `src/components/MenuDrawer.jsx`
  - Added `খালার টাকা` to the common menu for ordinary members.
  - Avoids duplicating the viewer entry for operational managers.
  - Keeps assistant/primary manager menu separation intact.

- `src/features/menu/MenuPages.jsx`
  - Added `KhalaMoneyViewPage`.
  - Added assistant-manager badge and sign-aware balance presentation to All Members.

- `src/features/dining/DiningPage.jsx`
  - Added readable Breakfast/Lunch/Dinner value pills in manager request cards.
  - Added a client-side duplicate-day pre-check for normal request creation/editing.
  - Improved market-entry placeholders for compact screens.

- `src/services/profileService.js`
  - Added browser-side profile-image compression and resizing.
  - Converts uploaded avatars to JPEG and targets <=190 KB.
  - Keeps the existing `userId/profile-avatar` path with `upsert: true` so replacement does not create a new per-user path.

- `src/features/profile/ProfilePage.jsx`
  - Updated user-facing avatar size guidance.

- `src/styles/ui-refresh.css`
  - Added readable meal value pill styles and Khala public-view styles.

## No backend SQL in Phase 2
Phase 1 remains the backend source of truth. Do not rerun old feature-patch SQL as part of this phase.
