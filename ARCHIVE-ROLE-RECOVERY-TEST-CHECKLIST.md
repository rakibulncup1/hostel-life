# Archive / Role Recovery — Test Checklist

## A. Migration result
- [ ] `ARCHIVE_ROLE_RECOVERY = committed`
- [ ] `PRE_CLOSE_END_DATE_COLUMN = present`
- [ ] `ARCHIVE_AUDIT_TABLE = present`
- [ ] `ARCHIVE_AUDIT_ROW_TRIGGERS = 8` (all eight audit triggers are enabled)
- [ ] `TARGETED_NOTIFICATION_COLUMN = present`
- [ ] `ARCHIVE_MANAGEMENT_RPC`, `REOPEN_ARCHIVED_PERIOD_RPC`, `MEMBER_DIRECTORY_V3/V4`, `MY_ARCHIVE_EDITABLE_PERIODS_RPC = present`
- [ ] `RUNNING_PRIMARY_POINTER_MISMATCHES = 0` where possible; if nonzero, do not guess or manually change roles—send the output for review.
- [ ] Review `HOSTELS_WITH_MULTIPLE_ACTIVE_ROLE_MANAGERS` and `ARCHIVED_PERIODS_WITHOUT_CLOSER`; these are diagnostics, not automatically rewritten.

## B. Role and member list
- [ ] Running-month primary manager sees manager functions and can load Member Management.
- [ ] An assigned assistant sees assistant operational features, but cannot close/start month, deactivate members, or change manager.
- [ ] Member badges correctly show Manager / Assistant Manager / Member on Dashboard and All Members.
- [ ] With no running period, all members remain visible; the header and member cards say “এখনো মাস শুরু হয়নি”; current-month balances are shown as zero/neutral rather than implying members are gone.
- [ ] If dashboard summary RPC is temporarily unavailable but `get_running_period_context` and member directory succeed, members still render and only the summary/meal card shows a recoverable warning.
- [ ] Primary manager can deactivate/reactivate a non-manager member. Assistant manager receives a clear denied message if attempting the same.

## C. Archive access / accidental close
- [ ] Month closer sees a link under menu → “আর্কাইভ সম্পাদনা” when authorized.
- [ ] Current primary manager opens menu → “আর্কাইভ” and sees who closed each archived month plus latest audit summary.
- [ ] Grant is only offered for the archived period’s exact closing manager; an arbitrary member cannot be selected.
- [ ] Grant/revoke creates a targeted notification only for the closing manager and an audit record.
- [ ] The previous closer opens the notification and menu → “আর্কাইভ সম্পাদনা”, then opens the allowed period.
- [ ] Attempted edit of another archive without permission is rejected server-side.
- [ ] Reopen button appears only for the exact closing manager, same calendar month, no running period, and no newer period.
- [ ] Confirm reopen. Ensure cancelled future meal requests are NOT assumed restored; re-submit them if needed.
- [ ] Change archived market/Khala/ledger/meal/request data under valid access, then revisit Previous Month History and verify last editor name, timestamp and summary.
- [ ] Revoke/expire access; the closer can no longer mutate archived records.

## D. Meal override
- [ ] Primary manager opens Dining → My Meal → Emergency Override.
- [ ] Choose a date where a server meal record already exists; existing breakfast/lunch/dinner values prefill before saving.
- [ ] Verify that a load error blocks no button silently: read its visible message and don't save defaults over a row while loading.
- [ ] Assistant Manager opens Dining → My Meal and gets the normal member meal-request/history/correction screen, not the primary manager's direct override panel.

## E. Project validation
- [ ] On the project folder, run `npm ci`.
- [ ] Run `npm run build`.
- [ ] Test on desktop and mobile viewport; ensure Archive Manager / member list / header badges don't overflow.

If any database diagnostic is nonzero or any step fails, share the complete SQL result/error and the exact UI action + screenshot. Do not rerun earlier migrations to “fix” a failed check.
