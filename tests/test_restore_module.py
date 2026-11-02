import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import (
    BackupError,
    _build_encrypted_archive,
    _build_master_database_restore_bundle,
    _copy_review_files_without_overwrite,
    _find_primary_key_conflicts,
    _journal_load,
    _load_catalog,
    _preflight_storage_target,
    _restore_marker,
    _redact,
    _target_connection_identity,
    _validate_archive_member,
    inspect_backup_for_restore,
)


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class _FakeConnection:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def execute(self, sql, params):
        self.calls.append((sql, params))
        return _FakeResult(self.rows)


class RestoreModuleTests(unittest.TestCase):
    def test_target_identity_accepts_direct_supabase_database_endpoint(self):
        result = _target_connection_identity(
            "postgresql://postgres:pw@db.targetrecovery1.supabase.co:5432/postgres?sslmode=require",
            "targetrecovery1",
            "sourceproject123",
            "https://targetrecovery1.supabase.co",
        )
        self.assertEqual(result["project_ref"], "targetrecovery1")
        self.assertEqual(result["database_host"], "db.targetrecovery1.supabase.co")

    def test_target_identity_accepts_project_scoped_session_pooler(self):
        result = _target_connection_identity(
            "postgresql://postgres.targetrecovery1:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require",
            "targetrecovery1",
            "sourceproject123",
            "https://targetrecovery1.supabase.co",
        )
        self.assertEqual(result["project_ref"], "targetrecovery1")

    def test_target_identity_rejects_hostname_substring_trick(self):
        with self.assertRaises(BackupError):
            _target_connection_identity(
                "postgresql://postgres:pw@db.targetrecovery1.supabase.co:5432/postgres",
                "targetrecovery1",
                "sourceproject123",
                "https://targetrecovery1.evil.example",
            )

    def test_master_restore_rejects_same_source_project(self):
        with self.assertRaises(BackupError):
            _target_connection_identity(
                "postgresql://postgres:pw@db.sourceproject123.supabase.co:5432/postgres",
                "sourceproject123",
                "sourceproject123",
                "https://sourceproject123.supabase.co",
            )

    def test_target_identity_rejects_project_url_path_or_query(self):
        for url in (
            "https://targetrecovery1.supabase.co/path",
            "https://targetrecovery1.supabase.co/?next=https://evil.example",
            "https://targetrecovery1.supabase.co:8443",
        ):
            with self.subTest(url=url), self.assertRaises(BackupError):
                _target_connection_identity(
                    "postgresql://postgres:pw@db.targetrecovery1.supabase.co:5432/postgres?sslmode=require",
                    "targetrecovery1", "sourceproject123", url,
                )

    def test_target_identity_rejects_disabled_database_ssl(self):
        with self.assertRaises(BackupError):
            _target_connection_identity(
                "postgresql://postgres:pw@db.targetrecovery1.supabase.co:5432/postgres?sslmode=disable",
                "targetrecovery1", "sourceproject123", "https://targetrecovery1.supabase.co",
            )

    def test_target_identity_rejects_non_default_database_or_port(self):
        for dsn in (
            "postgresql://postgres:pw@db.targetrecovery1.supabase.co:5432/other?sslmode=require",
            "postgresql://postgres:pw@db.targetrecovery1.supabase.co:6543/postgres?sslmode=require",
            "postgresql://restore_user:pw@db.targetrecovery1.supabase.co:5432/postgres?sslmode=require",
        ):
            with self.subTest(dsn=dsn), self.assertRaises(BackupError):
                _target_connection_identity(
                    dsn, "targetrecovery1", "sourceproject123", "https://targetrecovery1.supabase.co",
                )

    def test_archive_paths_reject_traversal_absolute_drive_and_backslash(self):
        self.assertEqual(_validate_archive_member("database/schema.sql"), "database/schema.sql")
        for path in ("../escape", "/absolute", "C:/secrets.txt", "folder\\secret.txt", "a/./b"):
            with self.subTest(path=path):
                with self.assertRaises(BackupError):
                    _validate_archive_member(path)

    def test_redaction_removes_bearer_and_named_credential_literals(self):
        text = "Authorization: Bearer my-private-token api_key=secret-value password='private-pass'"
        cleaned = _redact(text)
        self.assertNotIn("my-private-token", cleaned)
        self.assertNotIn("secret-value", cleaned)
        self.assertNotIn("private-pass", cleaned)
        self.assertIn("[REDACTED]", cleaned)

    def test_recovery_review_copy_is_idempotent_and_never_overwrites_manual_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            target = root / "target"
            source.mkdir()
            (source / "checklist.md").write_text("from backup", encoding="utf-8")
            result = _copy_review_files_without_overwrite(source, target)
            self.assertEqual(result, {"copied": 1, "matched": 0, "conflicts": []})
            result = _copy_review_files_without_overwrite(source, target)
            self.assertEqual(result, {"copied": 0, "matched": 1, "conflicts": []})
            (target / "checklist.md").write_text("my manual notes", encoding="utf-8")
            result = _copy_review_files_without_overwrite(source, target)
            self.assertEqual(result["conflicts"], ["checklist.md"])
            self.assertEqual((target / "checklist.md").read_text(encoding="utf-8"), "my manual notes")

    def test_restore_journal_is_bound_to_backup_type_and_target(self):
        with tempfile.TemporaryDirectory() as temp:
            journal_path = Path(temp) / "restore.json"
            journal = _journal_load(journal_path, "a" * 64, "targetrecovery1", "MASTER")
            journal_path.write_text(json.dumps(journal), encoding="utf-8")
            self.assertNotIn("password", journal_path.read_text(encoding="utf-8").lower())
            with self.assertRaises(BackupError):
                _journal_load(journal_path, "b" * 64, "targetrecovery1", "MASTER")
            with self.assertRaises(BackupError):
                _journal_load(journal_path, "a" * 64, "anotherproject123", "MASTER")
            with self.assertRaises(BackupError):
                _journal_load(journal_path, "a" * 64, "targetrecovery1", "HOSTEL")

    def test_restore_marker_is_deterministic_and_target_specific(self):
        marker = _restore_marker("a" * 64, "targetrecovery1", "MASTER")
        self.assertEqual(marker, _restore_marker("a" * 64, "targetrecovery1", "MASTER"))
        self.assertNotEqual(marker, _restore_marker("a" * 64, "anotherproject123", "MASTER"))
        self.assertNotEqual(marker, _restore_marker("a" * 64, "targetrecovery1", "HOSTEL"))

    def test_master_restore_bundle_orders_roles_schema_data_and_marker(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            extracted = root / "payload"
            db = extracted / "database"
            db.mkdir(parents=True)
            (db / "roles.sql").write_text("-- roles\nSELECT 'ROLE';\n", encoding="utf-8")
            (db / "schema.sql").write_text("-- schema\nSELECT 'SCHEMA';\n", encoding="utf-8")
            (db / "data.sql").write_text("-- data\nSELECT 'DATA';\n", encoding="utf-8")
            output = root / "bundle.sql"
            _build_master_database_restore_bundle(extracted, output, "HostelLifeRestore:v2:MASTER:test-marker")
            text = output.read_text(encoding="utf-8")
            self.assertLess(text.index("'ROLE'"), text.index("'SCHEMA'"))
            self.assertLess(text.index("'SCHEMA'"), text.index("session_replication_role = replica"))
            self.assertLess(text.index("session_replication_role = replica"), text.index("'DATA'"))
            self.assertIn("HostelLifeRestore:v2:MASTER:test-marker", text)

    def test_primary_key_conflicts_use_batched_query_and_detect_duplicate_backup_ids(self):
        conn = _FakeConnection([{"id": 2}])
        conflicts = _find_primary_key_conflicts(
            conn, "public", "example", ["id"], [{"id": 1}, {"id": 2}, {"id": 3}]
        )
        self.assertEqual(conflicts, {(2,)})
        self.assertEqual(len(conn.calls), 1)
        self.assertIn(" IN (", conn.calls[0][0])
        with self.assertRaises(BackupError):
            _find_primary_key_conflicts(conn, "public", "example", ["id"], [{"id": 1}, {"id": 1}])
        with self.assertRaises(BackupError):
            _find_primary_key_conflicts(conn, "public", "example", ["id"], [{"id": None}])

    def test_composite_primary_key_conflicts_are_checked_as_tuples(self):
        conn = _FakeConnection([{"hostel_id": "h1", "member_id": "m2"}])
        conflicts = _find_primary_key_conflicts(
            conn,
            "public",
            "membership",
            ["hostel_id", "member_id"],
            [{"hostel_id": "h1", "member_id": "m1"}, {"hostel_id": "h1", "member_id": "m2"}],
        )
        self.assertEqual(conflicts, {("h1", "m2")})
        self.assertIn("WHERE (\"hostel_id\", \"member_id\") IN", conn.calls[0][0])

    def test_hostel_catalog_fk_query_uses_unambiguous_pg_constraint_relations(self):
        class CatalogConnection:
            def __init__(self):
                self.queries = []
                self.results = [
                    [{"table_schema": "public", "table_name": "hostels", "column_name": "id", "ordinal_position": 1}],
                    [{
                        "child_schema": "public", "child_table": "hostel_memberships",
                        "parent_schema": "public", "parent_table": "hostels",
                        "constraint_name": "hostel_memberships_hostel_id_fkey",
                        "child_column": "hostel_id", "parent_column": "id", "ordinal_position": 1,
                    }],
                    [{"table_schema": "public", "table_name": "hostels", "column_name": "id", "data_type": "uuid", "udt_name": "uuid", "is_nullable": "NO", "ordinal_position": 1}],
                ]
            def execute(self, sql):
                self.queries.append(sql)
                return _FakeResult(self.results.pop(0))

        conn = CatalogConnection()
        primary_keys, foreign_keys, columns = _load_catalog(conn)
        self.assertEqual(primary_keys[("public", "hostels")], ["id"])
        self.assertEqual(foreign_keys[0]["child_table"], "hostel_memberships")
        self.assertEqual(foreign_keys[0]["parent_table"], "hostels")
        self.assertIn("FROM pg_constraint fk", conn.queries[1])
        self.assertIn("WITH ORDINALITY", conn.queries[1])
        self.assertIn(("public", "hostels"), columns)

    def test_storage_target_key_is_checked_with_read_only_bucket_list(self):
        response = MagicMock()
        response.status_code = 200
        response.json.return_value = [{"id": "profile-avatars"}]
        response.close = MagicMock()
        session = MagicMock()
        session.headers = {}
        session.request.return_value = response
        with patch("core.requests.Session", return_value=session):
            result = _preflight_storage_target("https://targetrecovery1.supabase.co", "sb_secret_demo")
        self.assertEqual(result, {"bucket_count": 1})
        session.request.assert_called_once()
        self.assertEqual(session.request.call_args.args[0], "GET")
        self.assertTrue(session.request.call_args.args[1].endswith("/storage/v1/bucket"))

    def test_inspect_master_backup_returns_restore_summary_after_integrity_check(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            payload = root / "payload"
            (payload / "database" / "auth").mkdir(parents=True)
            (payload / "storage").mkdir(parents=True)
            (payload / "database" / "roles.sql").write_text("-- role dump\n", encoding="utf-8")
            (payload / "database" / "schema.sql").write_text("-- schema dump\n", encoding="utf-8")
            (payload / "database" / "data.sql").write_text("-- data dump\n", encoding="utf-8")
            (payload / "database" / "auth" / "auth_users.json").write_text('{"row_count":2,"rows":[]}', encoding="utf-8")
            (payload / "database" / "auth" / "auth_identities.json").write_text('{"row_count":1,"rows":[]}', encoding="utf-8")
            (payload / "database" / "inventory.json").write_text('{"extensions":[{"extname":"pgcrypto"}]}', encoding="utf-8")
            (payload / "storage" / "buckets.json").write_text('[{"id":"profile-avatars"}]', encoding="utf-8")
            (payload / "storage" / "objects_manifest.json").write_text('[]', encoding="utf-8")
            result = _build_encrypted_archive(payload, root / "out", "sourceproject123", "MASTER", "Secure-Backup-Password-2026")
            summary = inspect_backup_for_restore(Path(result["file"]), "Secure-Backup-Password-2026")
        self.assertTrue(summary["verified"])
        self.assertEqual(summary["backup_type"], "MASTER")
        self.assertEqual(summary["project_ref"], "sourceproject123")
        self.assertEqual(summary["auth_user_count"], 2)
        self.assertEqual(summary["storage_object_count"], 0)


if __name__ == "__main__":
    unittest.main()
