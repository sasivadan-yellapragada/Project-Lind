# Clinical Trials Explorer (Project Lind)

Project Lind is a clinical-trials review app built on a generated ClinicalTrials.gov SQLite corpus. It includes the Level 1 Python ingestion CLI, a React/Vite + Express review workflow, and a Level 3 grounded Q&A layer that combines structured SQLite filters, Ollama-generated embeddings, a SQLite-backed vector index, and local Ollama LLM answer synthesis over trial text and optional openFDA label evidence.

The app is intended for product validation and reviewer workflow testing. It can run locally or as a single Render web service, but the generated SQLite files must be created and persisted separately from Git.

## Scope

- Browse a paginated clinical trial table.
- Search trials by keyword across selected trial fields.
- Filter by exact phase, status, sponsor, and condition.
- Open trial detail pages with summaries, descriptions, eligibility text, conditions, and interventions.
- Save local reviewer watchlist entries, notes, and tags without mutating the source trial corpus.
- Ask grounded LLM Q&A questions at `/ask`.
- Build an AI retrieval corpus from trial text and optional openFDA evidence.
- Run a lightweight retrieval, citation, grounding, and refusal evaluation harness.
- Serve the built frontend from the Express backend for production-style review.

## Architecture

```text
lind_1/
├── clinical_trials.py        # L1 ingestion/query CLI that creates trials.db
├── ai_build_corpus.py        # Builds backend/ai_corpus.db for grounded Q&A
├── trials.db                 # Generated source SQLite DB, ignored by Git
├── backend/
│   ├── index.js              # Express API and static frontend server
│   ├── db.js                 # SQLite connections and user_data.db initialization
│   ├── ai.js                 # Grounded Q&A retrieval, Ollama prompting, and citation checks
│   ├── eval.js               # AI evaluation runner
│   └── eval_cases.json       # AI evaluation cases
├── frontend/
│   ├── src/                  # React/Vite application
│   └── vite.config.js
├── progress/                 # Earlier PRD/progress notes
└── README.md
```

## Prerequisites

- Node.js 20+
- npm
- Python 3.8+
- A populated `trials.db` at the repository root for useful trial review
- Optional for browsing, required for Q&A: Ollama with local embedding and chat models
- Optional: a populated `backend/ai_corpus.db` for grounded Q&A

The backend can create an empty compatible `trials.db` schema if the source database is missing, but the explorer will show no meaningful trial data until the Level 1 ingest has populated the database.

Generate or refresh the source database:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python clinical_trials.py ingest --condition "non-small cell lung cancer"
```

Build the local AI corpus:

```bash
ollama pull nomic-embed-text
ollama pull llama3.1:8b
npm run build:ai
```

By default this writes `backend/ai_corpus.db`, indexes trial summaries, detailed descriptions, eligibility criteria, embeds each chunk with the local Ollama `nomic-embed-text` model, and attempts openFDA enrichment for common drug/biologic interventions. To build trial-only evidence without openFDA calls:

```bash
python3 ai_build_corpus.py --skip-openfda
```

The model and endpoint can be changed without code edits:

```bash
python3 ai_build_corpus.py --embedding-model mxbai-embed-large --ollama-url http://localhost:11434
OLLAMA_EMBED_MODEL=mxbai-embed-large OLLAMA_LLM_MODEL=llama3.1:8b npm --prefix backend run dev
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

By default, the frontend calls `/api`. For split dev servers, set `VITE_API_BASE_URL` to the backend URL:

```bash
VITE_API_BASE_URL=http://localhost:5001/api npm --prefix frontend run dev
```

For a production-style local build:

```bash
npm run build
npm start
```

The root `build` script installs backend/frontend dependencies and builds `frontend/dist`; the backend serves that build and the API from one Express process.

Run the AI evaluation harness after building `backend/ai_corpus.db`:

```bash
npm run eval:ai
```

## Data Stores

### Source Trial Data: `trials.db`

`trials.db` is the read-only source database created by the Level 1 Python ingest. The backend expects these tables:

- `trials`
- `trial_conditions`
- `trial_interventions`

The API reads trial records from `SOURCE_DB_PATH` when provided, otherwise `../trials.db` relative to `backend/`.

### Reviewer Data: `user_data.db`

The backend creates `user_data.db` automatically for reviewer actions. It stores:

- `watchlist`
- `notes`
- `tags`

Set `DATA_DIR` or `USER_DB_PATH` to control where this file is written. By default it is written inside `backend/`.

Because `user_data.db` is separate from `trials.db`, database-level foreign keys do not cross the two files. Referential integrity is application-enforced: `POST /api/watchlist`, `POST /api/notes`, and `POST /api/tags` reject unknown trial IDs.

### AI Corpus: `ai_corpus.db`

`ai_corpus.db` is generated by `ai_build_corpus.py`. It stores chunked evidence, real Ollama embedding vectors in `vector_json`, the embedding model/dimension used for each chunk, optional openFDA label/adverse-event snippets, and build metadata. It is ignored by Git like the other SQLite artifacts.

Set `AI_DB_PATH` to point the backend at a different corpus location. By default, the backend reads `backend/ai_corpus.db`.

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

### `POST /api/ask`

Request:

```json
{
  "question": "Recruiting Phase 3 trials whose eligibility allows prior chemotherapy"
}
```

Response:

```json
{
  "answer": "Grounded answer text with cited evidence snippets.",
  "citations": [
    {
      "source": "ClinicalTrials.gov",
      "nctId": "NCT01234567",
      "section": "Eligibility",
      "chunkId": "NCT01234567:eligibility_criteria:0"
    }
  ],
  "retrievedTrials": ["NCT01234567"],
  "refused": false,
  "filters": {
    "phase": "PHASE3",
    "status": "RECRUITING"
  }
}
```

If the question is outside the indexed corpus or the AI corpus is missing, the endpoint returns a grounded refusal with `refused: true`.

Other endpoints:

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

## Level 3 Grounded Q&A Design

Grounded Q&A stays local and auditable while using the same RAG mechanics expected in a production LLM workflow:

- Chunking: reuses the existing trial chunking logic for brief summaries, detailed descriptions, eligibility criteria, and optional openFDA label/adverse-event evidence.
- Embeddings: `ai_build_corpus.py` calls Ollama `/api/embed` with `nomic-embed-text` by default. This replaces the earlier deterministic hash vectors with actual local model embeddings.
- Vector store/index: embeddings are persisted in SQLite (`ai_chunks.vector_json`) with model metadata. The backend loads those rows into an exact cosine vector index, then applies optional structured trial filters before ranking.
- LLM synthesis: `/api/ask` sends the top evidence chunks to a local Ollama chat model (`llama3.1:8b` by default) with strict instructions to answer only from evidence.
- Citation grounding: evidence chunks are numbered as `[C1]`, `[C2]`, and so on. The backend refuses any non-refusal answer that does not cite valid retrieved chunk IDs.
- Refusal checks: unsupported corpus terms, best/guarantee/cure questions, missing evidence, missing corpus, missing embedding model, and missing LLM all produce explicit refusals instead of speculative answers.

The openFDA enrichment is supporting regulatory/reporting context, not clinical advice or proof of causality. Questions that ask for guarantees, cures, unsupported concepts, or evidence outside the indexed corpus are refused instead of answered speculatively.

### Model and Store Rationale

The default embedding model is `nomic-embed-text` because it is small, local, widely used with Ollama, and good enough for semantic retrieval over short clinical-trial chunks. `mxbai-embed-large` is a reasonable alternative when recall matters more than build speed and memory. Hosted embeddings were not used because the learning goal and demo constraints favor a reproducible local stack.

SQLite remains the vector store because the corpus is modest, already SQLite-backed, and easy to inspect during a demo. The exact cosine scan is simpler and more transparent than adding FAISS, Chroma, or Qdrant for this project size. Those stores become better choices if the corpus grows, approximate nearest-neighbor latency matters, or metadata filtering needs more advanced vector-native features.

The default answer model is `llama3.1:8b` through Ollama because it gives local synthesis with acceptable instruction following on a laptop-class setup. Smaller models are faster but weaker at citation discipline; larger models can improve answer quality if the demo machine has enough memory.

## Demo Validation

The main demo validates the following workflow:

- `trials.db` exists and the backend can read trial rows from it.
- `/api/trials` returns compact paginated trial rows with `data` and `meta`.
- Keyword search combines with exact filters using logical `AND`.
- Trial detail pages load full text fields plus conditions and interventions.
- Watchlist, notes, and tags write to `user_data.db` without mutating `trials.db`.
- Invalid `nctId` values are rejected before user records are created.
- `/ask` returns grounded answers with citations or grounded refusals.
- `npm run eval:ai` reports retrieval, citation, grounding, and refusal metrics.

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

Use it to regenerate or inspect `trials.db`; use the web app for interactive review.

## License

This project is for educational purposes as part of the ZoomRx internship program (Project Lind).
