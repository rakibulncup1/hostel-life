import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const migration = read('supabase/migrations/Run36_security_geo_location_and_localhost_diagnostics.sql');
const verify = read('supabase/verify/Verify_Run36_security_geo_localhost.sql');
const config = read('supabase/config.toml');
const telemetry = read('supabase/functions/record-auth-event/index.ts');
const geoProxy = read('supabase/functions/_shared/geoProxy.ts');
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

test('Run36 event writer validates event type and stores only bounded optional geo labels', () => {
  assert.match(migration, /p_event_type IS NULL OR p_event_type NOT IN/);
  assert.match(migration, /hl_security_events\(\s*event_type,ip_address,ip_fingerprint,identity_fingerprint,[\s\S]*?country_code,city,region,region_code/);
  assert.match(migration, /city text/);
  assert.match(telemetry, /hl_record_public_security_event_v3/);
  assert.match(telemetry, /resolveTrustedVisitor/);
  assert.match(geoProxy, /cf-ipcity/);
  assert.match(geoProxy, /cf-region-code/);
  assert.match(geoProxy, /HMAC/);
  assert.match(geoProxy, /display-only/);
});

test('Password reset Edge Function sends optional display-only location fields to new limiter and event writer', () => {
  assert.match(reset, /hl_consume_password_reset_ip_request_v2/);
  assert.match(reset, /hl_record_public_security_event_v3/);
  assert.match(reset, /p_city: location\.city/);
  assert.match(reset, /p_region: location\.region/);
  assert.match(reset, /unverified display-only location metadata/);
});

test('Geo-aware SQL writer and reset limiter remain service-role-only', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.hl_record_public_security_event_v3[\s\S]*?FROM PUBLIC,anon,authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.hl_record_public_security_event_v3[\s\S]*?TO service_role/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.hl_consume_password_reset_ip_request_v2[\s\S]*?FROM PUBLIC,anon,authenticated/);
  assert.match(verify, /Event writer service_role only/);
  assert.match(verify, /Reset IP limiter service_role only/);
});

test('Super Admin uses geo-aware event RPC and exposes city, region and request origin', () => {
  assert.match(service, /platform_admin_list_security_events_v3/);
  assert.match(service, /p_location_search: locationSearch/);
  assert.match(page, /platformAdminListSecurityEventsV3/);
  assert.match(page, /City \/ Region/);
  assert.match(page, /top_locations/);
  assert.match(page, /top_origins/);
  assert.match(read('src/styles/ui-refresh.css'), /platform-monitor-country-list/);
  assert.match(page, /Request Origin:/);
  assert.match(page, /Direct Supabase path/);
  assert.match(page, /লোকেশন তথ্য অনুপস্থিত বা unverified হতে পারে/);
});

test('Security health reports if upstream Cloudflare city and region headers are absent', () => {
  assert.match(telemetry, /city_header_available: Boolean\(location\.city\)/);
  assert.match(telemetry, /region_header_available: Boolean\(location\.region\)/);
  assert.match(page, /securityTelemetryStatus\.city_header_available/);
  assert.match(page, /securityTelemetryStatus\.region_header_available/);
  assert.match(page, /Cloudflare Worker Proxy deploy/);
  assert.match(page, /Worker signature যাচাই হয়নি \/ Direct Supabase path/);
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
