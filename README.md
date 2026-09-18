# Banzuke Guesser

A helper for the "Guess the Banzuke" game: the most recent Grand Sumo tournament's
Makuuchi and Juryo banzuke (with each rikishi's result) is shown on the left, and you
drag each rikishi into the slot you think they'll occupy on the next banzuke on the right.
The app fills in current rank, result and the rank change (`+0.5`, `-4.5`, `↑K`, `↓J`)
for you. Several rikishi can share a slot while you resolve conflicts.

Finished predictions can be submitted to the app itself under a shikona; once the real banzuke is
announced the *Results* page scores every submission against it and shows a leaderboard
(see *Submitting a guess* and *Scoring*).

Live site: deployed on Cloudflare Pages from this repository (see *Deployment*).

## How it works

```
sumo.or.jp ──┐
             ├─► scraper (Python, GitHub Actions nightly) ──► public/data/*.json ──► Cloudflare Pages
sumo-api.com ┘                                                                        (static site)
                                                    browser ──► /api/* (Pages Functions) ──► D1 (submissions)
```

- `public/` — the site. Plain HTML/CSS/ES modules, no build step.
  - `js/rank.js` — rank model and rank-change calculation.
  - `js/promote.js` — "Apply Ideal Rank Changes": a first-pass placement of every unplaced rikishi by net
    score and by the rank-change indicators.
  - `js/state.js` — guess state (rikishi → slot), guess-table rows.
  - `js/banzuke.js` — renders the previous and guess banzuke tables.
  - `js/dnd.js` — HTML5 drag-and-drop plus a tap-to-select fallback for touch devices.
  - `js/storage.js` — saves the guess in `localStorage` (one entry per basho) so it survives a reload,
    plus the browser token and the last submission.
  - `js/submit.js` — the Submit Guess button: validation, the shikona popover, the API call.
  - `js/score.js` — scores a prediction against the announced banzuke and ranks the leaderboard.
  - `js/results.js` — the Results page.
  - `data/` — generated JSON: `schedule.json`, `index.json`, `basho/YYYYMM.json` (results),
    `banzuke/YYYYMM.json` (the announced banzuke predictions are scored against), plus optional
    hand-edited `overrides/YYYYMM.json` (see *Special Statuses*).
- `functions/` — Cloudflare Pages Functions behind `/api/submit` and `/api/submissions`, storing
  submissions in a D1 database (see *Submissions backend*).
- `scraper/` — Python package that produces `public/data`.
  - `schedule.py` — parses the [tournament schedule](https://www.sumo.or.jp/EnTicket/year_schedule/).
  - `official.py` — banzuke + results from the [sumo.or.jp](https://www.sumo.or.jp/EnHonbashoBanzuke/index/)
    JSON endpoints (the site only exposes the *current* basho).
  - `sumoapi.py` — fallback/bootstrap from [sumo-api.com](https://sumo-api.com/), which has full history.
  - `annotate.py` — the special-status flags, computed from the previous two basho (see *Special Statuses*).
  - `cli.py` — `update` (nightly), `bootstrap --basho YYYYMM`, `annotate --basho YYYYMM`,
    `banzuke --basho YYYYMM`, `schedule`.
- `.github/workflows/update-data.yml` — runs `scraper.cli update` at 00:10 and 12:10 JST.
  It refreshes the schedule; if a tournament finished the day before and its data is not yet in
  the repo, fetches it (sumo.or.jp first, sumo-api.com if the official site has already moved on);
  and if a banzuke has been announced (mid-morning JST, hence the noon run) and `data/banzuke/`
  lacks it, fetches that. Changes are committed; the push triggers a Cloudflare Pages deploy.

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
```

To run the submission API locally as well (Node 20+):

```sh
npx wrangler d1 execute banzuke-guesser --local --file functions/schema.sql   # once
npx wrangler pages dev public                                                  # site + /api on :8788
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

## Submitting a guess

**Submit Guess** (next to the *Submit Guess to GTB* link, which still opens sumodb's game) saves the
Makuuchi half of the prediction in this app. It first checks, in this order, that the Makuuchi
headcount is right (rikishi in numbered Makuuchi slots or left in a ↑ candidates row; otherwise
*Not enough rikishi!* / *Too many rikishi!*), that no slot holds two rikishi (*Multiple at M3E*,
*Unplaced at ↑K* for a candidates row), and that there is no empty slot above a filled one of the
same rank type (*Gap at M7W*). A message stays on the (disabled) button until the prediction
changes. Then it asks for a shikona and posts to `/api/submit`; the button reads *Submitted* and a
note says when to come back (the announcement date), turning into *Resubmit Guess* as soon as the
prediction changes again. Submissions close on the announcement day.

Users are told apart by a random token kept in the browser's `localStorage` (not by IP address, so
two people behind one router can both play; the flip side is that a new browser or cleared storage
counts as a new user). One submission per token per tournament; a shikona belongs to one token per
tournament (*Shikona taken*), and changing your shikona frees the old one.

## Scoring

The *Results* page (the Pages box switches between *Predict* and *Results*; Results is the default
from the day after the announcement until the tournament ends) shows the submitted prediction next
to the announced banzuke, correct slots in blue and wrong ones in red, plus the score, community
placement, the leaderboard, and any other user's prediction on click.

A prediction earns 1 point per rikishi in the right slot and 1 point per correct neighbour pairing:
two rikishi that follow each other on the real banzuke (Y1E, Y1W, O1E, … order) and also follow
each other, in that order, in the prediction. This rewards getting the order right even when one
wrong placement shifts a whole group by a slot: for the real order ABCD, DABC scores 2 (no slots,
but AB and BC are paired), ABDC 3 (A and B placed, AB paired), DACB 1 (only C placed) and ABCD
itself 4 + 3 = 7. A full Makuuchi tops out at 42 + 41 = 83. Ties share a position (`T-3`).
Rikishi are matched by `rikishi_id`, so a shikona change between the two banzuke does not cost
points. Scoring runs in the browser (`public/js/score.js`) over `data/banzuke/YYYYMM.json` and the
submissions the API returns — which it only does once that file exists, so nobody can read the
others' guesses before the announcement.

## Submissions backend (Cloudflare D1)

`functions/` is deployed automatically with the site (Pages Functions need no build step). One-time
setup:

1. `npx wrangler d1 create banzuke-guesser` and paste the returned `database_id` into `wrangler.toml`.
2. `npx wrangler d1 execute banzuke-guesser --remote --file functions/schema.sql`.
3. In the Pages project, **Settings → Bindings → D1 database**: bind `DB` to that database (Pages
   also reads `wrangler.toml`, but the dashboard binding is the reliable one for Git deploys).

Endpoints: `POST /api/submit` `{basho, shikona, placements}` with header `X-Guesser-Token`
(→ `409 shikona_taken`, `403 closed`, `400` on a malformed guess), and
`GET /api/submissions?basho=YYYYMM` (→ `{published, count, me, submissions?}`).

## Deployment (Cloudflare Pages)

One-time setup in the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**,
pick this repository, then:

- Production branch: `main`
- Build command: *(leave empty)*
- Build output directory: `public`

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
