import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, supabaseConfigReady } from '../lib/supabase';
import { getFriendlySupabaseError } from '../utils/supabaseErrors';
import { invalidateRequestCache } from '../lib/requestCache';
import { readIdentitySnapshot, requestPersistentStorage, saveIdentitySnapshot } from '../services/offlineStore';

const AuthContext = createContext(null);

const LOGOUT_AUDIT_TIMEOUT_MS = 1500;
const SESSION_POLICY_CACHE_MS = 15 * 1000;
const SESSION_LIMIT_NOTICE_KEY = 'hostel-life-session-limit-notice-v1';
const SESSION_LIMIT_NOTICE_EVENT = 'hostel-life-session-limit-notice';

function sessionPolicyCacheKey(session) {
  const userId = session?.user?.id || 'unknown-user';
  // Prefer a token-specific suffix so a rapid account/session switch cannot
  // reuse another browser session's cached policy response.
  return `${userId}:${session?.access_token?.slice(-24) || session?.expires_at || 'current'}`;
}

function sessionLimitError(policy) {
  const reason = String(policy?.reason || 'session_revoked');
  const message = reason === 'session_expired'
    ? 'নিরাপত্তার কারণে আপনার লগইন সেশনের নির্ধারিত সময় শেষ হয়েছে। আবার লগইন করে Hostel Life ব্যবহার করুন।'
    : reason === 'session_revoked' || reason === 'device_limit'
      ? 'এই অ্যাকাউন্টে নতুন লগইন হওয়ায় এই ডিভাইসের পুরোনো সেশন বন্ধ করা হয়েছে। নিরাপত্তার জন্য আবার লগইন করুন।'
      : 'এই লগইন সেশনটি আর সক্রিয় নেই। নিরাপত্তার জন্য আবার লগইন করুন।';
  const error = new Error(message);
  error.code = 'SESSION_LIMIT_EXCEEDED';
  error.reason = reason;
  error.maxDevices = Number(policy?.max_devices_per_user || 10);
  return error;
}

async function recordLogoutBestEffort() {
  let timeoutId;
  try {
    const result = await Promise.race([
      supabase.rpc('hl_record_my_logout'),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve({ data: null, error: new Error('logout_audit_timeout') }), LOGOUT_AUDIT_TIMEOUT_MS);
      }),
    ]);
    return !result?.error && result?.data?.recorded === true;
  } catch {
    return false;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function signOutCurrentDeviceAndConfirm() {
  let remoteError = null;
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    remoteError = error || null;
  } catch (error) {
    remoteError = error;
  }

  // Supabase may report a remote revoke/network error after clearing the local
  // session. A local account switch is complete only when storage confirms the
  // current session is gone; a remote acknowledgement is tracked separately.
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw remoteError || sessionError;
  if (data?.session) throw remoteError || new Error('এই ডিভাইসের সেশন এখনো সক্রিয় রয়েছে। আবার চেষ্টা করুন।');

  return { remoteRevocationConfirmed: !remoteError };
}

async function loadIdentity() {
  if (!supabaseConfigReady || !supabase) {
    throw new Error('Supabase configuration is missing.');
  }

  const [profileResult, membershipResult, operationalRoleResult] = await Promise.all([
    supabase.rpc('get_my_profile'),
    supabase.rpc('get_my_membership'),
    supabase.rpc('get_my_operational_role'),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (membershipResult.error) throw membershipResult.error;

  return {
    profile: Array.isArray(profileResult.data) ? profileResult.data[0] ?? null : profileResult.data ?? null,
    membership: Array.isArray(membershipResult.data) ? membershipResult.data[0] ?? null : membershipResult.data ?? null,
    operationalRole: operationalRoleResult.error ? null : (Array.isArray(operationalRoleResult.data) ? operationalRoleResult.data[0] ?? null : operationalRoleResult.data ?? null),
  };
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [membership, setMembership] = useState(null);
  const [operationalRole, setOperationalRole] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityError, setIdentityError] = useState(null);
  const [offlineIdentity, setOfflineIdentity] = useState(false);
  const [sessionExpiryAt, setSessionExpiryAt] = useState(null);

  const clearIdentity = useCallback(() => {
    invalidateRequestCache();
    setProfile(null);
    setMembership(null);
    setOperationalRole(null);
    setIdentityError(null);
    setOfflineIdentity(false);
  }, []);

  const sessionPolicyCacheRef = useRef(new Map());
  const sessionPolicyInFlightRef = useRef(new Map());

  const endCurrentSessionWithNotice = useCallback(async (message) => {
    try { window.sessionStorage.setItem(SESSION_LIMIT_NOTICE_KEY, message); } catch { /* best-effort notice */ }
    try { window.dispatchEvent(new CustomEvent(SESSION_LIMIT_NOTICE_EVENT, { detail: { message } })); } catch { /* best-effort notice */ }
    try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* Confirm local state below. */ }
    try {
      const { data } = await supabase.auth.getSession();
      if (!data?.session) {
        setSession(null);
        setSessionExpiryAt(null);
        clearIdentity();
        sessionPolicyCacheRef.current.clear();
      }
    } catch { /* The Auth listener will clear local identity when storage is removed. */ }
  }, [clearIdentity]);

  const enforceSessionLimit = useCallback(async (targetSession) => {
    if (!supabaseConfigReady || !supabase || !targetSession?.user?.id) return null;
    const cacheKey = sessionPolicyCacheKey(targetSession);
    const cached = sessionPolicyCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.checkedAt < SESSION_POLICY_CACHE_MS) return cached.result;
    const inFlight = sessionPolicyInFlightRef.current.get(cacheKey);
    if (inFlight) return inFlight;

    const task = (async () => {
      const { data, error } = await supabase.rpc('hl_enforce_my_session_limit');
      if (error) throw error;
      const policy = Array.isArray(data) ? data[0] ?? null : data;
      if (!policy || policy.allowed !== true) {
        const denied = sessionLimitError(policy || {});
        await endCurrentSessionWithNotice(denied.message);
        const { data: current, error: currentError } = await supabase.auth.getSession();
        if (currentError || current?.session) {
          const failure = new Error('নিরাপত্তার কারণে সেশন বন্ধ করার চেষ্টা করা হয়েছে, কিন্তু এই ডিভাইসের স্থানীয় লগইন পরিষ্কার হয়নি। আবার চেষ্টা করুন।');
          failure.code = 'SESSION_LIMIT_SIGNOUT_FAILED';
          throw failure;
        }
        throw denied;
      }

      setSessionExpiryAt(policy.expires_at || null);
      sessionPolicyCacheRef.current.set(cacheKey, { checkedAt: Date.now(), result: policy });
      // Keep only a few recent token/expiry keys in memory.
      if (sessionPolicyCacheRef.current.size > 8) {
        const oldestKey = sessionPolicyCacheRef.current.keys().next().value;
        sessionPolicyCacheRef.current.delete(oldestKey);
      }
      return policy;
    })();

    sessionPolicyInFlightRef.current.set(cacheKey, task);
    try { return await task; }
    finally { if (sessionPolicyInFlightRef.current.get(cacheKey) === task) sessionPolicyInFlightRef.current.delete(cacheKey); }
  }, [clearIdentity, endCurrentSessionWithNotice]);

  const refreshIdentity = useCallback(async () => {
    if (!session?.user) {
      clearIdentity();
      return null;
    }

    setIdentityLoading(true);
    setIdentityError(null);
    try {
      await enforceSessionLimit(session);
      const identity = await loadIdentity();
      setProfile(identity.profile);
      setMembership(identity.membership);
      setOperationalRole(identity.operationalRole || null);
      setOfflineIdentity(false);
      saveIdentitySnapshot({ userId: session.user.id, identity }).catch(() => undefined);
      return identity;
    } catch (error) {
      if (error?.code === 'SESSION_LIMIT_EXCEEDED' || error?.code === 'SESSION_LIMIT_SIGNOUT_FAILED') {
        setIdentityError(error.message);
        throw error;
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const cached = await readIdentitySnapshot(session.user.id).catch(() => null);
        if (cached?.identity?.profile || cached?.identity?.membership) {
          setProfile(cached.identity.profile || null);
          setMembership(cached.identity.membership || null);
          setOperationalRole(cached.identity.operationalRole || null);
          setIdentityError(null);
          setOfflineIdentity(true);
          return cached.identity;
        }
      }
      const friendly = getFriendlySupabaseError(error, 'অ্যাকাউন্টের তথ্য লোড করা যায়নি।');
      setIdentityError(friendly);
      throw error;
    } finally {
      setIdentityLoading(false);
    }
  }, [session, clearIdentity, enforceSessionLimit]);

  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      if (!supabaseConfigReady || !supabase) {
        setIdentityError('Supabase configuration পাওয়া যাচ্ছে না। .env.local যাচাই করুন।');
        setAuthLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;

      if (error) {
        setIdentityError(getFriendlySupabaseError(error, 'লগইন সেশন যাচাই করা যায়নি।'));
      }

      setSession((current) => {
        if (current?.user?.id !== data.session?.user?.id) invalidateRequestCache();
        return current?.user?.id === data.session?.user?.id ? current : (data.session ?? null);
      });
      setAuthLoading(false);
    };

    initialize();

    if (!supabaseConfigReady || !supabase) return () => { mounted = false; };

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Token rotation is not a new login and must not inflate login counts.
      if (event === 'TOKEN_REFRESHED') return;
      // Leave the Supabase auth callback lock before making an RPC request.
      if (event === 'SIGNED_IN' && nextSession?.user?.id) {
        setSessionExpiryAt(null);
        window.setTimeout(async () => {
          try {
            await enforceSessionLimit(nextSession);
            const { error: logError } = await supabase.rpc('hl_record_my_login');
            if (logError) console.warn('Hostel Life login activity could not be recorded:', logError.message);
          } catch (policyError) {
            if (policyError?.code !== 'SESSION_LIMIT_EXCEEDED') {
              console.warn('Hostel Life session policy could not be verified:', policyError?.message || 'unknown_error');
            }
          }
        }, 0);
      }
      if (event === 'INITIAL_SESSION') {
        setSession((current) => {
          if (current?.user?.id !== nextSession?.user?.id) invalidateRequestCache();
          return current?.user?.id === nextSession?.user?.id ? current : (nextSession ?? null);
        });
      } else {
        invalidateRequestCache();
        setSession(nextSession ?? null);
      }
      setAuthLoading(false);
      if (!nextSession) {
        setSessionExpiryAt(null);
        clearIdentity();
        setOfflineIdentity(false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [clearIdentity, enforceSessionLimit]);

  useEffect(() => {
    if (!session) return;
    refreshIdentity().catch(() => undefined);
  }, [session, refreshIdentity]);


  useEffect(() => {
    if (!session?.user?.id || !sessionExpiryAt) return undefined;
    const expiresAt = new Date(sessionExpiryAt).getTime();
    if (!Number.isFinite(expiresAt)) return undefined;
    const remaining = expiresAt - Date.now();
    const message = 'নিরাপত্তার কারণে আপনার লগইন সেশনের নির্ধারিত সময় শেষ হয়েছে। আবার লগইন করে Hostel Life ব্যবহার করুন।';
    if (remaining <= 0) {
      endCurrentSessionWithNotice(message);
      return undefined;
    }
    const timer = window.setTimeout(() => endCurrentSessionWithNotice(message), Math.min(remaining, 2147483000));
    return () => window.clearTimeout(timer);
  }, [session?.user?.id, sessionExpiryAt, endCurrentSessionWithNotice]);

  useEffect(() => {
    if (!session?.user?.id || !supabase) return undefined;
    let active = true;
    let lastInteractionAt = Date.now();
    const heartbeat = async () => {
      if (!active || !navigator.onLine || document.visibilityState === 'hidden') return;
      // An idle tab is not a reliable signal that a person is still using the app.
      if (Date.now() - lastInteractionAt > 20 * 60 * 1000) return;
      try {
        await enforceSessionLimit(session);
        const { error } = await supabase.rpc('hl_touch_my_presence');
        if (error && active) console.warn('Hostel Life presence heartbeat could not be recorded:', error.message);
      } catch (error) {
        if (active && error?.code !== 'SESSION_LIMIT_EXCEEDED') {
          console.warn('Hostel Life session heartbeat could not verify policy:', error?.message || 'unknown_error');
        }
      }
    };
    // Resume presence immediately on the first real interaction after an idle
    // period; the server still throttles database writes to one per 10 minutes.
    const markInteraction = () => {
      const now = Date.now();
      const wasIdle = now - lastInteractionAt > 20 * 60 * 1000;
      lastInteractionAt = now;
      if (wasIdle) heartbeat();
    };
    const onInteraction = () => { markInteraction(); heartbeat(); };
    const onVisible = () => { if (document.visibilityState === 'visible') onInteraction(); };
    const interactionEvents = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll'];
    interactionEvents.forEach((eventName) => window.addEventListener(eventName, markInteraction, { passive: true }));
    heartbeat();
    const interval = window.setInterval(heartbeat, 60 * 1000);
    window.addEventListener('focus', onInteraction);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      interactionEvents.forEach((eventName) => window.removeEventListener(eventName, markInteraction));
      window.removeEventListener('focus', onInteraction);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session?.user?.id, session?.expires_at, enforceSessionLimit]);

  useEffect(() => {
    if (session?.user?.id) requestPersistentStorage().catch(() => undefined);
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user) return undefined;
    const retry = () => {
      if (navigator.onLine && document.visibilityState === 'visible' && document.hasFocus()) refreshIdentity().catch(() => undefined);
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [session?.user?.id, refreshIdentity]);

  const signOut = useCallback(async () => {
    if (!supabaseConfigReady || !supabase) throw new Error('Supabase configuration is missing.');

    // Audit data is optional telemetry. It must not hold the user on the page.
    const activityRecorded = await recordLogoutBestEffort();
    const { remoteRevocationConfirmed } = await signOutCurrentDeviceAndConfirm();
    setSession(null);
    setSessionExpiryAt(null);
    clearIdentity();
    return { scope: 'local', activityRecorded, remoteRevocationConfirmed };
  }, [clearIdentity]);

  const signOutLocal = useCallback(async () => {
    if (!supabaseConfigReady || !supabase) throw new Error('Supabase configuration is missing.');
    // Only this browser's session is removed; another device remains signed in.
    const activityRecorded = await recordLogoutBestEffort();
    const { remoteRevocationConfirmed } = await signOutCurrentDeviceAndConfirm();
    setSession(null);
    setSessionExpiryAt(null);
    clearIdentity();
    return { scope: 'local', activityRecorded, remoteRevocationConfirmed };
  }, [clearIdentity]);

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    profile,
    membership,
    isAuthenticated: Boolean(session),
    isManager: membership?.status === 'active' && (membership?.role === 'manager' || operationalRole?.is_primary_manager === true),
    operationalRole,
    isActiveMember: membership?.status === 'active',
    authLoading,
    identityLoading,
    identityError,
    offlineIdentity,
    sessionExpiryAt,
    refreshIdentity,
    signOut,
    signOutLocal,
  }), [session, profile, membership, operationalRole, authLoading, identityLoading, identityError, offlineIdentity, sessionExpiryAt, refreshIdentity, signOut, signOutLocal]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
