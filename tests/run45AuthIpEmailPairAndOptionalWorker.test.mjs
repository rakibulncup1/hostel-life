import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const read=(f)=>fs.readFileSync(path.join(root,f),'utf8');

test('automatic login lockouts use an IP plus HMAC email pair, not a shared IP alone',()=>{
 const sql=read('supabase/migrations/Run45_auth_ip_email_pair_limits.sql');
 assert.match(sql,/PRIMARY KEY\(scope,ip_address,email_fingerprint\)/);
 assert.match(sql,/identity_fingerprint=p_identity_fingerprint/);
 assert.match(sql,/ON CONFLICT\(scope,ip_address,email_fingerprint\)/);
 assert.match(sql,/more_than_5_failed_auth_attempts_per_minute/);
 assert.match(sql,/interval '15 minutes'/);
 assert.match(sql,/attempt_email/);
});

test('front-end sends attempted email to the gate but no server HMAC secret enters the bundle',()=>{
 const auth=read('src/services/authService.js');
 const gate=read('supabase/functions/auth-security-gate/index.ts');
 assert.match(auth,/checkAppAuthGate\(normalizedEmail\)/);
 assert.match(auth,/body: \{ email: normalizedEmail \}/);
 assert.match(gate,/fingerprintIdentity\(email, hmacSecret\)/);
 assert.match(gate,/hl_check_auth_ip_block_v2/);
 assert.doesNotMatch(auth,/HOSTEL_SECURITY_HMAC_SECRET|PASSWORD_RESET_HMAC_SECRET/);
});

test('missing client IP cannot block Authentication or OTP; email quota stays active',()=>{
 const auth=read('src/services/authService.js');
 const gate=read('supabase/functions/auth-security-gate/index.ts');
 const reset=read('supabase/functions/request-password-reset/index.ts');
 const otp=read('supabase/functions/request-signup-otp/index.ts');
 assert.match(auth,/Optional IP\/email security gate unavailable/i);
 assert.match(gate,/allowed: true, protection_available: false/);
 assert.match(reset,/if \(requestIp\)/);
 assert.match(otp,/p_request_ip: visitor\.ip \|\| null/);
});

test('Cloudflare Worker is optional, signed, Cloudflare-native and has a health endpoint',()=>{
 const client=read('src/lib/supabase.js');
 const worker=read('cloudflare/hostel-life-security-proxy/src/index.js');
 assert.match(client,/requestUrl\.href, request\.clone\(\)/);
 assert.match(worker,/url\.pathname === '\/' \|\| url\.pathname === '\/health'/);
 assert.match(worker,/x-hostel-geo-signature/);
 assert.doesNotMatch(worker,/IPINFO_TOKEN|api\.ipinfo\.io/);
});

test('registration copy is neutral and OTP is shown only after Supabase Auth returns no session',()=>{
 const page=read('src/features/auth/AuthPage.jsx');
 assert.match(page,/রেজিস্ট্রেশন করুন/);
 assert.match(page,/if \(data\.session\)/);
 assert.match(page,/setOtpStep\(true\)/);
});

test('Super Admin can release a specific account-pair block; a manual global block is explicit',()=>{
 const sql=read('supabase/migrations/Run45_auth_ip_email_pair_limits.sql');
 const page=read('src/features/platform/SuperAdminPage.jsx');
 assert.match(sql,/platform_admin_release_security_ip_block_v2/);
 assert.match(sql,/private\.is_super_admin\(\)/);
 assert.match(sql,/global_manual/);
 assert.match(page,/block\.attempt_email/);
 assert.match(page,/IP অনুপস্থিত, Native Auth Protection/);
});
