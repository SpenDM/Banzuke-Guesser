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
