// Who the user is, for the API: the browser token (storage.js) always, plus a Firebase ID token
// once they have signed in (Google or email/password, through the Register popover). Firebase's
// SDK is loaded from the CDN only when a session may exist or the user opens the sign-in form,
// so anonymous visitors never download it.
import { firebaseConfig } from './firebase-config.js';
import { getToken, setSignedIn, wasSignedIn } from './storage.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';

/** Sign-in is available when firebase-config.js has been filled in. */
export const signInEnabled = !!firebaseConfig.apiKey;

/** Short messages for the Firebase error codes the popover's forms can hit; the code otherwise. */
const MESSAGES = {
  'auth/invalid-email': 'Enter a valid email address',
  'auth/missing-password': 'Enter a password',
  'auth/weak-password': 'Password must be at least 6 characters',
  'auth/email-already-in-use': 'An account with this email already exists',
  'auth/invalid-credential': 'Wrong email or password',
  'auth/wrong-password': 'Wrong email or password',
  'auth/user-not-found': 'Wrong email or password',
  'auth/user-disabled': 'This account is disabled',
  'auth/too-many-requests': 'Too many attempts, try again later',
  'auth/network-request-failed': 'Network error, try again',
  'auth/popup-blocked': 'The sign-in popup was blocked',
  'auth/account-exists-with-different-credential': 'This email is registered with another sign-in method',
};
export const authMessage = (e) => MESSAGES[e?.code] || (e?.code ? e.code.replace(/^auth\//, '').replace(/-/g, ' ') : 'Try again');
/** Errors that are not errors: the user closed the Google popup. */
export const cancelled = (e) => ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'].includes(e?.code);

/**
 * The Firebase session. `user` is the signed-in Firebase user or null; a 'change' event fires
 * whenever that flips (including the initial restore of a persisted session). `ready` resolves
 * once the persisted session, if any, has been restored — immediately when there is none to load.
 */
class Auth extends EventTarget {
  user = null;
  sdk = null;      // { auth, ...firebase-auth exports } once loaded
  loading = null;

  constructor() {
    super();
    // A session may exist: load the SDK now so the API sees the account from the first call.
    this.ready = signInEnabled && wasSignedIn() ? this.load().catch(() => {}) : Promise.resolve();
  }

  load() {
    this.loading ||= (async () => {
      const [{ initializeApp }, auth] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`)]);
      const app = initializeApp(firebaseConfig);
      this.sdk = { ...auth, auth: auth.getAuth(app) };
      await new Promise((resolve) => {
        auth.onAuthStateChanged(this.sdk.auth, (user) => {
          this.user = user;
          setSignedIn(!!user);
          resolve();
          this.dispatchEvent(new Event('change'));
        });
      });
      return this.sdk;
    })();
    return this.loading;
  }

  /** Request headers identifying the caller to the API. */
  async headers() {
    await this.ready;
    const h = { 'x-guesser-token': getToken() };
    if (this.user) h.authorization = `Bearer ${await this.user.getIdToken()}`;
    return h;
  }

  /** How the user signed in, for the popover: 'Google', 'email' … */
  get providerName() {
    const id = this.user?.providerData?.[0]?.providerId;
    return { 'google.com': 'Google', password: 'email' }[id] || id || null;
  }

  // Firebase notifies onAuthStateChanged observers asynchronously, so `user` is taken from
  // currentUser as soon as a sign-in resolves for the API call that follows it.
  sync() {
    this.user = this.sdk.auth.currentUser;
    setSignedIn(!!this.user);
  }

  async signInWithGoogle() {
    const { auth, GoogleAuthProvider, signInWithPopup } = await this.load();
    await signInWithPopup(auth, new GoogleAuthProvider());
    this.sync();
  }

  async signInWithEmail(email, password) {
    const { auth, signInWithEmailAndPassword } = await this.load();
    await signInWithEmailAndPassword(auth, email, password);
    this.sync();
  }

  async createAccount(email, password) {
    const { auth, createUserWithEmailAndPassword } = await this.load();
    await createUserWithEmailAndPassword(auth, email, password);
    this.sync();
  }

  async resetPassword(email) {
    const { auth, sendPasswordResetEmail } = await this.load();
    await sendPasswordResetEmail(auth, email);
  }

  async signOut() {
    if (!this.sdk) return;
    await this.sdk.signOut(this.sdk.auth);
    this.sync();
  }
}

export const auth = new Auth();

/** fetch() of an API path with the identity headers; JSON bodies are encoded. */
export async function api(path, { method = 'GET', body } = {}) {
  const headers = await auth.headers();
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(path, { method, headers, cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) });
}
