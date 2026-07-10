const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { sourceDb, dbQuery } = require('./db');

const aiDbPath = path.resolve(process.env.AI_DB_PATH || path.join(__dirname, 'ai_corpus.db'));
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
const EMBEDDING_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
const LLM_MODEL = process.env.OLLAMA_LLM_MODEL || 'llama3.1:8b';
const MIN_VECTOR_SCORE = Number.parseFloat(process.env.AI_MIN_VECTOR_SCORE || '0.18');
const MAX_CONTEXT_CHUNKS = Number.parseInt(process.env.AI_MAX_CONTEXT_CHUNKS || '8', 10);

const STOPWORDS = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were',
    'been', 'have', 'has', 'had', 'not', 'but', 'you', 'your', 'their', 'its',
    'into', 'than', 'then', 'them', 'these', 'those', 'may', 'who', 'which',
    'will', 'shall', 'can', 'could', 'should', 'would', 'patients', 'patient',
    'study', 'trial', 'criteria', 'inclusion', 'exclusion'
]);
const QUERY_HELPER_WORDS = new Set([
    'allow', 'allows', 'allowed', 'allowing', 'mention', 'mentions', 'mentioning',
    'involve', 'involves', 'involving', 'require', 'requires', 'requiring',
    'available', 'whose', 'about', 'what', 'does', 'say', 'show', 'find', 'list',
    'openfda', 'fda', 'label', 'labels', 'warning', 'warnings', 'adverse',
    'reaction', 'reactions', 'side', 'effect', 'effects'
]);

let aiDb;
let vectorIndex;

function getAiDb() {
    if (!aiDb) {
        aiDb = new sqlite3.Database(aiDbPath, sqlite3.OPEN_READONLY);
    }
    return aiDb;
}

function aiQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        getAiDb().all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function aiGet(query, params = []) {
    return new Promise((resolve, reject) => {
        getAiDb().get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function tokenize(text) {
    return String(text || '')
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.filter(token => token.length > 2 && !STOPWORDS.has(token)) || [];
}

function cosine(a, b) {
    let score = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
        score += a[i] * b[i];
    }
    return score;
}

function normalizeVector(vector) {
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return norm ? vector.map(value => value / norm) : vector;
}

async function ollamaEmbed(text) {
    const response = await fetch(`${OLLAMA_URL}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: text })
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ollama embedding failed: ${response.status} ${body}`);
    }
    const payload = await response.json();
    const embedding = payload.embeddings?.[0] || payload.embedding;
    if (!Array.isArray(embedding)) throw new Error('Ollama embedding response did not include an embedding');
    return normalizeVector(embedding.map(Number));
}

async function ollamaGenerate(prompt) {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: LLM_MODEL,
            prompt,
            stream: false,
            options: {
                temperature: 0,
                num_predict: 550
            }
        })
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ollama generation failed: ${response.status} ${body}`);
    }
    const payload = await response.json();
    return String(payload.response || '').trim();
}

function parseStructuredFilters(question) {
    const q = String(question || '').toLowerCase();
    const filters = {};

    const phaseMatch = q.match(/\bphase\s*(1|2|3|4|i{1,3}|iv)\b/);
    if (phaseMatch) {
        const raw = phaseMatch[1].toUpperCase();
        const roman = { I: '1', II: '2', III: '3', IV: '4' };
        filters.phase = `PHASE${roman[raw] || raw}`;
    }

    const statusMap = [
        ['not yet recruiting', 'NOT_YET_RECRUITING'],
        ['active not recruiting', 'ACTIVE_NOT_RECRUITING'],
        ['enrolling by invitation', 'ENROLLING_BY_INVITATION'],
        ['recruiting', 'RECRUITING'],
        ['completed', 'COMPLETED'],
        ['terminated', 'TERMINATED'],
        ['withdrawn', 'WITHDRAWN'],
        ['suspended', 'SUSPENDED']
    ];
    const statusHit = statusMap.find(([phrase]) => q.includes(phrase));
    if (statusHit) filters.status = statusHit[1];

    const sponsorMatch = q.match(/\bsponsor(?:ed by)?\s+([a-z0-9 .,&-]{3,80})/);
    if (sponsorMatch) filters.sponsor = sponsorMatch[1].trim();

    return filters;
}

function stripStructuredTerms(question, filters) {
    let text = String(question || '');
    if (filters.phase) text = text.replace(/\bphase\s*(1|2|3|4|i{1,3}|iv)\b/ig, ' ');
    if (filters.status) {
        text = text.replace(/not yet recruiting|active not recruiting|enrolling by invitation|recruiting|completed|terminated|withdrawn|suspended/ig, ' ');
    }
    text = text.replace(/\b(trials?|studies|show|find|list|whose|that|are|is|with|where)\b/ig, ' ');
    return text.replace(/\s+/g, ' ').trim();
}

async function structuredTrialIds(filters) {
    const clauses = [];
    const params = [];
    if (filters.phase) {
        clauses.push('t.phase LIKE ?');
        params.push(`%${filters.phase}%`);
    }
    if (filters.status) {
        clauses.push('t.status = ?');
        params.push(filters.status);
    }
    if (filters.sponsor) {
        clauses.push('LOWER(t.sponsor) LIKE ?');
        params.push(`%${filters.sponsor.toLowerCase()}%`);
    }
    if (!clauses.length) return null;
    const rows = await dbQuery(
        sourceDb,
        `SELECT t.nct_id FROM trials t WHERE ${clauses.join(' AND ')} LIMIT 2000`,
        params
    );
    return new Set(rows.map(row => row.nct_id));
}

function isOpenFdaQuestion(question) {
    return /\b(openfda|fda|label|warning|boxed|adverse|reaction|side effect|toxicity)\b/i.test(question);
}

async function hasCorpus() {
    const table = await aiGet("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_chunks'");
    if (!table) return { ok: false, reason: 'missing' };
    try {
        const metadata = await aiGet("SELECT value FROM ai_metadata WHERE key = 'embedding_model'");
        if (!metadata) return { ok: false, reason: 'legacy' };
        return { ok: true };
    } catch (err) {
        return { ok: false, reason: 'legacy' };
    }
}

async function loadVectorIndex() {
    if (vectorIndex) return vectorIndex;
    const rows = await aiQuery(
        'SELECT chunk_id, nct_id, source, section, drug_name, title, text, vector_json FROM ai_chunks'
    );
    vectorIndex = rows.map(row => ({
        ...row,
        vector: normalizeVector(JSON.parse(row.vector_json).map(Number))
    }));
    return vectorIndex;
}

async function corpusContainsToken(token, candidateIds) {
    const clauses = ['(LOWER(text) LIKE ? OR LOWER(COALESCE(title, "")) LIKE ? OR LOWER(COALESCE(drug_name, "")) LIKE ? OR LOWER(section) LIKE ? OR LOWER(source) LIKE ?)'];
    const needle = `%${token.toLowerCase()}%`;
    const params = [needle, needle, needle, needle, needle];
    if (candidateIds && candidateIds.size) {
        const ids = [...candidateIds].slice(0, 1000);
        clauses.push(`nct_id IN (${ids.map(() => '?').join(',')})`);
        params.push(...ids);
    }
    const rows = await aiQuery(`SELECT 1 AS hit FROM ai_chunks WHERE ${clauses.join(' AND ')} LIMIT 1`, params);
    return rows.length > 0;
}

async function unsupportedCorpusTerms(question, candidateIds) {
    const tokens = [...new Set(tokenize(question))]
        .filter(token => !QUERY_HELPER_WORDS.has(token))
        .filter(token => !/^phase\d?$/.test(token));
    const unsupported = [];
    for (const token of tokens) {
        if (!(await corpusContainsToken(token, candidateIds))) unsupported.push(token);
    }
    return unsupported;
}

async function semanticSearch(question, candidateIds, options = {}) {
    const queryVector = await ollamaEmbed(question);
    const index = await loadVectorIndex();
    const candidateSet = candidateIds && candidateIds.size ? candidateIds : null;
    const queryTokens = new Set(tokenize(question));

    return index
        .filter(chunk => !options.source || chunk.source === options.source)
        .filter(chunk => !candidateSet || candidateSet.has(chunk.nct_id))
        .map(chunk => {
            const chunkTokens = new Set(tokenize(chunk.text));
            let overlap = 0;
            for (const token of queryTokens) {
                if (chunkTokens.has(token)) overlap += 1;
            }
            const score = cosine(queryVector, chunk.vector) + Math.min(overlap * 0.015, 0.08);
            const { vector, ...cleanChunk } = chunk;
            return { ...cleanChunk, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, options.limit || 12);
}

async function getTrialMap(nctIds) {
    if (!nctIds.length) return new Map();
    const rows = await dbQuery(
        sourceDb,
        `SELECT nct_id, title, phase, status, sponsor FROM trials WHERE nct_id IN (${nctIds.map(() => '?').join(',')})`,
        nctIds
    );
    return new Map(rows.map(row => [row.nct_id, row]));
}

function snippet(text, maxLength = 520) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLength) return clean;
    return `${clean.slice(0, maxLength - 1).trim()}...`;
}

function uniqueCitations(chunks) {
    const seen = new Set();
    const citations = [];
    for (const chunk of chunks) {
        const key = chunk.chunk_id;
        if (seen.has(key)) continue;
        seen.add(key);
        citations.push({
            source: chunk.source,
            nctId: chunk.nct_id || undefined,
            drug: chunk.drug_name || undefined,
            section: chunk.section,
            chunkId: chunk.chunk_id,
            title: chunk.title || undefined
        });
    }
    return citations;
}

function buildEvidenceContext(chunks, trialMap) {
    return chunks.map((chunk, index) => {
        const citationId = `C${index + 1}`;
        const trial = chunk.nct_id ? trialMap.get(chunk.nct_id) : null;
        const label = chunk.nct_id
            ? `${chunk.nct_id} | ${trial?.title || chunk.title || 'Untitled trial'} | ${trial?.phase || 'phase not listed'} | ${trial?.status || 'status not listed'}`
            : `${chunk.drug_name || chunk.title || 'Drug evidence'} | ${chunk.source}`;
        return `[${citationId}] ${chunk.source} | ${chunk.section} | ${label}\n${snippet(chunk.text)}`;
    }).join('\n\n');
}

function buildPrompt(question, chunks, trialMap, filters) {
    const filterText = Object.keys(filters).length ? JSON.stringify(filters) : 'none';
    return `You are a clinical-trials evidence assistant. Answer only from the evidence below.

Rules:
- If the evidence does not answer the question, reply exactly: I don't have data on that in the indexed corpus.
- Do not infer safety, efficacy, causality, or best treatment beyond the cited text.
- Every factual sentence in a non-refusal answer must include one or more citation markers like [C1].
- Use concise prose or bullets.
- Do not cite evidence that is not listed.

Question: ${question}
Structured filters already applied: ${filterText}

Evidence:
${buildEvidenceContext(chunks, trialMap)}

Answer:`;
}

function llmRefused(answer) {
    return /I don't have data on that in the indexed corpus/i.test(answer);
}

function citationIdsFromAnswer(answer) {
    return [...new Set([...String(answer || '').matchAll(/\[C(\d+)\]/g)].map(match => Number.parseInt(match[1], 10)))];
}

function validateGroundedAnswer(answer, chunks) {
    if (llmRefused(answer)) {
        return { ok: false, refused: true, answer: `I don't have data on that in the indexed corpus.` };
    }
    const citedIds = citationIdsFromAnswer(answer);
    const allowed = new Set(chunks.map((_, index) => index + 1));
    if (!citedIds.length || citedIds.some(id => !allowed.has(id))) {
        return { ok: false, refused: true, answer: `I don't have data on that in the indexed corpus.` };
    }
    return { ok: true, refused: false, answer };
}

function refusal(filters, extra = {}) {
    return {
        answer: `I don't have data on that in the indexed corpus.`,
        citations: [],
        retrievedTrials: [],
        refused: true,
        filters,
        ...extra
    };
}

async function answerQuestion(question) {
    const cleanQuestion = String(question || '').trim();
    if (!cleanQuestion) {
        return { answer: 'Ask a question about indexed trials or FDA label evidence.', citations: [], retrievedTrials: [], refused: true };
    }

    const corpus = await hasCorpus();
    if (!corpus.ok) {
        const detail = corpus.reason === 'legacy'
            ? 'The current AI corpus was built with the older deterministic vector format.'
            : `I don't have an AI corpus yet.`;
        return {
            answer: `${detail} Run python3 ai_build_corpus.py after starting Ollama, then ask again.`,
            citations: [],
            retrievedTrials: [],
            refused: true
        };
    }

    const filters = parseStructuredFilters(cleanQuestion);
    const candidateIds = await structuredTrialIds(filters);
    const semanticQuery = stripStructuredTerms(cleanQuestion, filters) || cleanQuestion;

    if (/\b(best|guarantee|guaranteed|cure)\b/i.test(cleanQuestion)) {
        return refusal(filters);
    }

    const unsupported = await unsupportedCorpusTerms(semanticQuery, candidateIds);
    if (unsupported.length) {
        return refusal(filters, {
            unsupportedTerms: process.env.NODE_ENV === 'test' ? unsupported : undefined
        });
    }

    let chunks;
    try {
        const source = isOpenFdaQuestion(cleanQuestion) && !candidateIds ? 'openFDA' : undefined;
        chunks = await semanticSearch(semanticQuery, candidateIds, { source, limit: 16 });
    } catch (err) {
        return {
            answer: `The local Ollama embedding model is unavailable. Start Ollama and run: ollama pull ${EMBEDDING_MODEL}`,
            citations: [],
            retrievedTrials: [],
            refused: true,
            filters,
            error: process.env.NODE_ENV === 'test' ? err.message : undefined
        };
    }

    const useful = chunks.filter(chunk => chunk.score >= MIN_VECTOR_SCORE).slice(0, MAX_CONTEXT_CHUNKS);
    if (!useful.length) return refusal(filters);

    const retrievedTrials = [...new Set(useful.filter(chunk => chunk.nct_id).map(chunk => chunk.nct_id))];
    const trialMap = await getTrialMap(retrievedTrials);

    let answer;
    try {
        answer = await ollamaGenerate(buildPrompt(cleanQuestion, useful, trialMap, filters));
    } catch (err) {
        return {
            answer: `The local Ollama LLM is unavailable. Start Ollama and run: ollama pull ${LLM_MODEL}`,
            citations: [],
            retrievedTrials: [],
            refused: true,
            filters,
            error: process.env.NODE_ENV === 'test' ? err.message : undefined
        };
    }

    const validated = validateGroundedAnswer(answer, useful);
    if (!validated.ok) return refusal(filters);

    return {
        answer: validated.answer,
        citations: uniqueCitations(useful),
        retrievedTrials,
        refused: false,
        filters,
        models: {
            embedding: EMBEDDING_MODEL,
            llm: LLM_MODEL,
            vectorStore: 'SQLite ai_chunks + exact cosine vector index'
        },
        debug: process.env.NODE_ENV === 'test' ? useful.map(({ chunk_id, score }) => ({ chunk_id, score })) : undefined
    };
}

module.exports = { answerQuestion, parseStructuredFilters, semanticSearch, structuredTrialIds };
