// The Firebase web app config: Firebase console → Project settings → Your apps → Web app. These
// values identify the project rather than secure it (they are public by design), so they live in
// the site; worker.js imports this file too, for the project id the ID tokens are verified against.
// Leave apiKey empty to disable sign-in: registration then only uses the browser token.

// authDomain is this site's own domain rather than <projectId>.firebaseapp.com: worker.js proxies
// /__/auth/* to Firebase so the Google sign-in popup/redirect also works in browsers that block
// third-party storage (see "Firebase sign-in" in the README for the setup).
export const firebaseConfig = {
  apiKey: 'AIzaSyAlTBb9RUWaleC4RpM6_BinHlEgl22nxKg',
  authDomain: 'sumo.ranker.page',
  projectId: 'banzuke-guesser',
  appId: '1:870632454640:web:ea13d0c451610bb95d4535',
  storageBucket: "banzuke-guesser.firebasestorage.app",
  messagingSenderId: "870632454640",
  measurementId: "G-LGSMT2FRM8"
};
