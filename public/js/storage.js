// Persists the guess state in the browser (localStorage), one entry per basho, plus the browser
// token, the registered profile and the last submission.
const PREFIX = 'banzuke-guesser:';

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // private mode, blocked storage, or corrupt JSON
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the app still works, it just won't persist.
  }
}

export const loadGuesses = (bashoId) => read(PREFIX + bashoId);
export const saveGuesses = (bashoId, snapshot) => write(PREFIX + bashoId, snapshot);

// Anonymous identity: a random id generated once per browser, sent with every API call (also
// when signed in, so the server can fold what this browser did anonymously into the account).
// Without storage a fresh one is generated per page load, so the server would see a new user
// each time.
const TOKEN_KEY = PREFIX + 'token';
let sessionToken = null;

export function getToken() {
  try {
    let t = localStorage.getItem(TOKEN_KEY);
    if (!t) {
      t = crypto.randomUUID();
      localStorage.setItem(TOKEN_KEY, t);
    }
    return t;
  } catch {
    sessionToken ||= crypto.randomUUID();
    return sessionToken;
  }
}

// The registered profile as /api/me last answered it ({ shikona, signed_in, provider }), so the
// Register button can show the shikona before the API has been asked again.
const PROFILE_KEY = PREFIX + 'profile';
export const loadProfile = () => read(PROFILE_KEY);
export const saveProfile = (profile) => write(PROFILE_KEY, profile);

// Whether a Firebase session may exist in this browser: set at sign-in, cleared at sign-out, so
// the page knows to load the Firebase SDK (auth.js) before asking the API who the user is.
const SIGNED_IN_KEY = PREFIX + 'signed-in';
export const wasSignedIn = () => read(SIGNED_IN_KEY) === true;
export const setSignedIn = (yes) => write(SIGNED_IN_KEY, yes || null);

// The last known submission for a round (the basho being predicted): { shikona, placements,
// submitted_at }, or null once the server says there is none. Lets the page say "Saved" vs
// "Save Guess" after a reload.
const submissionKey = (roundId) => `${PREFIX}submission:${roundId}`;
export const loadSubmission = (roundId) => read(submissionKey(roundId));
export const saveSubmission = (roundId, submission) => write(submissionKey(roundId), submission);
