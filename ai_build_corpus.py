import argparse
import hashlib
import json
import math
import re
import sqlite3
import time
from collections import Counter
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import urlopen


DEFAULT_SOURCE_DB = "trials.db"
DEFAULT_AI_DB = "backend/ai_corpus.db"
EMBED_DIM = 256

STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "are", "was", "were",
    "been", "have", "has", "had", "not", "but", "you", "your", "their", "its",
    "into", "than", "then", "them", "these", "those", "may", "who", "which",
    "will", "shall", "can", "could", "should", "would", "patients", "patient",
    "study", "trial", "criteria", "inclusion", "exclusion"
}


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


def tokenize(text):
    tokens = re.findall(r"[a-z0-9]+", (text or "").lower())
    return [token for token in tokens if len(token) > 2 and token not in STOPWORDS]


def hash_index(token):
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % EMBED_DIM


def embed_text(text):
    counts = Counter(tokenize(text))
    vector = [0.0] * EMBED_DIM
    if not counts:
        return vector

    for token, count in counts.items():
        vector[hash_index(token)] += 1.0 + math.log(count)

    norm = math.sqrt(sum(value * value for value in vector))
    if not norm:
        return vector
    return [round(value / norm, 6) for value in vector]


def chunk_text(text, max_chars=1800, overlap=180):
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
            vector_json TEXT NOT NULL
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


def insert_chunk(conn, chunk_id, nct_id, source, section, drug_name, title, text):
    conn.execute(
        """
        INSERT INTO ai_chunks (chunk_id, nct_id, source, section, drug_name, title, text, vector_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (chunk_id, nct_id, source, section, drug_name, title, text, json.dumps(embed_text(text))),
    )


def build_trial_chunks(source_conn, ai_conn):
    rows = source_conn.execute(
        """
        SELECT nct_id, title, brief_summary, detailed_description, eligibility_criteria
        FROM trials
        """
    ).fetchall()

    sections = [
        ("Brief Summary", "brief_summary"),
        ("Detailed Description", "detailed_description"),
        ("Eligibility", "eligibility_criteria"),
    ]
    total = 0
    for row in rows:
        values = dict(row)
        for section, field in sections:
            for index, chunk in enumerate(chunk_text(values.get(field))):
                chunk_id = f"{values['nct_id']}:{field}:{index}"
                insert_chunk(
                    ai_conn,
                    chunk_id,
                    values["nct_id"],
                    "ClinicalTrials.gov",
                    section,
                    None,
                    values.get("title"),
                    chunk,
                )
                total += 1
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


def openfda_get(path, params):
    url = f"https://api.fda.gov/{path}.json?{urlencode(params)}"
    try:
        with urlopen(url, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def fetch_openfda_label(drug_name):
    cleaned = normalize_name(drug_name)
    candidates = [drug_name, cleaned, *split_combination(drug_name)]
    seen = set()

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
        }
    return None


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
    except (HTTPError, URLError, TimeoutError, OSError):
        return []
    return [
        {"reaction": row.get("term"), "report_count": row.get("count", 0)}
        for row in (payload or {}).get("results", [])
        if row.get("term")
    ]


def build_openfda_enrichment(source_conn, ai_conn, max_drugs, skip_openfda):
    drugs = top_drug_interventions(source_conn, max_drugs)
    fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    stats = {"total_interventions": len(drugs), "matched": 0, "unmatched": 0}

    if skip_openfda:
        stats["unmatched"] = len(drugs)
        return stats

    for drug in drugs:
        label = fetch_openfda_label(drug)
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
                insert_chunk(ai_conn, f"openfda:{drug}:{section}:{index}", None, "openFDA", section, drug, drug, chunk)

        for event in fetch_adverse_events(drug):
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
            insert_chunk(ai_conn, f"openfda:{drug}:FAERS:0", None, "openFDA", "FDA Adverse Event Reports", drug, drug, event_text)

    return stats


def main():
    parser = argparse.ArgumentParser(description="Build the Level 3 AI retrieval corpus.")
    parser.add_argument("--source-db", default=DEFAULT_SOURCE_DB)
    parser.add_argument("--ai-db", default=DEFAULT_AI_DB)
    parser.add_argument("--max-openfda-drugs", type=int, default=20)
    parser.add_argument("--skip-openfda", action="store_true")
    args = parser.parse_args()

    source_conn = sqlite3.connect(args.source_db)
    source_conn.row_factory = sqlite3.Row
    ai_conn = sqlite3.connect(args.ai_db)
    ai_conn.row_factory = sqlite3.Row
    setup_ai_db(ai_conn)

    trial_chunks = build_trial_chunks(source_conn, ai_conn)
    fda_stats = build_openfda_enrichment(source_conn, ai_conn, args.max_openfda_drugs, args.skip_openfda)
    total_chunks = ai_conn.execute("SELECT COUNT(*) FROM ai_chunks").fetchone()[0]

    coverage = {
        "trial_chunks": trial_chunks,
        "total_chunks": total_chunks,
        "openfda_total_drugs_attempted": fda_stats["total_interventions"],
        "openfda_matched": fda_stats["matched"],
        "openfda_unmatched": fda_stats["unmatched"],
        "openfda_coverage_pct": round(100 * fda_stats["matched"] / max(1, fda_stats["total_interventions"]), 2),
        "embedding": f"local-hash-bow-{EMBED_DIM}",
    }

    for key, value in coverage.items():
        ai_conn.execute("INSERT INTO ai_metadata (key, value) VALUES (?, ?)", (key, json.dumps(value)))
    ai_conn.commit()
    source_conn.close()
    ai_conn.close()

    print(json.dumps(coverage, indent=2))


if __name__ == "__main__":
    main()
