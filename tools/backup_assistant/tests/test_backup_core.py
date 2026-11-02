import json
import tempfile
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import (
    BackupError,
    _build_encrypted_archive,
    _safe_relpath,
    parse_database_url,
    verify_backup,
    _supabase_headers,
    _windows_safe_component,
    _copy_project_source,
    _write_recovery_docs,
    cleanup_staging_dir,
    find_stale_staging_dirs,
)


class BackupCoreTests(unittest.TestCase):
    def test_encrypted_archive_round_trip_and_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            staging = root / "payload"
            (staging / "database").mkdir(parents=True)
            (staging / "database" / "schema.sql").write_text("CREATE TABLE example(id int);\n", encoding="utf-8")
            (staging / "readme.txt").write_text("Hostel Life backup test", encoding="utf-8")
            result = _build_encrypted_archive(staging, root / "out", "testproject123", "MASTER", "Secure-Backup-Password-2026")
            archive = Path(result["file"])
            self.assertTrue(archive.exists())
            verified = verify_backup(archive, "Secure-Backup-Password-2026")
            self.assertTrue(verified["verified"])
            self.assertGreaterEqual(verified["files_checked"], 2)

    def test_wrong_password_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            staging = root / "payload"
            staging.mkdir()
            (staging / "data.json").write_text('{"safe":true}', encoding="utf-8")
            result = _build_encrypted_archive(staging, root / "out", "project12345678", "MASTER", "Secure-Backup-Password-2026")
            with self.assertRaises(BackupError):
                verify_backup(Path(result["file"]), "A-different-password-123")

    def test_encrypted_archive_tamper_is_detected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            staging = root / "payload"
            staging.mkdir()
            (staging / "data.json").write_text('{"safe":true}', encoding="utf-8")
            result = _build_encrypted_archive(staging, root / "out", "project12345678", "MASTER", "Secure-Backup-Password-2026")
            archive = Path(result["file"])
            content = bytearray(archive.read_bytes())
            content[len(content) // 2] ^= 0x01
            archive.write_bytes(content)
            with self.assertRaises(BackupError):
                verify_backup(archive, "Secure-Backup-Password-2026")

    def test_windows_reserved_storage_file_names_are_encoded_safely(self):
        self.assertEqual(_windows_safe_component("CON"), "%43ON")
        self.assertEqual(_windows_safe_component("LPT1.txt"), "%4CPT1.txt")
        self.assertEqual(_windows_safe_component("avatar image.jpg"), "avatar%20image.jpg")

    def test_storage_paths_reject_traversal(self):
        self.assertEqual(_safe_relpath("avatar/member/photo.jpg"), "avatar/member/photo.jpg")
        for bad in ("../escape.txt", "/absolute/file", "bucket/../../secret", "a/./b"):
            with self.assertRaises(BackupError):
                _safe_relpath(bad)

    def test_new_secret_key_is_only_sent_in_apikey_header(self):
        headers = _supabase_headers("sb_secret_test_only")
        self.assertEqual(headers["apikey"], "sb_secret_test_only")
        self.assertNotIn("Authorization", headers)

    def test_legacy_service_role_key_uses_bearer_compatibility(self):
        headers = _supabase_headers("eyJhbGciOiJIUzI1NiJ9.test.signature")
        self.assertEqual(headers["Authorization"], "Bearer eyJhbGciOiJIUzI1NiJ9.test.signature")

    def test_connection_string_is_parsed_without_logging(self):
        parts = parse_database_url("postgresql://postgres:secret%40pass@db.example.supabase.co:5432/postgres?sslmode=require")
        self.assertEqual(parts["host"], "db.example.supabase.co")
        self.assertEqual(parts["password"], "secret@pass")
        self.assertEqual(parts["sslmode"], "require")

    def test_sidecar_checksum_mismatch_fails_before_decrypt(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            staging = root / "payload"
            staging.mkdir()
            (staging / "data.json").write_text('{"safe":true}', encoding="utf-8")
            result = _build_encrypted_archive(staging, root / "out", "project12345678", "MASTER", "Secure-Backup-Password-2026")
            archive = Path(result["file"])
            archive.with_suffix(archive.suffix + ".sha256").write_text("0" * 64 + "  wrong.hlbackup\n", encoding="ascii")
            with self.assertRaises(BackupError):
                verify_backup(archive, "Secure-Backup-Password-2026")

    def test_project_source_copy_excludes_env_and_build_folders(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "project"
            root.mkdir()
            (root / ".env").write_text("SECRET=value", encoding="utf-8")
            (root / ".env.example").write_text("PUBLIC_PLACEHOLDER=", encoding="utf-8")
            (root / "package.json").write_text("{}", encoding="utf-8")
            (root / "node_modules").mkdir()
            (root / "node_modules" / "huge.js").write_text("ignored", encoding="utf-8")
            (root / "supabase").mkdir()
            (root / "supabase" / "migration.sql").write_text("select 1;", encoding="utf-8")
            destination = Path(temp) / "copy"
            copied = _copy_project_source(root, destination)
            self.assertIn(".env.example", copied)
            self.assertIn("package.json", copied)
            self.assertIn("supabase/migration.sql", copied)
            self.assertFalse((destination / ".env").exists())
            self.assertFalse((destination / "node_modules" / "huge.js").exists())

    def test_staging_cleanup_only_removes_hostel_backup_workdirs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            staging = root / ".hostel_life_master_abcd"
            staging.mkdir()
            (staging / "private.sql").write_text("sensitive", encoding="utf-8")
            verify_temp = root / ".hl_verify_abcd.zip"
            verify_temp.write_bytes(b"temporary plaintext zip")
            unrelated = root / ".not_a_backup"
            unrelated.mkdir()
            self.assertEqual(find_stale_staging_dirs(root), [staging, verify_temp])
            with self.assertRaises(BackupError):
                cleanup_staging_dir(unrelated)
            cleanup_staging_dir(staging)
            cleanup_staging_dir(verify_temp)
            self.assertFalse(staging.exists())
            self.assertFalse(verify_temp.exists())
            self.assertTrue(unrelated.exists())

    def test_recovery_checklist_marks_optional_secrets_state_and_hostel_scope(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            _write_recovery_docs(root, "project12345678", ["PASSWORD_RESET_HMAC_SECRET"], "master", True)
            master_text = (root / "recovery" / "MANUAL_RECONFIGURATION_CHECKLIST.md").read_text(encoding="utf-8")
            self.assertIn("included in encrypted payload", master_text)
            self.assertIn("PASSWORD_RESET_HMAC_SECRET", master_text)
            _write_recovery_docs(root, "project12345678", [], "hostel", False)
            hostel_text = (root / "recovery" / "MANUAL_RECONFIGURATION_CHECKLIST.md").read_text(encoding="utf-8")
            self.assertIn("Auth account credentials", hostel_text)



if __name__ == "__main__":
    unittest.main()
