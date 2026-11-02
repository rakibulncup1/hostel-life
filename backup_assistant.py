from __future__ import annotations

import hashlib
import queue
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from urllib.parse import urlsplit

from core import (
    BackupError,
    check_prerequisites,
    cleanup_staging_dir,
    find_stale_staging_dirs,
    create_hostel_backup,
    create_master_backup,
    dry_run_restore,
    list_hostels,
    restore_backup,
    verify_backup,
)

APP_TITLE = "Hostel Life Backup Assistant"


class BackupAssistantApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title(APP_TITLE)
        self.geometry("1020x900")
        self.minsize(840, 720)
        self.configure(bg="#f3f6f8")
        self.events: queue.Queue = queue.Queue()
        self.busy = False
        self.hostel_rows: list[dict[str, str]] = []
        self.hostel_lookup: dict[str, str] = {}

        self.project_url = tk.StringVar()
        self.project_ref = tk.StringVar()
        self.database_url = tk.StringVar()
        self.service_key = tk.StringVar()
        self.project_root = tk.StringVar()
        self.reusable_secrets_file = tk.StringVar()
        self.destination = tk.StringVar()
        self.master_password = tk.StringVar()
        self.master_password_confirm = tk.StringVar()
        self.hostel_password = tk.StringVar()
        self.hostel_password_confirm = tk.StringVar()
        self.verify_file = tk.StringVar()
        self.verify_password = tk.StringVar()
        self.restore_file = tk.StringVar()
        self.restore_password = tk.StringVar()
        self.target_project_url = tk.StringVar()
        self.target_project_ref = tk.StringVar()
        self.target_database_url = tk.StringVar()
        self.target_service_key = tk.StringVar()
        self.restore_workspace = tk.StringVar()
        self.restore_source_dir = tk.StringVar()
        self.restore_confirmation = tk.StringVar()
        self.restore_plan = None
        self.selected_hostel = tk.StringVar()
        self.status = tk.StringVar(value="Backup নিতে প্রস্তুত")
        self.progress_value = tk.IntVar(value=0)

        self._style()
        self._build()
        self.after(120, self._poll_events)

    def _style(self) -> None:
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TFrame", background="#f3f6f8")
        style.configure("Panel.TFrame", background="#ffffff")
        style.configure("TLabel", background="#f3f6f8", foreground="#20303c", font=("Segoe UI", 10))
        style.configure("Panel.TLabel", background="#ffffff", foreground="#20303c", font=("Segoe UI", 10))
        style.configure("Title.TLabel", background="#f3f6f8", foreground="#142c3e", font=("Segoe UI", 19, "bold"))
        style.configure("Subtitle.TLabel", background="#f3f6f8", foreground="#5d6b76", font=("Segoe UI", 9))
        style.configure("TButton", font=("Segoe UI", 10), padding=(10, 7))
        style.configure("Primary.TButton", font=("Segoe UI", 10, "bold"), padding=(12, 9))
        style.configure("TEntry", padding=(7, 6))
        style.configure("TLabelframe", background="#ffffff", bordercolor="#dce5eb")
        style.configure("TLabelframe.Label", background="#ffffff", foreground="#20303c", font=("Segoe UI", 10, "bold"))
        style.configure("TNotebook", background="#f3f6f8", borderwidth=0)
        style.configure("TNotebook.Tab", padding=(14, 9), font=("Segoe UI", 10, "bold"))

    def _build(self) -> None:
        outer = ttk.Frame(self, padding=18)
        outer.pack(fill="both", expand=True)
        ttk.Label(outer, text="Hostel Life Backup Assistant", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            outer,
            text="Backup আপনার কম্পিউটারে AES-256-GCM এনক্রিপ্টেড ফাইলে তৈরি হবে। কোনো Secret বা Password সংরক্ষণ করা হয় না।",
            style="Subtitle.TLabel",
            wraplength=850,
        ).pack(anchor="w", pady=(4, 12))

        common = ttk.LabelFrame(outer, text="Supabase Connection", padding=12)
        common.pack(fill="x", pady=(0, 12))
        self._field(common, "Project URL", self.project_url, row=0, column=0, width=48)
        self._field(common, "Project Ref", self.project_ref, row=0, column=1, width=24)
        self._field(common, "PostgreSQL Connection String", self.database_url, row=1, column=0, width=75, show="•")
        self._field(common, "Supabase Secret Key (sb_secret) বা Legacy service_role (শুধু Storage পড়ার জন্য)", self.service_key, row=2, column=0, width=75, show="•")
        ttk.Label(common, text="Secret Key, Database Password বা Service Role Key কোনো Backup/Log/History-তে লেখা হবে না।", style="Panel.TLabel", foreground="#8a4a1e").grid(row=3, column=0, columnspan=2, sticky="w", pady=(4, 0))

        destination = ttk.LabelFrame(outer, text="Backup Location", padding=12)
        destination.pack(fill="x", pady=(0, 12))
        ttk.Label(destination, text="Backup Folder", style="Panel.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Entry(destination, textvariable=self.destination).grid(row=1, column=0, sticky="ew", padx=(0, 8))
        ttk.Button(destination, text="Folder নির্বাচন", command=self._choose_destination).grid(row=1, column=1, sticky="ew")
        destination.columnconfigure(0, weight=1)

        self.notebook = ttk.Notebook(outer)
        self.notebook.pack(fill="both", expand=True)
        master_tab = ttk.Frame(self.notebook, padding=14)
        hostel_tab = ttk.Frame(self.notebook, padding=14)
        verify_tab = ttk.Frame(self.notebook, padding=14)
        restore_tab = ttk.Frame(self.notebook, padding=14)
        self.notebook.add(master_tab, text="Master Backup")
        self.notebook.add(hostel_tab, text="Hostel Backup")
        self.notebook.add(verify_tab, text="Verify Backup")
        self.notebook.add(restore_tab, text="Restore & Recovery")
        self._build_master(master_tab)
        self._build_hostel(hostel_tab)
        self._build_verify(verify_tab)
        self._build_restore(restore_tab)

        bottom = ttk.Frame(outer)
        bottom.pack(fill="x", pady=(12, 0))
        self.progress = ttk.Progressbar(bottom, maximum=100, variable=self.progress_value)
        self.progress.pack(fill="x")
        ttk.Label(bottom, textvariable=self.status, style="Subtitle.TLabel").pack(anchor="w", pady=(5, 0))

        log_frame = ttk.LabelFrame(outer, text="কাজের বিবরণ", padding=8)
        log_frame.pack(fill="both", expand=False, pady=(10, 0))
        self.log_box = tk.Text(log_frame, height=7, wrap="word", bg="#101b24", fg="#dce9ef", insertbackground="#ffffff", relief="flat", font=("Consolas", 9), state="disabled")
        log_scroll = ttk.Scrollbar(log_frame, orient="vertical", command=self.log_box.yview)
        self.log_box.configure(yscrollcommand=log_scroll.set)
        self.log_box.pack(side="left", fill="both", expand=True)
        log_scroll.pack(side="right", fill="y")
        self._append_log("প্রথমবার ব্যবহারের আগে README_BN.md পড়ুন।")
        self._append_log("Master Backup: Supabase CLI + Docker · Master Restore: PostgreSQL psql · Hostel Restore: Psycopg · Dry Run আগে চালাতে হবে।")

    def _field(self, parent, label, variable, row, column, width=40, show=None):
        frame = ttk.Frame(parent, style="Panel.TFrame")
        frame.grid(row=row * 2, column=column, sticky="ew", padx=(0 if column == 0 else 12, 0), pady=(0, 2))
        ttk.Label(frame, text=label, style="Panel.TLabel").pack(anchor="w")
        entry = ttk.Entry(frame, textvariable=variable, width=width, show=show)
        entry.pack(fill="x", pady=(3, 7))
        parent.columnconfigure(column, weight=1)
        return entry

    def _build_master(self, parent) -> None:
        ttk.Label(parent, text="সম্পূর্ণ সিস্টেমের Master Backup", font=("Segoe UI", 13, "bold")).pack(anchor="w")
        ttk.Label(parent, text="Database Schema, Roles, Data, Auth Users/Identities, Storage Objects, স্থানীয় Website Source, SQL Migrations ও Edge Function Source আলাদা অংশে সংরক্ষিত হবে।", wraplength=820).pack(anchor="w", pady=(5, 10))
        ttk.Label(parent, text="Project Source Folder", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        row = ttk.Frame(parent)
        row.pack(fill="x", pady=(3, 10))
        ttk.Entry(row, textvariable=self.project_root).pack(side="left", fill="x", expand=True, padx=(0, 8))
        ttk.Button(row, text="Project Folder", command=self._choose_project).pack(side="right")
        ttk.Label(parent, text="ঐচ্ছিক Reusable Secrets File (সেনসিটিভ; এনক্রিপ্টেড Backup-এ যাবে)", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        secret_row = ttk.Frame(parent)
        secret_row.pack(fill="x", pady=(3, 10))
        ttk.Entry(secret_row, textvariable=self.reusable_secrets_file).pack(side="left", fill="x", expand=True, padx=(0, 8))
        ttk.Button(secret_row, text="Secrets File", command=self._choose_secrets_file).pack(side="right")
        ttk.Label(parent, text="Backup Encryption Password (কমপক্ষে ১২ অক্ষর)", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        ttk.Entry(parent, textvariable=self.master_password, show="•").pack(fill="x", pady=(3, 8))
        ttk.Label(parent, text="Password আবার লিখুন", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        ttk.Entry(parent, textvariable=self.master_password_confirm, show="•").pack(fill="x", pady=(3, 10))
        actions = ttk.Frame(parent)
        actions.pack(fill="x", pady=(5, 0))
        ttk.Button(actions, text="প্রয়োজনীয় Tool পরীক্ষা", command=self._check_tools).pack(side="left")
        ttk.Button(actions, text="Backup Size Estimate", command=self._estimate_size).pack(side="left", padx=(8, 0))
        self.master_button = ttk.Button(actions, text="Full Master Backup তৈরি করুন", style="Primary.TButton", command=self._start_master)
        self.master_button.pack(side="right")
        ttk.Label(parent, text="নোট: Backup চলাকালে Database-এ শুধু Read/Export হবে। কোনো Table বা Record পরিবর্তন/মুছে ফেলা হবে না। অস্থায়ী Plaintext Staging নির্বাচিত Drive-এ থাকবে; BitLocker-সুরক্ষিত Drive/USB ব্যবহার করুন।", wraplength=820, foreground="#7b4b22").pack(anchor="w", pady=(14, 0))

    def _build_hostel(self, parent) -> None:
        ttk.Label(parent, text="একটি নির্দিষ্ট মেসের Logical Backup", font=("Segoe UI", 13, "bold")).pack(anchor="w")
        ttk.Label(parent, text="নির্বাচিত মেসের সম্পর্কিত Public/Private টেবিল, সদস্যপদ, মাস, মিল, বাজার, ডিপোজিট, Ledger, Notice এবং ওই মেসের সদস্যদের Avatar কপি হবে। অন্য মেসের রেকর্ড অন্তর্ভুক্ত হবে না।", wraplength=820).pack(anchor="w", pady=(5, 10))
        ttk.Button(parent, text="Database থেকে মেসের তালিকা লোড করুন", command=self._load_hostels).pack(anchor="w", pady=(0, 8))
        ttk.Label(parent, text="মেস নির্বাচন", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        self.hostel_combo = ttk.Combobox(parent, textvariable=self.selected_hostel, state="readonly")
        self.hostel_combo.pack(fill="x", pady=(3, 10))
        ttk.Label(parent, text="Backup Encryption Password (কমপক্ষে ১২ অক্ষর)", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        ttk.Entry(parent, textvariable=self.hostel_password, show="•").pack(fill="x", pady=(3, 8))
        ttk.Label(parent, text="Password আবার লিখুন", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        ttk.Entry(parent, textvariable=self.hostel_password_confirm, show="•").pack(fill="x", pady=(3, 10))
        self.hostel_button = ttk.Button(parent, text="নির্বাচিত মেসের Backup তৈরি করুন", style="Primary.TButton", command=self._start_hostel)
        self.hostel_button.pack(anchor="e")
        ttk.Label(parent, text="এটি Master Backup-এর বিকল্প নয়। Auth User Account বা Global Configuration এতে থাকবে না; সংশ্লিষ্ট User ID-গুলো Target Project-এ আগে থাকতে হবে। Restore & Recovery Tab থেকে Dry Run করে মেসভিত্তিক Restore করা যাবে।", wraplength=820, foreground="#7b4b22").pack(anchor="w", pady=(14, 0))

    def _build_verify(self, parent) -> None:
        ttk.Label(parent, text="Backup Integrity Check", font=("Segoe UI", 13, "bold")).pack(anchor="w")
        ttk.Label(parent, text="আগে তৈরি করা .hlbackup ফাইল নির্বাচন করে Password দিন। AES-GCM Authentication এবং প্রতিটি ফাইলের SHA-256 Manifest যাচাই করা হবে।", wraplength=820).pack(anchor="w", pady=(5, 10))
        row = ttk.Frame(parent)
        row.pack(fill="x", pady=(0, 10))
        ttk.Entry(row, textvariable=self.verify_file).pack(side="left", fill="x", expand=True, padx=(0, 8))
        ttk.Button(row, text="Backup File", command=self._choose_verify_file).pack(side="right")
        ttk.Label(parent, text="Backup Password", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        ttk.Entry(parent, textvariable=self.verify_password, show="•").pack(fill="x", pady=(3, 10))
        self.verify_button = ttk.Button(parent, text="Backup যাচাই করুন", style="Primary.TButton", command=self._start_verify)
        self.verify_button.pack(anchor="e")

    def _build_restore(self, parent) -> None:
        ttk.Label(parent, text="Restore & Disaster Recovery", font=("Segoe UI", 13, "bold")).pack(anchor="w")
        ttk.Label(
            parent,
            text="আগে Backup Verify হবে। Master Backup শুধুমাত্র নতুন/খালি Target Project-এ Restore করা যাবে। Hostel Backup সামঞ্জস্যপূর্ণ Schema-তে নতুন Hostel হিসেবে যোগ হবে; আগে থেকে থাকা Data Overwrite হবে না।",
            wraplength=900,
        ).pack(anchor="w", pady=(5, 10))

        backup_box = ttk.LabelFrame(parent, text="Encrypted Backup", padding=10)
        backup_box.pack(fill="x", pady=(0, 8))
        ttk.Label(backup_box, text=".hlbackup File", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        row = ttk.Frame(backup_box)
        row.pack(fill="x", pady=(3, 7))
        ttk.Entry(row, textvariable=self.restore_file).pack(side="left", fill="x", expand=True, padx=(0, 8))
        ttk.Button(row, text="Backup File", command=self._choose_restore_file).pack(side="right")
        self._field(backup_box, "Backup Encryption Password", self.restore_password, row=1, column=0, width=70, show="•")

        target_box = ttk.LabelFrame(parent, text="Target Supabase Project (যেখানে Restore হবে)", padding=10)
        target_box.pack(fill="x", pady=(0, 8))
        self._field(target_box, "Target Project URL", self.target_project_url, row=0, column=0, width=50)
        self._field(target_box, "Target Project Ref", self.target_project_ref, row=0, column=1, width=25)
        self._field(target_box, "Target PostgreSQL Connection String", self.target_database_url, row=1, column=0, width=80, show="•")
        self._field(target_box, "Target Supabase Secret Key (sb_secret) / Legacy service_role", self.target_service_key, row=2, column=0, width=80, show="•")
        ttk.Label(target_box, text="পুরোনো Project-এর Key নয়; Target Project থেকে নতুন Key দিন। Credential Restore Journal/Log-এ রাখা হয় না।", foreground="#8a4a1e", wraplength=900).grid(row=6, column=0, columnspan=2, sticky="w", pady=(2, 0))

        local_box = ttk.LabelFrame(parent, text="Local Restore Workspace", padding=10)
        local_box.pack(fill="x", pady=(0, 8))
        ttk.Label(local_box, text="Restore Workspace Folder (Journal ও অস্থায়ী Plaintext এখানে থাকবে)", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        row = ttk.Frame(local_box)
        row.pack(fill="x", pady=(3, 7))
        ttk.Entry(row, textvariable=self.restore_workspace).pack(side="left", fill="x", expand=True, padx=(0, 8))
        ttk.Button(row, text="Workspace Folder", command=self._choose_restore_workspace).pack(side="right")
        ttk.Label(local_box, text="Optional: Website / Edge Function Source Restore Folder (খালি Folder দিন)", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        row2 = ttk.Frame(local_box)
        row2.pack(fill="x", pady=(3, 4))
        ttk.Entry(row2, textvariable=self.restore_source_dir).pack(side="left", fill="x", expand=True, padx=(0, 8))
        ttk.Button(row2, text="Source Folder", command=self._choose_restore_source).pack(side="right")

        actions = ttk.Frame(parent)
        actions.pack(fill="x", pady=(3, 8))
        ttk.Button(actions, text="প্রথমে Dry Run / Target Check", command=self._start_restore_dry_run).pack(side="left")
        self.restore_button = ttk.Button(actions, text="Restore / Resume শুরু করুন", style="Primary.TButton", command=self._start_restore)
        self.restore_button.pack(side="right")
        ttk.Label(parent, text="Restore Confirmation: Dry Run সফল হওয়ার পরে নিচে ঠিক এইভাবে লিখুন: RESTORE <Target Project Ref>", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        ttk.Entry(parent, textvariable=self.restore_confirmation).pack(fill="x", pady=(3, 8))
        ttk.Label(
            parent,
            text="সতর্কতা: Master Restore-এ Database Schema/Data ও Auth account নতুন Project-এ তৈরি হবে। Restore মাঝপথে বন্ধ হলে একই Backup, Target ও Workspace দিয়ে Resume করুন। অন্য Backup/Target দিয়ে পুরোনো Journal ব্যবহার করবেন না। কোনো DB Reset/Drop/Truncate চালানো হয় না।",
            wraplength=900,
            foreground="#8a4a1e",
        ).pack(anchor="w", pady=(6, 0))

    def _choose_restore_file(self) -> None:
        path = filedialog.askopenfilename(title="Encrypted Backup নির্বাচন করুন", filetypes=[("Hostel Life Backup", "*.hlbackup"), ("All files", "*.*")])
        if path:
            self.restore_file.set(path)
            self.restore_plan = None

    def _choose_restore_workspace(self) -> None:
        path = filedialog.askdirectory(title="Restore Workspace Folder নির্বাচন করুন")
        if path:
            self.restore_workspace.set(path)

    def _choose_restore_source(self) -> None:
        path = filedialog.askdirectory(title="Website/Project Source Restore Folder নির্বাচন করুন")
        if path:
            self.restore_source_dir.set(path)

    def _restore_signature(self) -> tuple[str, ...]:
        file_path = Path(self.restore_file.get().strip())
        digest = ""
        try:
            if file_path.is_file():
                hasher = hashlib.sha256()
                with file_path.open("rb") as handle:
                    while True:
                        chunk = handle.read(1024 * 1024)
                        if not chunk:
                            break
                        hasher.update(chunk)
                digest = hasher.hexdigest()
        except OSError:
            digest = ""
        connection_fingerprint = hashlib.sha256(
            "|".join((
                self.target_project_url.get().strip(),
                self.target_database_url.get().strip(),
                self.target_project_ref.get().strip(),
                hashlib.sha256(self.target_service_key.get().strip().encode("utf-8")).hexdigest(),
            )).encode("utf-8")
        ).hexdigest()
        return (
            str(file_path.resolve()) if file_path else "",
            digest,
            connection_fingerprint,
            self.restore_workspace.get().strip(),
            self.restore_source_dir.get().strip(),
        )

    def _start_restore_dry_run(self) -> None:
        path = Path(self.restore_file.get().strip())
        workspace = Path(self.restore_workspace.get().strip()) if self.restore_workspace.get().strip() else None
        if not path.is_file() or not self.restore_password.get():
            messagebox.showerror("Backup অসম্পূর্ণ", "Backup File ও Password দিন।")
            return
        if not all((self.target_project_url.get().strip(), self.target_project_ref.get().strip(), self.target_database_url.get().strip(), self.target_service_key.get().strip(), workspace)):
            messagebox.showerror("Target অসম্পূর্ণ", "Target Project URL, Ref, Database Connection String, Storage Secret/Service Role Key ও Restore Workspace দিন।")
            return
        if not messagebox.askyesno("Dry Run নিশ্চিত করুন", "Dry Run Backup-এর Integrity যাচাই এবং Target Database-এ শুধু Read-only Check করবে। কোনো Data Restore/পরিবর্তন হবে না। চালাবেন?"):
            return
        values = {
            "backup_file": path,
            "password": self.restore_password.get(),
            "target_database_url": self.target_database_url.get().strip(),
            "target_project_url": self.target_project_url.get().strip(),
            "target_project_ref": self.target_project_ref.get().strip(),
            "target_service_key": self.target_service_key.get().strip(),
        }
        self.restore_plan = None
        def worker():
            result = dry_run_restore(**values)
            self.events.put(("restore_plan", result))
        self._run_worker(worker)

    def _start_restore(self) -> None:
        path = Path(self.restore_file.get().strip())
        workspace_text = self.restore_workspace.get().strip()
        signature = self._restore_signature()
        if not path.is_file() or not self.restore_password.get():
            messagebox.showerror("Backup অসম্পূর্ণ", "Backup File ও Password দিন।")
            return
        if not workspace_text:
            messagebox.showerror("Workspace নেই", "Restore Workspace Folder নির্বাচন করুন।")
            return
        if self.restore_plan != signature:
            messagebox.showerror("Dry Run দরকার", "Backup File/Target/Workspace বদলেছে অথবা Dry Run করা হয়নি। আগে Dry Run চালান।")
            return
        ref = self.target_project_ref.get().strip().lower()
        expected = f"RESTORE {ref}"
        if self.restore_confirmation.get().strip() != expected:
            messagebox.showerror("Confirmation মেলেনি", f"নিশ্চিত করার জন্য ঠিক এই লেখা লিখুন:\n{expected}")
            return
        if not all((self.target_project_url.get().strip(), self.target_database_url.get().strip(), self.target_service_key.get().strip())):
            messagebox.showerror("Target অসম্পূর্ণ", "Target Project URL, Database Connection String ও Target Secret/Service Role Key দিন।")
            return
        source_folder = Path(self.restore_source_dir.get().strip()) if self.restore_source_dir.get().strip() else None
        warning = (
            f"Backup: {path.name}\nTarget Project Ref: {ref}\n\n"
            "এই Project-এ Restore চালানো হবে। Master Backup হলে Target অবশ্যই নতুন/খালি Project হতে হবে। "
            "একবার Restore শুরু হলে Database Data তৈরি হবে। শুরু করবেন?"
        )
        if not messagebox.askyesno("Restore Final Confirmation", warning):
            return
        values = {
            "backup_file": path,
            "password": self.restore_password.get(),
            "target_database_url": self.target_database_url.get().strip(),
            "target_project_url": self.target_project_url.get().strip(),
            "target_project_ref": ref,
            "target_service_key": self.target_service_key.get().strip(),
            "workspace_dir": Path(workspace_text),
            "restore_project_source_to": source_folder,
        }
        def worker():
            result = restore_backup(**values, log=lambda m: self.events.put(("log", m)), progress=lambda stage, pct: self.events.put(("progress", (stage, pct))))
            self.events.put(("restore_done", result))
        self._run_worker(worker)

    def _choose_destination(self) -> None:
        path = filedialog.askdirectory(title="Backup Folder নির্বাচন করুন")
        if path:
            self.destination.set(path)

    def _choose_project(self) -> None:
        path = filedialog.askdirectory(title="Hostel Life Project Folder নির্বাচন করুন")
        if path:
            self.project_root.set(path)

    def _choose_secrets_file(self) -> None:
        path = filedialog.askopenfilename(title="Reusable Secrets File নির্বাচন করুন", filetypes=[("Environment / Text Files", "*.env *.txt"), ("All files", "*.*")])
        if path:
            self.reusable_secrets_file.set(path)

    def _choose_verify_file(self) -> None:
        path = filedialog.askopenfilename(title="Backup File নির্বাচন করুন", filetypes=[("Hostel Life Backup", "*.hlbackup"), ("All files", "*.*")])
        if path:
            self.verify_file.set(path)

    def _append_log(self, message: str) -> None:
        self.log_box.configure(state="normal")
        self.log_box.insert("end", message + "\n")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")

    def _check_tools(self) -> None:
        def worker():
            checks = check_prerequisites()
            for key, value in checks.items():
                self.events.put(("log", f"{key}: {value}"))
            if checks.get("restore_ready"):
                self.events.put(("done", (True, "Restore-এর স্থানীয় Tool পাওয়া গেছে (Python, PostgreSQL psql, cryptography, requests)। Target-এর Credential ও Dry Run আলাদাভাবে যাচাই হবে।")))
            elif checks.get("hostel_backup_ready"):
                missing = []
                if not checks.get("psql"):
                    missing.append("PostgreSQL Client Tools / psql (Master Restore-এর জন্য)")
                self.events.put(("done", (False, "Hostel Backup-এর Python dependency পাওয়া গেছে। Restore-এর জন্য অনুপস্থিত: " + (", ".join(missing) or "প্রয়োজনীয় Python Package") + ". README_BN.md দেখুন।")))
            else:
                self.events.put(("done", (False, "প্রয়োজনীয় Python Package ইনস্টল করুন। README_BN.md দেখুন।")))
        self._run_worker(worker)

    def _estimate_size(self) -> None:
        db_url = self.database_url.get().strip()
        if not db_url:
            messagebox.showwarning("Connection দরকার", "PostgreSQL Connection String দিন।")
            return
        def worker():
            result = estimate_master_backup(db_url)
            self.events.put(("estimate", result))
            self.events.put(("done", (True, f"আনুমানিক Database + Storage Source Size: {result['estimated_source_bytes']:,} bytes")))
        self._run_worker(worker)

    def _load_hostels(self) -> None:
        db_url = self.database_url.get().strip()
        if not db_url:
            messagebox.showwarning("Connection দরকার", "PostgreSQL Connection String দিন।")
            return
        def worker():
            rows = list_hostels(db_url)
            self.events.put(("hostels", rows))
            self.events.put(("done", (True, f"{len(rows)}টি মেস পাওয়া গেছে।")))
        self._run_worker(worker)

    def _validate_passwords(self, first: str, second: str) -> bool:
        if len(first) < 12:
            messagebox.showerror("Password ছোট", "Encryption Password কমপক্ষে ১২ অক্ষরের হতে হবে।")
            return False
        if first != second:
            messagebox.showerror("Password মেলেনি", "দুইবার লেখা Password একই নয়।")
            return False
        return True

    def _cleanup_stale_staging(self, destination: Path) -> bool:
        stale = find_stale_staging_dirs(destination)
        if not stale:
            return True
        names = "\n".join(path.name for path in stale[:6])
        more = "\n..." if len(stale) > 6 else ""
        confirmed = messagebox.askyesno(
            "অসম্পূর্ণ Backup Folder পাওয়া গেছে",
            "আগের কোনো Backup/Verify থেমে গেলে অস্থায়ী Plaintext Folder বা ZIP থেকে যেতে পারে।\n\n"
            + names + more + "\n\nএগুলো মুছে ফেলবেন? সাধারণ Delete Secure Erase নয়; BitLocker-সুরক্ষিত Drive ব্যবহার করুন।",
        )
        if not confirmed:
            return False
        try:
            for path in stale:
                cleanup_staging_dir(path)
            self._append_log(f"{len(stale)}টি অসম্পূর্ণ Backup/Verify Artifact পরিষ্কার করা হয়েছে।")
            return True
        except Exception as exc:
            messagebox.showerror("Cleanup ব্যর্থ", str(exc))
            return False

    def _start_master(self) -> None:
        if not self._validate_passwords(self.master_password.get(), self.master_password_confirm.get()):
            return
        confirm_text = (
            "এটি Database, Auth Data ও Storage Files পড়ে Backup তৈরি করবে। "
            "কোনো তথ্য পরিবর্তন/মুছে ফেলবে না। অস্থায়ী Plaintext Staging নির্বাচিত Drive-এ থাকবে; "
            "BitLocker-সুরক্ষিত Drive ব্যবহার করুন.\n\n"
            "Reusable Secrets File নির্বাচন করলে তার গোপন মানও AES-256-GCM এনক্রিপ্টেড Backup-এ যোগ হবে। চালিয়ে যাবেন?"
        )
        if not messagebox.askyesno("Master Backup নিশ্চিত করুন", confirm_text):
            return
        values = {
            "database_url": self.database_url.get().strip(),
            "project_url": self.project_url.get().strip(),
            "project_ref": self.project_ref.get().strip(),
            "service_role_key": self.service_key.get().strip(),
            "project_root": Path(self.project_root.get().strip()),
            "destination_dir": Path(self.destination.get().strip()),
            "password": self.master_password.get(),
            "reusable_secrets_file": Path(self.reusable_secrets_file.get().strip()) if self.reusable_secrets_file.get().strip() else None,
        }
        project_root_text = self.project_root.get().strip()
        destination_text = self.destination.get().strip()
        if not all([values["database_url"], values["project_url"], values["project_ref"], values["service_role_key"], project_root_text, Path(project_root_text).is_dir(), destination_text]):
            messagebox.showerror("তথ্য অসম্পূর্ণ", "Project URL, Project Ref, Database URL, Service Role Key, Project Folder এবং Backup Folder দিন।")
            return
        values["destination_dir"].mkdir(parents=True, exist_ok=True)
        if not self._cleanup_stale_staging(values["destination_dir"]):
            return
        def worker():
            result = create_master_backup(**values, log=lambda m: self.events.put(("log", m)), progress=lambda s, p: self.events.put(("progress", (s, p))))
            self.events.put(("done", (True, result)))
        self._run_worker(worker)

    def _start_hostel(self) -> None:
        if not self._validate_passwords(self.hostel_password.get(), self.hostel_password_confirm.get()):
            return
        display_name = self.selected_hostel.get().strip()
        hostel_id = self.hostel_lookup.get(display_name)
        if not hostel_id:
            messagebox.showerror("মেস নির্বাচন করুন", "প্রথমে তালিকা লোড করে একটি মেস নির্বাচন করুন।")
            return
        if not messagebox.askyesno("Hostel Backup নিশ্চিত করুন", "শুধু নির্বাচিত মেসের Data ও সংশ্লিষ্ট Avatar পড়ে Backup হবে। অন্য মেসের ডেটা নেওয়া হবে না। অস্থায়ী Plaintext Staging নির্বাচিত Drive-এ থাকবে; BitLocker-সুরক্ষিত Drive ব্যবহার করুন। চালিয়ে যাবেন?"):
            return
        values = {
            "database_url": self.database_url.get().strip(),
            "project_url": self.project_url.get().strip(),
            "project_ref": self.project_ref.get().strip(),
            "service_role_key": self.service_key.get().strip(),
            "hostel_id": hostel_id,
            "destination_dir": Path(self.destination.get().strip()),
            "password": self.hostel_password.get(),
        }
        if not all([values["database_url"], values["project_url"], values["project_ref"], values["service_role_key"], self.destination.get().strip()]):
            messagebox.showerror("তথ্য অসম্পূর্ণ", "Project URL, Project Ref, Database URL, Service Role Key ও Backup Folder দিন।")
            return
        values["destination_dir"].mkdir(parents=True, exist_ok=True)
        if not self._cleanup_stale_staging(values["destination_dir"]):
            return
        def worker():
            result = create_hostel_backup(**values, log=lambda m: self.events.put(("log", m)), progress=lambda s, p: self.events.put(("progress", (s, p))))
            self.events.put(("done", (True, result)))
        self._run_worker(worker)

    def _start_verify(self) -> None:
        path = Path(self.verify_file.get().strip())
        password = self.verify_password.get()
        if not path.is_file() or not password:
            messagebox.showerror("তথ্য অসম্পূর্ণ", "Backup File এবং Password দিন।")
            return
        if not messagebox.askyesno("Backup Verify নিশ্চিত করুন", "যাচাইয়ের সময় সাময়িক Plaintext ZIP একই Drive-এ তৈরি হবে এবং কাজ শেষে মুছে যাবে। BitLocker-সুরক্ষিত Drive ব্যবহার করুন। চালিয়ে যাবেন?"):
            return
        def worker():
            result = verify_backup(path, password)
            self.events.put(("done", (True, result)))
        self._run_worker(worker)

    def _run_worker(self, worker) -> None:
        if self.busy:
            return
        self.busy = True
        self.progress_value.set(0)
        self.status.set("কাজ শুরু হচ্ছে...")
        for widget in (getattr(self, "master_button", None), getattr(self, "hostel_button", None), getattr(self, "verify_button", None), getattr(self, "restore_button", None)):
            if widget:
                widget.configure(state="disabled")
        thread = threading.Thread(target=self._worker_wrapper, args=(worker,), daemon=True)
        thread.start()

    def _worker_wrapper(self, worker) -> None:
        try:
            worker()
        except Exception as exc:
            self.events.put(("error", str(exc) if isinstance(exc, BackupError) else f"কাজটি সম্পন্ন হয়নি: {exc.__class__.__name__}: {exc}"))
        finally:
            self.events.put(("worker_finished", None))

    def _poll_events(self) -> None:
        try:
            while True:
                kind, payload = self.events.get_nowait()
                if kind == "log":
                    self._append_log(str(payload))
                elif kind == "progress":
                    stage, percent = payload
                    self.status.set(stage)
                    if percent is not None:
                        self.progress_value.set(percent)
                elif kind == "estimate":
                    db_mb = payload.get("database_bytes", 0) / (1024 * 1024)
                    storage_mb = payload.get("storage_bytes", 0) / (1024 * 1024)
                    total_mb = payload.get("estimated_source_bytes", 0) / (1024 * 1024)
                    self._append_log(f"Database Size (approx): {db_mb:,.1f} MB")
                    self._append_log(f"Storage Objects (approx): {storage_mb:,.1f} MB · {payload.get('object_count', 0):,} files")
                    self._append_log(f"মোট আনুমানিক Export Size: {total_mb:,.1f} MB")
                    self._append_log(payload.get("note", ""))
                    if not payload.get("storage_available"):
                        self._append_log("সতর্কতা: Storage Object Size পড়া যায়নি; পূর্ণ Egress Estimate নয়।")
                elif kind == "hostels":
                    self.hostel_rows = payload
                    self.hostel_lookup = {f"{row['name']} · {row['id'][:8]}": row["id"] for row in payload}
                    self.hostel_combo["values"] = list(self.hostel_lookup.keys())
                    self.selected_hostel.set(next(iter(self.hostel_lookup), ""))
                elif kind == "restore_plan":
                    self.restore_plan = self._restore_signature()
                    self.status.set("Dry Run সফল — Restore প্রস্তুত")
                    self.progress_value.set(100)
                    self._append_log(f"Backup Type: {payload.get('backup_type')}")
                    self._append_log(f"Source Project Ref: {payload.get('project_ref')}")
                    self._append_log(f"Target Project Ref: {payload.get('target', {}).get('project_ref')}")
                    if payload.get("backup_type") == "MASTER":
                        self._append_log(f"Auth Users: {payload.get('auth_user_count', 0):,} · Storage Objects: {payload.get('storage_object_count', 0):,} · Buckets: {payload.get('bucket_count', 0)}")
                    else:
                        self._append_log(f"Hostel ID: {payload.get('hostel_id')} · Tables: {payload.get('hostel_table_count', 0)} · Rows: {payload.get('hostel_row_count', 0):,}")
                    for warning in payload.get("limitations", []):
                        self._append_log(f"পরিকল্পনা: {warning}")
                    messagebox.showinfo("Dry Run সফল", f"Backup Integrity ও Target Check সফল।\n\nType: {payload.get('backup_type')}\nSource: {payload.get('project_ref')}\nTarget: {payload.get('target', {}).get('project_ref')}\n\nএখন Confirmation লিখে Restore শুরু করতে পারবেন।")
                elif kind == "restore_done":
                    self.status.set("Restore সম্পন্ন")
                    self.progress_value.set(100)
                    self._append_log(f"Restore সফল: Target {payload.get('target_project_ref')}")
                    self._append_log(f"Restore Journal: {payload.get('journal')}")
                    for warning in payload.get("warnings", []):
                        self._append_log(f"পরবর্তী যাচাই: {warning}")
                    messagebox.showinfo("Restore সফল", f"Restore সম্পন্ন হয়েছে।\n\nTarget Project: {payload.get('target_project_ref')}\nJournal: {payload.get('journal')}\n\nলগের পরবর্তী যাচাইগুলো সম্পন্ন করুন।")
                    self._clear_secrets()
                elif kind == "done":
                    success, payload = payload
                    if success and isinstance(payload, dict) and payload.get("file"):
                        self.status.set("Backup সম্পন্ন")
                        self.progress_value.set(100)
                        self._append_log(f"Backup File: {payload['file']}")
                        self._append_log(f"Size: {payload['size_bytes']:,} bytes")
                        self._append_log(f"SHA-256: {payload['sha256']}")
                        if payload.get("warnings"):
                            for warning in payload["warnings"]:
                                self._append_log(f"সতর্কতা: {warning}")
                        messagebox.showinfo("Backup সফল", f"Backup তৈরি হয়েছে:\n{payload['file']}\n\nSHA-256: {payload['sha256']}")
                        self._clear_secrets()
                    elif success and isinstance(payload, dict) and payload.get("verified"):
                        self.status.set("Backup যাচাই সফল")
                        self.progress_value.set(100)
                        self._append_log(f"যাচাই সফল: {payload.get('files_checked', 0)}টি ফাইল")
                        messagebox.showinfo("Backup অক্ষত", f"AES-256-GCM ও SHA-256 যাচাই সফল।\n\nযাচাইকৃত ফাইল: {payload.get('files_checked', 0)}\nBackup Type: {payload.get('backup_type')}")
                        self._clear_secrets()
                    else:
                        self.status.set(str(payload))
                        self._append_log(str(payload))
                elif kind == "error":
                    self.status.set("কাজ ব্যর্থ হয়েছে")
                    self._append_log(f"ত্রুটি: {payload}")
                    self._clear_secrets()
                    messagebox.showerror("Backup Error", str(payload))
                elif kind == "worker_finished":
                    self.busy = False
                    for widget in (getattr(self, "master_button", None), getattr(self, "hostel_button", None), getattr(self, "verify_button", None), getattr(self, "restore_button", None)):
                        if widget:
                            widget.configure(state="normal")
        except queue.Empty:
            pass
        self.after(120, self._poll_events)

    def _clear_secrets(self) -> None:
        self.service_key.set("")
        self.database_url.set("")
        self.reusable_secrets_file.set("")
        self.master_password.set("")
        self.master_password_confirm.set("")
        self.hostel_password.set("")
        self.hostel_password_confirm.set("")
        self.verify_password.set("")
        self.restore_password.set("")
        self.target_database_url.set("")
        self.target_service_key.set("")
        self.restore_confirmation.set("")
        self.restore_plan = None
        # Keep database_url in memory only until the user closes the utility,
        # allowing another export without retyping. It is never written to disk/logs.


def main() -> None:
    app = BackupAssistantApp()
    app.mainloop()


if __name__ == "__main__":
    main()
