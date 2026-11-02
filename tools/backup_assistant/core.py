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
    return psycopg.connect(database_url, row_factory=dict_row, connect_timeout=20)


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
            hashes_map = manifest.get("files_sha256", {})
            checked = 0
            for name, expected in hashes_map.items():
                if name not in names:
                    raise BackupError(f"Backup-এ ফাইলটি নেই: {name}")
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
- Storage objects are included as files; Storage metadata is recreated from the bucket/object manifest during the future restore workflow.
- This package includes a database logical dump, but platform-level Auth, SMTP, provider, Vercel and project settings still need reconfiguration."""
    else:
        contents = """- Selected Hostel row and related public/private table data
- Related member profile rows and selected hostel members' profile-avatar objects
- Foreign-key and column metadata to support the future scoped restore
- Identity references only; no Auth passwords or global project settings"""
        limitations = """- A Hostel Backup is a tenant-scoped data package for an existing compatible Hostel Life schema. It does not contain Auth account credentials, global settings, the website source or Edge Function code.
- The target project must already contain the Auth User IDs listed in `identity_references.json`; the package does not recreate user accounts.
- This package is intended for the future Module 2 restore workflow and is not a standalone Supabase project backup."""
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
- The restore process is intentionally delivered as a separate Module 2 so that this backup utility never overwrites a live project.
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
        """SELECT tc.table_schema AS child_schema, tc.table_name AS child_table,
                  ccu.table_schema AS parent_schema, ccu.table_name AS parent_table,
                  tc.constraint_name, kcu.column_name AS child_column,
                  ccu.column_name AS parent_column, kcu.ordinal_position
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_schema=kcu.constraint_schema AND tc.constraint_name=kcu.constraint_name
            AND tc.table_schema=kcu.table_schema AND tc.table_name=kcu.table_name
           JOIN information_schema.constraint_column_usage ccu
             ON tc.constraint_schema=ccu.constraint_schema AND tc.constraint_name=ccu.constraint_name
           WHERE tc.constraint_type='FOREIGN KEY'
             AND tc.table_schema IN ('public','private')
             AND ccu.table_schema IN ('public','private')
           ORDER BY tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position"""
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
        """SELECT tc.table_schema AS child_schema, tc.table_name AS child_table,
                  kcu.column_name AS child_column
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_schema=kcu.constraint_schema AND tc.constraint_name=kcu.constraint_name
            AND tc.table_schema=kcu.table_schema AND tc.table_name=kcu.table_name
           JOIN information_schema.constraint_column_usage ccu
             ON tc.constraint_schema=ccu.constraint_schema AND tc.constraint_name=ccu.constraint_name
           WHERE tc.constraint_type='FOREIGN KEY'
             AND tc.table_schema IN ('public','private')
             AND ccu.table_schema='auth' AND ccu.table_name='users'"""
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
