# Banzuke Guesser

A helper for the "Guess the Banzuke" game: the most recent Grand Sumo tournament's
Makuuchi and Juryo banzuke (with each rikishi's result) is shown on the left, and you
drag each rikishi into the slot you think they'll occupy on the next banzuke on the right.
The app fills in current rank, result and the rank change (`+0.5`, `-4.5`, `↑K`, `↓J`)
for you. Several rikishi can share a slot while you resolve conflicts.
 
Finished predictions can be submitted to the app itself under a registered shikona — optionally
tied to a Google or email sign-in so it follows you across devices; once the real banzuke is
announced the *Results* page scores every submission against it and shows a leaderboard
(see *Registering and submitting a guess* and *Scoring*).

Live site: deployed on Cloudflare Workers from this repository (see *Deployment*).

## How it works

```
sumo.or.jp ──┐
             ├─► scraper (Python, GitHub Actions nightly) ──► public/data/*.json ──► Cloudflare Worker
sumo-api.com ┘                                                                        (static assets)
                                                    browser ──► /api/* (worker.js) ──► D1 (users, submissions)
                                                       └──► Firebase Auth (optional sign-in; the Worker verifies its ID tokens)
```

- `public/` — the site. Plain HTML/CSS/ES modules, no build step.
  - `js/rank.js` — rank model and rank-change calculation.
  - `js/promote.js` — "Apply Ideal Rank Changes": a first-pass placement of every unplaced rikishi by net
    score and by the rank-change indicators.
  - `js/state.js` — guess state (rikishi → slot), guess-table rows.
  - `js/banzuke.js` — renders the previous and guess banzuke tables.
  - `js/dnd.js` — HTML5 drag-and-drop plus a tap-to-select fallback for touch devices.
  - `js/storage.js` — saves the guess in `localStorage` (one entry per basho) so it survives a reload,
    plus the browser token, the registered profile and the last submission.
  - `js/register.js` — the Register button and popover: shikona, Google / email sign-in.
  - `js/auth.js` — the identity sent to the API (browser token + Firebase ID token when signed in);
    loads the Firebase SDK lazily. `js/firebase-config.js` holds the project's web config.
  - `js/submit.js` — the Save Guess button: validation and the API call.
  - `js/score.js` — scores a prediction against the announced banzuke and ranks the leaderboard.
  - `js/results.js` — the Results page; `js/rounds.js` names the rounds the Past Banzuke box lists.
  - `js/profile.js` — the rikishi profile popup (photo, fact sheet, tournament history), opened by
    double-clicking a name.
  - `data/` — generated JSON: `schedule.json`, `index.json`, `basho/YYYYMM.json` (results),
    `banzuke/YYYYMM.json` (the announced banzuke predictions are scored against),
    `profiles/{rikishi_id}.json` (one per rikishi, for the profile popup), `live.json` (the tournament
    under way, see *Next Banzuke mode*), plus optional
    hand-edited `overrides/YYYYMM.json` (see *Special Statuses*).
- `worker.js` + `functions/api/` — the Cloudflare Worker: `/api/register`, `/api/me`, `/api/submit`
  and `/api/submissions` keep users and submissions in a D1 database (`functions/firebase.js`
  verifies Firebase ID tokens); `/__/auth/*` is proxied to Firebase for the sign-in popup; every
  other path is served from `public/` as static assets (see *Submissions backend*).
- `scraper/` — Python package that produces `public/data`.
  - `schedule.py` — parses the [tournament schedule](https://www.sumo.or.jp/EnTicket/year_schedule/).
  - `official.py` — banzuke + results from the [sumo.or.jp](https://www.sumo.or.jp/EnHonbashoBanzuke/index/)
    JSON endpoints (the site only exposes the *current* basho).
  - `sumoapi.py` — fallback/bootstrap from [sumo-api.com](https://sumo-api.com/), which has full history.
  - `annotate.py` — the special-status flags, computed from the previous two basho (see *Special Statuses*).
  - `profiles.py` — one `data/profiles/{rikishi_id}.json` per rikishi for the profile popup: the
    sumo.or.jp English profile page (photo, fact sheet, signature maneuvers, tournament records)
    enriched with sumo-api.com birthplace and a hand-curated wrestling style (`style_overlay.json`,
    keyed by sumo.or.jp id; anyone uncurated falls back to a guess from their signature maneuvers).
    Refreshed automatically whenever a basho's results are written.
  - `cli.py` — `update` (nightly), `bootstrap --basho YYYYMM`, `annotate --basho YYYYMM`,
    `banzuke --basho YYYYMM`, `profiles --basho YYYYMM`, `live`, `schedule`.
- `.github/workflows/update-data.yml` — runs `scraper.cli update` at 00:10 and 12:10 JST.
  It refreshes the schedule; if a tournament finished the day before and its data is not yet in
  the repo, fetches it (sumo.or.jp first, sumo-api.com if the official site has already moved on);
  and if a banzuke has been announced (mid-morning JST, hence the noon run) and `data/banzuke/`
  lacks it, fetches that; and from a banzuke announcement to that tournament's final day, refreshes
  `data/live.json` with the records so far. Changes are committed; the push triggers a Cloudflare deploy.

## Local development

```sh
pip install -e ".[dev]"
python -m pytest                      # scraper tests
for t in tests/js/*.test.mjs; do node "$t"; done   # frontend tests
python -m http.server 8000 -d public  # then open http://localhost:8000
```

Fetch data manually:

```sh
python -m scraper.cli update                      # what the nightly job runs
python -m scraper.cli bootstrap --basho 202607    # seed a specific basho from sumo-api.com
python -m scraper.cli update --force --source official   # re-fetch from sumo.or.jp only
python -m scraper.cli annotate --basho 202607     # recompute the indicators of an existing file
python -m scraper.cli banzuke --basho 202609      # fetch an announced banzuke into data/banzuke/
python -m scraper.cli profiles --basho 202607     # (re)build the rikishi profile pages for a basho
python -m scraper.cli live                        # refresh data/live.json (the tournament under way)
```

To run the submission API locally as well (Node 22+):

```sh
npx wrangler d1 execute banzuke-guesser --local --file functions/schema.sql   # once
npx wrangler dev                                                               # site + /api on :8787
```

## Special Statuses

Each rikishi in `basho/YYYYMM.json` carries flags that the banzuke committee weighs but the score
system does not, shown as badges on the chip (the Legend box lists them):

| field | badge | meaning |
|---|---|---|
| `yusho` | 🏆 | tournament winner (Makuuchi and Juryo) |
| `kadoban` | KB | kadoban Ozeki: a losing record this tournament results in demotion |
| `tsunatori` | →Y | Yokozuna run: a yusho or jun-yusho (tie with the champion) as Ozeki last basho; a yusho this tournament completes it, and so does a jun-yusho — unless last basho was *also* only a jun-yusho, since two ties in a row don't count (`tsunatori_needs_yusho`) |
| `ozeki_run` | →O *n* | Sekiwake who was Sekiwake/Komusubi in both previous basho with ≥ 18 wins there; *n* = 33 − those wins, the target for promotion |
| `ozeki_return` | ↪O 10 | Sekiwake demoted from Ozeki due to injury; 10 wins regain the rank |
| `suspended` | SUS | disciplinary suspension; ranked as a full absence (the full demotion applies, unlike `retired`) |
| `retired` | Retired | announced retirement |

Two badges need no flag, since they are decided by rank and this basho's result alone: a Komusubi
with 11+ wins (`→S 11`) forces the JSA to open an extra Sekiwake slot regardless of vacancies, and
an M1 with 8+ wins or an M2 with 10+ wins (`→K n`) forces one open for Komusubi the same way.
Unlike the flag-driven badges above, they only appear once met — there is no "still on a run" state
to show beforehand.

`scraper/annotate.py` computes the flags above when a basho is saved, from the previous basho files in
`public/data` or, when missing, from sumo-api.com (also the source of the yusho). It runs again
with `annotate --basho YYYYMM`, e.g. if the nightly fetch ran before sumo-api.com recorded the yusho.
A rikishi is followed across basho by `rikishi_id` (the sumo.or.jp id; sumo-api.com's `nskId`), so
a shikona change between two tournaments — usual on Ozeki promotion — does not lose their history;
`key` (from the shikona) only identifies them *within* one basho file.

Some of this is announced rather than derivable (a retirement after the data was fetched, a
suspension, a Yokozuna run the committee did or did not declare). Put corrections in
`public/data/overrides/YYYYMM.json`, merged into the rikishi by the frontend at load time:

```json
{ "hoshoryu": { "retired": true }, "kirishima": { "tsunatori": false }, "abi": { "suspended": true } }
```

## Registering and submitting a guess

**Register** opens a popover asking for a shikona; once saved, the button shows it, and clicking it
again lets the user rename or change their sign-in. A shikona belongs to one user across every
round (*Shikona taken*), and renaming frees the old one (and renames past submissions). The popover
also offers, optionally, **Sign in with Google** and an email/password form (sign in, create
account, forgot password): signing in ties the shikona and the predictions to the account, so they
are the same on every device and survive a cleared browser.

Without a sign-in, users are told apart by a random token kept in the browser's `localStorage`
(not by IP address, so two people behind one router can both play; the flip side is that a new
browser or cleared storage counts as a new user). Signing in folds that browser's anonymous
identity into the account: its registration moves over unless the account already has a shikona
(the account's wins), and so do its submissions, except for rounds the account already submitted.
Signing out returns the browser to its (now empty) anonymous identity.

**Save Guess** (next to *Submit Guess to GTB*, whose drop-down has the Fill GTB Form bookmarklet and a link to sumodb's game) saves the
Makuuchi half of the prediction in this app. It first checks, in this order, that the Makuuchi
headcount is right (rikishi in numbered Makuuchi slots or left in the ↑S/↑K candidates rows; the
Maegashira candidates row is outside Makuuchi, so rikishi may be left there; otherwise
*Not enough rikishi!* / *Too many rikishi!*), that no slot holds two rikishi (*Multiple at M3E*,
*Unplaced at ↑K* for a Sekiwake/Komusubi candidates row), and that there is no empty slot above a filled one of the
same rank type (*Gap at M7W*); then that the user is registered (*Register first*, opening the
popover). A message stays on the (disabled) button until the prediction changes. Then it posts to
`/api/submit`; the button reads *Saved* and a note says when to come back (the announcement
date), turning into *Save Guess* as soon as the prediction changes again. One submission per
user per tournament. Submissions close on the announcement day (*Submissions closed until <date>*,
the day after that tournament ends, when the next round opens).

## Next Banzuke mode

From a banzuke announcement until the day after that tournament ends, the round it closes can no
longer be saved. During that time a bar above the two banzuke says so ("Submissions are closed until
<date> when the <tournament> tournament is finished") and switches the Prediction page between:

- **Current Banzuke** — as usual: the announced tournament's banzuke predicted from the latest
  results file. Save Guess stays closed.
- **Next Banzuke** — the tournament under way on the left (`data/live.json`: its banzuke with the
  records so far, blank before day 1) and the banzuke of the tournament *after* it on the right.
  Save Guess is open for that later round. Apply Ideal Rank Changes is off, since the records
  aren't final yet; clicking it says so. Special-status badges stay neutral until a target is
  settled, either reached or out of reach even by winning every remaining bout, and →Y stays neutral
  throughout, because the yusho isn't known until the end.

The choice is remembered per browser. The guess is stored under the tournament under way, which is the
same key its results file uses once it finishes, so a Next Banzuke prediction carries over into the
regular round when it opens. The scraper writes `live.json` on every run between the announcement and
the final day (annotated like a results file, minus the yusho and jun-yusho), refreshes the profile
pages the first time a tournament's file is written (for new Juryo promotees), and removes the file
once that tournament's results file exists.

## Scoring

The *Results* page (the Pages box switches between *Predict* and *Results*; Results is the default
from the day after the announcement until the tournament ends, but only for a user who submitted a
prediction) shows the submitted prediction next to the announced banzuke, correct slots in blue
and wrong ones in red, plus the score, community placement, the leaderboard, and any other user's
prediction on click. Its sidebar swaps Tools and Legend for a *Past Banzuke* box: a year and a
tournament select over every round the app has data for (one results file each), or a welcome
note while there is only the first.

A prediction earns 1 point per rikishi in the right slot and 1 point per correct neighbour pairing:
two rikishi that follow each other on the real banzuke (Y1E, Y1W, O1E, … order) and also follow
each other, in that order, in the prediction. This rewards getting the order right even when one
wrong placement shifts a whole group by a slot: for the real order ABCD, DABC scores 2 (no slots,
but AB and BC are paired), ABDC 3 (A and B placed, AB paired), DACB 1 (only C placed) and ABCD
itself 4 + 3 = 7. A full Makuuchi tops out at 42 + 41 = 83. Ties share a position (`T-3`).
The leaderboard also shows each prediction's *GTB Score*, by Guess the Banzuke's rules: 2 points
for a rikishi on the right rank and side, 1 for the right rank on the other side (sanyaku ranks
numbered, so S2E is not S1E), up to 84. Its *Total Score* and *GTB Score* headers sort the table;
by GTB, ties go to the most right-rank guesses (GTB's first tiebreaker; its later ones, points
counted up from the bottom of the banzuke, are not applied).
Rikishi are matched by `rikishi_id`, so a shikona change between the two banzuke does not cost
points. Scoring runs in the browser (`public/js/score.js`) over `data/banzuke/YYYYMM.json` and the
submissions the API returns — which it only does once that file exists, so nobody can read the
others' guesses before the announcement.

## Submissions backend (Cloudflare D1)

`worker.js` dispatches `/api/*` to the handlers in `functions/api/` and everything else to the
assets; `wrangler.toml` declares the assets directory and the `DB` binding. One-time setup:

1. `npx wrangler d1 create banzuke-guesser` and paste the returned `database_id` into `wrangler.toml`.
2. `npx wrangler d1 execute banzuke-guesser --remote --file functions/schema.sql` (a database from
   before the `users` table: `--file functions/migrate-users.sql` instead, once — it registers every
   token that has submitted under its latest shikona and drops the per-round shikona constraint).

Every endpoint identifies the caller by the `X-Guesser-Token` header (the browser token) and/or
`Authorization: Bearer <Firebase ID token>` (→ `401 bad_auth` if it does not verify); rows are keyed
by the token or by `fb:<uid>`. A request carrying both first folds the token's identity into the
account (see *Registering and submitting a guess*).

- `POST /api/register` `{shikona?, basho?}` — registers or renames (→ `409 shikona_taken`,
  `400 bad_shikona`); without `shikona` just answers with the profile. Both return
  `{shikona, signed_in, provider, submission}`, `submission` being the caller's prediction for `basho`.
- `GET /api/me?basho=YYYYMM` — the same profile.
- `POST /api/submit` `{basho, placements}` (→ `403 not_registered`, `403 closed`, `400` on a
  malformed guess).
- `GET /api/submissions?basho=YYYYMM` (→ `{published, count, me, submissions?}`).

### Firebase sign-in

Sign-in is optional and off until `public/js/firebase-config.js` is filled in. One-time setup:

1. [Firebase console](https://console.firebase.google.com/): create a project (no Analytics needed),
   add a **Web app** and copy its `apiKey`, `projectId` and `appId` into `firebase-config.js`.
   Keep `authDomain` as the site's own domain (`sumo.ranker.page`).
2. **Authentication → Sign-in method**: enable **Google** and **Email/Password**. Other providers
   (Apple, GitHub, Microsoft…) are a toggle here plus a method in `auth.js` and a button.
3. **Authentication → Settings → Authorized domains**: add `sumo.ranker.page` (and `localhost`
   for `wrangler dev`).
4. Because `authDomain` is the site itself, the Worker proxies `/__/auth/*` to
   `<projectId>.firebaseapp.com`, which keeps the Google popup working in browsers that block
   third-party storage. For that, in [Google Cloud console](https://console.cloud.google.com/apis/credentials)
   → the project's *Web client (auto created by Google Service)* OAuth client, add
   `https://sumo.ranker.page/__/auth/handler` to **Authorized redirect URIs**
   (Firebase's [redirect best practices](https://firebase.google.com/docs/auth/web/redirect-best-practices), option 3).

No secret is involved: the Worker verifies ID tokens against Google's public keys
(`functions/firebase.js`), and the web config only names the project.

## Deployment (Cloudflare Workers)

One-time setup in the Cloudflare dashboard: **Workers & Pages → Create → Workers → Import a
repository**, pick this repository, then:

- Production branch: `main`
- Build command: *(leave empty)*
- Deploy command: `npx wrangler deploy` (the default)

Every push to `main` (including the nightly data commit) redeploys. `public/_headers` sets a
5-minute cache on `/data/*` so fresh results show up shortly after a deploy.

Note: GitHub disables scheduled workflows after 60 days without repository activity; the bot's
own commits after each tournament count as activity, so this should not trigger in practice.
If it does, re-enable the workflow from the Actions tab.

## Tools

- **Apply Ideal Rank Changes** places every rikishi you have not placed yet (placed ones are left
  alone) by their net score, one rank number per point with East/West as half steps, so a 9-6 at
  M5E lands on M2E. Absences count as losses. Demotions chain into the next rank type down the
  same way the Rank Change column counts them. Anyone whose score would carry them up into a higher
  rank type is put in a temporary "↑" candidates row just below that type, for you to sort into
  the open slots; the row disappears once its last occupant is moved out. The right half of the
  Maegashira/Juryo candidates row (red) holds Makuuchi rikishi whose score would drop them into
  Juryo. Sekiwake who would mathematically reach Ozeki are capped at S1E. Yokozuna and Ozeki are only
  re-ordered within their rank by wins (previous order breaks ties). Retired rikishi are left unplaced.
  The indicators override the score at the top: a `↪O 10` Sekiwake with 10+ wins, then a `→O n`
  Sekiwake with n+ wins, go to the next open Ozeki slot below the sitting Ozeki; a `→Y` Ozeki with the
  yusho goes to the next open Yokozuna slot; a `KB` Ozeki with fewer than 8 wins goes to the first
  Sekiwake slot the score placements left open; a Komusubi with 11+ wins (`→S 11`) goes to the next
  open Sekiwake slot too, forcing one if none is open, rather than sitting in the candidates row like
  a lesser Komusubi score; an M1 with 8+ wins or an M2 with 10+ wins (`→K n`) does the same one rank
  down, forcing a Komusubi slot instead of sitting in the Komusubi candidates row. A rank without an
  open slot gets a row added (up to 3).
- **Reset** clears every guess.

## Roadmap

- Links to each rikishi's profile / tournament history (`profile_url` is already in the data).
- A model that produces its own prediction.
- Makushita promotees in the data, so the bottom of Juryo can be predicted too.
