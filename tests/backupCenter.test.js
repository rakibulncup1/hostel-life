import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const page = fs.readFileSync(path.join(root, 'src/features/platform/SuperAdminPage.jsx'), 'utf8');
const utility = path.join(root, 'tools/backup_assistant');

test('Super Admin exposes a local encrypted Backup Center without cloud upload claims', () => {
  assert.match(page, /\['backup','Backup & Recovery'\]/);
  assert.match(page, /Backup কোনো Supabase Bucket-এ পাঠানো হয় না/);
  assert.match(page, /এই Web Panel আপনার কম্পিউটারের Local Folder বা Backup History পড়তে পারে না/);
  assert.match(page, /Hostel_Life_Backup_Assistant_Windows_Package\.zip/);
  assert.match(page, /এই বোতামটি শুধু Assistant-এর ZIP ডাউনলোড করে/);
  assert.match(page, /প্রকৃত `\.hlbackup` তৈরি হবে Assistant-এর `Master Backup` Tab-এ/);
  assert.match(page, /ডাউনলোড করা `\.hlbackup` এই Web Panel-এ Upload হবে না/);
  assert.match(page, /Restore & Recovery/);
  assert.match(page, /RUN_BACKUP_ASSISTANT\.bat/);
});

test('Portable Backup Assistant includes encryption, verification and separated backup modes', () => {
  const core = fs.readFileSync(path.join(utility, 'core.py'), 'utf8');
  const gui = fs.readFileSync(path.join(utility, 'backup_assistant.py'), 'utf8');
  assert.match(core, /AES-256-GCM/);
  assert.match(core, /def create_master_backup/);
  assert.match(core, /def create_hostel_backup/);
  assert.match(core, /def verify_backup/);
  assert.match(gui, /Full Master Backup তৈরি করুন/);
  assert.match(gui, /নির্বাচিত মেসের Backup তৈরি করুন/);
});

 test('Backup package avoids writing secrets into project source or browser code', () => {
  const core = fs.readFileSync(path.join(utility, 'core.py'), 'utf8');
  assert.match(core, /excluded_files = \{\"\.env\"/);
  assert.match(core, /secret_names_only\.json/);
  assert.doesNotMatch(page, /service_role|SUPABASE_SERVICE_ROLE_KEY|Database Connection String/);
});

test('Restore & Recovery is delivered in the local assistant with dry-run and typed confirmation', () => {
  const core = fs.readFileSync(path.join(utility, 'core.py'), 'utf8');
  const gui = fs.readFileSync(path.join(utility, 'backup_assistant.py'), 'utf8');
  assert.match(page, /Restore & Disaster Recovery/);
  assert.match(gui, /Restore & Recovery/);
  assert.match(gui, /প্রথমে Dry Run \/ Target Check/);
  assert.match(gui, /RESTORE \{ref\}/);
  assert.match(gui, /\.hlbackup নির্বাচন করুন/);
  assert.match(gui, /filedialog\.askopenfilename/);
  assert.match(core, /def dry_run_restore/);
  assert.match(core, /def restore_backup/);
  assert.match(core, /No reset\/drop\/truncate commands are used/);
  assert.match(core, /_copy_review_files_without_overwrite/);
});
