from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
import zipfile
from collections import deque
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path, PurePosixPath
from typing import Any, Callable
from urllib.parse import quote, unquote, urlsplit

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import requests

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # checked by the GUI before a backup starts
    psycopg = None
    dict_row = None

MAGIC = b"HLBKUP02"  # 8 bytes
SALT_LENGTH = 16
NONCE_LENGTH = 12
TAG_LENGTH = 16
KDF_ITERATIONS = 600_000
CHUNK_SIZE = 1024 * 1024
MAX_STORAGE_OBJECTS = 50_000
MAX_HOSTEL_ROWS = 150_000
MAX_FK_BATCH = 250

LogFn = Callable[[str], None]
ProgressFn = Callable[[str, int | None], None]


class BackupError(RuntimeError):
    pass


def _log(callback: LogFn | None, message: str) -> None:
    if callback:
        callback(message)


def _progress(callback: ProgressFn | None, stage: str, percent: int | None = None) -> None:
    if callback:
        callback(stage, percent)


def _run_command(
    command: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    log: LogFn | None = None,
    timeout: int = 60 * 60,
) -> str:
    """Run a local tool. Never log command arguments because they may contain secrets."""
    _log(log, f"চালানো হচ্ছে: {Path(command[0]).name} ({len(command) - 1}টি argument) ...")
    try:
        completed = subprocess.run(
            command,
            cwd=str(cwd) if cwd else None,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
            shell=False,
        )
    except FileNotFoundError as exc:
        raise BackupError(f"প্রয়োজনীয় কমান্ড পাওয়া যায়নি: {command[0]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise BackupError(f"{Path(command[0]).name} নির্ধারিত সময়ে শেষ হয়নি।") from exc
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "কোনো বিস্তারিত পাওয়া যায়নি").strip()
        # Avoid echoing a connection string/key if a CLI happens to include it.
        detail = _redact(detail)
        raise BackupError(f"{Path(command[0]).name} ব্যর্থ হয়েছে (Exit {completed.returncode}): {detail[-1800:]}")
    output = (completed.stdout or "").strip()
    _log(log, f"সম্পন্ন: {Path(command[0]).name}")
    return output


def _redact(text: str) -> str:
    text = re.sub(r"postgres(?:ql)?://[^\s'\"]+", "postgresql://[REDACTED]", text, flags=re.I)
    text = re.sub(r"eyJ[a-zA-Z0-9_.-]{20,}", "[REDACTED_KEY]", text)
    text = re.sub(r"sb_secret_[A-Za-z0-9_-]+", "[REDACTED_KEY]", text)
    text = re.sub(r"(?i)(authorization\s*[:=]\s*['\"]?)(?:bearer\s+)?[^'\"\s,;}]+", r"\1[REDACTED]", text)
    text = re.sub(r"(?i)((?:x-api-key|api[_-]?key|service[_-]?role(?:[_-]?key)?|access[_-]?token|refresh[_-]?token|password|secret|token)\s*[:=]\s*['\"]?)[^'\"\s,;}]+", r"\1[REDACTED]", text)
    return text


def supabase_command() -> list[str]:
    direct = shutil.which("supabase")
    if direct:
        return [direct]
    npx = shutil.which("npx")
    if npx:
        return [npx, "--yes", "supabase"]
    raise BackupError("Supabase CLI পাওয়া যায়নি। Node.js 20.19+ এবং npx ইনস্টল করুন অথবা Supabase CLI PATH-এ যোগ করুন।")


def check_prerequisites() -> dict[str, Any]:
    checks: dict[str, Any] = {"python": True, "cryptography": True, "requests": True}
    checks["psycopg"] = psycopg is not None
    checks["psql"] = shutil.which("psql") is not None
    checks["supabase_cli"] = shutil.which("supabase") is not None or shutil.which("npx") is not None
    checks["docker"] = shutil.which("docker") is not None
    checks["docker_running"] = False
    if checks["docker"]:
        try:
            result = subprocess.run(
                ["docker", "info", "--format", "{{.ServerVersion}}"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=12,
                check=False,
            )
            checks["docker_running"] = result.returncode == 0 and bool(result.stdout.strip())
            if checks["docker_running"]:
                checks["docker_version"] = result.stdout.strip()
        except Exception:
            checks["docker_running"] = False
    if checks.get("supabase_cli"):
        try:
            result = subprocess.run(supabase_command() + ["--version"], capture_output=True, text=True, timeout=60)
            checks["supabase_version"] = (result.stdout or result.stderr).strip() or "পাওয়া যায়নি"
        except Exception:
            checks["supabase_version"] = "পাওয়া যায়নি"
    checks["master_backup_ready"] = all(
        checks.get(name) for name in ("psycopg", "supabase_cli", "docker_running")
    )
    checks["hostel_backup_ready"] = all(checks.get(name) for name in ("psycopg",))
    checks["restore_ready"] = all(checks.get(name) for name in ("psycopg", "psql", "requests", "cryptography"))
    return checks


def find_stale_staging_dirs(destination_dir: Path) -> list[Path]:
    if not destination_dir.is_dir():
        return []
    return sorted(
        path for path in destination_dir.iterdir()
        if (path.is_dir() and (path.name.startswith(".hostel_life_master_") or path.name.startswith(".hostel_life_hostel_")))
        or (path.is_file() and path.name.startswith(".hl_verify_") and path.suffix == ".zip")
    )


def cleanup_staging_dir(path: Path) -> None:
    if path.is_dir() and (path.name.startswith(".hostel_life_master_") or path.name.startswith(".hostel_life_hostel_")):
        shutil.rmtree(path)
        return
    if path.is_file() and path.name.startswith(".hl_verify_") and path.suffix == ".zip":
        path.unlink()
        return
    raise BackupError("শুধু Hostel Life-এর অস্থায়ী Backup/Verify Artifact পরিষ্কার করা যাবে।")


def parse_database_url(database_url: str) -> dict[str, Any]:
    parsed = urlsplit(database_url.strip())
    if parsed.scheme not in ("postgres", "postgresql") or not parsed.hostname:
        raise BackupError("সঠিক PostgreSQL Connection String দিন (postgresql://... দিয়ে শুরু হবে)।")
    query = dict()
    for part in parsed.query.split("&"):
        if "=" in part:
            key, value = part.split("=", 1)
            query[unquote(key)] = unquote(value)
    return {
        "host": parsed.hostname,
        "port": parsed.port or 5432,
        "user": unquote(parsed.username or "postgres"),
        "password": unquote(parsed.password or ""),
        "dbname": unquote(parsed.path.lstrip("/")) or "postgres",
        "sslmode": query.get("sslmode", "require"),
    }


def _pg_env(database_url: str) -> dict[str, str]:
    parts = parse_database_url(database_url)
    env = os.environ.copy()
    env.update({
        "PGHOST": parts["host"],
        "PGPORT": str(parts["port"]),
        "PGUSER": parts["user"],
        "PGPASSWORD": parts["password"],
        "PGDATABASE": parts["dbname"],
        "PGSSLMODE": parts["sslmode"],
        "PGCONNECT_TIMEOUT": "20",
    })
    return env


def _connect(database_url: str):
    if psycopg is None:
        raise BackupError("psycopg পাওয়া যায়নি। RUN_BACKUP_ASSISTANT.bat চালিয়ে প্রয়োজনীয় প্যাকেজ ইনস্টল করুন।")
    parts = parse_database_url(database_url)
    return psycopg.connect(database_url, row_factory=dict_row, connect_timeout=20, sslmode=parts["sslmode"])


def _windows_safe_component(value: str) -> str:
    encoded = quote(value, safe="-_.~")
    if re.match(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$", encoded, flags=re.IGNORECASE):
        first = encoded[0]
        encoded = f"%{ord(first):02X}" + encoded[1:]
    if encoded.endswith("."):
        encoded = encoded[:-1] + "%2E"
    return encoded


def _safe_relpath(value: str) -> str:
    # Keep object keys below the target root and reject traversal before pathlib normalizes dot segments.
    normalized = value.replace("\\", "/")
    raw_parts = normalized.split("/")
    path = PurePosixPath(normalized)
    if not normalized or path.is_absolute() or any(part in ("", ".", "..") for part in raw_parts):
        raise BackupError(f"Storage object path নিরাপদ নয়: {value!r}")
    return str(path)


def _json_default(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"__base64__": base64.b64encode(bytes(value)).decode("ascii")}
    return str(value)


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default), encoding="utf-8")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _derive_key(password: str, salt: bytes) -> bytes:
    if len(password) < 12:
        raise BackupError("Backup Password কমপক্ষে ১২ অক্ষরের হতে হবে।")
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=KDF_ITERATIONS)
    return kdf.derive(password.encode("utf-8"))


def encrypt_file(source_zip: Path, target_file: Path, password: str, log: LogFn | None = None) -> str:
    """Stream-encrypt a ZIP with AES-256-GCM and PBKDF2; plaintext is never left behind after return."""
    salt = os.urandom(SALT_LENGTH)
    nonce = os.urandom(NONCE_LENGTH)
    header = MAGIC + salt + nonce
    key = _derive_key(password, salt)
    encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    encryptor.authenticate_additional_data(header)
    target_file.parent.mkdir(parents=True, exist_ok=True)
    temporary = target_file.with_suffix(target_file.suffix + ".part")
    try:
        with source_zip.open("rb") as source, temporary.open("wb") as target:
            target.write(header)
            while True:
                chunk = source.read(CHUNK_SIZE)
                if not chunk:
                    break
                encrypted = encryptor.update(chunk)
                if encrypted:
                    target.write(encrypted)
            final_chunk = encryptor.finalize()
            if final_chunk:
                target.write(final_chunk)
            target.write(encryptor.tag)
            target.flush()
            os.fsync(target.fileno())
        temporary.replace(target_file)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    digest = _sha256_file(target_file)
    checksum_path = target_file.with_suffix(target_file.suffix + ".sha256")
    checksum_path.write_text(f"{digest}  {target_file.name}\n", encoding="ascii")
    _log(log, f"Encrypted Backup তৈরি হয়েছে: {target_file.name}")
    return digest


def decrypt_file(source_file: Path, target_zip: Path, password: str) -> None:
    size = source_file.stat().st_size
    min_size = len(MAGIC) + SALT_LENGTH + NONCE_LENGTH + TAG_LENGTH + 1
    if size < min_size:
        raise BackupError("Backup ফাইল অসম্পূর্ণ বা সঠিক ফরম্যাটের নয়।")
    temporary = target_zip.with_suffix(target_zip.suffix + ".part")
    try:
        with source_file.open("rb") as source:
            header = source.read(len(MAGIC) + SALT_LENGTH + NONCE_LENGTH)
            if len(header) != len(MAGIC) + SALT_LENGTH + NONCE_LENGTH or not header.startswith(MAGIC):
                raise BackupError("এটি Hostel Life-এর সমর্থিত Backup ফাইল নয়।")
            salt = header[len(MAGIC):len(MAGIC) + SALT_LENGTH]
            nonce = header[-NONCE_LENGTH:]
            source.seek(-TAG_LENGTH, os.SEEK_END)
            tag = source.read(TAG_LENGTH)
            ciphertext_length = size - len(header) - TAG_LENGTH
            source.seek(len(header))
            key = _derive_key(password, salt)
            decryptor = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
            decryptor.authenticate_additional_data(header)
            remaining = ciphertext_length
            with temporary.open("wb") as target:
                while remaining > 0:
                    chunk = source.read(min(CHUNK_SIZE, remaining))
                    if not chunk:
                        raise BackupError("Backup ফাইলের শেষ অংশ অনুপস্থিত।")
                    remaining -= len(chunk)
                    clear = decryptor.update(chunk)
                    if clear:
                        target.write(clear)
                final_clear = decryptor.finalize()
                if final_clear:
                    target.write(final_clear)
                target.flush()
                os.fsync(target.fileno())
        temporary.replace(target_zip)
    except Exception as exc:
        temporary.unlink(missing_ok=True)
        if isinstance(exc, BackupError):
            raise
        raise BackupError("Password ভুল অথবা Backup ফাইল পরিবর্তিত/ক্ষতিগ্রস্ত হয়েছে।") from exc


def verify_backup(backup_file: Path, password: str, temp_dir: Path | None = None) -> dict[str, Any]:
    if not backup_file.is_file():
        raise BackupError("Backup ফাইল পাওয়া যায়নি।")
    checksum_path = backup_file.with_suffix(backup_file.suffix + ".sha256")
    if checksum_path.is_file():
        expected_line = checksum_path.read_text(encoding="ascii", errors="ignore").strip().split()
        if expected_line:
            actual_archive_hash = _sha256_file(backup_file)
            if actual_archive_hash.lower() != expected_line[0].lower():
                raise BackupError("Backup SHA-256 Checksum মেলেনি; ফাইলটি পরিবর্তিত বা অসম্পূর্ণ।")
    parent = temp_dir or backup_file.parent
    parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix=".hl_verify_", suffix=".zip", dir=parent, delete=False) as tmp:
        zip_path = Path(tmp.name)
    try:
        decrypt_file(backup_file, zip_path, password)
        with zipfile.ZipFile(zip_path, "r") as archive:
            bad = archive.testzip()
            if bad:
                raise BackupError(f"ZIP-এর একটি ফাইল ক্ষতিগ্রস্ত: {bad}")
            names = set(archive.namelist())
            if "manifest.json" not in names:
                raise BackupError("manifest.json পাওয়া যায়নি; Backup অসম্পূর্ণ।")
            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
            if manifest.get("format") != "HostelLifeEncryptedBackup" or int(manifest.get("format_version", 0)) != 2:
                raise BackupError("এই Backup Format সমর্থিত নয়।")
            hashes_map = manifest.get("files_sha256", {})
            if not isinstance(hashes_map, dict) or not hashes_map:
                raise BackupError("Backup Manifest-এ SHA-256 তালিকা নেই।")
            payload_names = names - {"manifest.json"}
            if set(hashes_map) != payload_names:
                raise BackupError("Backup Manifest ও ZIP File List মিলছে না।")
            checked = 0
            for name, expected in hashes_map.items():
                _validate_archive_member(name)
                digest = hashlib.sha256()
                with archive.open(name, "r") as item:
                    while True:
                        chunk = item.read(CHUNK_SIZE)
                        if not chunk:
                            break
                        digest.update(chunk)
                actual = digest.hexdigest()
                if actual.lower() != str(expected).lower():
                    raise BackupError(f"ফাইলের Checksum মেলেনি: {name}")
                checked += 1
            if not checked:
                raise BackupError("Backup Manifest-এ ফাইলের Checksum নেই।")
            return {"verified": True, "files_checked": checked, "backup_type": manifest.get("backup_type"), "created_at": manifest.get("created_at"), "project_ref": manifest.get("project_ref")}
    except zipfile.BadZipFile as exc:
        raise BackupError("এনক্রিপ্টেড Backup-এর ভেতরের ZIP পড়া যায়নি।") from exc
    finally:
        zip_path.unlink(missing_ok=True)


def _copy_project_source(source_root: Path, target_root: Path, log: LogFn | None = None) -> list[str]:
    if not source_root.is_dir():
        raise BackupError("Project Folder নির্বাচন করুন।")
    excluded_dirs = {".git", "node_modules", "dist", ".vercel", ".supabase", ".next", ".temp", "coverage", "__pycache__", "backups", "backup", "Backup"}
    excluded_files = {".env", ".env.local", ".env.production", ".env.development", "service_role.key", "secrets.env", "reusable_secrets.env", "user_supplied_reusable_secrets.env", "credentials.json", ".npmrc", "id_rsa", "id_ed25519", "backup_history.json"}
    copied: list[str] = []
    target_root.mkdir(parents=True, exist_ok=True)
    for current, dirs, files in os.walk(source_root, followlinks=False):
        current_path = Path(current)
        dirs[:] = [name for name in dirs if name not in excluded_dirs and not (current_path / name).is_symlink()]
        relative = current_path.relative_to(source_root)
        out_dir = target_root / relative
        out_dir.mkdir(parents=True, exist_ok=True)
        for filename in files:
            source_file = current_path / filename
            if source_file.is_symlink() or filename in excluded_files:
                continue
            if filename.startswith(".env.") and filename != ".env.example":
                continue
            # Do not copy generated backup artefacts back into the next backup.
            if filename.endswith((".hlbackup", ".sha256", ".log", ".pem", ".p12", ".pfx", ".key")):
                continue
            relative_name = (relative / filename).as_posix()
            if relative_name.startswith("public/downloads/Hostel_Life_Backup_Assistant"):
                # The package is supplied separately in the installer, avoiding a recursive package copy.
                continue
            destination = out_dir / filename
            shutil.copy2(source_file, destination)
            copied.append(relative_name)
    _log(log, f"Project Source Copy: {len(copied)}টি ফাইল")
    return copied


def _scan_secret_names(source_root: Path) -> list[str]:
    names: set[str] = set()
    patterns = [
        re.compile(r"Deno\.env\.get\(['\"]([A-Z0-9_]+)['\"]\)"),
        re.compile(r"process\.env\.([A-Z][A-Z0-9_]+)"),
    ]
    for path in source_root.rglob("*"):
        if not path.is_file() or any(part in {"node_modules", ".git", "dist"} for part in path.parts):
            continue
        if path.suffix.lower() not in {".ts", ".tsx", ".js", ".jsx", ".json", ".toml", ".md", ".example"}:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for pattern in patterns:
            names.update(pattern.findall(text))
    names.update({"VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"})
    return sorted(names)


def _export_auth_data(database_url: str, output_dir: Path, log: LogFn | None = None) -> dict[str, Any]:
    """Export account identity rows from managed Auth tables without copying live sessions."""
    output_dir.mkdir(parents=True, exist_ok=True)
    exported: dict[str, Any] = {}
    optional_tables = ("mfa_factors",)
    with _connect(database_url) as conn:
        server_version = conn.execute("SHOW server_version").fetchone()["server_version"]
        for table in ("users", "identities", *optional_tables):
            columns = conn.execute(
                """SELECT column_name, data_type, udt_name, is_nullable, ordinal_position
                   FROM information_schema.columns
                   WHERE table_schema='auth' AND table_name=%s
                   ORDER BY ordinal_position""",
                [table],
            ).fetchall()
            if not columns:
                if table in optional_tables:
                    continue
                raise BackupError(f"Auth-এর auth.{table} টেবিল পাওয়া যায়নি।")
            # Table names are from a fixed internal allowlist, never user input.
            rows = conn.execute(f'SELECT * FROM auth."{table}"').fetchall()
            data = {
                "schema": "auth",
                "table": table,
                "columns": [dict(row) for row in columns],
                "row_count": len(rows),
                "rows": [dict(row) for row in rows],
            }
            target = output_dir / f"auth_{table}.json"
            _write_json(target, data)
            exported[table] = {"file": target.name, "row_count": len(rows), "column_count": len(columns)}
            _log(log, f"Auth Backup: auth.{table} ({len(rows):,} rows)")
    return {
        "server_version": server_version,
        "tables": exported,
        "excluded_tables": ["auth.sessions", "auth.refresh_tokens", "auth.audit_log_entries", "auth.one_time_tokens"],
        "note": "auth.users, identities এবং বিদ্যমান mfa_factors-এর Data এনক্রিপ্টেড Backup-এ আছে। Active Session/Refresh Token ইচ্ছাকৃতভাবে নেই; Restore-এর পরে পুনরায় Login করতে হবে। Auth Schema নতুন Supabase Project-এর Managed Schema Version-এর সঙ্গে মিলতে হবে।",
    }


def _export_cron_jobs(database_url: str, output_file: Path, log: LogFn | None = None) -> dict[str, Any]:
    """Keep pg_cron SQL commands for review; the restore tool never schedules them automatically."""
    jobs: list[dict[str, Any]] = []
    available = False
    with _connect(database_url) as conn:
        with conn.transaction():
            conn.execute("SET TRANSACTION READ ONLY")
            try:
                with conn.transaction():
                    rows = conn.execute(
                        """SELECT jobid, jobname, schedule, command, nodename, nodeport,
                                  database, username, active
                           FROM cron.job ORDER BY jobid"""
                    ).fetchall()
                    jobs = [dict(row) for row in rows]
                    available = True
            except Exception:
                available = False
    _write_json(output_file, {
        "available": available,
        "job_count": len(jobs),
        "jobs": jobs,
        "restore_policy": "manual_review_only; commands are never executed by Backup Assistant",
    })
    _log(log, f"Cron Job Snapshot: {len(jobs)}টি Job" if available else "pg_cron নেই বা পড়া যায়নি; Cron Job Snapshot unavailable")
    return {"available": available, "job_count": len(jobs)}


def _database_inventory(database_url: str) -> dict[str, Any]:
    with _connect(database_url) as conn:
        version = conn.execute("SELECT version() AS version, current_database() AS database, current_setting('TimeZone') AS timezone").fetchone()
        database_size = conn.execute("SELECT pg_database_size(current_database())::bigint AS bytes").fetchone()
        extensions = conn.execute("SELECT extname, extversion FROM pg_extension ORDER BY extname").fetchall()
        schemas = conn.execute("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','pg_catalog') ORDER BY schema_name").fetchall()
        sizes = conn.execute(
            """SELECT schemaname, relname AS table_name,
                      pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass)::bigint AS total_bytes,
                      n_live_tup::bigint AS estimated_live_rows
               FROM pg_stat_user_tables ORDER BY total_bytes DESC LIMIT 50"""
        ).fetchall()
        publications = conn.execute("SELECT pubname, puballtables FROM pg_publication ORDER BY pubname").fetchall()
        publication_tables = conn.execute("SELECT pubname, schemaname, tablename FROM pg_publication_tables ORDER BY pubname, schemaname, tablename").fetchall()
        migration_schema = conn.execute("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='supabase_migrations') AS exists").fetchone()["exists"]
        cron_jobs = []
        try:
            with conn.transaction():
                cron_rows = conn.execute("SELECT jobid, jobname, schedule, active, length(command)::integer AS command_length, md5(command) AS command_md5 FROM cron.job ORDER BY jobid").fetchall()
                cron_jobs = [dict(row) for row in cron_rows]
        except Exception:
            cron_jobs = []
        try:
            with conn.transaction():
                storage_usage = conn.execute(
                    """SELECT bucket_id, count(*)::bigint AS object_count,
                              COALESCE(sum(CASE WHEN COALESCE(metadata->>'size','') ~ '^[0-9]+$' THEN (metadata->>'size')::bigint ELSE 0 END),0)::bigint AS total_bytes
                       FROM storage.objects GROUP BY bucket_id ORDER BY bucket_id"""
                ).fetchall()
                storage_usage_available = True
        except Exception:
            storage_usage = []
            storage_usage_available = False
        return {
            "database": {**dict(version), "database_size_bytes": database_size["bytes"]},
            "storage_usage_estimate": {"available": storage_usage_available, "buckets": [dict(row) for row in storage_usage], "total_bytes": sum(row["total_bytes"] for row in storage_usage)},
            "extensions": [dict(row) for row in extensions],
            "schemas": [row["schema_name"] for row in schemas],
            "largest_tables_top_50": [dict(row) for row in sizes],
            "realtime_publications": [dict(row) for row in publications],
            "realtime_publication_tables": [dict(row) for row in publication_tables],
            "cron_jobs_summary": cron_jobs,
            "supabase_migrations_schema_exists": bool(migration_schema),
        }


def estimate_master_backup(database_url: str) -> dict[str, Any]:
    """Read-only estimate of database and Storage object bytes; does not download any data."""
    inventory = _database_inventory(database_url)
    database_bytes = int(inventory.get("database", {}).get("database_size_bytes") or 0)
    storage_info = inventory.get("storage_usage_estimate", {})
    storage_bytes = int(storage_info.get("total_bytes") or 0)
    return {
        "database_bytes": database_bytes,
        "storage_bytes": storage_bytes,
        "storage_available": bool(storage_info.get("available")),
        "object_count": sum(int(row.get("object_count") or 0) for row in storage_info.get("buckets", [])),
        "bucket_count": len(storage_info.get("buckets", [])),
        "estimated_source_bytes": database_bytes + storage_bytes,
        "note": "এটি আনুমানিক Source Size; SQL Compression, API Response ও অন্যান্য মাসিক Traffic-এর কারণে বাস্তব Egress আলাদা হতে পারে।",
    }


def _supabase_headers(api_key: str) -> dict[str, str]:
    key = api_key.strip()
    if not key:
        raise BackupError("Storage Backup-এর জন্য Supabase Service Role/Secret Key প্রয়োজন।")
    headers = {"apikey": key, "User-Agent": "HostelLifeBackupAssistant/1.0"}
    # New sb_secret keys are opaque API keys, not JWTs; legacy service_role keys are JWTs.
    if not key.startswith("sb_secret_"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _storage_request(session: requests.Session, method: str, url: str, **kwargs):
    last_error = None
    for attempt in range(3):
        try:
            response = session.request(method, url, timeout=(20, 180), **kwargs)
            if response.status_code in (429, 500, 502, 503, 504):
                last_error = BackupError(f"Storage API সাময়িকভাবে ব্যস্ত (HTTP {response.status_code})")
                response.close()
                time.sleep(1.5 * (attempt + 1))
                continue
            if response.status_code >= 400:
                message = ""
                try:
                    body = response.json()
                    message = body.get("message") or body.get("error") or body.get("statusCode") or ""
                except Exception:
                    message = response.text[:300]
                response.close()
                raise BackupError(f"Storage API ব্যর্থ (HTTP {response.status_code}): {_redact(str(message))}")
            return response
        except requests.RequestException as exc:
            last_error = BackupError(f"Storage Network Error: {exc.__class__.__name__}")
            time.sleep(1.5 * (attempt + 1))
    raise last_error or BackupError("Storage API অনুরোধ ব্যর্থ হয়েছে।")


def _download_storage(
    project_url: str,
    service_key: str,
    output_root: Path,
    log: LogFn | None = None,
    *,
    user_ids: set[str] | None = None,
) -> dict[str, Any]:
    base = project_url.rstrip("/") + "/storage/v1"
    session = requests.Session()
    session.headers.update(_supabase_headers(service_key))
    buckets_response = _storage_request(session, "GET", base + "/bucket")
    buckets = buckets_response.json()
    if not isinstance(buckets, list):
        raise BackupError("Storage Bucket List-এর Response সঠিক নয়।")
    safe_buckets = []
    for bucket in buckets:
        safe_buckets.append({key: bucket.get(key) for key in (
            "id", "name", "public", "file_size_limit", "allowed_mime_types", "created_at", "updated_at"
        ) if key in bucket})
    _write_json(output_root / "buckets.json", safe_buckets)
    objects_root = output_root / "objects"
    objects_root.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, Any]] = []
    total_bytes = 0
    for bucket in buckets:
        bucket_id = str(bucket.get("id") or bucket.get("name") or "")
        if not bucket_id:
            continue
        _log(log, f"Storage Bucket Backup: {bucket_id}")
        queue = deque([""])
        visited_prefixes: set[str] = set()
        while queue:
            prefix = queue.popleft()
            if prefix in visited_prefixes:
                continue
            visited_prefixes.add(prefix)
            offset = 0
            while True:
                response = _storage_request(
                    session,
                    "POST",
                    f"{base}/object/list/{quote(bucket_id, safe='')}",
                    json={"prefix": prefix, "limit": 500, "offset": offset, "sortBy": {"column": "name", "order": "asc"}},
                )
                items = response.json()
                if not isinstance(items, list):
                    raise BackupError(f"Bucket {bucket_id}-এর Object List সঠিক নয়।")
                for item in items:
                    name = str(item.get("name") or "")
                    if not name:
                        continue
                    full_path = f"{prefix}{name}"
                    metadata = item.get("metadata")
                    is_folder = metadata is None and item.get("id") is None
                    if is_folder:
                        queue.append(full_path.rstrip("/") + "/")
                        continue
                    if user_ids is not None:
                        first_segment = full_path.split("/", 1)[0]
                        if bucket_id != "profile-avatars" or first_segment not in user_ids:
                            continue
                    if len(manifest) >= MAX_STORAGE_OBJECTS:
                        raise BackupError(f"Storage Object {MAX_STORAGE_OBJECTS:,}-এর সীমা অতিক্রম করেছে।")
                    _safe_relpath(f"{bucket_id}/{full_path}")
                    disk_parts = [_windows_safe_component(part) for part in (bucket_id, *full_path.split("/"))]
                    destination = objects_root.joinpath(*disk_parts)
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    encoded_path = "/".join(quote(part, safe="-_.~") for part in full_path.split("/"))
                    download_url = f"{base}/object/authenticated/{quote(bucket_id, safe='-_.~')}/{encoded_path}"
                    download = _storage_request(session, "GET", download_url, stream=True)
                    size = 0
                    digest = hashlib.sha256()
                    try:
                        with destination.open("wb") as file_handle:
                            for chunk in download.iter_content(chunk_size=CHUNK_SIZE):
                                if not chunk:
                                    continue
                                file_handle.write(chunk)
                                digest.update(chunk)
                                size += len(chunk)
                    finally:
                        download.close()
                    total_bytes += size
                    manifest.append({
                        "bucket": bucket_id,
                        "path": full_path,
                        "local_path": "/".join(disk_parts),
                        "size_bytes": size,
                        "sha256": digest.hexdigest(),
                        "content_type": (metadata or {}).get("mimetype") or (metadata or {}).get("contentType"),
                        "cache_control": (metadata or {}).get("cacheControl"),
                    })
                    _log(log, f"ডাউনলোড: {bucket_id}/{full_path} ({size:,} bytes)")
                if len(items) < 500:
                    break
                offset += len(items)
    _write_json(output_root / "objects_manifest.json", manifest)
    session.close()
    return {"bucket_count": len(buckets), "object_count": len(manifest), "total_bytes": total_bytes, "buckets": safe_buckets}


def _export_storage_database_metadata(database_url: str, output_dir: Path, log: LogFn | None = None) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    with _connect(database_url) as conn:
        count_row = conn.execute("SELECT count(*)::bigint AS object_count FROM storage.objects").fetchone()
        object_count = int(count_row["object_count"] or 0)
        if object_count > MAX_STORAGE_OBJECTS:
            raise BackupError(f"Storage Object সংখ্যা {object_count:,}; নিরাপদ Backup সীমা {MAX_STORAGE_OBJECTS:,}। সীমা বাড়ানোর আগে পর্যালোচনা দরকার।")
        buckets = conn.execute("SELECT * FROM storage.buckets ORDER BY id").fetchall()
        objects = conn.execute("SELECT * FROM storage.objects ORDER BY bucket_id, name").fetchall()
    _write_json(output_dir / "storage_buckets_database.json", [dict(row) for row in buckets])
    _write_json(output_dir / "storage_objects_database.json", [dict(row) for row in objects])
    _log(log, f"Storage Database Metadata: {len(buckets)} buckets, {len(objects):,} objects")
    return {"bucket_rows": len(buckets), "object_rows": len(objects), "note": "Storage objects-এর database metadata এনক্রিপ্টেড JSON-এ আছে; আসল object file আলাদা Storage API download-এ রাখা হয়েছে। Restore Module 2 Storage API ব্যবহার করে bucket/object recreate করবে।"}


def _write_recovery_docs(staging: Path, project_ref: str, secret_names: list[str], backup_type: str, contains_user_secrets: bool = False) -> None:
    config_dir = staging / "recovery"
    config_dir.mkdir(parents=True, exist_ok=True)
    secret_lines = "\n".join(f"- `{name}`" for name in secret_names) if secret_names else "- `VITE_SUPABASE_URL`\n- `VITE_SUPABASE_PUBLISHABLE_KEY`\n- `SUPABASE_URL`\n- `SUPABASE_PUBLISHABLE_KEY`\n- `SUPABASE_SECRET_KEY` (new key) / `SUPABASE_SERVICE_ROLE_KEY` (legacy key)"
    if backup_type.lower() == "master":
        contents = """- Supabase CLI database roles/schema/data exports
- Auth users, identities and optional MFA factors (encrypted JSON data; includes password hashes)
- Supabase Storage bucket metadata and object files
- Local website source, SQL migrations, Edge Function source and PWA assets
- Database extension, publication, version and table inventory"""
        limitations = """- Supabase Auth users and identities are included as encrypted JSON data. Active sessions/refresh tokens are intentionally not copied; users should sign in again after a project migration.
- Storage objects are included as files; Module 2 recreates bucket/object content through the Storage API and verifies object hashes.
- This package includes a database logical dump, but platform-level Auth, SMTP, provider, Vercel and project settings still need reconfiguration."""
    else:
        contents = """- Selected Hostel row and related public/private table data
- Related member profile rows and selected hostel members' profile-avatar objects
- Foreign-key and column metadata used by the Module 2 scoped restore
- Identity references only; no Auth passwords or global project settings"""
        limitations = """- A Hostel Backup is a tenant-scoped data package for an existing compatible Hostel Life schema. It does not contain Auth account credentials, global settings, the website source or Edge Function code.
- The target project must already contain the Auth User IDs listed in `identity_references.json`; the package does not recreate user accounts.
- This package can be restored by Module 2 into an existing compatible Hostel Life schema; it is not a standalone Supabase project backup."""
    checklist = f"""# Hostel Life Recovery Checklist (Module 1 Backup)

Backup Type: {backup_type}
Source Project Ref: {project_ref}

## This package contains
{contents}
- Encrypted manifest with per-file SHA-256 hashes
- Optional user-supplied reusable secrets file: {"included in encrypted payload" if contains_user_secrets else "not selected; required values must be re-entered"}

## Reconfiguration items
The following names were found or are normally required. Re-enter their NEW project-specific values in the target environment; do not reuse old project keys blindly. If an optional reusable secrets file was selected, its contents are encrypted in `recovery/user_supplied_reusable_secrets.env`; review it before restoring and update project-specific keys:
{secret_lines}

Also review:
- Supabase Auth Site URL, redirect allow-list, email/SMTP settings and enabled providers
- Project API keys, database password, JWT signing configuration and project URL
- Edge Function secrets and environment variables
- Realtime publication membership
- Required extensions and Database Webhooks
- Vercel environment variables, project binding, custom domain and deployment settings
- Any Vault / column-encryption root key, if the project uses Vault or encrypted columns

## Important limitations
{limitations}
- Module 2 Restore is available in the Backup Assistant. Master Restore requires a different, new/empty Target Project; Hostel Restore adds a separate Hostel to a compatible schema and never overwrites an existing Hostel.
- This is a logical backup. Run it during a low-activity period and keep at least one separate copy on USB or another device.
"""
    (config_dir / "MANUAL_RECONFIGURATION_CHECKLIST.md").write_text(checklist, encoding="utf-8")


def _build_encrypted_archive(
    staging: Path,
    destination_dir: Path,
    project_ref: str,
    backup_type: str,
    password: str,
    log: LogFn | None = None,
    *,
    warnings: list[str] | None = None,
) -> dict[str, Any]:
    warnings = warnings or []
    all_files = sorted(path for path in staging.rglob("*") if path.is_file() and path.name != "manifest.json")
    hashes_map = {path.relative_to(staging).as_posix(): _sha256_file(path) for path in all_files}
    file_count = len(hashes_map)
    total_bytes = sum(path.stat().st_size for path in all_files)
    manifest = {
        "format": "HostelLifeEncryptedBackup",
        "format_version": 2,
        "backup_type": backup_type,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "project_ref": project_ref,
        "file_count": file_count,
        "payload_bytes": total_bytes,
        "encryption": {"algorithm": "AES-256-GCM", "kdf": "PBKDF2-HMAC-SHA256", "iterations": KDF_ITERATIONS},
        "warnings": warnings,
        "files_sha256": hashes_map,
    }
    _write_json(staging / "manifest.json", manifest)
    destination_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_ref = re.sub(r"[^a-zA-Z0-9_-]", "", project_ref)[:16] or "project"
    output = destination_dir / f"HostelLife_{backup_type}_{safe_ref}_{stamp}.hlbackup"
    zip_path = staging.parent / f"{output.stem}.zip"
    try:
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            for path in sorted(p for p in staging.rglob("*") if p.is_file()):
                archive.write(path, path.relative_to(staging).as_posix())
        digest = encrypt_file(zip_path, output, password, log)
    finally:
        zip_path.unlink(missing_ok=True)
    history_path = destination_dir / "backup_history.json"
    history: list[dict[str, Any]] = []
    if history_path.exists():
        try:
            history = json.loads(history_path.read_text(encoding="utf-8"))
            if not isinstance(history, list):
                history = []
        except Exception:
            history = []
    history.append({
        "file": output.name,
        "created_at": manifest["created_at"],
        "backup_type": backup_type,
        "project_ref": project_ref,
        "size_bytes": output.stat().st_size,
        "sha256": digest,
    })
    history_path.write_text(json.dumps(history[-100:], ensure_ascii=False, indent=2), encoding="utf-8")
    return {"file": str(output), "size_bytes": output.stat().st_size, "sha256": digest, "manifest": manifest}


def create_master_backup(
    *,
    database_url: str,
    project_url: str,
    project_ref: str,
    service_role_key: str,
    project_root: Path,
    destination_dir: Path,
    password: str,
    reusable_secrets_file: Path | None = None,
    log: LogFn | None = None,
    progress: ProgressFn | None = None,
) -> dict[str, Any]:
    checks = check_prerequisites()
    missing = [name for name in ("psycopg", "supabase_cli", "docker_running") if not checks.get(name)]
    if missing:
        labels = {"psycopg": "psycopg Python Package", "supabase_cli": "Supabase CLI / npx", "docker_running": "চালু Docker Desktop"}
        raise BackupError("Master Backup-এর আগে ইনস্টল/চালু করুন: " + ", ".join(labels.get(name, name) for name in missing))
    if not service_role_key.strip():
        raise BackupError("Storage Objects Backup-এর জন্য Service Role/Secret Key দিতে হবে।")
    if not project_url.lower().startswith("https://"):
        raise BackupError("Supabase Project URL অবশ্যই HTTPS হতে হবে।")
    if not re.fullmatch(r"[a-z0-9-]{8,40}", project_ref.strip()):
        raise BackupError("Project Ref সঠিক নয়। Supabase Project Settings থেকে কপি করুন।")
    _derive_key(password, os.urandom(SALT_LENGTH))  # validate password before any export
    warnings: list[str] = []
    destination_dir.mkdir(parents=True, exist_ok=True)
    project_resolved = project_root.resolve()
    destination_resolved = destination_dir.resolve()
    if destination_resolved == project_resolved or project_resolved in destination_resolved.parents:
        raise BackupError("Backup Folder Project Folder-এর ভেতরে হতে পারবে না। আলাদা Drive বা USB Folder নির্বাচন করুন।")
    # Plaintext staging stays on the selected backup volume and is removed on exit.
    with tempfile.TemporaryDirectory(prefix=".hostel_life_master_", dir=destination_dir) as temp_name:
        temp = Path(temp_name)
        staging = temp / "payload"
        staging.mkdir()
        workdir = temp / "supabase_work"
        (workdir / "supabase").mkdir(parents=True, exist_ok=True)
        (workdir / "supabase" / "config.toml").write_text(
            'project_id = "hostel-life-backup-export"\n\n[api]\nenabled = false\n\n[db]\nport = 54322\n',
            encoding="utf-8",
        )
        conn_parts = parse_database_url(database_url)
        cli_env = os.environ.copy()
        cli_env["SUPABASE_DB_PASSWORD"] = conn_parts["password"]
        cli_env["PGPASSWORD"] = conn_parts["password"]
        # Authenticate through the Supabase CLI's existing OS credential store.
        # This creates only a temporary link config, not a link in the user's project.
        _progress(progress, "Supabase Project সংযোগ যাচাই", 5)
        _run_command(supabase_command() + ["link", "--project-ref", project_ref], cwd=workdir, env=cli_env, log=log, timeout=180)

        database_dir = staging / "database"
        database_dir.mkdir(parents=True)
        dump_jobs = [
            ("roles.sql", supabase_command() + ["db", "dump", "--linked", "-f", str(database_dir / "roles.sql"), "--role-only"]),
            ("schema.sql", supabase_command() + ["db", "dump", "--linked", "-f", str(database_dir / "schema.sql")]),
            ("data.sql", supabase_command() + ["db", "dump", "--linked", "-f", str(database_dir / "data.sql"), "--use-copy", "--data-only", "-x", "storage.buckets_vectors", "-x", "storage.vector_indexes"]),
        ]
        for index, (name, command) in enumerate(dump_jobs, start=1):
            _progress(progress, f"Database {name} Export", 8 + index * 12)
            _run_command(command, cwd=workdir, env=cli_env, log=log, timeout=60 * 60)
            target = database_dir / name
            if not target.exists() or target.stat().st_size < 50:
                raise BackupError(f"Database Dump ফাইল তৈরি হয়নি বা ফাঁকা: {name}")

        _progress(progress, "Auth User ও Identity Backup", 48)
        auth_info = _export_auth_data(database_url, database_dir / "auth", log)
        _write_json(database_dir / "auth" / "auth_backup_info.json", auth_info)

        _progress(progress, "Database Inventory ও Extension যাচাই", 55)
        inventory = _database_inventory(database_url)
        _write_json(database_dir / "inventory.json", inventory)
        _export_cron_jobs(database_url, database_dir / "cron_jobs.json", log)
        estimated_bytes = int(inventory.get("database", {}).get("database_size_bytes") or 0) + int(inventory.get("storage_usage_estimate", {}).get("total_bytes") or 0)
        _log(log, f"আনুমানিক Database + Storage Export Size: {estimated_bytes:,} bytes (বাস্তব Egress আলাদা হতে পারে)")
        if estimated_bytes > 4 * 1024 * 1024 * 1024:
            warnings.append("Database + Storage-এর আনুমানিক আকার ৪ GB-এর বেশি। Free Plan-এর মাসিক Egress সীমা ও ইতিমধ্যে ব্যবহৃত Traffic দেখে Backup সময় নির্ধারণ করুন।")
            _log(log, warnings[-1])
        if inventory.get("supabase_migrations_schema_exists"):
            try:
                _run_command(
                    supabase_command() + ["db", "dump", "--linked", "--schema", "supabase_migrations", "-f", str(database_dir / "migration_history_schema.sql")],
                    cwd=workdir, env=cli_env, log=log, timeout=60 * 30,
                )
                _run_command(
                    supabase_command() + ["db", "dump", "--linked", "--schema", "supabase_migrations", "-f", str(database_dir / "migration_history_data.sql"), "--use-copy", "--data-only"],
                    cwd=workdir, env=cli_env, log=log, timeout=60 * 30,
                )
            except BackupError as exc:
                warnings.append(f"Supabase CLI Migration History আলাদাভাবে Export করতে পারেনি: {exc}; Local SQL Migration Source অন্তর্ভুক্ত আছে।")
                _log(log, warnings[-1])
        else:
            warnings.append("supabase_migrations Schema পাওয়া যায়নি; Local SQL Migration Files Backup-এ অন্তর্ভুক্ত আছে।")

        _progress(progress, "Storage Bucket ও File Backup", 62)
        storage_info = _download_storage(project_url, service_role_key, staging / "storage", log)
        storage_db_info = _export_storage_database_metadata(database_url, staging / "storage", log)
        storage_info["database_metadata"] = storage_db_info
        _write_json(staging / "storage" / "storage_backup_info.json", storage_info)

        _progress(progress, "Project Source ও SQL Migration Copy", 78)
        project_files = _copy_project_source(project_root, staging / "project" / "source", log)
        _write_json(staging / "project" / "source_inventory.json", {"file_count": len(project_files), "files": project_files})
        secret_names = _scan_secret_names(project_root)
        _write_json(staging / "project" / "required_secret_names.json", secret_names)

        _progress(progress, "Remote Edge Function Source ও Secret Name List", 84)
        remote_work = temp / "remote_functions"
        (remote_work / "supabase").mkdir(parents=True, exist_ok=True)
        (remote_work / "supabase" / "config.toml").write_text('project_id = "hostel-life-edge-export"\n', encoding="utf-8")
        remote_functions_dir = staging / "edge_functions" / "remote_snapshot"
        try:
            _run_command(supabase_command() + ["functions", "download", "--project-ref", project_ref, "--use-api"], cwd=remote_work, env=cli_env, log=log, timeout=60 * 20)
            downloaded = remote_work / "supabase" / "functions"
            if downloaded.exists():
                shutil.copytree(downloaded, remote_functions_dir, dirs_exist_ok=True)
            else:
                warnings.append("Remote Edge Function download-এর পরে কোনো function folder পাওয়া যায়নি; local source অন্তর্ভুক্ত আছে।")
        except BackupError as exc:
            warnings.append(f"Remote Edge Function snapshot সম্পন্ন হয়নি: {exc}; Local source অন্তর্ভুক্ত আছে।")
            _log(log, warnings[-1])
        (staging / "edge_functions" / "local_source_note.txt").write_text(
            "Project/source/supabase/functions-এ local Edge Function source সংরক্ষিত আছে। remote_snapshot থাকলে সেটি deployed source-এর পৃথক কপি।\n",
            encoding="utf-8",
        )

        try:
            secrets_output = _run_command(supabase_command() + ["secrets", "list", "--project-ref", project_ref], cwd=remote_work, env=cli_env, log=log, timeout=90)
            # Store only names, not complete CLI output. Avoid accidental value disclosure.
            secret_listing = []
            for line in secrets_output.splitlines():
                match = re.match(r"\s*([A-Z][A-Z0-9_]{2,})\s+(?:\S+)?", line)
                if match and match.group(1) not in {"NAME", "SECRET", "SECRETS"}:
                    secret_listing.append(match.group(1))
            _write_json(staging / "edge_functions" / "secret_names_only.json", sorted(set(secret_listing)))
        except BackupError as exc:
            warnings.append(f"Edge Function Secret Name List পাওয়া যায়নি: {exc}")
            _log(log, warnings[-1])

        contains_user_secrets = False
        if reusable_secrets_file is not None:
            if not reusable_secrets_file.is_file():
                raise BackupError("নির্বাচিত Reusable Secrets File পাওয়া যায়নি।")
            if reusable_secrets_file.stat().st_size > 1024 * 1024:
                raise BackupError("Reusable Secrets File ১ MB-এর বেশি হতে পারবে না।")
            secrets_copy = staging / "recovery" / "user_supplied_reusable_secrets.env"
            secrets_copy.parent.mkdir(parents=True, exist_ok=True)
            secrets_copy.write_bytes(reusable_secrets_file.read_bytes())
            contains_user_secrets = True
            _log(log, "ঐচ্ছিক Reusable Secrets File এনক্রিপ্টেড Backup-এর অন্তর্ভুক্ত করা হয়েছে (কোনো Secret Value Log করা হয়নি)।")
        _write_recovery_docs(staging, project_ref, sorted(set(secret_names)), "master", contains_user_secrets)
        _write_json(staging / "metadata" / "source_project.json", {
            "project_ref": project_ref,
            "project_url": project_url.rstrip("/"),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "project_root_name": project_root.name,
            "database_inventory": "database/inventory.json",
            "storage_inventory": "storage/storage_backup_info.json",
            "secrets_values_included": contains_user_secrets,
        })
        _progress(progress, "AES-256-GCM এনক্রিপশন ও Checksum", 92)
        result = _build_encrypted_archive(staging, destination_dir, project_ref, "MASTER", password, log, warnings=warnings)
        result["warnings"] = warnings
        result["storage"] = storage_info
        _progress(progress, "Master Backup সম্পন্ন", 100)
        return result


# ---------- Hostel-only logical export ----------

def _load_catalog(conn) -> tuple[dict[tuple[str, str], list[str]], list[dict[str, Any]], dict[tuple[str, str], list[str]]]:
    pk_rows = conn.execute(
        """SELECT tc.table_schema, tc.table_name, kcu.column_name, kcu.ordinal_position
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_schema=kcu.constraint_schema AND tc.constraint_name=kcu.constraint_name
            AND tc.table_schema=kcu.table_schema AND tc.table_name=kcu.table_name
           WHERE tc.constraint_type='PRIMARY KEY'
             AND tc.table_schema IN ('public','private')
           ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position"""
    ).fetchall()
    pk_map: dict[tuple[str, str], list[str]] = {}
    for row in pk_rows:
        pk_map.setdefault((row["table_schema"], row["table_name"]), []).append(row["column_name"])
    fk_rows = conn.execute(
        """SELECT child_ns.nspname AS child_schema, child.relname AS child_table,
                  parent_ns.nspname AS parent_schema, parent.relname AS parent_table,
                  fk.conname AS constraint_name, child_att.attname AS child_column,
                  parent_att.attname AS parent_column, child_key.ordinality AS ordinal_position
           FROM pg_constraint fk
           JOIN pg_class child ON child.oid=fk.conrelid
           JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
           JOIN pg_class parent ON parent.oid=fk.confrelid
           JOIN pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace
           CROSS JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY AS child_key(attnum, ordinality)
           JOIN LATERAL unnest(fk.confkey) WITH ORDINALITY AS parent_key(attnum, ordinality)
             ON parent_key.ordinality=child_key.ordinality
           JOIN pg_attribute child_att ON child_att.attrelid=child.oid AND child_att.attnum=child_key.attnum
           JOIN pg_attribute parent_att ON parent_att.attrelid=parent.oid AND parent_att.attnum=parent_key.attnum
           WHERE fk.contype='f'
             AND child_ns.nspname IN ('public','private')
             AND parent_ns.nspname IN ('public','private')
           ORDER BY child_ns.nspname, child.relname, fk.conname, child_key.ordinality"""
    ).fetchall()
    fk_map: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in fk_rows:
        key = (row["child_schema"], row["child_table"], row["constraint_name"])
        item = fk_map.setdefault(key, {
            "child_schema": row["child_schema"], "child_table": row["child_table"],
            "parent_schema": row["parent_schema"], "parent_table": row["parent_table"],
            "child_columns": [], "parent_columns": [],
        })
        item["child_columns"].append(row["child_column"])
        item["parent_columns"].append(row["parent_column"])
    fks = list(fk_map.values())
    column_rows = conn.execute(
        """SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable, ordinal_position
           FROM information_schema.columns
           WHERE table_schema IN ('public','private')
           ORDER BY table_schema, table_name, ordinal_position"""
    ).fetchall()
    columns: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in column_rows:
        columns.setdefault((row["table_schema"], row["table_name"]), []).append(dict(row))
    return pk_map, fks, {key: value for key, value in columns.items()}


def _ident(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _query_rows(conn, schema: str, table: str, where_sql: str, params: list[Any]) -> list[dict[str, Any]]:
    sql = f"SELECT * FROM {_ident(schema)}.{_ident(table)} WHERE {where_sql}"
    cursor = conn.execute(sql, params)
    return [dict(row) for row in cursor.fetchall()]


def _row_key(row: dict[str, Any], pk_columns: list[str]) -> tuple[Any, ...]:
    return tuple(row.get(column) for column in pk_columns)


def _select_by_values(conn, schema: str, table: str, columns: list[str], values: list[tuple[Any, ...]], hostel_id: str, has_hostel_id: bool) -> list[dict[str, Any]]:
    if not values:
        return []
    output: list[dict[str, Any]] = []
    # Composite-key tuple predicates are supported by PostgreSQL.
    for offset in range(0, len(values), MAX_FK_BATCH):
        chunk = values[offset:offset + MAX_FK_BATCH]
        if len(columns) == 1:
            placeholders = ",".join(["%s"] * len(chunk))
            predicate = f"{_ident(columns[0])} IN ({placeholders})"
            params = [row[0] for row in chunk]
        else:
            left = "(" + ",".join(_ident(col) for col in columns) + ")"
            rows_sql = ",".join(["(" + ",".join(["%s"] * len(columns)) + ")"] * len(chunk))
            predicate = f"{left} IN ({rows_sql})"
            params = [value for row in chunk for value in row]
        if has_hostel_id:
            predicate += f" AND {_ident('hostel_id')} = %s"
            params.append(hostel_id)
        output.extend(_query_rows(conn, schema, table, predicate, params))
    return output


def _collect_hostel_rows(conn, hostel_id: str, log: LogFn | None = None) -> dict[tuple[str, str], dict[tuple[Any, ...], dict[str, Any]]]:
    pk_map, fks, columns = _load_catalog(conn)
    root_key = ("public", "hostels")
    if root_key not in pk_map:
        raise BackupError("public.hostels টেবিল বা Primary Key পাওয়া যায়নি।")
    root_rows = _query_rows(conn, "public", "hostels", '"id" = %s', [hostel_id])
    if not root_rows:
        raise BackupError("নির্বাচিত মেস ডাটাবেসে পাওয়া যায়নি।")
    included: dict[tuple[str, str], dict[tuple[Any, ...], dict[str, Any]]] = {root_key: {_row_key(root_rows[0], pk_map[root_key]): root_rows[0]}}
    processed_sizes: dict[tuple[str, str], int] = {}
    queue: deque[tuple[str, str]] = deque([root_key])
    # First, seed every table that explicitly carries hostel_id. This also covers
    # legacy tables whose foreign-key constraint is missing but tenant key exists.
    for table_key, table_columns in columns.items():
        schema, table = table_key
        names = {col["column_name"] for col in table_columns}
        if table_key == root_key or "hostel_id" not in names or table_key not in pk_map:
            continue
        rows = _query_rows(conn, schema, table, '"hostel_id" = %s', [hostel_id])
        if rows:
            store = included.setdefault(table_key, {})
            for row in rows:
                store[_row_key(row, pk_map[table_key])] = row
            queue.append(table_key)
            _log(log, f"মেস ডেটা শনাক্ত: {schema}.{table} ({len(rows)} row)")
            if sum(len(row_set) for row_set in included.values()) > MAX_HOSTEL_ROWS:
                raise BackupError(f"মেস Backup {MAX_HOSTEL_ROWS:,} row-এর নিরাপত্তা সীমা অতিক্রম করেছে।")
    # Walk only from tenant-owned parents to their child tables. We never walk
    # upward into auth.users or other global accounts, preventing cross-hostel leaks.
    while queue:
        parent_key = queue.popleft()
        parent_rows = list(included.get(parent_key, {}).values())
        old_size = processed_sizes.get(parent_key, 0)
        if old_size >= len(parent_rows):
            continue
        fresh_rows = parent_rows[old_size:]
        processed_sizes[parent_key] = len(parent_rows)
        for fk in fks:
            if (fk["parent_schema"], fk["parent_table"]) != parent_key:
                continue
            child_key = (fk["child_schema"], fk["child_table"])
            child_pk = pk_map.get(child_key)
            if not child_pk:
                continue
            parent_values = [tuple(row.get(col) for col in fk["parent_columns"]) for row in fresh_rows]
            parent_values = [value for value in parent_values if all(item is not None for item in value)]
            if not parent_values:
                continue
            child_col_names = {col["column_name"] for col in columns.get(child_key, [])}
            child_rows = _select_by_values(
                conn,
                child_key[0], child_key[1], fk["child_columns"], parent_values,
                hostel_id, "hostel_id" in child_col_names,
            )
            if not child_rows:
                continue
            store = included.setdefault(child_key, {})
            before = len(store)
            for row in child_rows:
                if "hostel_id" in row and str(row["hostel_id"]) != str(hostel_id):
                    continue
                store[_row_key(row, child_pk)] = row
            if len(store) > before:
                queue.append(child_key)
            if sum(len(rows) for rows in included.values()) > MAX_HOSTEL_ROWS:
                raise BackupError(f"মেস Backup {MAX_HOSTEL_ROWS:,} row-এর নিরাপত্তা সীমা অতিক্রম করেছে।")
    # Profiles are global records, but include only profiles belonging to this
    # hostel's memberships; never include other hostel's membership/financial rows.
    membership_key = ("public", "hostel_memberships")
    profile_key = ("public", "profiles")
    if membership_key in included and profile_key in pk_map:
        user_ids = sorted({row.get("user_id") for row in included[membership_key].values() if row.get("user_id")})
        profiles: dict[tuple[Any, ...], dict[str, Any]] = {}
        for offset in range(0, len(user_ids), MAX_FK_BATCH):
            batch = user_ids[offset:offset + MAX_FK_BATCH]
            placeholders = ",".join(["%s"] * len(batch))
            rows = _query_rows(conn, "public", "profiles", f'"id" IN ({placeholders})', batch)
            for row in rows:
                profiles[_row_key(row, pk_map[profile_key])] = row
        if profiles:
            included[profile_key] = profiles
    total = sum(len(rows) for rows in included.values())
    _log(log, f"Hostel Export: {len(included)}টি টেবিল, {total:,}টি row")
    return included


def _export_hostel_json(conn, hostel_id: str, output_root: Path, log: LogFn | None = None) -> dict[str, Any]:
    pk_map, _fks, columns = _load_catalog(conn)
    included = _collect_hostel_rows(conn, hostel_id, log)
    export_root = output_root / "tables"
    export_root.mkdir(parents=True, exist_ok=True)
    table_info: list[dict[str, Any]] = []
    user_ids: set[str] = set()
    for table_key in sorted(included.keys()):
        schema, table = table_key
        rows_map = included[table_key]
        rows = list(rows_map.values())
        if table == "hostel_memberships":
            user_ids.update(str(row["user_id"]) for row in rows if row.get("user_id"))
        filename = f"{schema}__{table}.json"
        _write_json(export_root / filename, rows)
        table_info.append({
            "schema": schema,
            "table": table,
            "file": f"tables/{filename}",
            "row_count": len(rows),
            "primary_key": pk_map.get(table_key, []),
            "columns": columns.get(table_key, []),
        })
    # Record every Auth User ID referenced by the selected tenant rows, but do not
    # export auth.users or traverse into other hostels. Member profile/avatar data
    # remains limited to the selected hostel's membership rows.
    auth_fk_rows = conn.execute(
        """SELECT child_ns.nspname AS child_schema, child.relname AS child_table,
                  child_att.attname AS child_column
           FROM pg_constraint fk
           JOIN pg_class child ON child.oid=fk.conrelid
           JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
           JOIN pg_class parent ON parent.oid=fk.confrelid
           JOIN pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace
           CROSS JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY AS child_key(attnum, ordinality)
           JOIN LATERAL unnest(fk.confkey) WITH ORDINALITY AS parent_key(attnum, ordinality)
             ON parent_key.ordinality=child_key.ordinality
           JOIN pg_attribute child_att ON child_att.attrelid=child.oid AND child_att.attnum=child_key.attnum
           WHERE fk.contype='f'
             AND child_ns.nspname IN ('public','private')
             AND parent_ns.nspname='auth' AND parent.relname='users'"""
    ).fetchall()
    referenced_auth_ids: set[str] = set(user_ids)
    for fk in auth_fk_rows:
        table_key = (fk["child_schema"], fk["child_table"])
        if table_key not in included:
            continue
        for row in included[table_key].values():
            value = row.get(fk["child_column"])
            if value:
                referenced_auth_ids.add(str(value))
    _write_json(output_root / "identity_references.json", {
        "member_user_ids": sorted(user_ids),
        "all_referenced_auth_user_ids": sorted(referenced_auth_ids),
        "requires_existing_auth_users": True,
        "note": "এটি মেসভিত্তিক Export; Auth account বা Password Hash নেই। Restore-এর সময় all_referenced_auth_user_ids-এর একই User ID-র Auth Account Target Project-এ থাকতে হবে। Avatar শুধু member_user_ids-এর জন্য অন্তর্ভুক্ত।",
    })
    return {
        "hostel_id": hostel_id,
        "table_count": len(table_info),
        "row_count": sum(item["row_count"] for item in table_info),
        "tables": table_info,
        "member_user_ids": sorted(user_ids),
        "referenced_auth_user_ids": sorted(referenced_auth_ids),
    }


def list_hostels(database_url: str) -> list[dict[str, str]]:
    with _connect(database_url) as conn:
        rows = conn.execute("SELECT id::text AS id, name FROM public.hostels ORDER BY name").fetchall()
    return [{"id": row["id"], "name": row["name"]} for row in rows]


def create_hostel_backup(
    *,
    database_url: str,
    project_url: str,
    project_ref: str,
    service_role_key: str,
    hostel_id: str,
    destination_dir: Path,
    password: str,
    log: LogFn | None = None,
    progress: ProgressFn | None = None,
) -> dict[str, Any]:
    if psycopg is None:
        raise BackupError("Hostel Backup-এর জন্য psycopg ইনস্টল করা দরকার।")
    if not service_role_key.strip():
        raise BackupError("সদস্যের প্রোফাইল ছবি Backup-এর জন্য Service Role/Secret Key দিতে হবে।")
    _derive_key(password, os.urandom(SALT_LENGTH))
    try:
        hostel_uuid = uuid.UUID(hostel_id)
    except (ValueError, TypeError) as exc:
        raise BackupError("মেসের ID সঠিক UUID নয়।") from exc
    warnings = ["Hostel Backup-এ Auth Account/Password Hash, Global Settings, Edge Function ও Website Source অন্তর্ভুক্ত নয়; এটি একই Hostel Life Schema-তে মেসভিত্তিক Data Export।"]
    destination_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".hostel_life_hostel_", dir=destination_dir) as temp_name:
        staging = Path(temp_name) / "payload"
        staging.mkdir()
        _progress(progress, "মেসের তালিকা ও সদস্য সম্পর্ক যাচাই", 8)
        with _connect(database_url) as conn:
            with conn.transaction():
                conn.execute("SET TRANSACTION READ ONLY")
                hostel_rows = conn.execute("SELECT id::text AS id, name FROM public.hostels WHERE id=%s", [hostel_uuid]).fetchall()
                if not hostel_rows:
                    raise BackupError("নির্বাচিত মেস পাওয়া যায়নি।")
                hostel = dict(hostel_rows[0])
                data_info = _export_hostel_json(conn, str(hostel_uuid), staging / "database", log)
        _progress(progress, "শুধু নির্বাচিত মেসের Storage ছবি Backup", 62)
        storage_info = {"bucket_count": 0, "object_count": 0, "total_bytes": 0, "scope": "selected-hostel-members-profile-avatars-only"}
        if data_info["member_user_ids"]:
            storage_info = _download_storage(
                project_url, service_role_key, staging / "storage", log,
                user_ids=set(data_info["member_user_ids"]),
            )
        else:
            _write_json(staging / "storage" / "buckets.json", [])
            _write_json(staging / "storage" / "objects_manifest.json", [])
        _write_json(staging / "hostel.json", hostel)
        _write_json(staging / "hostel_export_manifest.json", {**data_info, "storage": storage_info, "created_at": datetime.now(timezone.utc).isoformat()})
        _write_recovery_docs(staging, project_ref, [], "hostel")
        result = _build_encrypted_archive(staging, destination_dir, project_ref, "HOSTEL", password, log, warnings=warnings)
        result["hostel"] = hostel
        result["export"] = data_info
        result["warnings"] = warnings
        _progress(progress, "Hostel Backup সম্পন্ন", 100)
        return result

# ---------- Restore & disaster recovery (Module 2) ----------

RESTORE_SYSTEM_SCHEMAS = {
    "auth", "extensions", "graphql", "graphql_public", "information_schema",
    "pg_catalog", "pgbouncer", "pgsodium", "realtime", "storage",
    "supabase_functions", "supabase_internal", "supabase_migrations", "vault",
}
MAX_RESTORE_EXPANDED_BYTES = 100 * 1024 * 1024 * 1024


def _validate_archive_member(name: str) -> str:
    if not isinstance(name, str) or "\\" in name:
        raise BackupError("Backup ZIP-এ অনিরাপদ File Path পাওয়া গেছে।")
    normalized = _safe_relpath(name)
    if normalized != name or ":" in PurePosixPath(name).parts[0]:
        raise BackupError(f"Backup ZIP-এ অনিরাপদ File Path: {name!r}")
    return normalized


def _read_verified_manifest(backup_file: Path, password: str, work_dir: Path) -> tuple[Path, dict[str, Any]]:
    verification = verify_backup(backup_file, password, temp_dir=work_dir)
    zip_path = work_dir / f"verified_{uuid.uuid4().hex}.zip"
    decrypt_file(backup_file, zip_path, password)
    try:
        with zipfile.ZipFile(zip_path, "r") as archive:
            names = archive.namelist()
            if len(names) != len(set(names)):
                raise BackupError("Backup ZIP-এ একই File Path একাধিকবার আছে।")
            total_size = 0
            for info in archive.infolist():
                if info.filename == "manifest.json":
                    continue
                _validate_archive_member(info.filename)
                total_size += int(info.file_size)
                if total_size > MAX_RESTORE_EXPANDED_BYTES:
                    raise BackupError("Backup-এর আনকমপ্রেসড Size ১০০ GB-এর নিরাপত্তা সীমা অতিক্রম করেছে।")
                # Symbolic links and special filesystem entries are not accepted.
                unix_mode = (info.external_attr >> 16) & 0xFFFF
                file_kind = unix_mode & 0o170000
                if file_kind not in (0, 0o100000, 0o040000):
                    raise BackupError(f"Backup ZIP-এ সমর্থিত নয় এমন File Type: {info.filename}")
            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
            if manifest.get("format") != "HostelLifeEncryptedBackup" or int(manifest.get("format_version", 0)) != 2:
                raise BackupError("এই Backup Format Module 2 সমর্থন করে না।")
            expected_names = set(manifest.get("files_sha256", {}).keys())
            payload_names = set(names) - {"manifest.json"}
            if expected_names != payload_names:
                raise BackupError("Backup Manifest ও ZIP File List মিলছে না।")
        return zip_path, manifest
    except Exception:
        zip_path.unlink(missing_ok=True)
        raise


def _safe_extract_archive(zip_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with zipfile.ZipFile(zip_path, "r") as archive:
        for info in archive.infolist():
            if info.filename == "manifest.json" or info.is_dir():
                continue
            relative = _validate_archive_member(info.filename)
            output = (root / Path(*PurePosixPath(relative).parts)).resolve()
            if output != root and root not in output.parents:
                raise BackupError("Backup ZIP-এর File Path Restore Folder-এর বাইরে যাওয়ার চেষ্টা করেছে।")
            output.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info, "r") as source, output.open("wb") as target:
                shutil.copyfileobj(source, target, length=CHUNK_SIZE)


def inspect_backup_for_restore(backup_file: Path, password: str) -> dict[str, Any]:
    """Verify a backup and return a non-secret summary without connecting to a target."""
    backup_file = Path(backup_file)
    if not backup_file.is_file():
        raise BackupError("Backup File পাওয়া যায়নি।")
    with tempfile.TemporaryDirectory(prefix=".hl_inspect_", dir=backup_file.parent) as tmp_name:
        tmp = Path(tmp_name)
        zip_path, manifest = _read_verified_manifest(backup_file, password, tmp)
        try:
            with zipfile.ZipFile(zip_path, "r") as archive:
                names = set(archive.namelist())
                summary: dict[str, Any] = {
                    "verified": True,
                    "backup_type": str(manifest.get("backup_type", "")).upper(),
                    "project_ref": manifest.get("project_ref"),
                    "created_at": manifest.get("created_at"),
                    "file_count": int(manifest.get("file_count") or len(manifest.get("files_sha256", {}))),
                    "payload_bytes": int(manifest.get("payload_bytes") or 0),
                    "sha256": _sha256_file(backup_file),
                    "warnings": list(manifest.get("warnings") or []),
                }
                if summary["backup_type"] == "MASTER":
                    required = {"database/roles.sql", "database/schema.sql", "database/data.sql", "database/auth/auth_users.json", "database/auth/auth_identities.json", "storage/buckets.json", "storage/objects_manifest.json"}
                    missing = sorted(required - names)
                    if missing:
                        raise BackupError("Master Backup-এ Restore-এর জন্য প্রয়োজনীয় File নেই: " + ", ".join(missing))
                    storage_objects = json.loads(archive.read("storage/objects_manifest.json").decode("utf-8"))
                    buckets = json.loads(archive.read("storage/buckets.json").decode("utf-8"))
                    if "database/inventory.json" in names:
                        db_inventory = json.loads(archive.read("database/inventory.json").decode("utf-8"))
                        summary["source_extensions"] = db_inventory.get("extensions", [])
                    else:
                        summary["source_extensions"] = []
                    users = json.loads(archive.read("database/auth/auth_users.json").decode("utf-8"))
                    identities = json.loads(archive.read("database/auth/auth_identities.json").decode("utf-8"))
                    summary.update({
                        "bucket_count": len(buckets),
                        "storage_object_count": len(storage_objects),
                        "auth_user_count": int(users.get("row_count") or 0),
                        "auth_identity_count": int(identities.get("row_count") or 0),
                        "cron_job_count": 0,
                        "has_project_source": any(name.startswith("project/source/") for name in names),
                        "has_migration_history": "database/migration_history_data.sql" in names,
                    })
                    if "database/cron_jobs.json" in names:
                        cron = json.loads(archive.read("database/cron_jobs.json").decode("utf-8"))
                        summary["cron_job_count"] = len(cron.get("jobs", [])) if isinstance(cron, dict) else len(cron)
                elif summary["backup_type"] == "HOSTEL":
                    if "hostel_export_manifest.json" not in names or "database/identity_references.json" not in names:
                        raise BackupError("Hostel Backup-এ Restore Manifest/Identity Reference পাওয়া যায়নি।")
                    hostel_manifest = json.loads(archive.read("hostel_export_manifest.json").decode("utf-8"))
                    summary.update({
                        "hostel_id": hostel_manifest.get("hostel_id"),
                        "hostel_table_count": int(hostel_manifest.get("table_count") or 0),
                        "hostel_row_count": int(hostel_manifest.get("row_count") or 0),
                        "storage_object_count": len(json.loads(archive.read("storage/objects_manifest.json").decode("utf-8"))) if "storage/objects_manifest.json" in names else 0,
                    })
                else:
                    raise BackupError("এই Backup Type Restore-এর জন্য সমর্থিত নয়।")
                return summary
        finally:
            zip_path.unlink(missing_ok=True)


def _target_connection_identity(database_url: str, target_project_ref: str, source_project_ref: str, project_url: str, *, allow_same_source: bool = False) -> dict[str, str]:
    ref = target_project_ref.strip().lower()
    if not re.fullmatch(r"[a-z0-9-]{8,40}", ref):
        raise BackupError("Target Project Ref সঠিক নয়। Supabase Dashboard থেকে কপি করুন।")
    if not allow_same_source and ref == str(source_project_ref or "").strip().lower():
        raise BackupError("নিরাপত্তার জন্য একই Source Project-এ Master Restore নিষিদ্ধ। একটি নতুন Target Project তৈরি করুন।")
    parsed_url = urlsplit(project_url.strip())
    if (
        parsed_url.scheme != "https" or not parsed_url.hostname or parsed_url.username or parsed_url.password
        or parsed_url.path not in ("", "/") or parsed_url.query or parsed_url.fragment
        or parsed_url.port not in (None, 443)
    ):
        raise BackupError("Target Project URL অবশ্যই Credential-বিহীন, Root HTTPS Supabase Project URL হতে হবে।")
    url_host = parsed_url.hostname.lower().rstrip(".")
    # Never send a powerful Storage key to an arbitrary HTTPS host merely because
    # that hostname contains the project ref as a substring.
    if url_host != f"{ref}.supabase.co":
        raise BackupError("Target Project URL-এর Hostname অবশ্যই <Project-Ref>.supabase.co হতে হবে।")
    parts = parse_database_url(database_url)
    if str(parts.get("sslmode") or "").lower() not in {"require", "verify-ca", "verify-full"}:
        raise BackupError("Target Database Connection String-এ SSL Mode require/verify-ca/verify-full থাকতে হবে।")
    db_host = str(parts["host"]).lower().rstrip(".")
    db_user = str(parts["user"]).lower()
    direct_match = db_host == f"db.{ref}.supabase.co" and db_user == "postgres"
    pooler_match = db_host.endswith(".pooler.supabase.com") and db_host.startswith("aws-") and db_user == f"postgres.{ref}"
    if not (direct_match or pooler_match):
        raise BackupError("Database Host/Username Target Project Ref-এর সঙ্গে নিশ্চিতভাবে মেলেনি। Project-এর Connect প্যানেল থেকে Direct বা Supavisor Session Pooler URL নিন।")
    if int(parts.get("port") or 0) != 5432 or str(parts.get("dbname") or "") != "postgres":
        raise BackupError("Target Connection String-এ Project-এর default postgres Database ও Port 5432 ব্যবহার করুন।")
    if not parts.get("password"):
        raise BackupError("Target Database Connection String-এ Password নেই।")
    return {"project_ref": ref, "project_url_host": url_host, "database_host": db_host}


def _db_comment(conn) -> str:
    row = conn.execute(
        "SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname=current_database()"
    ).fetchone()
    return str((row or {}).get("comment") or "")


def _database_has_marker(conn, marker: str) -> bool:
    return marker in _db_comment(conn)


def _append_database_comment_marker(conn, marker: str) -> None:
    # A database COMMENT is committed in the same transaction as restored rows.
    # The marker is non-secret and supports safe resume after a power/network loss.
    current = _db_comment(conn)
    if marker in current:
        return
    new_comment = (current + "\n" if current else "") + marker
    statement = conn.execute(
        "SELECT format('COMMENT ON DATABASE %I IS %L', current_database(), %s) AS sql",
        [new_comment],
    ).fetchone()["sql"]
    conn.execute(statement)


def _target_database_preflight(database_url: str, *, require_empty: bool) -> dict[str, Any]:
    with _connect(database_url) as conn:
        with conn.transaction():
            conn.execute("SET TRANSACTION READ ONLY")
            identity = conn.execute("SELECT current_database() AS name, current_user AS role, version() AS version").fetchone()
            role_capabilities = conn.execute(
                "SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname=current_user"
            ).fetchone() or {"rolsuper": False, "rolcreaterole": False}
            can_set_replication_role = False
            try:
                # A nested savepoint allows this permission probe to fail without
                # aborting the read-only preflight transaction.
                with conn.transaction():
                    conn.execute("SET LOCAL session_replication_role = replica")
                can_set_replication_role = True
            except Exception:
                can_set_replication_role = False
            comment = _db_comment(conn)
            relations = conn.execute(
                """SELECT n.nspname AS schema_name, c.relname AS relation_name, c.relkind
                   FROM pg_class c
                   JOIN pg_namespace n ON n.oid=c.relnamespace
                   WHERE c.relkind IN ('r','p','v','m','S')
                     AND n.nspname NOT IN (
                       'auth','extensions','graphql','graphql_public','information_schema','pg_catalog',
                       'pgbouncer','pgsodium','realtime','storage','supabase_functions','supabase_internal',
                       'supabase_migrations','vault'
                     )
                     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.deptype='e')
                   ORDER BY n.nspname, c.relname"""
            ).fetchall()
            auth_users = int(conn.execute("SELECT count(*) AS n FROM auth.users").fetchone()["n"])
            auth_identities = int(conn.execute("SELECT count(*) AS n FROM auth.identities").fetchone()["n"])
            storage_buckets = int(conn.execute("SELECT count(*) AS n FROM storage.buckets").fetchone()["n"])
            storage_objects = int(conn.execute("SELECT count(*) AS n FROM storage.objects").fetchone()["n"])
            extensions = [dict(row) for row in conn.execute("SELECT extname, extversion FROM pg_extension ORDER BY extname").fetchall()]
            migration_exists = conn.execute("SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ok").fetchone()["ok"]
            migration_count = 0
            if migration_exists:
                migration_count = int(conn.execute("SELECT count(*) AS n FROM supabase_migrations.schema_migrations").fetchone()["n"])
        result = {
            "database": str(identity["name"]),
            "role": str(identity["role"]),
            "version": str(identity["version"]),
            "can_create_roles": bool(role_capabilities.get("rolsuper") or role_capabilities.get("rolcreaterole")),
            "can_set_replication_role": bool(can_set_replication_role),
            "user_relations": [dict(row) for row in relations],
            "auth_users": auth_users,
            "auth_identities": auth_identities,
            "storage_buckets": storage_buckets,
            "storage_objects": storage_objects,
            "extensions": extensions,
            "migration_history_exists": bool(migration_exists),
            "migration_history_rows": migration_count,
            "database_comment": comment,
        }
    if require_empty:
        blockers = []
        if not result["can_create_roles"]:
            blockers.append("Target Database Role-এ custom role restore করার permission নেই")
        if not result["can_set_replication_role"]:
            blockers.append("Target Database Role-এ session_replication_role পরিবর্তনের permission নেই")
        if result["user_relations"]:
            blockers.append(f"{len(result['user_relations'])}টি User Table/View/Sequence ইতিমধ্যে আছে")
        if result["auth_users"] or result["auth_identities"]:
            blockers.append(f"Auth-এ {result['auth_users']} Users ও {result['auth_identities']} Identities আছে")
        if result["storage_buckets"] or result["storage_objects"]:
            blockers.append(f"Storage-এ {result['storage_buckets']} Bucket ও {result['storage_objects']} Object আছে")
        if result["migration_history_rows"]:
            blockers.append(f"Migration History-তে {result['migration_history_rows']}টি Row আছে")
        if blockers:
            raise BackupError("Target Project খালি নয়; Master Restore বন্ধ করা হয়েছে: " + "; ".join(blockers) + ". অন্য একটি নতুন Supabase Project ব্যবহার করুন।")
    return result


def _restore_marker(backup_sha256: str, target_ref: str, kind: str = "MASTER") -> str:
    digest = hashlib.sha256(f"{kind}|{backup_sha256}|{target_ref}".encode("utf-8")).hexdigest()[:32]
    return f"HostelLifeRestore:v2:{kind}:{digest}"


def _journal_write(path: Path, journal: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    journal["updated_at"] = datetime.now(timezone.utc).isoformat()
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(journal, ensure_ascii=False, indent=2), encoding="utf-8")
    with temp.open("rb") as handle:
        os.fsync(handle.fileno())
    temp.replace(path)


def _journal_load(path: Path, backup_sha256: str, target_ref: str, backup_type: str) -> dict[str, Any]:
    if path.exists():
        try:
            journal = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise BackupError("Restore Journal পড়া যায়নি; নিরাপত্তার জন্য Resume বন্ধ করা হয়েছে।") from exc
        if journal.get("backup_sha256") != backup_sha256 or journal.get("target_project_ref") != target_ref or journal.get("backup_type") != backup_type:
            raise BackupError("এই Restore Folder-এর Journal অন্য Backup বা Target Project-এর। আলাদা Restore Folder নির্বাচন করুন।")
        return journal
    journal = {
        "journal_version": 1,
        "backup_sha256": backup_sha256,
        "backup_type": backup_type,
        "target_project_ref": target_ref,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "steps": {},
        "storage": {"created_buckets": [], "uploaded_objects": []},
    }
    _journal_write(path, journal)
    return journal


def _set_step(journal_path: Path, journal: dict[str, Any], name: str, status: str, **extra: Any) -> None:
    step = journal.setdefault("steps", {}).setdefault(name, {})
    step.update({"status": status, "updated_at": datetime.now(timezone.utc).isoformat(), **extra})
    _journal_write(journal_path, journal)


def _run_psql_file(database_url: str, sql_file: Path, log: LogFn | None = None, timeout: int = 60 * 60) -> None:
    executable = shutil.which("psql")
    if not executable:
        raise BackupError("PostgreSQL psql পাওয়া যায়নি। PostgreSQL Client Tools ইনস্টল করে PATH-এ যোগ করুন।")
    parts = parse_database_url(database_url)
    # Pass credentials via the child process environment, never on the visible command line.
    command = [executable, "--no-psqlrc", "--single-transaction", "--set=ON_ERROR_STOP=1", "--dbname", parts["dbname"], "--file", str(sql_file)]
    _run_command(command, env=_pg_env(database_url), log=log, timeout=timeout)


def _build_master_database_restore_bundle(extracted: Path, output: Path, marker: str) -> None:
    roles = extracted / "database" / "roles.sql"
    schema = extracted / "database" / "schema.sql"
    data = extracted / "database" / "data.sql"
    for item in (roles, schema, data):
        if not item.is_file() or item.stat().st_size < 10:
            raise BackupError(f"Master Restore-এর SQL Dump অনুপস্থিত/ফাঁকা: {item.name}")
    marker_sql = f"""
DO $hl_restore$
DECLARE
  existing_comment text;
  restore_marker text := '{marker}';
BEGIN
  SELECT shobj_description(oid, 'pg_database') INTO existing_comment
  FROM pg_database WHERE datname=current_database();
  IF position(restore_marker in coalesce(existing_comment, '')) = 0 THEN
    EXECUTE format('COMMENT ON DATABASE %I IS %L', current_database(),
      concat_ws(E'\\n', nullif(existing_comment, ''), restore_marker));
  END IF;
END;
$hl_restore$;
"""
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as target:
        for source in (roles, schema):
            with source.open("rb") as handle:
                shutil.copyfileobj(handle, target, length=CHUNK_SIZE)
            target.write(b"\n")
        target.write(b"SET session_replication_role = replica;\n")
        with data.open("rb") as handle:
            shutil.copyfileobj(handle, target, length=CHUNK_SIZE)
        target.write(b"\n")
        target.write(marker_sql.encode("utf-8"))
        target.flush()
        os.fsync(target.fileno())


def _decode_exported_value(value: Any, column: dict[str, Any]) -> Any:
    data_type = str(column.get("data_type") or "").lower()
    udt_name = str(column.get("udt_name") or "").lower()
    if isinstance(value, dict) and set(value) == {"__base64__"}:
        try:
            return base64.b64decode(value["__base64__"], validate=True)
        except Exception as exc:
            raise BackupError("Auth Backup-এ Base64 Binary Field সঠিক নয়।") from exc
    if data_type in {"json", "jsonb"}:
        try:
            from psycopg.types.json import Json, Jsonb
            return Jsonb(value) if data_type == "jsonb" else Json(value)
        except Exception:
            return json.dumps(value, ensure_ascii=False)
    if data_type == "array":
        return value
    if isinstance(value, (dict, list)):
        # Some older Auth versions expose JSON fields with incomplete type metadata.
        try:
            from psycopg.types.json import Jsonb
            return Jsonb(value)
        except Exception:
            return json.dumps(value, ensure_ascii=False)
    if udt_name == "bytea" and isinstance(value, str):
        return base64.b64decode(value)
    return value


def _restore_json_table(conn, data_file: Path, schema: str, table: str, *, log: LogFn | None = None) -> int:
    if not data_file.is_file():
        raise BackupError(f"Restore Data File পাওয়া যায়নি: {data_file.name}")
    payload = json.loads(data_file.read_text(encoding="utf-8"))
    rows = payload.get("rows", [])
    source_columns = payload.get("columns", [])
    if not isinstance(rows, list) or not isinstance(source_columns, list):
        raise BackupError(f"{schema}.{table} JSON Structure সঠিক নয়।")
    target_columns = conn.execute(
        """SELECT column_name, data_type, udt_name, is_nullable, column_default, is_generated, is_identity
           FROM information_schema.columns WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position""",
        [schema, table],
    ).fetchall()
    if not target_columns:
        raise BackupError(f"Target Project-এ {schema}.{table} Table নেই।")
    target_by_name = {row["column_name"]: dict(row) for row in target_columns}
    source_names = [str(item["column_name"]) for item in source_columns if item.get("column_name")]
    missing_target = sorted(set(source_names) - set(target_by_name))
    if missing_target:
        raise BackupError(f"Target {schema}.{table} Table-এ Source Column নেই: {', '.join(missing_target)}")
    source_set = set(source_names)
    missing_required = [
        row["column_name"] for row in target_columns
        if row["column_name"] not in source_set
        and row["is_nullable"] == "NO"
        and row["column_default"] is None
        and row["is_generated"] == "NEVER"
        and row["is_identity"] == "NO"
    ]
    if missing_required:
        raise BackupError(f"Target {schema}.{table}-এ নতুন Required Column আছে; Schema Migration/Compatibility আগে ঠিক করুন: {', '.join(missing_required)}")
    insert_columns = [name for name in source_names if target_by_name[name]["is_generated"] != "ALWAYS"]
    if not rows:
        return 0
    columns_sql = ", ".join(_ident(name) for name in insert_columns)
    placeholders = ", ".join(["%s"] * len(insert_columns))
    override_identity = any(target_by_name[name]["is_identity"] == "YES" for name in insert_columns)
    identity_clause = " OVERRIDING SYSTEM VALUE" if override_identity else ""
    sql = f"INSERT INTO {_ident(schema)}.{_ident(table)} ({columns_sql}){identity_clause} VALUES ({placeholders})"
    batch: list[tuple[Any, ...]] = []
    for row in rows:
        if not isinstance(row, dict):
            raise BackupError(f"{schema}.{table}-এ একটি Row Object নয়।")
        batch.append(tuple(_decode_exported_value(row.get(name), target_by_name[name]) for name in insert_columns))
        if len(batch) >= 500:
            conn.cursor().executemany(sql, batch)
            batch.clear()
    if batch:
        conn.cursor().executemany(sql, batch)
    _log(log, f"Restore Data: {schema}.{table} ({len(rows):,} rows)")
    return len(rows)


def _restore_auth_data(database_url: str, extracted: Path, marker: str, log: LogFn | None = None) -> dict[str, int]:
    auth_dir = extracted / "database" / "auth"
    required_files = {"users": auth_dir / "auth_users.json", "identities": auth_dir / "auth_identities.json"}
    with _connect(database_url) as conn:
        with conn.transaction():
            if _database_has_marker(conn, marker):
                return {"users": -1, "identities": -1, "mfa_factors": -1, "already_restored": 1}
            users = int(conn.execute("SELECT count(*) AS n FROM auth.users").fetchone()["n"])
            identities = int(conn.execute("SELECT count(*) AS n FROM auth.identities").fetchone()["n"])
            if users or identities:
                raise BackupError("Auth Restore-এর আগে Target auth.users ও auth.identities খালি থাকতে হবে।")
            counts: dict[str, int] = {}
            for table in ("users", "identities", "mfa_factors"):
                file_path = required_files.get(table, auth_dir / f"auth_{table}.json")
                if not file_path.exists():
                    if table in required_files:
                        raise BackupError(f"Auth Backup File অনুপস্থিত: {file_path.name}")
                    counts[table] = 0
                    continue
                if table == "mfa_factors":
                    exists = conn.execute("SELECT to_regclass('auth.mfa_factors') IS NOT NULL AS ok").fetchone()["ok"]
                    if not exists:
                        counts[table] = 0
                        _log(log, "Target Auth Version-এ mfa_factors Table নেই; MFA Factor Restore বাদ দেওয়া হয়েছে।")
                        continue
                count = _restore_json_table(conn, file_path, "auth", table, log=log)
                counts[table] = count
            _append_database_comment_marker(conn, marker)
    return counts


def _load_storage_restore_payload(extracted: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    storage_root = extracted / "storage"
    buckets_path = storage_root / "buckets.json"
    objects_path = storage_root / "objects_manifest.json"
    if not buckets_path.is_file() or not objects_path.is_file():
        raise BackupError("Storage Bucket/Object Manifest অনুপস্থিত।")
    buckets = json.loads(buckets_path.read_text(encoding="utf-8"))
    objects = json.loads(objects_path.read_text(encoding="utf-8"))
    if not isinstance(buckets, list) or not isinstance(objects, list):
        raise BackupError("Storage Backup Manifest-এর Format সঠিক নয়।")
    for obj in objects:
        if not isinstance(obj, dict) or not obj.get("bucket") or not obj.get("path") or not obj.get("local_path"):
            raise BackupError("Storage Object Manifest-এ অসম্পূর্ণ Entry আছে।")
        _safe_relpath(str(obj["path"]))
        _safe_relpath(str(obj["local_path"]))
    return buckets, objects


def _storage_restore_existing_buckets(session: requests.Session, project_url: str) -> dict[str, dict[str, Any]]:
    base = project_url.rstrip("/") + "/storage/v1"
    response = _storage_request(session, "GET", base + "/bucket")
    data = response.json()
    if not isinstance(data, list):
        raise BackupError("Target Storage Bucket List পড়া যায়নি।")
    return {str(item.get("id") or item.get("name")): item for item in data if item.get("id") or item.get("name")}


def _preflight_storage_target(project_url: str, service_key: str) -> dict[str, int]:
    """Read-only check that the supplied key can reach the exact Target Storage API."""
    if not service_key.strip():
        raise BackupError("Target Project-এর Supabase Secret/Service Role Key দিন।")
    session = requests.Session()
    session.headers.update(_supabase_headers(service_key))
    try:
        buckets = _storage_restore_existing_buckets(session, project_url)
        return {"bucket_count": len(buckets)}
    finally:
        session.close()


def _storage_upload_file(session: requests.Session, url: str, source_file: Path, headers: dict[str, str]) -> None:
    last_error = None
    for attempt in range(3):
        try:
            with source_file.open("rb") as handle:
                response = session.request("POST", url, data=handle, headers=headers, timeout=(20, 300))
            if response.status_code in (429, 500, 502, 503, 504):
                last_error = BackupError(f"Storage Upload সাময়িকভাবে ব্যস্ত (HTTP {response.status_code})")
                response.close()
                time.sleep(1.5 * (attempt + 1))
                continue
            if response.status_code >= 400:
                detail = ""
                try:
                    body = response.json()
                    detail = str(body.get("message") or body.get("error") or body.get("statusCode") or "")
                except Exception:
                    detail = response.text[:300]
                response.close()
                raise BackupError(f"Storage Upload ব্যর্থ (HTTP {response.status_code}): {_redact(detail)}")
            response.close()
            return
        except requests.RequestException as exc:
            last_error = BackupError(f"Storage Upload Network Error: {exc.__class__.__name__}")
            time.sleep(1.5 * (attempt + 1))
    raise last_error or BackupError("Storage Upload ব্যর্থ হয়েছে।")


def _remote_storage_object_sha256(session: requests.Session, project_url: str, bucket: str, object_path: str) -> str | None:
    base = project_url.rstrip("/") + "/storage/v1"
    encoded_path = "/".join(quote(part, safe="-_.~") for part in object_path.split("/"))
    url = f"{base}/object/authenticated/{quote(bucket, safe='-_.~')}/{encoded_path}"
    try:
        response = _storage_request(session, "GET", url, stream=True)
    except BackupError as exc:
        # A normal 404 means not uploaded yet; other errors remain fatal.
        if "HTTP 404" in str(exc):
            return None
        raise
    digest = hashlib.sha256()
    try:
        for chunk in response.iter_content(chunk_size=CHUNK_SIZE):
            if chunk:
                digest.update(chunk)
    finally:
        response.close()
    return digest.hexdigest()


def _restore_storage(
    project_url: str,
    service_key: str,
    extracted: Path,
    journal_path: Path,
    journal: dict[str, Any],
    *,
    target_database_url: str,
    log: LogFn | None = None,
    progress: ProgressFn | None = None,
    hostel_member_ids: set[str] | None = None,
) -> dict[str, int]:
    buckets, objects = _load_storage_restore_payload(extracted)
    if hostel_member_ids is not None:
        filtered = []
        for obj in objects:
            if obj["bucket"] != "profile-avatars":
                raise BackupError("Hostel Backup-এ profile-avatars ছাড়া অন্য Bucket Object পাওয়া গেছে।")
            if str(obj["path"]).split("/", 1)[0] not in hostel_member_ids:
                raise BackupError("Hostel Avatar Manifest-এ নির্বাচিত মেসের বাইরের User ID আছে।")
            filtered.append(obj)
        objects = filtered
        buckets = [b for b in buckets if str(b.get("id") or b.get("name")) == "profile-avatars"]
    headers = _supabase_headers(service_key)
    session = requests.Session()
    session.headers.update(headers)
    base = project_url.rstrip("/") + "/storage/v1"
    try:
        existing = _storage_restore_existing_buckets(session, project_url)
        for index, bucket in enumerate(buckets):
            bucket_id = str(bucket.get("id") or bucket.get("name") or "")
            if not bucket_id:
                continue
            if bucket_id in existing:
                current = existing[bucket_id]
                for field in ("public", "file_size_limit", "allowed_mime_types"):
                    wanted = bucket.get(field)
                    current_value = current.get(field)
                    if field == "allowed_mime_types":
                        wanted = sorted(wanted or [])
                        current_value = sorted(current_value or [])
                    if wanted is not None and current_value != wanted:
                        raise BackupError(f"Target Storage Bucket '{bucket_id}'-এর {field} Source-এর সঙ্গে মেলে না। আগে Bucket Config হাতে মিলিয়ে নিন।")
                if bucket_id not in journal.setdefault("storage", {}).setdefault("created_buckets", []):
                    journal["storage"]["created_buckets"].append(bucket_id)
                    _journal_write(journal_path, journal)
                _log(log, f"Bucket আছে, যাচাই করা হয়েছে: {bucket_id}")
            else:
                body = {
                    "id": bucket_id,
                    "name": bucket_id,
                    "public": bool(bucket.get("public", False)),
                }
                if bucket.get("file_size_limit") is not None:
                    body["file_size_limit"] = bucket["file_size_limit"]
                if bucket.get("allowed_mime_types") is not None:
                    body["allowed_mime_types"] = bucket["allowed_mime_types"]
                _storage_request(session, "POST", base + "/bucket", json=body)
                journal["storage"]["created_buckets"].append(bucket_id)
                _journal_write(journal_path, journal)
                _log(log, f"Bucket তৈরি: {bucket_id}")
            _progress(progress, "Storage Bucket Restore", 66 + int((index + 1) / max(len(buckets), 1) * 4))
        uploaded = set(journal.setdefault("storage", {}).setdefault("uploaded_objects", []))
        object_root = extracted / "storage" / "objects"
        for index, obj in enumerate(objects):
            bucket_id = str(obj["bucket"])
            object_path = str(obj["path"])
            journal_key = f"{bucket_id}/{object_path}"
            local_rel = _safe_relpath(str(obj["local_path"]))
            source_file = object_root.joinpath(*PurePosixPath(local_rel).parts)
            if not source_file.is_file():
                raise BackupError(f"Storage Object File নেই: {journal_key}")
            if int(obj.get("size_bytes") or source_file.stat().st_size) != source_file.stat().st_size:
                raise BackupError(f"Storage Object Size মেলেনি: {journal_key}")
            if obj.get("sha256") and _sha256_file(source_file).lower() != str(obj["sha256"]).lower():
                raise BackupError(f"Storage Object SHA-256 মেলেনি: {journal_key}")
            # Re-uploading an object is safe because x-upsert is used and the local SHA is fixed.
            encoded_path = "/".join(quote(part, safe="-_.~") for part in object_path.split("/"))
            url = f"{base}/object/{quote(bucket_id, safe='-_.~')}/{encoded_path}"
            upload_headers = {
                "Content-Type": str(obj.get("content_type") or "application/octet-stream"),
                "Content-Length": str(source_file.stat().st_size),
            }
            cache_control = obj.get("cache_control")
            if cache_control:
                cache_text = str(cache_control)
                upload_headers["Cache-Control"] = cache_text if cache_text.lower().startswith("max-age=") else f"max-age={cache_text}"
            with _connect(target_database_url) as db_conn:
                exists = db_conn.execute(
                    "SELECT 1 FROM storage.objects WHERE bucket_id=%s AND name=%s LIMIT 1",
                    [bucket_id, object_path],
                ).fetchone()
            if exists:
                existing_hash = _remote_storage_object_sha256(session, project_url, bucket_id, object_path)
                if existing_hash != str(obj.get("sha256") or "").lower():
                    raise BackupError(f"Target Storage-এ একই Path-এর আলাদা/পরিবর্তিত Object আছে; Overwrite করা হয়নি: {journal_key}")
                _log(log, f"Target Object SHA-256 মিলে গেছে: {journal_key}")
            else:
                if journal_key in uploaded:
                    _log(log, f"Journal-এ Upload Done ছিল, কিন্তু Target Object নেই; নিরাপদে নতুন করে Upload হচ্ছে: {journal_key}")
                # No x-upsert header: if another actor creates the path during this request,
                # Storage rejects the duplicate instead of overwriting their object.
                _storage_upload_file(session, url, source_file, upload_headers)
            if journal_key not in uploaded:
                uploaded.add(journal_key)
                journal["storage"]["uploaded_objects"] = sorted(uploaded)
                _journal_write(journal_path, journal)
            _log(log, f"Storage Restore: {journal_key}")
            _progress(progress, "Storage Object Restore", 70 + int((index + 1) / max(len(objects), 1) * 20))
        return {"buckets": len(buckets), "objects": len(objects)}
    finally:
        session.close()


def _restore_migration_history(database_url: str, extracted: Path, marker: str, log: LogFn | None = None) -> str:
    schema_file = extracted / "database" / "migration_history_schema.sql"
    data_file = extracted / "database" / "migration_history_data.sql"
    if not data_file.exists():
        return "not_in_backup"
    with _connect(database_url) as conn:
        with conn.transaction():
            if _database_has_marker(conn, marker):
                return "already_restored"
            schema_exists = bool(conn.execute("SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name='supabase_migrations') AS ok").fetchone()["ok"])
            table_exists = bool(conn.execute("SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ok").fetchone()["ok"])
            count = 0
            if table_exists:
                count = int(conn.execute("SELECT count(*) AS n FROM supabase_migrations.schema_migrations").fetchone()["n"])
    if count:
        return "target_has_history"
    with tempfile.TemporaryDirectory(prefix=".hl_migration_restore_") as temp_name:
        bundle = Path(temp_name) / "migration_history_restore.sql"
        marker_sql = f"""
DO $hl_migration_restore$
DECLARE
  existing_comment text;
  restore_marker text := '{marker}';
BEGIN
  SELECT shobj_description(oid, 'pg_database') INTO existing_comment
  FROM pg_database WHERE datname=current_database();
  IF position(restore_marker in coalesce(existing_comment, '')) = 0 THEN
    EXECUTE format('COMMENT ON DATABASE %I IS %L', current_database(),
      concat_ws(E'\\n', nullif(existing_comment, ''), restore_marker));
  END IF;
END;
$hl_migration_restore$;
"""
        with bundle.open("wb") as target:
            if not schema_exists and schema_file.exists():
                with schema_file.open("rb") as source:
                    shutil.copyfileobj(source, target, length=CHUNK_SIZE)
                target.write(b"\n")
            elif not table_exists:
                # Never replay CREATE SCHEMA over an existing managed schema.
                return "target_schema_conflict"
            with data_file.open("rb") as source:
                shutil.copyfileobj(source, target, length=CHUNK_SIZE)
            target.write(b"\n")
            target.write(marker_sql.encode("utf-8"))
        _run_psql_file(database_url, bundle, log=log, timeout=60 * 30)
    return "restored"


def _copy_review_files_without_overwrite(source_folder: Path, target_folder: Path) -> dict[str, int]:
    """Copy recovery review files idempotently without replacing any user-edited file."""
    if not source_folder.is_dir():
        return {"copied": 0, "matched": 0}
    target_folder.mkdir(parents=True, exist_ok=True)
    root = target_folder.resolve()
    copied = 0
    matched = 0
    conflicts: list[str] = []
    for item in source_folder.rglob("*"):
        if not item.is_file():
            continue
        relative = item.relative_to(source_folder)
        output = target_folder / relative
        if output.is_symlink():
            raise BackupError(f"Recovery Review Folder-এ Symbolic Link পাওয়া গেছে; নিরাপত্তার জন্য থামানো হয়েছে: {relative}")
        output.parent.mkdir(parents=True, exist_ok=True)
        resolved = output.resolve()
        if resolved != root and root not in resolved.parents:
            raise BackupError("Recovery Review File Target Folder-এর বাইরে যাওয়ার চেষ্টা করেছে।")
        source_hash = _sha256_file(item)
        if output.exists():
            if not output.is_file() or _sha256_file(output) != source_hash:
                conflicts.append(str(relative))
                continue
            matched += 1
            continue
        shutil.copy2(item, output)
        copied += 1
    return {"copied": copied, "matched": matched, "conflicts": conflicts}


def _copy_project_source_restore(extracted: Path, target_folder: Path, journal: dict[str, Any], journal_path: Path, log: LogFn | None = None) -> dict[str, Any]:
    source = extracted / "project" / "source"
    if not source.is_dir():
        return {"copied": 0, "skipped": True}
    target = target_folder.expanduser().resolve()
    if target.exists() and any(target.iterdir()):
        recorded = journal.get("source_restore", {}).get("target")
        if recorded != str(target):
            raise BackupError("Project Source Restore Folder খালি নয়। ভুল করে অন্য ফাইল Overwrite হবে না বলে Restore বন্ধ করা হয়েছে। খালি Folder দিন।")
    target.mkdir(parents=True, exist_ok=True)
    journal["source_restore"] = {"target": str(target), "status": "running"}
    _journal_write(journal_path, journal)
    copied = 0
    for item in source.rglob("*"):
        if not item.is_file():
            continue
        relative = item.relative_to(source)
        output = target / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        source_hash = _sha256_file(item)
        if output.exists():
            if _sha256_file(output) != source_hash:
                raise BackupError(f"Project Source Restore-এর Folder-এ ভিন্ন ফাইল আছে; Overwrite করা হয়নি: {relative}")
            continue
        shutil.copy2(item, output)
        copied += 1
    journal["source_restore"]["status"] = "done"
    journal["source_restore"]["file_count"] = sum(1 for p in source.rglob("*") if p.is_file())
    _journal_write(journal_path, journal)
    _log(log, f"Project Source Restore: {journal['source_restore']['file_count']:,}টি File")
    return {"copied": copied, "file_count": journal["source_restore"]["file_count"], "target": str(target)}


def dry_run_restore(
    *,
    backup_file: Path,
    password: str,
    target_database_url: str,
    target_project_url: str,
    target_project_ref: str,
    target_service_key: str,
) -> dict[str, Any]:
    backup_file = Path(backup_file).expanduser().resolve()
    summary = inspect_backup_for_restore(backup_file, password)
    identity = _target_connection_identity(
        target_database_url, target_project_ref, str(summary.get("project_ref") or ""), target_project_url,
        allow_same_source=(summary["backup_type"] == "HOSTEL"),
    )
    storage_preflight = _preflight_storage_target(target_project_url, target_service_key)
    summary["target_storage"] = storage_preflight
    if summary["backup_type"] == "MASTER":
        target = _target_database_preflight(target_database_url, require_empty=True)
        blockers = []
        if summary.get("auth_user_count", 0) and target["auth_users"]:
            blockers.append("Auth account target-এ আগে থেকেই আছে")
        if summary.get("storage_object_count", 0) and target["storage_objects"]:
            blockers.append("Storage object target-এ আগে থেকেই আছে")
        if blockers:
            raise BackupError("Dry Run বন্ধ: " + "; ".join(blockers))
        summary["restore_mode"] = "MASTER_TO_NEW_EMPTY_PROJECT"
        summary["target"] = {**identity, **{k: target[k] for k in ("database", "role", "can_create_roles", "can_set_replication_role", "user_relations", "auth_users", "storage_buckets", "storage_objects", "migration_history_rows", "extensions")}}
        target_extensions = {str(item.get("extname")) for item in target.get("extensions", [])}
        summary["missing_extensions"] = sorted(str(item.get("extname")) for item in summary.get("source_extensions", []) if str(item.get("extname")) not in target_extensions)
        summary["limitations"] = [
            "Restore কেবল নতুন/খালি Target Project-এ হবে।",
            "Auth Active Session/Refresh Token ফেরত আসবে না; সদস্যদের আবার Login করতে হবে।",
            "Storage object owner ও generated metadata নতুন Upload API অনুযায়ী তৈরি হবে; আসল File Path/Content ফেরত আসবে।",
            "Missing Extension থাকলে Restore-এর আগে Supabase Dashboard থেকে Enable করুন: " + (", ".join(summary.get("missing_extensions", [])) or "কোনো Missing Extension শনাক্ত হয়নি"),
            "Edge Function Deploy, Secrets, Auth Provider/SMTP/Redirect, Vercel Settings ও Cron Job স্বয়ংক্রিয়ভাবে চালু হবে না।",
        ]
    else:
        target = _target_database_preflight(target_database_url, require_empty=False)
        with tempfile.TemporaryDirectory(prefix=".hl_hostel_dry_run_") as temp_name:
            temp = Path(temp_name)
            zip_path, _manifest = _read_verified_manifest(backup_file, password, temp)
            extracted = temp / "payload"
            _safe_extract_archive(zip_path, extracted)
            zip_path.unlink(missing_ok=True)
            hostel_check = _dry_run_hostel_preflight(target_database_url, extracted)
        summary["restore_mode"] = "SELECTED_HOSTEL_INTO_EXISTING_SCHEMA"
        summary["hostel_preflight"] = hostel_check
        summary["target"] = {**identity, **{k: target[k] for k in ("database", "user_relations", "auth_users", "storage_buckets", "storage_objects")}}
        summary["limitations"] = [
            "Target-এ একই Hostel ID আগে থাকলে Restore বন্ধ হবে।",
            "Schema/Column/Primary Key/Required Auth User ID Dry Run-এ পরীক্ষা করা হয়েছে; Restore-এর সময় আবার যাচাই হবে।",
            "Schema আগে থেকেই সামঞ্জস্যপূর্ণ থাকতে হবে; Migration স্বয়ংক্রিয়ভাবে প্রয়োগ হবে না।",
            "Hostel Backup-এ Auth Account/Password নেই; সংশ্লিষ্ট User ID Target Project-এ আগে থাকতে হবে।",
            "Existing profile row overwrite হবে না; সদস্যের পুরোনো Profile রেখে দেওয়া হবে।",
        ]
    return summary


def _find_primary_key_conflicts(conn, schema: str, table: str, primary_key: list[str], rows: list[dict[str, Any]]) -> set[tuple[Any, ...]]:
    """Find all target PK collisions in bounded queries instead of one query per row."""
    if not primary_key:
        raise BackupError(f"{schema}.{table}-এর Primary Key নেই।")
    seen: set[str] = set()
    keys: list[tuple[Any, ...]] = []
    for row in rows:
        values = tuple(row.get(col) for col in primary_key)
        if any(value is None for value in values):
            raise BackupError(f"{schema}.{table}-এর Primary Key-এ NULL পাওয়া গেছে।")
        token = json.dumps(values, ensure_ascii=False, sort_keys=True, default=_json_default)
        if token in seen:
            raise BackupError(f"Backup-এর {schema}.{table}-এ Duplicate Primary Key আছে।")
        seen.add(token)
        keys.append(values)
    conflicts: set[tuple[Any, ...]] = set()
    width = len(primary_key)
    for offset in range(0, len(keys), MAX_FK_BATCH):
        chunk = keys[offset:offset + MAX_FK_BATCH]
        col_sql = ", ".join(_ident(col) for col in primary_key)
        if width == 1:
            placeholders = ", ".join(["%s"] * len(chunk))
            sql = f"SELECT {col_sql} FROM {_ident(schema)}.{_ident(table)} WHERE {col_sql} IN ({placeholders})"
            params = [item[0] for item in chunk]
        else:
            tuple_placeholder = "(" + ", ".join(["%s"] * width) + ")"
            tuples_sql = ", ".join([tuple_placeholder] * len(chunk))
            sql = f"SELECT {col_sql} FROM {_ident(schema)}.{_ident(table)} WHERE ({col_sql}) IN ({tuples_sql})"
            params = [value for item in chunk for value in item]
        for found in conn.execute(sql, params).fetchall():
            conflicts.add(tuple(found[col] for col in primary_key))
    return conflicts


def _dry_run_hostel_preflight(database_url: str, extracted: Path) -> dict[str, Any]:
    """Validate hostel IDs, Auth references, target columns and PK collisions read-only."""
    info_path = extracted / "hostel_export_manifest.json"
    identity_path = extracted / "database" / "identity_references.json"
    if not info_path.is_file() or not identity_path.is_file():
        raise BackupError("Hostel Backup Manifest/Identity Reference পাওয়া যায়নি।")
    info = json.loads(info_path.read_text(encoding="utf-8"))
    identity = json.loads(identity_path.read_text(encoding="utf-8"))
    hostel_id = str(info.get("hostel_id") or "")
    try:
        uuid.UUID(hostel_id)
    except Exception as exc:
        raise BackupError("Hostel Backup-এর Hostel ID সঠিক UUID নয়।") from exc
    tables = info.get("tables") or []
    if not tables or len(tables) > 200:
        raise BackupError("Hostel Backup-এর Table Count অস্বাভাবিক।")
    checked_rows = 0
    profile_skips = 0
    with _connect(database_url) as conn:
        with conn.transaction():
            conn.execute("SET TRANSACTION READ ONLY")
            if not conn.execute("SELECT to_regclass('public.hostels') IS NOT NULL AS ok").fetchone()["ok"]:
                raise BackupError("Target-এ public.hostels Table নেই; সঠিক Hostel Life Database নির্বাচন করুন।")
            if conn.execute("SELECT EXISTS(SELECT 1 FROM public.hostels WHERE id=%s) AS ok", [hostel_id]).fetchone()["ok"]:
                raise BackupError("এই Hostel ID Target Project-এ আগে থেকেই আছে; Duplicate Restore অনুমোদিত নয়।")
            required_users = sorted(set(str(x) for x in identity.get("all_referenced_auth_user_ids", []) if x))
            if required_users:
                found = {str(row["id"]) for row in conn.execute("SELECT id::text AS id FROM auth.users WHERE id = ANY(%s::uuid[])", [required_users]).fetchall()}
                missing = sorted(set(required_users) - found)
                if missing:
                    raise BackupError(f"Target Auth-এ {len(missing)}টি Required User ID নেই।")
            for item in tables:
                schema, table = str(item.get("schema") or ""), str(item.get("table") or "")
                if schema not in {"public", "private"} or not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", table):
                    raise BackupError("Hostel Backup-এ অনিরাপদ Table Identifier পাওয়া গেছে।")
                relative = "database/" + str(item.get("file") or "")
                _validate_archive_member(relative)
                data_file = extracted / "database" / str(item.get("file") or "")
                if not data_file.is_file():
                    raise BackupError(f"Hostel Table JSON পাওয়া যায়নি: {schema}.{table}")
                rows = json.loads(data_file.read_text(encoding="utf-8"))
                if not isinstance(rows, list):
                    raise BackupError(f"{schema}.{table} JSON Array নয়।")
                checked_rows += len(rows)
                if checked_rows > MAX_HOSTEL_ROWS:
                    raise BackupError("Hostel Backup Row Count নিরাপত্তা সীমা অতিক্রম করেছে।")
                target_columns = conn.execute(
                    "SELECT column_name, data_type, udt_name, is_nullable, column_default, is_generated, is_identity FROM information_schema.columns WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position",
                    [schema, table],
                ).fetchall()
                if not target_columns:
                    raise BackupError(f"Target Schema-তে {schema}.{table} Table নেই; একই Migration/Version আগে প্রয়োগ করুন।")
                target_map = {row["column_name"]: dict(row) for row in target_columns}
                source_cols = [str(col.get("column_name")) for col in item.get("columns", []) if col.get("column_name")]
                missing_cols = set(source_cols) - set(target_map)
                if missing_cols:
                    raise BackupError(f"Target {schema}.{table}-এ Source Column নেই: {', '.join(sorted(missing_cols))}")
                missing_required = [
                    row["column_name"] for row in target_columns
                    if row["column_name"] not in source_cols and row["is_nullable"] == "NO"
                    and row["column_default"] is None and row["is_generated"] == "NEVER" and row["is_identity"] == "NO"
                ]
                if missing_required:
                    raise BackupError(f"Target {schema}.{table}-এ নতুন Required Column আছে: {', '.join(missing_required)}")
                pk = [str(col) for col in (item.get("primary_key") or [])]
                if not pk or any(col not in source_cols for col in pk):
                    raise BackupError(f"{schema}.{table}-এর Primary Key Manifest অসম্পূর্ণ।")
                if schema == "public" and table == "profiles":
                    ids = [row.get("id") for row in rows if row.get("id")]
                    if ids:
                        present = conn.execute("SELECT id::text AS id FROM public.profiles WHERE id = ANY(%s::uuid[])", [ids]).fetchall()
                        profile_skips += len(present)
                else:
                    conflicts = _find_primary_key_conflicts(conn, schema, table, pk, rows)
                    if conflicts:
                        raise BackupError(f"Target {schema}.{table}-এ {len(conflicts)}টি Primary Key Conflict আছে।")
    return {"hostel_id": hostel_id, "table_count": len(tables), "row_count": checked_rows, "existing_profile_rows_kept": profile_skips}


def _restore_hostel_rows(database_url: str, extracted: Path, marker: str, log: LogFn | None = None) -> dict[str, int]:
    info_file = extracted / "hostel_export_manifest.json"
    identity_file = extracted / "database" / "identity_references.json"
    if not info_file.is_file() or not identity_file.is_file():
        raise BackupError("Hostel Backup Manifest/Identity Reference পাওয়া যায়নি।")
    info = json.loads(info_file.read_text(encoding="utf-8"))
    identity = json.loads(identity_file.read_text(encoding="utf-8"))
    hostel_id = str(info.get("hostel_id") or "")
    try:
        uuid.UUID(hostel_id)
    except Exception as exc:
        raise BackupError("Hostel Backup-এর Hostel ID সঠিক UUID নয়।") from exc
    tables = info.get("tables") or []
    if not tables or len(tables) > 200:
        raise BackupError("Hostel Backup-এর Table Count অস্বাভাবিক।")
    with _connect(database_url) as conn:
        with conn.transaction():
            if _database_has_marker(conn, marker):
                return {"tables": -1, "rows": -1, "already_restored": 1, "hostel_id": hostel_id}
            exists = conn.execute("SELECT EXISTS(SELECT 1 FROM public.hostels WHERE id=%s) AS ok", [hostel_id]).fetchone()["ok"]
            if exists:
                raise BackupError("এই Hostel ID Target Project-এ আগে থেকেই আছে। Duplicate/Merge Restore করা হবে না।")
            required_users = sorted(set(str(x) for x in identity.get("all_referenced_auth_user_ids", []) if x))
            if required_users:
                rows = conn.execute("SELECT id::text AS id FROM auth.users WHERE id = ANY(%s::uuid[])", [required_users]).fetchall()
                found = {str(row["id"]) for row in rows}
                missing = sorted(set(required_users) - found)
                if missing:
                    raise BackupError(f"Target Auth-এ {len(missing)}টি Required User ID নেই। আগে সংশ্লিষ্ট Account তৈরি/Restore করুন।")
            catalog: dict[tuple[str, str], dict[str, Any]] = {}
            for item in tables:
                schema = str(item.get("schema") or "")
                table = str(item.get("table") or "")
                if schema not in {"public", "private"} or not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", table):
                    raise BackupError("Hostel Backup-এ অনিরাপদ Table Identifier পাওয়া গেছে।")
                file_path = extracted / "database" / str(item.get("file") or "")
                _validate_archive_member("database/" + str(item.get("file") or ""))
                if not file_path.is_file():
                    raise BackupError(f"Hostel Table JSON পাওয়া যায়নি: {schema}.{table}")
                catalog[(schema, table)] = {**item, "file_path": file_path}
            if ("public", "hostels") not in catalog:
                raise BackupError("Hostel Backup-এ public.hostels Row নেই।")
            # All tables/columns are validated before inserting any row.
            existing_rows: dict[tuple[str, str], set[tuple[Any, ...]]] = {}
            source_rows: dict[tuple[str, str], list[dict[str, Any]]] = {}
            for key, item in catalog.items():
                schema, table = key
                source = json.loads(item["file_path"].read_text(encoding="utf-8"))
                if not isinstance(source, list):
                    raise BackupError(f"{schema}.{table} JSON Array নয়।")
                source_rows[key] = source
                target_columns = conn.execute(
                    "SELECT column_name, data_type, udt_name, is_nullable, column_default, is_generated, is_identity FROM information_schema.columns WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position",
                    [schema, table],
                ).fetchall()
                if not target_columns:
                    raise BackupError(f"Target Schema-তে {schema}.{table} Table নেই; একই Migration/Version আগে প্রয়োগ করুন।")
                target_col_map = {row["column_name"]: dict(row) for row in target_columns}
                source_cols = [str(col.get("column_name")) for col in item.get("columns", []) if col.get("column_name")]
                if set(source_cols) - set(target_col_map):
                    raise BackupError(f"Target {schema}.{table}-এ Source Column নেই: {', '.join(sorted(set(source_cols) - set(target_col_map)))}")
                missing_required = [
                    row["column_name"] for row in target_columns
                    if row["column_name"] not in source_cols and row["is_nullable"] == "NO" and row["column_default"] is None and row["is_generated"] == "NEVER" and row["is_identity"] == "NO"
                ]
                if missing_required:
                    raise BackupError(f"Target {schema}.{table}-এ নতুন Required Column আছে: {', '.join(missing_required)}")
                pk = item.get("primary_key") or []
                if not pk:
                    raise BackupError(f"{schema}.{table}-এর Primary Key Manifest-এ নেই।")
                for row in source:
                    if any(col not in row for col in pk):
                        raise BackupError(f"{schema}.{table}-এর Primary Key Value অসম্পূর্ণ।")
                if key == ("public", "profiles"):
                    # Existing global profiles must never be overwritten by a tenant restore.
                    profile_ids = [row.get("id") for row in source]
                    if any(value is None for value in profile_ids) or len({str(value) for value in profile_ids}) != len(profile_ids):
                        raise BackupError("Hostel Backup-এ public.profiles Primary Key অসম্পূর্ণ বা Duplicate।")
                    ids = [value for value in profile_ids if value]
                    found = set()
                    if ids:
                        found = {str(row["id"]) for row in conn.execute("SELECT id::text AS id FROM public.profiles WHERE id = ANY(%s::uuid[])", [ids]).fetchall()}
                    existing_rows[key] = {(value,) for value in found}
                else:
                    conflicts = _find_primary_key_conflicts(conn, schema, table, pk, source)
                    if conflicts:
                        raise BackupError(f"Target {schema}.{table}-এ {len(conflicts)}টি Primary Key Conflict আছে। Existing Data overwrite করা হবে না।")
                    existing_rows[key] = conflicts
            # Validate a safe parent-before-child insertion order from target Foreign Keys.
            fk_rows = conn.execute(
                """SELECT child_ns.nspname AS child_schema, child.relname AS child_table,
                          parent_ns.nspname AS parent_schema, parent.relname AS parent_table
                   FROM pg_constraint fk
                   JOIN pg_class child ON child.oid=fk.conrelid
                   JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
                   JOIN pg_class parent ON parent.oid=fk.confrelid
                   JOIN pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace
                   WHERE fk.contype='f'
                     AND child_ns.nspname IN ('public','private')
                     AND parent_ns.nspname IN ('public','private')"""
            ).fetchall()
            keys = set(catalog)
            edges: dict[tuple[str, str], set[tuple[str, str]]] = {key: set() for key in keys}
            indegree = {key: 0 for key in keys}
            for fk in fk_rows:
                child = (fk["child_schema"], fk["child_table"])
                parent = (fk["parent_schema"], fk["parent_table"])
                if child in keys and parent in keys and child not in edges[parent]:
                    edges[parent].add(child)
                    indegree[child] += 1
            ready = sorted([key for key, degree in indegree.items() if degree == 0])
            order: list[tuple[str, str]] = []
            while ready:
                key = ready.pop(0)
                order.append(key)
                for child in sorted(edges[key]):
                    indegree[child] -= 1
                    if indegree[child] == 0:
                        ready.append(child)
                        ready.sort()
            if len(order) != len(keys):
                cyclic = sorted(key for key, degree in indegree.items() if degree > 0)
                raise BackupError("Target Schema-তে Circular Foreign Key আছে; নিরাপদ Tenant Restore order নির্ধারণ করা যায়নি: " + ", ".join(f"{s}.{t}" for s, t in cyclic))
            inserted = 0
            for schema, table in order:
                item = catalog[(schema, table)]
                rows = source_rows[(schema, table)]
                pk = item.get("primary_key") or []
                target_columns = conn.execute(
                    "SELECT column_name, data_type, udt_name, is_generated FROM information_schema.columns WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position",
                    [schema, table],
                ).fetchall()
                target_col_map = {row["column_name"]: dict(row) for row in target_columns}
                source_cols = [str(col.get("column_name")) for col in item.get("columns", []) if col.get("column_name")]
                insert_cols = [col for col in source_cols if target_col_map[col]["is_generated"] != "ALWAYS"]
                if schema == "public" and table == "profiles":
                    current_ids = existing_rows.get((schema, table), set())
                    rows = [row for row in rows if (str(row.get("id")),) not in current_ids]
                if not rows:
                    continue
                columns_sql = ", ".join(_ident(col) for col in insert_cols)
                placeholders = ", ".join(["%s"] * len(insert_cols))
                override_identity = any(target_col_map[col]["is_identity"] == "YES" for col in insert_cols)
                identity_clause = " OVERRIDING SYSTEM VALUE" if override_identity else ""
                sql = f"INSERT INTO {_ident(schema)}.{_ident(table)} ({columns_sql}){identity_clause} VALUES ({placeholders})"
                batch = []
                for row in rows:
                    batch.append(tuple(_decode_exported_value(row.get(col), target_col_map[col]) for col in insert_cols))
                    if len(batch) >= 500:
                        conn.cursor().executemany(sql, batch)
                        inserted += len(batch)
                        batch.clear()
                if batch:
                    conn.cursor().executemany(sql, batch)
                    inserted += len(batch)
                _log(log, f"Hostel Restore: {schema}.{table} ({len(rows):,} rows)")
            _append_database_comment_marker(conn, marker)
    return {"tables": len(tables), "rows": inserted, "hostel_id": hostel_id}


def restore_backup(
    *,
    backup_file: Path,
    password: str,
    target_database_url: str,
    target_project_url: str,
    target_project_ref: str,
    target_service_key: str,
    workspace_dir: Path,
    restore_project_source_to: Path | None = None,
    log: LogFn | None = None,
    progress: ProgressFn | None = None,
) -> dict[str, Any]:
    """Restore a verified Master or Hostel backup. No reset/drop/truncate commands are used."""
    backup_file = Path(backup_file).expanduser().resolve()
    workspace_dir = Path(workspace_dir).expanduser().resolve()
    if not backup_file.is_file():
        raise BackupError("Backup File পাওয়া যায়নি।")
    if not target_service_key.strip():
        raise BackupError("Storage Restore-এর জন্য Target Project-এর Supabase Secret/Service Role Key দিন।")
    if not workspace_dir.exists():
        workspace_dir.mkdir(parents=True, exist_ok=True)
    if backup_file == workspace_dir or workspace_dir in backup_file.parents:
        raise BackupError("Restore Workspace-এর ভেতরে Backup File রাখা যাবে না। আলাদা Folder নির্বাচন করুন।")
    backup_sha = _sha256_file(backup_file)
    summary = inspect_backup_for_restore(backup_file, password)
    identity = _target_connection_identity(
        target_database_url, target_project_ref, str(summary.get("project_ref") or ""), target_project_url,
        allow_same_source=(summary["backup_type"] == "HOSTEL"),
    )
    backup_type = summary["backup_type"]
    _preflight_storage_target(target_project_url, target_service_key)
    marker = _restore_marker(backup_sha, identity["project_ref"], backup_type)
    journal_path = workspace_dir / f"restore_journal_{backup_type.lower()}_{identity['project_ref']}_{backup_sha[:12]}.json"
    journal = _journal_load(journal_path, backup_sha, identity["project_ref"], backup_type)
    # Extract into a temporary folder inside the chosen, preferably encrypted, workspace drive.
    with tempfile.TemporaryDirectory(prefix=".hostel_life_restore_", dir=workspace_dir) as temp_name:
        temp = Path(temp_name)
        zip_path, manifest = _read_verified_manifest(backup_file, password, temp)
        extracted = temp / "payload"
        _safe_extract_archive(zip_path, extracted)
        zip_path.unlink(missing_ok=True)
        if backup_type == "MASTER":
            target = _target_database_preflight(target_database_url, require_empty=False)
            with _connect(target_database_url) as conn:
                with conn.transaction():
                    if _database_has_marker(conn, marker):
                        _set_step(journal_path, journal, "database", "done", recovered_from_database_marker=True)
                    elif journal.get("steps", {}).get("database", {}).get("status") == "done":
                        raise BackupError("Restore Journal-এ Database Done, কিন্তু Target Database Marker নেই। নিরাপত্তার জন্য Restore বন্ধ।")
            if journal.get("steps", {}).get("database", {}).get("status") != "done":
                target = _target_database_preflight(target_database_url, require_empty=True)
                _set_step(journal_path, journal, "database", "running")
                _progress(progress, "Database Schema/Roles/Data Restore", 5)
                bundle = temp / "database_restore_bundle.sql"
                _build_master_database_restore_bundle(extracted, bundle, marker)
                _run_psql_file(target_database_url, bundle, log=log, timeout=2 * 60 * 60)
                _set_step(journal_path, journal, "database", "done")
            # Migration history is separate from application schema/data. Reconcile
            # the database marker on every resume instead of trusting local JSON alone.
            mig_marker = marker + ":MIGRATIONS"
            migration_step = journal.get("steps", {}).get("migration_history", {})
            with _connect(target_database_url) as conn:
                with conn.transaction():
                    already_migrated = _database_has_marker(conn, mig_marker)
            migration_result = migration_step.get("result")
            if already_migrated:
                migration_result = "already_restored"
                _set_step(journal_path, journal, "migration_history", "done", result=migration_result, recovered_from_database_marker=True)
            elif migration_step.get("status") == "done" and migration_result not in {"not_in_backup", "target_has_history", "target_schema_conflict"}:
                raise BackupError("Restore Journal-এ Migration History Done, কিন্তু Target Database Marker নেই। Target/Journal বদলেছে কি না যাচাই করুন; নিরাপত্তার জন্য Resume বন্ধ।")
            elif migration_step.get("status") != "done":
                _set_step(journal_path, journal, "migration_history", "running")
                migration_result = _restore_migration_history(target_database_url, extracted, mig_marker, log)
                _set_step(journal_path, journal, "migration_history", "done", result=migration_result)
            # Auth rows and their marker are committed in the same transaction.
            auth_marker = marker + ":AUTH"
            auth_step = journal.get("steps", {}).get("auth", {})
            with _connect(target_database_url) as conn:
                with conn.transaction():
                    auth_already_restored = _database_has_marker(conn, auth_marker)
            if auth_already_restored:
                auth_result = auth_step.get("result", {"already_restored": 1})
                _set_step(journal_path, journal, "auth", "done", result=auth_result, recovered_from_database_marker=True)
            elif auth_step.get("status") == "done":
                raise BackupError("Restore Journal-এ Auth Done, কিন্তু Target Database Marker নেই। Auth Data পরিবর্তিত/মুছে গেছে কি না যাচাই করুন; নিরাপত্তার জন্য Resume বন্ধ।")
            else:
                _set_step(journal_path, journal, "auth", "running")
                _progress(progress, "Auth Users/Identities Restore", 52)
                auth_result = _restore_auth_data(target_database_url, extracted, auth_marker, log)
                _set_step(journal_path, journal, "auth", "done", result=auth_result)
            # Storage has no database transaction marker. Re-verify every object
            # against the Target API even when the local journal says it was done.
            _set_step(journal_path, journal, "storage", "running")
            _progress(progress, "Storage Bucket/Object Restore", 66)
            storage_result = _restore_storage(target_project_url, target_service_key, extracted, journal_path, journal, target_database_url=target_database_url, log=log, progress=progress)
            _set_step(journal_path, journal, "storage", "done", result=storage_result)
            source_result = {"skipped": True}
            if restore_project_source_to is not None:
                source_result = _copy_project_source_restore(extracted, Path(restore_project_source_to), journal, journal_path, log)
            cron_path = extracted / "database" / "cron_jobs.json"
            cron_review = []
            recovery_review_warnings: list[str] = []
            recovery = workspace_dir / "recovery_review"
            recovery.mkdir(parents=True, exist_ok=True)
            recovery_docs = extracted / "recovery"
            if recovery_docs.is_dir():
                doc_copy = _copy_review_files_without_overwrite(recovery_docs, recovery / "recovery_docs")
                if doc_copy["conflicts"]:
                    recovery_review_warnings.append("recovery_review/recovery_docs-এ কিছু হাতে সম্পাদিত File আগের মতো রাখা হয়েছে: " + ", ".join(doc_copy["conflicts"][:8]))
            if cron_path.exists():
                cron_payload = json.loads(cron_path.read_text(encoding="utf-8"))
                cron_review = cron_payload.get("jobs", []) if isinstance(cron_payload, dict) else cron_payload
                review_cron = recovery / f"cron_jobs_{identity['project_ref']}.json"
                sanitized_cron_payload = dict(cron_payload) if isinstance(cron_payload, dict) else {"jobs": cron_payload}
                sanitized_jobs = []
                for job in cron_review:
                    clean_job = dict(job) if isinstance(job, dict) else {"command": str(job)}
                    clean_job["command"] = _redact(str(clean_job.get("command") or ""))
                    sanitized_jobs.append(clean_job)
                sanitized_cron_payload["jobs"] = sanitized_jobs
                sanitized_cron_payload["review_note"] = "Credential-like literals were redacted from this local review copy. The original command remains only in the encrypted backup. Re-enter new Target secrets manually."
                if review_cron.exists():
                    try:
                        existing_cron = json.loads(review_cron.read_text(encoding="utf-8"))
                    except Exception:
                        existing_cron = None
                    if existing_cron != sanitized_cron_payload:
                        recovery_review_warnings.append("আগের Cron Job Review File পরিবর্তিত থাকায় সেটি Overwrite করা হয়নি।")
                else:
                    _write_json(review_cron, sanitized_cron_payload)
            remote_snapshot = extracted / "edge_functions" / "remote_snapshot"
            if remote_snapshot.is_dir():
                edge_copy = _copy_review_files_without_overwrite(remote_snapshot, recovery / "remote_edge_function_snapshot")
                if edge_copy["conflicts"]:
                    recovery_review_warnings.append("recovery_review/remote_edge_function_snapshot-এ কিছু হাতে সম্পাদিত File আগের মতো রাখা হয়েছে: " + ", ".join(edge_copy["conflicts"][:8]))
            _set_step(journal_path, journal, "complete", "done")
            _progress(progress, "Master Restore সম্পন্ন", 100)
            migration_result_value = journal.get("steps", {}).get("migration_history", {}).get("result")
            restore_warnings = [
                    "Auth Active Session/Refresh Token Restore হয়নি; সবাইকে আবার Login করতে হবে।",
                    "Edge Function Source/Secrets ও Cron Job স্বয়ংক্রিয়ভাবে Deploy/Enable করা হয়নি; recovery_review ও Project Source দেখে হাতে যাচাই করুন।",
                    "Storage Object owner ও generated metadata নতুন Storage API Upload অনুযায়ী তৈরি হয়েছে; File Path ও Content Restore হয়েছে।",
                    "Auth Provider, SMTP, Redirect URL, Project API/JWT Key, Vercel Environment/Domain, Realtime Publication, non-default Extension ও Encryption/Vault Root Key আলাদাভাবে যাচাই করুন।",
                ]
            restore_warnings.extend(recovery_review_warnings)
            if migration_result_value in {"target_has_history", "target_schema_conflict"}:
                restore_warnings.append("Supabase Migration History স্বয়ংক্রিয়ভাবে Restore হয়নি; Target-এর supabase_migrations অবস্থা হাতে যাচাই করুন।")
            return {
                "restored": True,
                "backup_type": backup_type,
                "target_project_ref": identity["project_ref"],
                "journal": str(journal_path),
                "database": journal.get("steps", {}).get("database", {}),
                "migration_history": journal.get("steps", {}).get("migration_history", {}),
                "auth": journal.get("steps", {}).get("auth", {}),
                "storage": storage_result,
                "project_source": source_result,
                "cron_jobs_for_manual_review": len(cron_review),
                "warnings": restore_warnings,
            }
        else:
            # A Hostel backup is a tenant-only merge into an existing, compatible app schema.
            _target_database_preflight(target_database_url, require_empty=False)
            with _connect(target_database_url) as conn:
                with conn.transaction():
                    hostel_already_restored = _database_has_marker(conn, marker)
            hostel_step = journal.get("steps", {}).get("hostel_data", {})
            if hostel_already_restored:
                data_result = hostel_step.get("result", {"already_restored": 1})
                _set_step(journal_path, journal, "hostel_data", "done", result=data_result, recovered_from_database_marker=True)
            elif hostel_step.get("status") == "done":
                raise BackupError("Restore Journal-এ Hostel Data Done, কিন্তু Target Database Marker নেই। Target-এর ডেটা/Journal বদলেছে কি না যাচাই করুন; নিরাপত্তার জন্য Resume বন্ধ।")
            else:
                _set_step(journal_path, journal, "hostel_data", "running")
                _progress(progress, "Selected Hostel Data Restore", 10)
                data_result = _restore_hostel_rows(target_database_url, extracted, marker, log)
                _set_step(journal_path, journal, "hostel_data", "done", result=data_result)
            info = json.loads((extracted / "hostel_export_manifest.json").read_text(encoding="utf-8"))
            members = set(str(x) for x in info.get("member_user_ids", []) if x)
            _set_step(journal_path, journal, "storage", "running")
            _progress(progress, "Selected Hostel Avatar Restore", 65)
            storage_result = _restore_storage(target_project_url, target_service_key, extracted, journal_path, journal, target_database_url=target_database_url, log=log, progress=progress, hostel_member_ids=members)
            _set_step(journal_path, journal, "storage", "done", result=storage_result)
            _set_step(journal_path, journal, "complete", "done")
            _progress(progress, "Hostel Restore সম্পন্ন", 100)
            return {
                "restored": True,
                "backup_type": backup_type,
                "target_project_ref": identity["project_ref"],
                "hostel_id": info.get("hostel_id"),
                "hostel_data": data_result,
                "storage": storage_result,
                "journal": str(journal_path),
                "warnings": ["Auth Account/Password Restore করা হয়নি; referenced User ID-গুলো Target Project-এ আগে থাকতে হবে।", "আগে থেকে থাকা global profile row overwrite করা হয়নি।"],
            }
