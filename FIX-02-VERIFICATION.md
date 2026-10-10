# Hostel Life — FIX-02 Verification Checklist

## Automated/static checks completed in build environment

- 45 JS/JSX source files present after adding `src/utils/mealPolicy.js`.
- TypeScript parser accepted all JS and JSX source files.
- `.js` syntax check passed for all 23 JavaScript files.
- Named import/export consistency check passed.
- Meal policy helper tests passed for open, cutoff-passed and finalized states.
- Package contains no `node_modules`.
- Package contains no `.env.local`.

## Full Vite build

Not claimed here because the execution environment cannot reach the npm registry and no dependency cache is available. Run in the normal network-enabled development environment:

```bash
npm install
npm run build
```

Expected result: Vite build completes successfully without module/export errors.

## Manual QA matrix

### A. New meal request

1. Open Dining → Meal Request → New Request.
2. Verify start date cannot be today/past.
3. Verify end date cannot exceed running period end date.
4. Select a range and confirm the UI checks server daily meal states.
5. Submit valid data and confirm a success toast.
6. Try a range containing a cutoff-passed/finalized day and confirm a client warning before RPC submission.

### B. Request history / edit

1. Open an approved normal request.
2. Verify only eligible future days remain directly editable.
3. Attempt to edit when no eligible future day remains; verify warning.
4. Submit a valid edit and verify success feedback and refreshed navigation state.

### C. Correction

1. Open an approved request containing a cutoff-passed day.
2. Start correction.
3. Verify only cutoff-passed, non-finalized days are treated as correction-eligible.
4. Try a range containing an unavailable day; verify the range guard.
5. Submit a valid correction and verify success.

### D. Manager meal entry

1. Open Manager → Meal Entry.
2. Choose a date with existing data.
3. Verify final values are preferred when present.
4. Edit a member and save.
5. When conflicts are detected, verify the confirmation modal appears.
6. Confirm the override and verify the server receives a force-enabled payload.
7. Try a finalized-day override with a non-primary manager; verify useful server error feedback.
8. Choose a date with no daily meal record; verify save is disabled and warning is shown.

### E. Regression

- Dashboard loads online.
- Dashboard meal details open online.
- Dashboard offline snapshot remains intact.
- Non-dashboard pages remain blocked while offline.
- No horizontal overflow on a small Android viewport.
- All save/action paths show success or failure feedback.
