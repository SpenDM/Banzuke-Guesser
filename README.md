# Banzuke Guesser

A helper for the "Guess the Banzuke" game: the most recent Grand Sumo tournament's
Makuuchi and Juryo banzuke (with each rikishi's result) is shown on the left, and you
drag each rikishi into the slot you think they'll occupy on the next banzuke on the right.
The app fills in current rank, result and the rank change (`+0.5`, `-4.5`, `↑K`, `↓J`)
for you. Several rikishi can share a slot while you resolve conflicts.

Live site: deployed on Cloudflare Pages from this repository (see *Deployment*).

## How it works

```
sumo.or.jp ──┐
             ├─► scraper (Python, GitHub Actions nightly) ──► public/data/*.json ──► Cloudflare Pages
sumo-api.com ┘                                                                        (static site)
```

- `public/` — the site. Plain HTML/CSS/ES modules, no build step.
  - `js/rank.js` — rank model and rank-change calculation.
  - `js/promote.js` — "Apply Ideal Rank Changes": a first-pass placement of every unplaced rikishi by net
    score and by the rank-change indicators.
  - `js/state.js` — guess state (rikishi → slot), guess-table rows.
  - `js/banzuke.js` — renders the previous and guess banzuke tables.
  - `js/dnd.js` — HTML5 drag-and-drop plus a tap-to-select fallback for touch devices.
  - `js/storage.js` — saves the guess in `localStorage` (one entry per basho) so it survives a reload.
  - `data/` — generated JSON: `schedule.json`, `index.json`, `basho/YYYYMM.json`, plus optional
    hand-edited `overrides/YYYYMM.json` (see *Special Statuses*).
- `scraper/` — Python package that produces `public/data`.
  - `schedule.py` — parses the [tournament schedule](https://www.sumo.or.jp/EnTicket/year_schedule/).
  - `official.py` — banzuke + results from the [sumo.or.jp](https://www.sumo.or.jp/EnHonbashoBanzuke/index/)
    JSON endpoints (the site only exposes the *current* basho).
  - `sumoapi.py` — fallback/bootstrap from [sumo-api.com](https://sumo-api.com/), which has full history.
  - `annotate.py` — the special-status flags, computed from the previous two basho (see *Special Statuses*).
  - `cli.py` — `update` (nightly), `bootstrap --basho YYYYMM`, `annotate --basho YYYYMM`, `schedule`.
- `.github/workflows/update-data.yml` — runs `scraper.cli update` every night at 00:10 JST.
  It refreshes the schedule, and if a tournament finished the day before and its data is
  not yet in the repo, fetches it (sumo.or.jp first, sumo-api.com if the official site has
  already moved on) and commits it. The push triggers a Cloudflare Pages deploy.

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
```

## Special Statuses

Each rikishi in `basho/YYYYMM.json` carries flags that the banzuke committee weighs but the score
system does not, shown as badges on the chip (the Legend box lists them):

| field | badge | meaning |
|---|---|---|
| `yusho` | 🏆 | tournament winner (Makuuchi and Juryo) |
| `kadoban` | KB | kadoban Ozeki: a losing record this tournament results in demotion |
| `tsunatori` | →Y | Yokozuna run: tournament win or win-equivalent as Ozeki last basho; another this tournament yields eligibility for promotion |
| `ozeki_run` | →O *n* | Sekiwake who was Sekiwake/Komusubi in both previous basho with ≥ 18 wins there; *n* = 33 − those wins, the target for promotion |
| `ozeki_return` | ↩O 10 | Sekiwake demoted from Ozeki due to injury; 10 wins regain the rank |
| `retired` | Retired | announced retirement |

Two badges need no flag, since they are decided by rank and this basho's result alone: a Komusubi
with 11+ wins (`→S 11`) forces the JSA to open an extra Sekiwake slot regardless of vacancies, and
an M1 with 8+ wins or an M2 with 10+ wins (`→K n`) forces one open for Komusubi the same way.
Unlike the flag-driven badges above, they only appear once met — there is no "still on a run" state
to show beforehand.

`scraper/annotate.py` computes the flags above when a basho is saved, from the previous basho files in
`public/data` or, when missing, from sumo-api.com (also the source of the yusho). It runs again
with `annotate --basho YYYYMM`, e.g. if the nightly fetch ran before sumo-api.com recorded the yusho.

Some of this is announced rather than derivable (a retirement after the data was fetched, a
Yokozuna run the committee did or did not declare). Put corrections in
`public/data/overrides/YYYYMM.json`, merged into the rikishi by the frontend at load time:

```json
{ "hoshoryu": { "retired": true }, "kirishima": { "tsunatori": false } }
```

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
  same way the Change column counts them. Anyone whose score would carry them up into a higher
  rank type is put in a temporary "↑" candidates row just below that type, for you to sort into
  the open slots; the row disappears once its last occupant is moved out. The right half of the
  Maegashira/Juryo candidates row (red) holds Makuuchi rikishi whose score would drop them into
  Juryo. Sekiwake who would mathematically reach Ozeki are capped at S1E. Yokozuna and Ozeki are only
  re-ordered within their rank by wins (previous order breaks ties). Retired rikishi are left unplaced.
  The indicators override the score at the top: a `↩O 10` Sekiwake with 10+ wins, then a `→O n`
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
