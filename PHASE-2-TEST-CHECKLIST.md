# Phase 2 Runtime Test Checklist

Run `npm ci` and `npm run build` first.

## Ordinary member
- Open the three-line menu and verify `খালার টাকা` appears once.
- Open `খালার টাকা`; verify current and archived period sections have correct labels.
- Verify the logged-in member's own Khala entries appear first in each period and are labeled `আপনার এন্ট্রি`.
- Open `সকল সদস্য`; verify positive balance shows `বর্তমান অবশিষ্ট`, negative balance shows `বর্তমান বকেয়া`, and the displayed amount has no minus sign.
- Verify the assistant-manager badge appears for an assigned assistant.
- Submit a new meal request for a date range that overlaps an existing active request; the UI should warn and not submit.

## Manager / assistant manager
- Open Dining → Meal Request and verify Breakfast/Lunch/Dinner values are readable words, not B/L/D.
- Enter a market entry on mobile/narrow width and verify placeholders remain clear: `নাম`, `পরিমাণ`, `Amount`.
- Verify assistant managers still cannot access month close/member deactivation/manager transfer.
- Verify primary manager still has the full manager menu without a duplicate read-only Khala entry.

## Profile
- Select a large JPG/PNG/WEBP avatar.
- Verify upload succeeds even when the source image is larger than 2 MB but below the 10 MB client guard.
- Replace the avatar and verify the same profile avatar path is replaced rather than creating a second per-user path.
- Verify the stored upload is approximately <=190 KB when the source can be compressed to the target.

## Regression check
- Login/logout.
- Dashboard meal details.
- Market history/detail.
- Account history.
- Month close/new month.
- Member deactivate/reactivate.
- Assistant manager assignment.
- PDF/CSV reports.
