const PENDING_HOSTEL_LINK_KEY = 'hostel-life-pending-join-link';
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Keep a pending invitation across email-confirmation redirects, which may
 * open the verification URL in a separate browser tab. The token is only
 * temporary onboarding state; every use is revalidated by the server.
 */
export function getPendingHostelLinkToken() {
  try {
    const sessionToken = window.sessionStorage.getItem(PENDING_HOSTEL_LINK_KEY) || '';
    const localToken = window.localStorage.getItem(PENDING_HOSTEL_LINK_KEY) || '';
    const token = TOKEN_PATTERN.test(sessionToken) ? sessionToken : localToken;
    if (!TOKEN_PATTERN.test(token)) {
      window.sessionStorage.removeItem(PENDING_HOSTEL_LINK_KEY);
      window.localStorage.removeItem(PENDING_HOSTEL_LINK_KEY);
      return '';
    }
    // Keep both stores in sync for the same-tab and email-verification flows.
    window.sessionStorage.setItem(PENDING_HOSTEL_LINK_KEY, token);
    window.localStorage.setItem(PENDING_HOSTEL_LINK_KEY, token);
    return token;
  } catch {
    return '';
  }
}

export function setPendingHostelLinkToken(token) {
  if (!TOKEN_PATTERN.test(String(token || ''))) return false;
  let stored = false;
  try { window.sessionStorage.setItem(PENDING_HOSTEL_LINK_KEY, token); stored = true; } catch { /* Continue with durable storage. */ }
  try { window.localStorage.setItem(PENDING_HOSTEL_LINK_KEY, token); stored = true; } catch { /* Browser storage can be disabled. */ }
  return stored;
}

export function clearPendingHostelLinkToken() {
  try { window.sessionStorage.removeItem(PENDING_HOSTEL_LINK_KEY); } catch { /* Storage is optional. */ }
  try { window.localStorage.removeItem(PENDING_HOSTEL_LINK_KEY); } catch { /* Storage is optional. */ }
}
