import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseConfigReady } from '../lib/supabase';
import { getFriendlySupabaseError } from '../utils/supabaseErrors';
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
      requestPersistentStorage().catch(() => undefined);
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

      setSession(data.session ?? null);
      setAuthLoading(false);
    };

    initialize();

    if (!supabaseConfigReady || !supabase) return () => { mounted = false; };

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
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
    if (!session?.user) return undefined;
    const retry = () => {
      if (navigator.onLine) refreshIdentity().catch(() => undefined);
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [session?.user?.id, refreshIdentity]);

  const signOut = useCallback(async () => {
    if (!supabaseConfigReady || !supabase) throw new Error('Supabase configuration is missing.');
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
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
  }), [session, profile, membership, operationalRole, authLoading, identityLoading, identityError, offlineIdentity, refreshIdentity, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
