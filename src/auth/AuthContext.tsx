import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react';
import type { ReactNode } from 'react';
import type { User } from 'firebase/auth';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { auth, isFirebaseConfigured } from '@/api/firebase';
import { isGoogleSignInAvailable, signInWithGoogle, signOutOfGoogle } from './googleSignIn';
import {
  ensureUserProfile,
  updateDisplayName as updateStoredDisplayName,
  updateUserSettings,
  watchUserProfile,
  type UserProfile,
} from '@/api/userData';
import {
  applyRemoteNearbyRadius,
  getNearbyRadius,
  setNearbyRadiusRemoteSink,
} from '@/hooks/useNearbyRadius';
import {
  applyRemoteAlertPreferences,
  getAlertPreferences,
  setAlertPreferencesRemoteSink,
} from '@/hooks/useAlertPreferences';

interface AuthContextValue {
  user: User | null;
  /** The user's Firestore profile; null until it loads (or when signed out). */
  profile: UserProfile | null;
  /** First name to greet the user with, if they gave one. */
  firstName: string | null;
  loading: boolean;
  isConfigured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  /** True when Google sign-in is set up for this build. */
  googleAvailable: boolean;
  /** Resolves false if the user backed out of the Google account picker. */
  signInWithGoogle: () => Promise<boolean>;
  sendPasswordReset: (email: string) => Promise<void>;
  updateName: (name: string) => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function friendlyError(code: string): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address doesn’t look right. Check for typos.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact support.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Wrong email or password. Try again.';
    case 'auth/email-already-in-use':
      return 'An account with that email already exists. Try signing in.';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return 'Password must be at least 6 characters.';
    case 'auth/missing-email':
      return 'Enter your email address first.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection.';
    default:
      return 'Something went wrong. Try again.';
  }
}

function toFriendly(err: unknown): Error {
  return new Error(friendlyError((err as { code?: string })?.code ?? ''));
}

function firstNameOf(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first || null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);
  // Name typed on the sign-up form. onAuthStateChanged fires inside
  // createUserWithEmailAndPassword, before we can attach the name to the account,
  // so the profile effect reads it from here. One writer avoids a create race.
  const pendingName = useRef<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Profile: create on first sign-in, then keep it live. Firestore problems must
  // never block the app — the account works without the profile document.
  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    const displayName = pendingName.current ?? user.displayName;
    pendingName.current = null;
    ensureUserProfile(user, {
      displayName,
      nearbyRadiusKm: getNearbyRadius(),
      alertPreferences: getAlertPreferences(),
    })
      .catch((err) => console.warn('Could not create user profile', err))
      .finally(() => {
        if (cancelled) return;
        unsubscribe = watchUserProfile(
          user.uid,
          (p) => {
            setProfile(p);
            if (p?.settings?.nearby_radius_km !== undefined) {
              applyRemoteNearbyRadius(p.settings.nearby_radius_km);
            }
            if (p?.settings?.alert_preferences !== undefined) {
              applyRemoteAlertPreferences(p.settings.alert_preferences);
            }
          },
          (err) => console.warn('Could not load user profile', err),
        );
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [user]);

  // Mirror radius and alert-preference changes made on this device to the profile.
  useEffect(() => {
    if (!user) return;
    setNearbyRadiusRemoteSink((next) => {
      updateUserSettings(user.uid, { nearby_radius_km: next }).catch((err) =>
        console.warn('Could not save radius', err),
      );
    });
    setAlertPreferencesRemoteSink((next) => {
      updateUserSettings(user.uid, { alert_preferences: next }).catch((err) =>
        console.warn('Could not save alert preferences', err),
      );
    });
    return () => {
      setNearbyRadiusRemoteSink(null);
      setAlertPreferencesRemoteSink(null);
    };
  }, [user]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!auth) throw new Error('Authentication is not configured.');
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      throw toFriendly(err);
    }
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    if (!auth) throw new Error('Authentication is not configured.');
    const displayName = name.trim() || null;
    pendingName.current = displayName;
    let created: User;
    try {
      ({ user: created } = await createUserWithEmailAndPassword(auth, email, password));
    } catch (err) {
      pendingName.current = null;
      throw toFriendly(err);
    }
    // The Firestore profile (which the greeting reads) gets the name from
    // pendingName. Also store it on the Auth account; if that fails, the account
    // still works and the name can be set again in Settings.
    if (displayName) {
      updateProfile(created, { displayName }).catch((err) =>
        console.warn('Could not save name on the account', err),
      );
    }
  }, []);

  const googleSignIn = useCallback(async () => {
    if (!auth) throw new Error('Authentication is not configured.');
    // A new Google user gets their profile (and Google display name) from the
    // profile effect, same as an email sign-up.
    return signInWithGoogle(auth);
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    if (!auth) throw new Error('Authentication is not configured.');
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (err) {
      throw toFriendly(err);
    }
  }, []);

  const updateName = useCallback(async (name: string) => {
    const current = auth?.currentUser;
    if (!current) throw new Error('You’re not signed in.');
    const displayName = name.trim();
    // The greeting reads the Firestore profile, so the change shows up through its listener.
    await updateProfile(current, { displayName: displayName || null });
    await updateStoredDisplayName(current.uid, displayName);
  }, []);

  const signOutFn = useCallback(async () => {
    if (!auth) return;
    await firebaseSignOut(auth);
    await signOutOfGoogle();
  }, []);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (!auth?.currentUser) return null;
    return auth.currentUser.getIdToken();
  }, []);

  const firstName = firstNameOf(profile?.display_name ?? user?.displayName);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      firstName,
      loading,
      isConfigured: isFirebaseConfigured,
      signIn,
      signUp,
      googleAvailable: isGoogleSignInAvailable,
      signInWithGoogle: googleSignIn,
      sendPasswordReset,
      updateName,
      signOut: signOutFn,
      getIdToken,
    }),
    [user, profile, firstName, loading, signIn, signUp, googleSignIn, sendPasswordReset, updateName, signOutFn, getIdToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return ctx;
}
