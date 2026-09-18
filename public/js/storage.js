// Persists the guess state in the browser (localStorage), one entry per basho.
const PREFIX = 'banzuke-guesser:';

export function loadGuesses(bashoId) {
  try {
    const raw = localStorage.getItem(PREFIX + bashoId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // private mode, blocked storage, or corrupt JSON
  }
}

export function saveGuesses(bashoId, snapshot) {
  try {
    localStorage.setItem(PREFIX + bashoId, JSON.stringify(snapshot));
  } catch {
    // Storage unavailable: the app still works, it just won't persist.
  }
}

// Anonymous identity for submissions: a random id generated once per browser. Without storage
// a fresh one is generated per page load, so the server would see a new user each time.
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

// The last successful submission for a round (the basho being predicted): { shikona, placements,
// submitted_at }. Lets the page say "Submitted" vs "Resubmit Guess" after a reload.
const submissionKey = (roundId) => `${PREFIX}submission:${roundId}`;

export function loadSubmission(roundId) {
  try {
    const raw = localStorage.getItem(submissionKey(roundId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSubmission(roundId, submission) {
  try {
    localStorage.setItem(submissionKey(roundId), JSON.stringify(submission));
  } catch {
    // Storage unavailable: the button state just won't survive a reload.
  }
}
