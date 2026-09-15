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
  - `js/state.js` — guess state (rikishi → slot), guess-table rows.
  - `js/banzuke.js` — renders the previous and guess banzuke tables.
  - `js/dnd.js` — HTML5 drag-and-drop plus a tap-to-select fallback for touch devices.
  - `data/` — generated JSON: `schedule.json`, `index.json`, `basho/YYYYMM.json`.
- `scraper/` — Python package that produces `public/data`.
  - `schedule.py` — parses the [tournament schedule](https://www.sumo.or.jp/EnTicket/year_schedule/).
  - `official.py` — banzuke + results from the [sumo.or.jp](https://www.sumo.or.jp/EnHonbashoBanzuke/index/)
    JSON endpoints (the site only exposes the *current* basho).
  - `sumoapi.py` — fallback/bootstrap from [sumo-api.com](https://sumo-api.com/), which has full history.
  - `cli.py` — `update` (nightly), `bootstrap --basho YYYYMM`, `schedule`.
- `.github/workflows/update-data.yml` — runs `scraper.cli update` every night at 00:10 JST.
  It refreshes the schedule, and if a tournament finished the day before and its data is
  not yet in the repo, fetches it (sumo.or.jp first, sumo-api.com if the official site has
  already moved on) and commits it. The push triggers a Cloudflare Pages deploy.

## Local development

```sh
pip install -e ".[dev]"
python -m pytest                      # scraper tests
node tests/js/rank.test.mjs           # rank-change tests
python -m http.server 8000 -d public  # then open http://localhost:8000
```

Fetch data manually:

```sh
python -m scraper.cli update                      # what the nightly job runs
python -m scraper.cli bootstrap --basho 202607    # seed a specific basho from sumo-api.com
python -m scraper.cli update --force --source official   # re-fetch from sumo.or.jp only
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

## Roadmap

- Save the guess in the browser so it survives a reload.
- Automatic pre-ranking (e.g. 8-7 → +1), leaving only conflicts to resolve by hand.
- Links to each rikishi's profile / tournament history (`profile_url` is already in the data).
- A model that produces its own prediction.
