# Core Recovery — Functional Test Checklist

Test with the existing primary manager account first.

## 1. Current period

- Header shows the current period label.
- Management context shows the same period ID and dates.
- Dashboard loads instead of reporting “no running month”.

## 2. Market

- A market entry dated today can be saved.
- Market History shows existing entries.
- Opening a market entry shows its items and total.

## 3. Khala Money

- Manager/assistant can select the current period.
- Saving a Khala entry succeeds.
- The new entry immediately appears in the list.
- A normal member can view the Khala list from the member menu.

## 4. Meal requests

- Send a normal meal request from a member account.
- Open manager meal-request screen; the request must appear under the appropriate tab.
- Send a correction request after cutoff; it must reach the manager/assistant inbox.
- Approving it must update the authoritative meal data path.

## 5. Month close

- Open Current Month Close.
- The current period is visible.
- Select today as the close date.
- If future requests exist, a clear confirmation warning appears.
- Confirming the close archives the period.
- New Month then shows the next required start date as the day after the closed period.

## 6. New month

- Start the next month only from the required date.
- Verify a new period UUID is created.
- Verify the old period remains in archive/history.

## 7. Reports / meal sheet

- Running-period report loads.
- Meal sheet generation/download uses the running period and does not report a false “no running month”.

## 8. Assistant manager

- Assistant can perform operational actions.
- Assistant cannot close/start month or transfer primary management.

## 9. Historical overlap

The two previously detected historical normal-request overlap pairs are intentionally preserved. Do not delete them merely to make this test pass.
