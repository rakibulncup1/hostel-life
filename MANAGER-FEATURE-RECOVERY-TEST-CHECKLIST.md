# Manual verification checklist

## Manager account
- [ ] 3-line menu shows: Current Month Close, New Month, Change Manager, Assistant Managers, Mess Settings, Archive, Notifications, Khala Money, Member Management.
- [ ] Header says Manager.
- [ ] If management-context RPC is temporarily unavailable, manager menu remains visible.

## Dining
- [ ] Manager sees: Meal Entry, My Meal, Meal Request, Market Entry, Deposit, Other Expense.
- [ ] Market Entry loads member selector.
- [ ] Market Entry can save a controlled test entry.
- [ ] Deposit can load active members.
- [ ] Other Expense can load active members.
- [ ] Meal Request opens the manager inbox.

## Khala Money
- [ ] Manager can open Khala Money.
- [ ] Current/allowed work periods appear.
- [ ] Add entry works.
- [ ] New entry appears immediately after save.
- [ ] Void/Delete action is visible and works with a reason.
- [ ] Normal member can view the public Khala history.

## Requests
- [ ] Normal member creates a meal request.
- [ ] Manager refreshes/open inbox and sees it.
- [ ] Correction request appears in manager correction tab.
- [ ] Approving correction updates the underlying meal flow according to backend rules.

## Reports
- [ ] Normal member opens Report Center.
- [ ] Manager opens Report Center.
- [ ] No false "Manager permission required" gate.
- [ ] Meal CSV downloads.
- [ ] Market CSV downloads.
- [ ] Account CSV downloads.
- [ ] Settlement CSV downloads.
- [ ] Full report print/PDF window opens.

## Meal Sheet
- [ ] All members view works.
- [ ] Selecting a member filters daily rows.
- [ ] Selected member CSV exports.
- [ ] Selected member Print/PDF opens with member name and totals.

## Regression
- [ ] Dashboard works.
- [ ] History works.
- [ ] Khala public view works.
- [ ] Assistant Manager still sees only assistant-level powers.
- [ ] Super Admin phase remains untouched.
