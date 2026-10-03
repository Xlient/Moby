import { GoogleAuthProvider, signInWithPopup, type Auth } from 'firebase/auth';

// Web: Firebase's own popup flow. Needs the site's domain listed under
// Authentication → Settings → Authorized domains.

export const isGoogleSignInAvailable = true;

export async function signInWithGoogle(auth: Auth): Promise<boolean> {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    return true;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return false;
    if (code === 'auth/account-exists-with-different-credential') {
      throw new Error('This email already has an account. Sign in with your password instead.');
    }
    throw new Error('Google sign-in didn’t work. Try again, or use email and password.');
  }
}

export async function signOutOfGoogle(): Promise<void> {
  // Nothing cached outside Firebase on web.
}
