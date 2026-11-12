import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const migration = read('supabase/migrations/Run36_security_geo_location_and_localhost_diagnostics.sql');
const targetedMigration = read('supabase/migrations/Run39_targeted_hostel_life_improvements.sql');
const verify = read('supabase/verify/Verify_Run36_security_geo_localhost.sql');
const config = read('supabase/config.toml');
const telemetry = read('supabase/functions/record-auth-event/index.ts');
const geoProxy = read('supabase/functions/_shared/geoProxy.ts');
const worker = read('cloudflare/hostel-life-security-proxy/src/index.js');
const reset = read('supabase/functions/request-password-reset/index.ts');
const service = read('src/services/platformService.js');
const page = read('src/features/platform/SuperAdminPage.jsx');

 test('Run36 is additive and does not rewrite/delete existing business data', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS city text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS region text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS region_code text/);
  assert.doesNotMatch(migration, /\b(DROP TABLE|TRUNCATE|DELETE FROM (public|auth)\.|UPDATE (public|auth)\.)/i);
  assert.match(migration, /Run35 security columns are missing/);
});

test('Run39 security event writer retains schema compatibility but new telemetry stores no geo values', () => {
  assert.match(migration, /p_event_type IS NULL OR p_event_type NOT IN/);
  assert.match(migration, /hl_security_events\(\s*event_type,ip_address,ip_fingerprint,identity_fingerprint,[\s\S]*?country_code,city,region,region_code/);
  assert.match(migration, /city text/);
  assert.match(telemetry, /hl_record_public_security_event_v5/);
  assert.match(targetedMigration, /hl_record_public_security_event_v4/);
  assert.match(telemetry, /resolveTrustedVisitor/);
  assert.doesNotMatch(worker, /request\.cf|cf\.city|cf\.region|cf\.regionCode/);
  assert.match(geoProxy, /HMAC/);
  assert.match(geoProxy, /location: EMPTY_LOCATION/);
  assert.match(telemetry, /const location = \{ countryCode: null, city: null, region: null, regionCode: null \}/);
});

test('Password reset keeps its IP limiter but explicitly sends NULL location fields', () => {
  assert.match(reset, /hl_consume_password_reset_ip_request_v3/);
  assert.match(reset, /hl_record_public_security_event_v4/);
  assert.match(reset, /const location = \{ countryCode: null, city: null, region: null, regionCode: null \}/);
  assert.match(reset, /p_city: location\.city/);
  assert.match(reset, /p_region: location\.region/);
  assert.match(geoProxy, /proxyVerified: false/);
});

test('Geo-aware SQL writer and reset limiter remain service-role-only', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.hl_record_public_security_event_v3[\s\S]*?FROM PUBLIC,anon,authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.hl_record_public_security_event_v3[\s\S]*?TO service_role/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.hl_consume_password_reset_ip_request_v2[\s\S]*?FROM PUBLIC,anon,authenticated/);
  assert.match(verify, /Event writer service_role only/);
  assert.match(verify, /Reset IP limiter service_role only/);
});

test('Super Admin security responses strip legacy location fields and Logs Explorer scans are time-bounded', () => {
  assert.match(service, /function stripSecurityLocationFields/);
  assert.match(service, /function stripSecurityListLocationFields/);
  assert.match(service, /function stripSecurityAnalyticsLocationFields/);
  assert.match(service, /return stripSecurityListLocationFields\(data\)/);
  assert.match(service, /return stripSecurityAnalyticsLocationFields\(data\)/);
  const v4 = service.slice(service.indexOf('export async function platformAdminListSecurityEventsV4'), service.indexOf('// Retain the old export'));
  assert.match(v4, /p_country_code: null/);
  assert.match(v4, /p_location_search: null/);
  for (const file of [
    'supabase/diagnostics/LogsExplorer_1h_source_summary.sql',
    'supabase/diagnostics/LogsExplorer_1h_gateway_requests.sql',
    'supabase/diagnostics/LogsExplorer_1h_postgres_signals.sql',
  ]) {
    const diagnostic = read(file);
    assert.match(diagnostic, /INTERVAL 1 HOUR/);
    assert.doesNotMatch(diagnostic, /INTERVAL 24 HOUR/);
  }
  const guide = read('supabase/diagnostics/Logs_Query_Usage_Guide_BN.md');
  assert.match(guide, /Logs Query/);
  assert.match(guide, /Logs Ingest/);
  assert.match(guide, /স্বয়ংক্রিয়ভাবে চলে না/);
});

test('Super Admin keeps security event RPC and removes all geo display/filter elements', () => {
  assert.match(service, /platform_admin_list_security_events_v4/);
  assert.match(service, /p_location_search: locationSearch/);
  assert.match(page, /platformAdminListSecurityEventsV4/);
  assert.match(page, /IP দিয়ে খুঁজুন/);
  assert.doesNotMatch(page, /Country Code|City \/ Region|top_locations|country_code/);
  assert.match(page, /top_origins/);
  assert.match(read('src/styles/ui-refresh.css'), /platform-monitor-country-list/);
  assert.match(page, /Request Origin:/);
  assert.match(page, /লোকেশন সংগ্রহ/);
  assert.match(page, /বন্ধ/);
});

test('Security health explicitly reports that location collection is disabled', () => {
  assert.match(telemetry, /location_collection_enabled: false/);
  assert.match(page, /লোকেশন সংগ্রহ: <strong>বন্ধ<\/strong>/);
});

test('Local Super Admin denial explains project, blocked-profile, and role causes', () => {
  assert.match(page, /VITE_SUPABASE_URL/);
  assert.match(page, /data\.is_blocked === true/);
  assert.match(page, /role হলো/);
  assert.match(page, /HOSTEL_SECURITY_ALLOWED_ORIGINS/);
});

test('JWT verification remains disabled for pre-auth/public Functions and enabled for Admin deletion', () => {
  assert.match(config, /\[functions\.auth-security-gate\]\s*verify_jwt = false/);
  assert.match(config, /\[functions\.record-auth-event\]\s*verify_jwt = false/);
  assert.match(config, /\[functions\.request-password-reset\]\s*verify_jwt = false/);
  assert.match(config, /\[functions\.admin-delete-unlinked-user\]\s*verify_jwt = true/);
});
