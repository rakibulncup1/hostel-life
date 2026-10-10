# FIX-02 — Database Instruction

This frontend package does **not** require a new Supabase migration.

Do not rerun:

- master SQL
- `HOSTEL_LIFE_REPAIR_MIGRATION_V2_0_2.sql`
- Dashboard Repair V2.1.x SQL
- Module 06 database patch

The frontend only reads the existing `daily_meal_days` rows to display server-defined state/cutoff information and continues to use the already-existing RPCs for writes.

If a future backend change becomes necessary, it should be prepared as a separate targeted SQL patch with a corresponding read-only verification script.
