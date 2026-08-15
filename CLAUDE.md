# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Static anime web players (deployed to GitHub Pages under the `/anime/` path prefix) plus Python crawlers in `scripts/` that feed them data. There is no build step, no test suite, no linter — frontend files are plain HTML/JS/CSS edited directly. Comments, UI text, and commit messages are in Vietnamese; keep that convention.

## Commands

```bash
# Local dev server (Flask, serves the site at http://localhost:8000/anime/)
cp .env.example .env   # fill FIREBASE_API_KEY (needed by auth/auth.js)
uv run python main.py

# Crawl Google Drive links for one anime (by AniList ID) and push to Firebase
cd scripts && uv run python crawl_anime.py <anilist_id>        # 100 tập mới nhất
cd scripts && uv run python crawl_anime.py <anilist_id> --num 0    # tất cả tập
cd scripts && uv run python crawl_anime.py <anilist_id> --dry-run  # xem kế hoạch

# AniList metadata lookup
cd scripts && uv run python anilist_cli.py search "<tên>"
cd scripts && uv run python anilist_cli.py get <anilist_id>
```

Prefer the project skills `crawl_anime` and `anilist` for those two workflows — they document exit codes, `--pick`/`--url` disambiguation, and monitoring.

Dependencies are managed with `uv` (`pyproject.toml`, `package = false` — it's a script collection, not an installable package).

## Architecture

**Data flow:** `scripts/` crawlers scrape animevietsub (Selenium + real Chrome to pass Cloudflare, profile `/tmp/cf-chrome-profile`) → extract per-episode Google Drive links → push to Firebase Realtime DB at `https://r3fire.firebaseio.com/anime/{id}` → static player pages fetch that JSON client-side. A Google Sheet (key in `scripts/avs_extract.py` / `scripts/sheet.py`) is the catalog/source of truth; convention: **Sheet `id` == AniList ID == Firebase key**.

**Scripts must run from `scripts/`** — they load the `r3fire.json` service-account key and import each other by relative path. `crawl_anime.py` is the end-to-end orchestrator; `avs_extract.py`/`avs_search.py`/`animevietsub.py` are the animevietsub layer; `fire.py` pushes to Firebase; `sheet.py` handles the Sheet; `anilist.py`/`jikan.py` are metadata clients.

**Frontend:** each top-level directory is a standalone page routed both by GitHub Pages (directory path) and by `main.py` (Flask blueprint with `/anime` prefix — add a route there when adding a page):
- `index.html` — homepage: anime grid from Firebase/AniList images, plus movie search via `phimapi.com`
- `gdrive/` — main player for crawled Drive episodes (`/anime/gdrive/?id=<anilist_id>` reads Firebase `anime/{id}`)
- `player/` — hls.js player tuned for weak devices/smart TVs (see `TV_HLS_CONFIG`); `r3player/`, `artplayer/`, `jwplayer/` — alternative players; `room/` — watch-together; `yt/`, `fb/`, `frame/` — embed wrappers
- `auth/` — Firebase auth; `auth.js` contains the placeholder `__FIREBASE_API_KEY__`, replaced by sed at deploy time and by Flask locally

Frontend targets old TV browsers in places — e.g. CSS rules with unusual pseudo-selectors are kept un-merged because old engines drop the whole rule; remote-control (arrow-key focus) navigation matters on the homepage and players.

**Deploy:** push to `master` → `.github/workflows/deploy.yml` injects `FIREBASE_API_KEY` into `auth/auth.js` and publishes the whole repo to GitHub Pages. Everything must work as static files with the `/anime/` prefix.
