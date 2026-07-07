# Clinical Trials Explorer (Level 2)

Level 2 turns the Level 1 ClinicalTrials.gov ingestion script into a local review application. The source clinical trial corpus still comes from the generated SQLite `trials.db`, while the L2 app adds a React/Vite frontend, an Express/Node API, and a separate SQLite store for local reviewer data such as watchlist items, notes, and tags.

The app is intended for local product validation and reviewer workflow testing. It is not yet a deployed multi-user system.

## Level 2 Scope

- Browse a paginated clinical trial table.
- Search trials by keyword across selected trial fields.
- Filter by exact phase, status, sponsor, and condition.
- Open trial detail pages with summaries, descriptions, eligibility text, conditions, and interventions.
- Add local reviewer watchlist entries, notes, and tags without mutating the source trial corpus.
- Serve the built frontend from the Express backend for production-like local review.

## Architecture

```
lind_1/
├── clinical_trials.py        # L1 ingestion/query CLI that creates trials.db
├── trials.db                 # Required source SQLite DB, generated locally
├── backend/
│   ├── index.js              # Express API and static frontend server
│   └── db.js                 # SQLite connections and user_data.db initialization
├── frontend/
│   ├── src/                  # React/Vite application
│   └── vite.config.js
├── progress/                 # Earlier PRD/progress notes
└── README.md
```

## Prerequisites

- Node.js 20+
- npm
- Python 3.8+ only if you need to regenerate `trials.db`
- A populated `trials.db` at the repository root

`trials.db` is a prerequisite for meaningful L2 review. The backend can create an empty compatible schema if the file is missing, but that fallback is only to prevent startup failure; the explorer will show no useful trial data until the Level 1 ingest has populated the database.

Generate or refresh the source database with:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python clinical_trials.py ingest --condition "non-small cell lung cancer"
```

## Local Setup

Install backend and frontend dependencies:

```bash
npm --prefix backend install
npm --prefix frontend install
```

Run the backend API:

```bash
npm --prefix backend run dev
```

Run the frontend dev server in another terminal:

```bash
npm --prefix frontend run dev
```

By default, the frontend calls `/api`. For split dev servers, configure Vite proxying or set `VITE_API_BASE_URL` to the backend URL, for example:

```bash
VITE_API_BASE_URL=http://localhost:5001/api npm --prefix frontend run dev
```

For a production-style local build:

```bash
npm run build
npm start
```

The root `build` script installs backend/frontend dependencies and builds `frontend/dist`; the backend then serves that build and the API from the same Express process.

## Data Stores

### Source Trial Data: `trials.db`

`trials.db` is the read-only source database created by the L1 Python ingest. The L2 backend expects these tables:

- `trials`
- `trial_conditions`
- `trial_interventions`

The API reads trial records from this database using `SOURCE_DB_PATH` when provided, otherwise `../trials.db` relative to `backend/`.

### Reviewer Data: `user_data.db`

The backend creates `user_data.db` automatically for L2 reviewer actions. It stores:

- `watchlist`
- `notes`
- `tags`

Set `DATA_DIR` or `USER_DB_PATH` to control where this file is written. By default it is written inside `backend/`.

Because `user_data.db` is a separate SQLite file from `trials.db`, it does not have a normal database-level foreign key to `trials.nct_id`. Referential integrity is application-enforced: the backend checks `trials.db` before writing user records. Unknown trial IDs are rejected in `backend/index.js` by `requireExistingTrial`, which is called by `POST /api/watchlist`, `POST /api/notes`, and `POST /api/tags`.

A single SQLite database with source tables plus separate user tables would make database-enforced foreign keys simpler. L2 keeps separate files anyway because it protects the ClinicalTrials.gov source snapshot from mutable reviewer data and makes source refreshes easier. If stronger relational guarantees become more important than that separation, the simpler Level 3 direction is one managed database with read-only source tables and writable user tables.

## API Contract

### `GET /api/trials`

Query parameters:

- `keyword`: optional SQL `LIKE` keyword search.
- `phase`: optional exact phase match.
- `status`: optional exact status match.
- `sponsor`: optional exact sponsor match.
- `condition`: optional exact condition match.
- `page`: optional positive page number, defaults to `1`.
- `limit`: optional page size, defaults to `50`, capped at `100`.

Expected response shape:

```json
{
  "data": [
    {
      "nct_id": "NCT01234567",
      "title": "Example Trial Title",
      "condition": "Non-Small Cell Lung Cancer, Lung Cancer",
      "phase": "PHASE3",
      "status": "RECRUITING",
      "sponsor": "Example Sponsor",
      "start_date": "2025-01-15"
    }
  ],
  "meta": {
    "totalCount": 1234,
    "page": 1,
    "limit": 50,
    "totalPages": 25
  }
}
```

The list endpoint intentionally returns a compact row shape for table rendering. Full detail fields are available from `GET /api/trials/:nctId`.

Other L2 endpoints:

- `GET /api/filters`
- `GET /api/trials/:nctId`
- `GET /api/watchlist`
- `POST /api/watchlist`
- `DELETE /api/watchlist/:nctId`
- `GET /api/notes/:nctId`
- `POST /api/notes`
- `PUT /api/notes/:id`
- `DELETE /api/notes/:id`
- `GET /api/tags/:nctId`
- `POST /api/tags`
- `PUT /api/tags/:id`
- `DELETE /api/tags/:id`

Invalid trial IDs are rejected on user-data create endpoints:

```json
{
  "error": "Trial not found"
}
```

## Final L2 Design Decisions

### React/Vite + Express/Node Instead of FastAPI

Level 1 remains a Python data-ingestion layer, but Level 2 is primarily an interactive browser app. React/Vite was introduced to move quickly on table browsing, detail views, routing, form state, and reviewer interactions with a mature frontend toolchain. Express/Node keeps the API and frontend build pipeline in the same JavaScript ecosystem, which reduces context switching for this UI-focused level.

FastAPI would also have worked over the same SQLite source database. It was not chosen for L2 because the backend requirements are intentionally thin: read filtered trial rows, return detail records, and persist simple reviewer annotations. Keeping the L2 web layer in Node avoids adding a second web runtime while the Python stack continues to own ingestion.

### Separate `user_data.db`

Reviewer data is stored in `user_data.db` instead of LocalStorage because notes, tags, and watchlist entries should survive browser changes, support backend validation, and remain queryable from the API. LocalStorage would make the UI simpler but would trap useful review work in one browser profile and make future sync/export harder.

Reviewer data is also kept out of `trials.db` because the source database is treated as an ingested clinical-trial snapshot. Separating mutable user data from source data keeps refreshes of `trials.db` safer and makes it clear which data came from ClinicalTrials.gov versus local review.

### SQL `LIKE` Search for L2

SQL `LIKE` search is sufficient for Level 2 because the expected local corpus is small enough for interactive review with simple keyword matching and pagination. The goal is discoverability during validation, not production-grade ranking, stemming, typo tolerance, or large-scale search analytics.

SQLite FTS or additional indexed search should be revisited in Level 3 if the corpus grows substantially, searches become slow, or users need relevance-ranked results. The current tradeoff favors transparent SQL and low implementation complexity over search performance and ranking quality.

### Search Fields

Keyword search intentionally includes:

- trial title
- sponsor
- brief summary
- detailed description
- condition names

Eligibility criteria is displayed on the detail page but intentionally deferred from keyword search until Level 3. Eligibility text can be long, noisy, and clinically specific; adding it to broad L2 search could reduce result quality without the ranking and highlighting work that would make it useful.

### Exact Sponsor and Condition Filters

Phase, status, sponsor, and condition filters use exact matches because the frontend receives known values from `GET /api/filters` and can submit canonical database values. This keeps the filter behavior predictable: selecting a sponsor or condition narrows to that exact stored value.

Partial, normalized, alias-aware filters are deferred because sponsor names and conditions can require domain-specific cleanup. L2 avoids pretending to solve synonym handling before there is a normalization strategy.

### Offset/Page Pagination

Page-number pagination backed by SQL `LIMIT`/`OFFSET` is acceptable for the expected L2 corpus size and is easy for reviewers to understand. The UI supports next/previous, first/last, and jump-to-page flows, which are useful during manual review.

Cursor pagination would be preferable for very large datasets or frequently changing result sets. The L2 dataset is local and effectively static during a review session, so offset pagination is simpler and adequate.

### Local-Only Review

Local-only review is acceptable for now because L2 validates the product workflow against a local source database and local reviewer actions. A deployment path was explored, but the current design still depends on a generated `trials.db` artifact and a writable SQLite user database. Those constraints are manageable locally and should be hardened before shared hosting.

Before production deployment, Level 3 should define data seeding, persistent storage, authentication if needed, backups, and a managed database/runtime strategy.

### Scraper Artifacts

The committed `scraper/` artifacts were not part of the L2 app. They were unrelated Puppeteer exploration files and have been removed from the working tree so the repository reflects the actual Level 2 architecture.

## Demo Validation

The Level 2 demo validates the following workflow:

- `trials.db` exists and the backend can read trial rows from it.
- `/api/trials` returns compact paginated trial rows with `data` and `meta`.
- Keyword search combines with exact filters using logical `AND`.
- Trial detail pages load full text fields plus conditions and interventions.
- Watchlist, notes, and tags write to `user_data.db` without mutating `trials.db`.
- Invalid `nctId` values are rejected before user records are created.
- Refresh/restart persistence works because reviewer data is stored in SQLite, not in React state or browser-only storage.

Targeted persistence mini-demo:

1. Start the backend and frontend.
2. Open any trial detail page, for example `/trial/<valid-nct-id>`.
3. Add the trial to the watchlist, add one note, and add one tag.
4. Refresh the browser and confirm the watchlist state, note, and tag are still visible.
5. Stop and restart the backend, reopen the same detail page, and confirm the same watchlist state, note, and tag are still loaded.
6. Open `/watchlist` and confirm the saved trial appears there.
7. Optional API proof:

```bash
curl http://localhost:5001/api/watchlist
curl http://localhost:5001/api/notes/<valid-nct-id>
curl http://localhost:5001/api/tags/<valid-nct-id>
curl -X POST http://localhost:5001/api/notes \
  -H "Content-Type: application/json" \
  -d '{"nctId":"NOT_A_REAL_TRIAL","note":"should fail"}'
```

The last command should return `404` with `{"error":"Trial not found"}`, showing that separate-database integrity is enforced by the application layer.

## Level 1 CLI

The original ingestion/query CLI is still available:

```bash
python clinical_trials.py query --phase PHASE3 --status RECRUITING --sponsor Pfizer --condition "lung cancer"
```

Use it to regenerate or inspect `trials.db`; use the L2 web app for interactive review.

## License

This project is for educational purposes as part of the ZoomRx internship program (Project Lind).
