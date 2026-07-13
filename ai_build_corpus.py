import argparse
import json
import re
import sqlite3
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


DEFAULT_SOURCE_DB = "trials.db"
DEFAULT_AI_DB = "backend/ai_corpus.db"
DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_EMBEDDING_MODEL = "nomic-embed-text"
DEFAULT_OPENFDA_TIMEOUT = 3
OPENFDA_TIMEOUT = DEFAULT_OPENFDA_TIMEOUT

def normalize_name(value):
    value = (value or "").lower()
    value = re.sub(r"\([^)]*\)", " ", value)
    value = re.sub(r"[^a-z0-9+/\-\s]", " ", value)
    value = re.sub(r"\b(tablet|injection|capsule|oral|iv|intravenous|subcutaneous|placebo)\b", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def split_combination(name):
    clean = normalize_name(name)
    parts = re.split(r"\s+(?:and|plus|with|combined with|in combination with)\s+|[+/]", clean)
    return [part.strip() for part in parts if len(part.strip()) >= 4]


class OllamaEmbedder:
    def __init__(self, base_url, model):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.dim = None

    def embed(self, text):
        return self.embed_many([text])[0]

    def embed_many(self, texts):
        payload = json.dumps({"model": self.model, "input": texts}).encode("utf-8")
        request = Request(
            f"{self.base_url}/api/embed",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=120) as response:
                body = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            raise RuntimeError(
                f"Ollama embedding failed for model '{self.model}'. "
                f"Start Ollama and run: ollama pull {self.model}"
            ) from exc

        vectors = body.get("embeddings") or [body.get("embedding")]
        if not isinstance(vectors, list) or not vectors or not isinstance(vectors[0], list):
            raise RuntimeError("Ollama embedding response did not include a vector")

        if self.dim is None:
            self.dim = len(vectors[0])
        return [[round(float(value), 8) for value in vector] for vector in vectors]


CHUNK_MAX_CHARS = 1800
CHUNK_OVERLAP = 180
EMBEDDED_TRIAL_FIELDS = [
    ("Brief Summary", "brief_summary"),
    ("Detailed Description", "detailed_description"),
    ("Eligibility", "eligibility_criteria"),
]


def chunk_text(text, max_chars=CHUNK_MAX_CHARS, overlap=CHUNK_OVERLAP):
    text = re.sub(r"\s+", " ", (text or "")).strip()
    if not text:
        return []

    chunks = []
    start = 0
    while start < len(text):
        end = min(len(text), start + max_chars)
        if end < len(text):
            sentence_end = max(text.rfind(". ", start, end), text.rfind("; ", start, end))
            if sentence_end > start + 600:
                end = sentence_end + 1
        chunks.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(0, end - overlap)
    return chunks


def setup_ai_db(conn):
    conn.executescript(
        """
        DROP TABLE IF EXISTS ai_chunks;
        DROP TABLE IF EXISTS fda_drug_labels;
        DROP TABLE IF EXISTS fda_adverse_events;
        DROP TABLE IF EXISTS ai_metadata;

        CREATE TABLE ai_chunks (
            chunk_id TEXT PRIMARY KEY,
            nct_id TEXT,
            source TEXT NOT NULL,
            section TEXT NOT NULL,
            drug_name TEXT,
            title TEXT,
            text TEXT NOT NULL,
            vector_json TEXT NOT NULL,
            embedding_model TEXT NOT NULL,
            embedding_dim INTEGER NOT NULL
        );

        CREATE INDEX idx_ai_chunks_nct ON ai_chunks(nct_id);
        CREATE INDEX idx_ai_chunks_source ON ai_chunks(source);
        CREATE INDEX idx_ai_chunks_drug ON ai_chunks(drug_name);

        CREATE TABLE fda_drug_labels (
            drug_name TEXT PRIMARY KEY,
            match_type TEXT NOT NULL,
            fda_id TEXT,
            brand_names TEXT,
            generic_names TEXT,
            indications TEXT,
            warnings TEXT,
            adverse_reactions TEXT,
            boxed_warning TEXT,
            fetched_at TEXT NOT NULL
        );

        CREATE TABLE fda_adverse_events (
            drug_name TEXT,
            reaction TEXT,
            report_count INTEGER,
            fetched_at TEXT NOT NULL,
            PRIMARY KEY (drug_name, reaction)
        );

        CREATE TABLE ai_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """
    )


def insert_chunk(conn, embedder, chunk_id, nct_id, source, section, drug_name, title, text):
    vector = embedder.embed(text)
    insert_chunk_vector(conn, embedder, vector, chunk_id, nct_id, source, section, drug_name, title, text)


def insert_chunk_vector(conn, embedder, vector, chunk_id, nct_id, source, section, drug_name, title, text):
    conn.execute(
        """
        INSERT INTO ai_chunks (
            chunk_id, nct_id, source, section, drug_name, title, text,
            vector_json, embedding_model, embedding_dim
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            chunk_id,
            nct_id,
            source,
            section,
            drug_name,
            title,
            text,
            json.dumps(vector),
            embedder.model,
            len(vector),
        ),
    )


def insert_chunk_batch(conn, embedder, rows, batch_size=8, label="chunks"):
    for start in range(0, len(rows), batch_size):
        batch = rows[start:start + batch_size]
        vectors = embedder.embed_many([row["text"] for row in batch])
        conn.executemany(
            """
            INSERT INTO ai_chunks (
                chunk_id, nct_id, source, section, drug_name, title, text,
                vector_json, embedding_model, embedding_dim
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    row["chunk_id"],
                    row["nct_id"],
                    row["source"],
                    row["section"],
                    row["drug_name"],
                    row["title"],
                    row["text"],
                    json.dumps(vector),
                    embedder.model,
                    len(vector),
                )
                for row, vector in zip(batch, vectors)
            ],
        )
        conn.commit()
        done = min(start + len(batch), len(rows))
        if done == len(rows) or done % 200 == 0:
            print(f"Embedded {done}/{len(rows)} {label}", flush=True)


def build_trial_chunks(source_conn, ai_conn, embedder):
    rows = source_conn.execute(
        """
        SELECT nct_id, title, brief_summary, detailed_description, eligibility_criteria
        FROM trials
        """
    ).fetchall()

    sections = EMBEDDED_TRIAL_FIELDS
    total = 0
    chunk_rows = []
    for row in rows:
        values = dict(row)
        for section, field in sections:
            for index, chunk in enumerate(chunk_text(values.get(field))):
                chunk_id = f"{values['nct_id']}:{field}:{index}"
                chunk_rows.append({
                    "chunk_id": chunk_id,
                    "nct_id": values["nct_id"],
                    "source": "ClinicalTrials.gov",
                    "section": section,
                    "drug_name": None,
                    "title": values.get("title"),
                    "text": chunk,
                })
                total += 1
    insert_chunk_batch(ai_conn, embedder, chunk_rows, label="trial chunks")
    return total


def top_drug_interventions(source_conn, limit):
    rows = source_conn.execute(
        """
        SELECT intervention_name, COUNT(*) AS trial_count
        FROM trial_interventions
        WHERE UPPER(intervention_type) IN ('DRUG', 'BIOLOGICAL')
        GROUP BY LOWER(intervention_name)
        ORDER BY trial_count DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [row["intervention_name"] for row in rows]


def openfda_get(path, params, timeout=None):
    url = f"https://api.fda.gov/{path}.json?{urlencode(params)}"
    try:
        with urlopen(url, timeout=timeout or OPENFDA_TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def fetch_openfda_label(drug_name):
    cleaned = normalize_name(drug_name)
    candidates = [drug_name, cleaned, *split_combination(drug_name)]
    seen = set()
    timed_out = False

    for candidate in candidates:
        candidate = candidate.strip()
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        quoted = quote(candidate)
        search = (
            f'openfda.generic_name:"{quoted}" OR '
            f'openfda.brand_name:"{quoted}" OR '
            f'openfda.substance_name:"{quoted}"'
        )
        try:
            payload = openfda_get("drug/label", {"search": search, "limit": 1})
        except TimeoutError:
            timed_out = True
            continue
        except (HTTPError, URLError, TimeoutError, OSError):
            continue
        results = (payload or {}).get("results", [])
        if not results:
            continue

        result = results[0]
        openfda = result.get("openfda", {})
        match_type = "exact" if candidate.lower() == drug_name.lower() else "cleaned_or_component"
        return {
            "drug_name": drug_name,
            "match_type": match_type,
            "fda_id": ",".join(openfda.get("application_number", [])[:3]),
            "brand_names": ", ".join(openfda.get("brand_name", [])[:8]),
            "generic_names": ", ".join(openfda.get("generic_name", [])[:8]),
            "indications": "\n".join(result.get("indications_and_usage", [])[:3]),
            "warnings": "\n".join((result.get("boxed_warning", []) + result.get("warnings", []) + result.get("warnings_and_cautions", []))[:4]),
            "adverse_reactions": "\n".join(result.get("adverse_reactions", [])[:4]),
            "boxed_warning": "\n".join(result.get("boxed_warning", [])[:2]),
        }, timed_out
    return None, timed_out


def fetch_adverse_events(drug_name):
    search = f'patient.drug.openfda.generic_name:"{quote(normalize_name(drug_name))}"'
    try:
        payload = openfda_get(
            "drug/event",
            {
                "search": search,
                "count": "patient.reaction.reactionmeddrapt.exact",
                "limit": 10,
            },
        )
    except TimeoutError:
        return [], True
    except (HTTPError, URLError, TimeoutError, OSError):
        return [], False
    return [
        {"reaction": row.get("term"), "report_count": row.get("count", 0)}
        for row in (payload or {}).get("results", [])
        if row.get("term")
    ], False


def build_openfda_enrichment(source_conn, ai_conn, embedder, max_drugs, skip_openfda):
    drugs = top_drug_interventions(source_conn, max_drugs)
    fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    stats = {"total_interventions": len(drugs), "matched": 0, "unmatched": 0, "skipped": 0, "timed_out": 0}

    if skip_openfda:
        stats["skipped"] = len(drugs)
        return stats

    for drug in drugs:
        print(f"Fetching openFDA evidence for {drug}", flush=True)
        label, timed_out = fetch_openfda_label(drug)
        if timed_out:
            stats["timed_out"] += 1
        if not label:
            stats["unmatched"] += 1
            continue

        stats["matched"] += 1
        ai_conn.execute(
            """
            INSERT INTO fda_drug_labels (
                drug_name, match_type, fda_id, brand_names, generic_names, indications,
                warnings, adverse_reactions, boxed_warning, fetched_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                drug,
                label["match_type"],
                label["fda_id"],
                label["brand_names"],
                label["generic_names"],
                label["indications"],
                label["warnings"],
                label["adverse_reactions"],
                label["boxed_warning"],
                fetched_at,
            ),
        )

        label_sections = [
            ("FDA Indications", label["indications"]),
            ("FDA Warnings", label["warnings"]),
            ("FDA Adverse Reactions", label["adverse_reactions"]),
            ("FDA Boxed Warning", label["boxed_warning"]),
        ]
        for section, text in label_sections:
            for index, chunk in enumerate(chunk_text(text)):
                insert_chunk(ai_conn, embedder, f"openfda:{drug}:{section}:{index}", None, "openFDA", section, drug, drug, chunk)

        events, events_timed_out = fetch_adverse_events(drug)
        if events_timed_out:
            stats["timed_out"] += 1
        for event in events:
            ai_conn.execute(
                """
                INSERT OR REPLACE INTO fda_adverse_events (drug_name, reaction, report_count, fetched_at)
                VALUES (?, ?, ?, ?)
                """,
                (drug, event["reaction"], event["report_count"], fetched_at),
            )
        event_rows = ai_conn.execute(
            "SELECT reaction, report_count FROM fda_adverse_events WHERE drug_name = ? ORDER BY report_count DESC LIMIT 10",
            (drug,),
        ).fetchall()
        if event_rows:
            event_text = "; ".join([f"{row['reaction']} ({row['report_count']} reports)" for row in event_rows])
            insert_chunk(ai_conn, embedder, f"openfda:{drug}:FAERS:0", None, "openFDA", "FDA Adverse Event Reports", drug, drug, event_text)

    return stats


def main():
    parser = argparse.ArgumentParser(description="Build the Level 3 AI retrieval corpus.")
    parser.add_argument("--source-db", default=DEFAULT_SOURCE_DB)
    parser.add_argument("--ai-db", default=DEFAULT_AI_DB)
    parser.add_argument("--max-openfda-drugs", type=int, default=20)
    parser.add_argument("--skip-openfda", action="store_true")
    parser.add_argument("--ollama-url", default=DEFAULT_OLLAMA_URL)
    parser.add_argument("--embedding-model", default=DEFAULT_EMBEDDING_MODEL)
    parser.add_argument("--openfda-timeout", type=int, default=DEFAULT_OPENFDA_TIMEOUT)
    args = parser.parse_args()

    global OPENFDA_TIMEOUT
    OPENFDA_TIMEOUT = args.openfda_timeout
    embedder = OllamaEmbedder(args.ollama_url, args.embedding_model)
    embedder.embed("clinical trials retrieval preflight")
    source_conn = sqlite3.connect(args.source_db)
    source_conn.row_factory = sqlite3.Row
    ai_conn = sqlite3.connect(args.ai_db)
    ai_conn.row_factory = sqlite3.Row
    setup_ai_db(ai_conn)

    trial_chunks = build_trial_chunks(source_conn, ai_conn, embedder)
    source_trial_count = source_conn.execute("SELECT COUNT(*) FROM trials").fetchone()[0]

    # Write core metadata immediately so the corpus is valid even if openFDA enrichment
    # is interrupted. This removes the need for any manual post-build metadata patching.
    core_metadata = {
        "trial_chunks": trial_chunks,
        "source_trial_count": source_trial_count,
        "embedding_model": embedder.model,
        "embedding_dim": embedder.dim,
        "chunk_size": CHUNK_MAX_CHARS,
        "chunk_overlap": CHUNK_OVERLAP,
        "embedded_fields": [field for _, field in EMBEDDED_TRIAL_FIELDS],
        "chunk_strategy": f"max_chars={CHUNK_MAX_CHARS}, overlap={CHUNK_OVERLAP}, sentence_boundary=True",
        "vector_store": "SQLite ai_chunks table with vector_json embeddings and exact cosine scan in backend/ai.js",
        "answer_model": "Ollama local LLM configured by OLLAMA_LLM_MODEL, default llama3.1:8b",
        "openfda_timeout_seconds": OPENFDA_TIMEOUT,
        "build_started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    for key, value in core_metadata.items():
        ai_conn.execute("INSERT OR REPLACE INTO ai_metadata (key, value) VALUES (?, ?)", (key, json.dumps(value)))
    ai_conn.commit()
    print(f"Core metadata committed ({trial_chunks} trial chunks). Corpus is now usable.", flush=True)

    fda_stats = build_openfda_enrichment(source_conn, ai_conn, embedder, args.max_openfda_drugs, args.skip_openfda)
    total_chunks = ai_conn.execute("SELECT COUNT(*) FROM ai_chunks").fetchone()[0]

    # Update metadata with final counts including any openFDA enrichment
    final_metadata = {
        "total_chunks": total_chunks,
        "openfda_total_drugs_attempted": fda_stats["total_interventions"],
        "openfda_matched": fda_stats["matched"],
        "openfda_unmatched": fda_stats["unmatched"],
        "openfda_skipped": fda_stats["skipped"],
        "openfda_timed_out": fda_stats["timed_out"],
        "openfda_coverage_pct": round(100 * fda_stats["matched"] / max(1, fda_stats["total_interventions"]), 2),
        "build_completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    for key, value in final_metadata.items():
        ai_conn.execute("INSERT OR REPLACE INTO ai_metadata (key, value) VALUES (?, ?)", (key, json.dumps(value)))
    ai_conn.commit()
    source_conn.close()
    ai_conn.close()

    coverage = {**core_metadata, **final_metadata}
    print("\nopenFDA enrichment summary:")
    print(f"  Attempted: {fda_stats['total_interventions']}")
    print(f"  Matched:   {fda_stats['matched']}")
    print(f"  Unmatched: {fda_stats['unmatched']}")
    print(f"  Skipped:   {fda_stats['skipped']}")
    print(f"  Timed out: {fda_stats['timed_out']}")

    print(json.dumps(coverage, indent=2))


if __name__ == "__main__":
    main()
