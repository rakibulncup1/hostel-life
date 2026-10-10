# Changed files — Manager Feature & Reporting Recovery V1

- `src/hooks/useManagementContext.js`
  - Authenticated manager role fallback.
  - Running-period fallback if management-context RPC errors.
  - Primary manager precedence over assistant assignment.

- `src/app/AppShell.jsx`
  - Immediate manager-role fallback for Header and MenuDrawer.

- `src/components/MenuDrawer.jsx`
  - Accepts authenticated manager fallback and restores primary manager items immediately.

- `src/features/manager/ManagerPages.jsx`
  - Manager/Primary Manager guards accept authenticated manager fallback.
  - Reports page is public to authenticated members.
  - Meal Sheet adds member filter and filtered print/export.

- `src/features/dining/DiningPage.jsx`
  - Dining manager capability derives from authenticated manager fallback as well as management context.

- `src/features/menu/MenuPages.jsx`
  - Simplified public Khala Money summary copy.

- `src/styles/ui-refresh.css`
  - Responsive report member filter styling.
