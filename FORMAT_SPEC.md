# Hostel Life Backup Format v2

The `.hlbackup` file is an authenticated encrypted container. Do not rename it to `.zip` and do not attempt to extract it with a normal ZIP utility.

## Binary format

- 8 bytes: ASCII magic `HLBKUP02`
- 16 bytes: random PBKDF2 salt
- 12 bytes: random AES-GCM nonce
- Remaining bytes except the last 16: AES-GCM ciphertext of the ZIP payload
- Last 16 bytes: AES-GCM authentication tag

## Cryptography

- Key derivation: PBKDF2-HMAC-SHA256
- Iterations: 600,000
- Derived key: 32 bytes
- Encryption: AES-256-GCM
- Additional authenticated data (AAD): the complete 36-byte header (`magic + salt + nonce`)
- Password is never stored in the backup or restore journal.

## ZIP payload

- `manifest.json` contains format version, backup type, project reference, encryption metadata, warnings, and SHA-256 hashes for all other payload files.
- All file paths inside the ZIP are relative paths. Restore rejects absolute paths, traversal, Windows drive paths, backslashes, special ZIP entries, duplicate paths, and excessive expansion size.
- Auth JSON uses ISO strings for dates, decimal strings for exact numeric values, UUID strings, and `{ "__base64__": "..." }` for byte values.
- Master backups contain database roles/schema/data dumps, Auth data JSON, Storage bucket/object data, project source, Edge Function snapshots, Cron Job command snapshots, and recovery checklists.
- Hostel backups contain tenant-scoped table JSON, profile-avatar files, and references to existing Auth User IDs.
- Storage object paths in `storage/objects/` use URL percent-encoding per path component so names remain safe on Windows; `objects_manifest.json` retains the original bucket/path and encoded `local_path` for restore.

## Restore safety

- Restore validates AES-GCM, ZIP structure, path policy, and each manifest SHA-256 before using any payload.
- Master Restore requires a different, empty Target Supabase Project and confirms its URL, Project Ref, database host, and DB username match.
- Hostel Restore requires the existing compatible schema, unused Hostel ID, existing referenced Auth User IDs, valid table/column metadata, and no non-profile primary-key conflicts.
- Database restore markers are committed in the same transaction as the associated data. A local journal is also bound to backup SHA-256, target ref and backup type; it contains no credentials.
- Storage restore does not use upsert. Existing objects are compared by downloaded SHA-256; different content at the same path causes a hard stop.
- The Restore Assistant never runs remote `db reset`, `DROP`, or `TRUNCATE` commands. It does not automatically deploy Edge Functions, set secrets, enable Cron Jobs, or modify platform-level Auth/Realtime/Vercel settings.

## Integrity

- AES-GCM authenticates the encrypted payload.
- The internal manifest verifies each ZIP payload file with SHA-256.
- A sibling `.hlbackup.sha256` file verifies encrypted file transfer before decryption.
