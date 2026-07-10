# Level 3 PRD: Grounded Clinical-Trials Q&A

## Goal

Build a local LLM-based Q&A workflow over the clinical-trials corpus that demonstrates the full grounded RAG loop: model embeddings, vector retrieval, evidence-conditioned answer synthesis, citations, and refusal behavior.

## User Need

Clinical reviewers need to ask natural-language questions such as "Recruiting Phase 3 trials whose eligibility allows prior chemotherapy" and receive concise answers tied to specific trial or openFDA evidence. The system should make it clear when the indexed evidence is insufficient.

## Final Architecture

- Corpus builder: `ai_build_corpus.py` reuses existing trial chunking for brief summaries, detailed descriptions, eligibility criteria, and optional openFDA snippets.
- Embedding model: the builder calls Ollama `/api/embed` with `nomic-embed-text` by default and stores the real embedding vector per chunk.
- Vector store: `backend/ai_corpus.db` stores chunk text, source metadata, embedding model, embedding dimension, and `vector_json`.
- Vector index: `backend/ai.js` loads the SQLite vectors into an exact cosine index and applies structured filters for phase, status, and sponsor before ranking.
- LLM: `/api/ask` calls Ollama `/api/generate` with `llama3.1:8b` by default.
- Grounding: retrieved chunks are passed to the LLM as numbered evidence items (`[C1]`, `[C2]`, etc.).
- Citation gate: the backend rejects non-refusal answers unless they cite valid retrieved evidence IDs.
- Refusals: the backend refuses unsupported terms, guarantee/cure/best-treatment questions, missing evidence, missing corpus, missing embedding model, and missing LLM.

## Rationale

`nomic-embed-text` is the default embedding model because it is local, easy to run through Ollama, and appropriate for short text chunks. `mxbai-embed-large` is the main alternative when stronger retrieval quality is worth higher memory and build cost. Hosted embeddings were avoided because the Level 3 learning goal emphasizes a local, inspectable stack.

SQLite is retained as the vector store because the corpus is already SQLite-backed and small enough for exact cosine search. This keeps the demo transparent: reviewers can inspect the chunk rows, vectors, and metadata directly. FAISS, Chroma, or Qdrant would be good alternatives for larger corpora or lower-latency approximate nearest-neighbor search, but they add operational overhead that is not necessary for this stage.

`llama3.1:8b` is the default synthesis model because it is a practical local model with reasonable instruction following. Smaller Ollama models can be used for speed, while larger models can improve answer quality on machines with enough memory.

## Evaluation

The existing `backend/eval.js` harness remains the demo check. It evaluates:

- retrieval: expected trial IDs appear when the question has known relevant trials
- citation: accepted answers cite ClinicalTrials.gov or openFDA as required
- grounding: citations include concrete trial IDs or drug labels
- refusal: unsupported or unsafe questions return `refused: true`

## Non-Goals

- Medical advice or treatment ranking
- Claims about efficacy, causality, or adverse-event incidence beyond cited evidence
- Hosted LLM or hosted embedding dependencies
- A production-scale vector database migration before corpus size requires it
