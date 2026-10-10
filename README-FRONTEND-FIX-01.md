# Hostel Life — Frontend Fix 01

This cumulative update sits on top of UI Refresh 1.2 + Module 06 + Repair Migration V2.0.2.

## Scope
- Month management UI aligned with the repaired backend RPCs.
- Primary manager vs assistant manager guards.
- Assistant manager page and badges.
- Member deactivate/reactivate flow wiring.
- Manager "আমার মিল" entry and emergency override wiring.
- Manager meal-entry conflict preflight with explicit overwrite confirmation.
- Meal correction form now limits selectable dates to cutoff-passed days.
- Normal meal request history only shows correction action when a correction-eligible day exists.
- Personal tomorrow-meal trust card for members and manager "আমার মিল".
- Small responsive helpers for new surfaces.

## Database
No new SQL is included. This module targets the already-applied Safe Repair V2.0.2 RPCs.

## Install
Extract the ZIP contents directly into the existing `D:\MY PROJECTS\Hostel Life` project root. Keep `.env.local` unchanged. Then run `npm install` and `npm run build`.
