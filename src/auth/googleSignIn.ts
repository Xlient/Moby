import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, signInWithCredential, type Auth } from 'firebase/auth';
import { env } from '@/config/env';

// Native (Android/iOS): the Google account picker returns an ID token issued for
// our OAuth *web* client, which Firebase Auth exchanges for a Firebase session.
// The web variant lives in googleSignIn.web.ts.

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  GoogleSignin.configure({ webClientId: env.googleWebClientId });
  configured = true;
}

export const isGoogleSignInAvailable = !!env.googleWebClientId;

/** Resolves false when the user closes the picker. Throws a friendly Error otherwise. */
export async function signInWithGoogle(auth: Auth): Promise<boolean> {
  ensureConfigured();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return false; // cancelled
    const idToken = response.data.idToken;
    if (!idToken) throw new Error('Google didn’t return a sign-in token. Try again.');
    await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    return true;
  } catch (err) {
    throw new Error(friendlyGoogleError(err));
  }
}

/** Clears the cached Google account so the picker shows next time. */
export async function signOutOfGoogle(): Promise<void> {
  if (!configured) return;
  try {
    await GoogleSignin.signOut();
  } catch {
    // Not signed in with Google — nothing to clear.
  }
}

function friendlyGoogleError(err: unknown): string {
  if (err instanceof Error && !isErrorWithCode(err) && err.message.startsWith('Google')) {
    return err.message;
  }
  if (isErrorWithCode(err)) {
    switch (err.code) {
      case statusCodes.IN_PROGRESS:
        return 'Google sign-in is already open.';
      case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
        return 'Google Play services is missing or out of date on this device.';
      case '10': // DEVELOPER_ERROR: SHA-1 / package / web client ID mismatch.
        console.warn(
          'Google Sign-In DEVELOPER_ERROR: register this build’s SHA-1 for com.xlient.moby in ' +
            'Firebase and check EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.',
        );
        return 'Google sign-in isn’t set up for this version of the app yet.';
      case 'auth/account-exists-with-different-credential':
        return 'This email already has an account. Sign in with your password instead.';
      case 'auth/network-request-failed':
        return 'Network error. Check your connection.';
    }
  }
  console.warn('Google sign-in failed', err);
  return 'Google sign-in didn’t work. Try again, or use email and password.';
}
