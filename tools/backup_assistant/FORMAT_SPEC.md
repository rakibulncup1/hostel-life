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
- The password is never stored in the backup or local history.

## ZIP payload

- `manifest.json` contains the format version, backup type, project reference, encryption metadata, warnings, and SHA-256 hashes for all other payload files.
- All file paths inside the ZIP are relative paths.
- Auth JSON uses ISO strings for dates, decimal strings for exact numeric values, UUID strings, and `{ "__base64__": "..." }` for byte values.
- Master backups contain database roles/schema/data dumps, Auth data JSON, Storage bucket/object data, project source, Edge Function snapshots, and recovery checklists.
- Storage object paths in `storage/objects/` use URL percent-encoding per path component so names remain safe on Windows; `objects_manifest.json` retains the original bucket/path and the encoded `local_path` for future restore.
- Hostel backups contain tenant-scoped table JSON, profile-avatar files, and references to existing Auth User IDs.

## Integrity

- AES-GCM authenticates the encrypted payload.
- The internal manifest verifies each ZIP payload file with SHA-256.
- A sibling `.hlbackup.sha256` file verifies the encrypted file transfer before decryption.

Module 2 Restore must validate all three layers before importing any data.
