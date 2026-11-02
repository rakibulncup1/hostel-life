import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseConfigReady } from '../lib/supabase';
import { getFriendlySupabaseError } from '../utils/supabaseErrors';
import { invalidateRequestCache } from '../lib/requestCache';
import { readIdentitySnapshot, requestPersistentStorage, saveIdentitySnapshot } from '../services/offlineStore';

const AuthContext = createContext(null);

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

  const clearIdentity = useCallback(() => {
    invalidateRequestCache();
    setProfile(null);
    setMembership(null);
    setOperationalRole(null);
    setIdentityError(null);
    setOfflineIdentity(false);
  }, []);

  const refreshIdentity = useCallback(async () => {
    if (!session?.user) {
      clearIdentity();
      return null;
    }

    setIdentityLoading(true);
    setIdentityError(null);
    try {
      const identity = await loadIdentity();
      setProfile(identity.profile);
      setMembership(identity.membership);
      setOperationalRole(identity.operationalRole || null);
      setOfflineIdentity(false);
      saveIdentitySnapshot({ userId: session.user.id, identity }).catch(() => undefined);
      return identity;
    } catch (error) {
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
  }, [session, clearIdentity]);

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
        window.setTimeout(() => {
          supabase.rpc('hl_record_my_login').then(({ error: logError }) => {
            if (logError) console.warn('Hostel Life login activity could not be recorded:', logError.message);
          }).catch(() => undefined);
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
        clearIdentity();
        setOfflineIdentity(false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [clearIdentity]);

  useEffect(() => {
    if (!session) return;
    refreshIdentity().catch(() => undefined);
  }, [session, refreshIdentity]);


  useEffect(() => {
    if (!session?.user?.id || !supabase) return undefined;
    let active = true;
    let lastInteractionAt = Date.now();
    const heartbeat = () => {
      if (!active || !navigator.onLine || document.visibilityState === 'hidden') return;
      // An idle tab is not a reliable signal that a person is still using the app.
      if (Date.now() - lastInteractionAt > 20 * 60 * 1000) return;
      supabase.rpc('hl_touch_my_presence').then(({ error }) => {
        if (error && active) console.warn('Hostel Life presence heartbeat could not be recorded:', error.message);
      }).catch(() => undefined);
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
    const interval = window.setInterval(heartbeat, 15 * 60 * 1000);
    window.addEventListener('focus', onInteraction);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      interactionEvents.forEach((eventName) => window.removeEventListener(eventName, markInteraction));
      window.removeEventListener('focus', onInteraction);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session?.user?.id]);

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

    // A normal app logout ends only this browser's session. Other devices stay
    // signed in; the database activity log is also session-scoped.
    let activityRecorded = false;
    try {
      const { data, error } = await supabase.rpc('hl_record_my_logout');
      activityRecorded = !error && data?.recorded === true;
    } catch {
      // Audit telemetry must never prevent the user from leaving the account.
    }

    // Local scope avoids a remote global-revocation request and reliably clears
    // this device even when the Auth service is temporarily unavailable.
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
    setSession(null);
    clearIdentity();
    return { scope: 'local', activityRecorded };
  }, [clearIdentity]);

  const signOutLocal = useCallback(async () => {
    if (!supabaseConfigReady || !supabase) throw new Error('Supabase configuration is missing.');
    // Only remove the current browser's session. Other devices stay signed in.
    await supabase.rpc('hl_record_my_logout').catch(() => undefined);
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
    setSession(null);
    clearIdentity();
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
    refreshIdentity,
    signOut,
    signOutLocal,
  }), [session, profile, membership, operationalRole, authLoading, identityLoading, identityError, offlineIdentity, refreshIdentity, signOut, signOutLocal]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
