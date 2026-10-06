# Module 06 Install

1. Close the running dev server.
2. Back up your current project folder as a precaution.
3. Open `supabase/MODULE-06-DATABASE-PATCH.sql` from this ZIP and run the whole file once in Supabase SQL Editor. **Do not rerun the full Master SQL.**
4. Extract this ZIP into the existing project folder:
   `D:\MY PROJECTS\Hostel Life`
5. Do not overwrite `.env.local`.
6. Run:

```powershell
cd "D:\MY PROJECTS\Hostel Life"
npm install
npm run dev
```

7. Verify the Manager menu routes from the three-line menu.
8. For a production-like PWA test, run `npm run build` and then `npm run preview`.
