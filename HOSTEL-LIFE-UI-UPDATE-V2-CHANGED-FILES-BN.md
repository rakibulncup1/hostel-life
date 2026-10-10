# পরিবর্তিত সোর্স ফাইল — UI Update V2

- `src/app/App.jsx` — নতুন system pages route/title
- `src/app/AppShell.jsx` — offline access for system pages; dynamic copyright footer
- `src/components/Icon.jsx` — missing `file` ও `book` icon mapping
- `src/components/MenuDrawer.jsx` — Privacy/Terms/How-to/Developer system menu group
- `src/features/dashboard/DashboardPage.jsx` — late request summary/net details/scrollable detail modal; dashboard member name routes to All Members
- `src/features/dining/DiningPage.jsx` — Dining card arrow removal and clearer user-facing Bengali labels
- `src/features/history/HistoryPage.jsx` — history intro, account scope controls, click-to-detail transactions, manager-only edit in detail modal, PDF print exports
- `src/features/manager/ManagerPages.jsx` — report terms in Bengali, member daily meal report and PDF, neutral headings for Reports/Meal Sheet
- `src/features/menu/MenuPages.jsx` — All Members detail modal/scroll target; system pages; developer portfolio; Khala read-only view polish
- `src/services/reportService.js` — branded linked footer for all reports using central print helper
- `src/styles/ui-refresh.css` — responsive header, bottom nav, modal scroll, info cards, footer and report layout
- `src/utils/accounting.js` — Bengali-facing ledger labels

এ প্যাকেজে কোনো database SQL পরিবর্তন/প্রয়োগ করা হয়নি।
