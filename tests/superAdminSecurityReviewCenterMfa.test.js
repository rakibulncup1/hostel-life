import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('Run44 adds only read-on-demand analytics and reuses the existing private security event/IP-block tables', () => {
  const sql = read('supabase/migrations/Run44_security_review_center_mfa_ip_controls.sql');
  assert.match(sql, /platform_admin_get_security_analytics_30d/);
  assert.match(sql, /top_ips_30d/);
  assert.match(sql, /top_countries_30d/);
  assert.match(sql, /top_locations_30d/);
  assert.match(sql, /top_origins_30d/);
  assert.match(sql, /platform_admin_add_security_ip_block/);
  assert.match(sql, /platform_admin_release_security_ip_block/);
  assert.match(sql, /private\.hl_security_ip_blocks/);
  assert.match(sql, /private\.hl_security_events/);
  assert.match(sql, /platform_admin_list_security_ip_blocks/);
  assert.match(sql, /'city',b\.city/);
  assert.match(sql, /'region',b\.region/);
  assert.match(sql, /GROUP BY d\.day/);
  assert.match(sql, /blocked_until <= v_now/);
  assert.match(sql, /updated_at < v_now - interval '30 days'/);
  assert.doesNotMatch(sql, /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?private\.hl_security_events/i);
  assert.doesNotMatch(sql, /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?private\.hl_security_ip_blocks/i);
});

test('Super Admin authorization requires Supabase Auth AAL2 at the database layer', () => {
  const sql = read('supabase/migrations/Run44_security_review_center_mfa_ip_controls.sql');
  const page = read('src/features/platform/SuperAdminPage.jsx');
  assert.match(sql, /coalesce\(auth\.jwt\(\)->>'aal',\s*'aal1'\)\s*=\s*'aal2'/);
  assert.match(sql, /private\.is_current_auth_session_allowed\(\)/);
  assert.match(page, /supabase\.auth\.mfa\.enroll/);
  assert.match(page, /supabase\.auth\.mfa\.challenge/);
  assert.match(page, /supabase\.auth\.mfa\.verify/);
  assert.match(page, /currentLevel !== 'aal2'/);
});

test('30-day review center, manual IP block UI and factor backup management are wired to RPCs', () => {
  const page = read('src/features/platform/SuperAdminPage.jsx');
  const service = read('src/services/platformService.js');
  assert.match(page, /platformAdminGetSecurityAnalytics30d/);
  assert.match(page, /platform-security-review-center/);
  assert.match(page, /platform-security-manual-block/);
  assert.match(page, /releaseSecurityIpBlock/);
  assert.match(page, /ব্যাকআপ Authenticator যুক্ত করুন/);
  assert.match(page, /Attempt Email Column/);
  assert.match(service, /platform_admin_get_security_analytics_30d/);
  assert.match(service, /platform_admin_add_security_ip_block/);
  assert.match(service, /platform_admin_release_security_ip_block/);
});

test('Signup OTP endpoint is proxied and has a read-only health endpoint', () => {
  const client = read('src/lib/supabase.js');
  const worker = read('cloudflare/hostel-life-security-proxy/src/index.js');
  const edge = read('supabase/functions/request-signup-otp/index.ts');
  assert.match(client, /functions\/v1\/request-signup-otp/);
  assert.match(worker, /request-signup-otp', new Set\(\['GET', 'POST'\]\)/);
  assert.match(edge, /request\.method === 'GET'/);
  assert.match(edge, /hl_signup_otp_writer_health_v1/);
  assert.match(edge, /geo_proxy_verified/);
  assert.match(edge, /hl_check_auth_ip_block/);
});

test('IPinfo Lite fallback is HTTPS-only, cached, and used only when Cloudflare Country is missing', () => {
  const worker = read('cloudflare/hostel-life-security-proxy/src/index.js');
  const helper = read('supabase/functions/_shared/geoProxy.ts');
  assert.match(worker, /https:\/\/api\.ipinfo\.io\/lite/);
  assert.match(worker, /lookupIpinfoGeo/);
  assert.match(worker, /globalThis\.caches\?\.default/);
  assert.match(worker, /max-age=86400/);
  assert.match(worker, /!resolvedCountry && env\.IPINFO_TOKEN/);
  assert.match(worker, /x-hostel-geo-provider/);
  assert.match(helper, /GEO_PROXY_PROVIDER_INVALID/);
  assert.match(helper, /input\.geoProvider/);
});

test('Privacy policy discloses attempted-email and conditional IPinfo Lite geolocation processing', () => {
  const privacy = read('public/privacy-policy.html');
  assert.match(privacy, /Security Event/);
  assert.match(privacy, /৩০ দিনের/);
  assert.match(privacy, /IPinfo Lite/);
  assert.match(privacy, /Password, OTP code/);
});
