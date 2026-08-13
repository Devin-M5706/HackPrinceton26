/**
 * Firebase phone sign-in.
 *
 * The browser runs the OTP flow against Firebase directly, then exchanges the
 * resulting ID token with our backend for a CHW bearer token. Firebase is
 * loaded lazily so a visitor who never signs in does not download the SDK.
 *
 * When the build has no Firebase config, sign-in is reported as unavailable
 * rather than initialising with placeholder credentials and failing with an
 * opaque error at the last step.
 */

import { FIREBASE_CONFIG, FIREBASE_ENABLED, NAME_KEY } from './config.js';
import { setToken, signInWithFirebase } from './api.js';

let authPromise = null;
let recaptcha = null;
let confirmation = null;

async function getFirebaseAuth() {
  if (!FIREBASE_ENABLED) {
    throw new Error('Phone sign-in is not configured for this deployment.');
  }
  if (!authPromise) {
    authPromise = (async () => {
      const [{ initializeApp }, authModule] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
      ]);
      const app = initializeApp(FIREBASE_CONFIG);
      return { auth: authModule.getAuth(app), authModule };
    })();
  }
  return authPromise;
}

export { FIREBASE_ENABLED };

/**
 * Send an OTP to a phone number.
 * @param {string} phoneNumber E.164, e.g. +2276...
 * @param {string} recaptchaContainerId id of the element to anchor reCAPTCHA to
 */
export async function requestOtp(phoneNumber, recaptchaContainerId) {
  const { auth, authModule } = await getFirebaseAuth();

  if (!recaptcha) {
    recaptcha = new authModule.RecaptchaVerifier(auth, recaptchaContainerId, {
      size: 'invisible',
    });
  }

  try {
    confirmation = await authModule.signInWithPhoneNumber(auth, phoneNumber, recaptcha);
  } catch (error) {
    // A failed attempt leaves the verifier unusable; drop it so the next try
    // builds a fresh one instead of failing forever.
    try {
      recaptcha.clear();
    } catch {
      /* already torn down */
    }
    recaptcha = null;
    throw error;
  }
}

/**
 * Confirm the OTP and exchange it for a CHW session.
 * @param {string} code six-digit code
 * @returns {Promise<{name: string, region: string, role: string}>}
 */
export async function confirmOtp(code) {
  if (!confirmation) {
    throw new Error('Your code expired. Go back and request a new one.');
  }

  const credential = await confirmation.confirm(code);
  const idToken = await credential.user.getIdToken();

  const session = await signInWithFirebase(idToken);
  setToken(session.token);
  localStorage.setItem(NAME_KEY, session.name ?? 'CHW');

  // One-shot: a used confirmation must not be replayable.
  confirmation = null;

  return session;
}

/** True once an OTP has been sent and is awaiting confirmation. */
export function hasPendingConfirmation() {
  return confirmation !== null;
}

/** Discard any in-flight OTP, e.g. when the modal is closed. */
export function resetOtp() {
  confirmation = null;
}
