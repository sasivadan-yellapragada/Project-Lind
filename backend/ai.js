const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { sourceDb, dbQuery, dbGet } = require('./db');

const aiDbPath = path.resolve(process.env.AI_DB_PATH || path.join(__dirname, 'ai_corpus.db'));
const EMBED_DIM = 256;
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

function tokenize(text) {
    return String(text || '')
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.filter(token => token.length > 2 && !STOPWORDS.has(token)) || [];
}

function hashIndex(token) {
    const digest = crypto.createHash('sha256').update(token).digest('hex');
    return Number.parseInt(digest.slice(0, 8), 16) % EMBED_DIM;
}

function embedText(text) {
    const counts = new Map();
    for (const token of tokenize(text)) {
        counts.set(token, (counts.get(token) || 0) + 1);
    }
    const vector = Array(EMBED_DIM).fill(0);
    for (const [token, count] of counts.entries()) {
        vector[hashIndex(token)] += 1 + Math.log(count);
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return norm ? vector.map(value => value / norm) : vector;
}

function cosine(a, b) {
    let score = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
        score += a[i] * b[i];
    }
    return score;
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

async function semanticSearch(question, candidateIds, options = {}) {
    const queryVector = embedText(question);
    const params = [];
    const clauses = [];
    if (options.source) {
        clauses.push('source = ?');
        params.push(options.source);
    }
    if (candidateIds && candidateIds.size) {
        const ids = [...candidateIds].slice(0, 1000);
        clauses.push(`nct_id IN (${ids.map(() => '?').join(',')})`);
        params.push(...ids);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const chunks = await aiQuery(
        `SELECT chunk_id, nct_id, source, section, drug_name, title, text, vector_json FROM ai_chunks ${where}`,
        params
    );

    const queryTokens = new Set(tokenize(question));
    return chunks
        .map(chunk => {
            const vector = JSON.parse(chunk.vector_json);
            const chunkTokens = new Set(tokenize(chunk.text));
            let overlap = 0;
            for (const token of queryTokens) {
                if (chunkTokens.has(token)) overlap += 1;
            }
            const score = cosine(queryVector, vector) + Math.min(overlap * 0.025, 0.15);
            return { ...chunk, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, options.limit || 12);
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

async function getTrialMap(nctIds) {
    if (!nctIds.length) return new Map();
    const rows = await dbQuery(
        sourceDb,
        `SELECT nct_id, title, phase, status, sponsor FROM trials WHERE nct_id IN (${nctIds.map(() => '?').join(',')})`,
        nctIds
    );
    return new Map(rows.map(row => [row.nct_id, row]));
}

function snippet(text, maxLength = 260) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLength) return clean;
    return `${clean.slice(0, maxLength - 1).trim()}...`;
}

function uniqueCitations(chunks) {
    const seen = new Set();
    const citations = [];
    for (const chunk of chunks) {
        const key = [chunk.source, chunk.nct_id || '', chunk.drug_name || '', chunk.section].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        citations.push({
            source: chunk.source,
            nctId: chunk.nct_id || undefined,
            drug: chunk.drug_name || undefined,
            section: chunk.section,
            chunkId: chunk.chunk_id
        });
    }
    return citations;
}

function buildGroundedAnswer(question, chunks, trialMap, filters) {
    const trialChunks = chunks.filter(chunk => chunk.nct_id);
    const fdaChunks = chunks.filter(chunk => chunk.source === 'openFDA');
    const trialIds = [...new Set(trialChunks.map(chunk => chunk.nct_id))];
    const filterParts = [];
    if (filters.phase) filterParts.push(`phase contains ${filters.phase}`);
    if (filters.status) filterParts.push(`status is ${filters.status}`);
    if (filters.sponsor) filterParts.push(`sponsor matches ${filters.sponsor}`);

    const lines = [];
    if (trialIds.length) {
        lines.push(`I found ${trialIds.length} trial${trialIds.length === 1 ? '' : 's'} grounded in the indexed corpus${filterParts.length ? ` after applying structured filters (${filterParts.join(', ')})` : ''}.`);
        for (const nctId of trialIds.slice(0, 6)) {
            const trial = trialMap.get(nctId);
            const evidence = trialChunks.find(chunk => chunk.nct_id === nctId);
            lines.push(`${nctId}: ${trial?.title || evidence?.title || 'Untitled trial'} (${trial?.phase || 'phase not listed'}, ${trial?.status || 'status not listed'}). Evidence from ${evidence.section}: ${snippet(evidence.text)}`);
        }
    }

    if (fdaChunks.length) {
        lines.push(`FDA label/adverse-event evidence was retrieved from openFDA. These data are supporting regulatory/reporting evidence, not proof of causality or incidence.`);
        for (const chunk of fdaChunks.slice(0, 4)) {
            lines.push(`${chunk.drug_name || 'Drug'} - ${chunk.section}: ${snippet(chunk.text)}`);
        }
    }

    if (!lines.length) {
        lines.push(`I don't have data on that in the indexed corpus.`);
    }

    return lines.join('\n');
}

async function answerQuestion(question) {
    const cleanQuestion = String(question || '').trim();
    if (!cleanQuestion) {
        return { answer: 'Ask a question about indexed trials or FDA label evidence.', citations: [], retrievedTrials: [], refused: true };
    }

    const table = await new Promise(resolve => {
        getAiDb().get("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_chunks'", [], (err, row) => {
            resolve(err ? null : row);
        });
    });
    if (!table) {
        return {
            answer: `I don't have an AI corpus yet. Run python3 ai_build_corpus.py, then ask again.`,
            citations: [],
            retrievedTrials: [],
            refused: true
        };
    }

    const filters = parseStructuredFilters(cleanQuestion);
    const candidateIds = await structuredTrialIds(filters);
    const semanticQuery = stripStructuredTerms(cleanQuestion, filters) || cleanQuestion;
    if (/\b(best|guarantee|guaranteed|cure)\b/i.test(cleanQuestion)) {
        return {
            answer: `I don't have data on that in the indexed corpus.`,
            citations: [],
            retrievedTrials: [],
            refused: true,
            filters
        };
    }
    const unsupported = await unsupportedCorpusTerms(semanticQuery, candidateIds);
    if (unsupported.length) {
        return {
            answer: `I don't have data on that in the indexed corpus.`,
            citations: [],
            retrievedTrials: [],
            refused: true,
            filters,
            unsupportedTerms: process.env.NODE_ENV === 'test' ? unsupported : undefined
        };
    }
    const source = isOpenFdaQuestion(cleanQuestion) && !candidateIds ? 'openFDA' : undefined;
    const chunks = await semanticSearch(semanticQuery, candidateIds, { source, limit: 14 });
    const useful = chunks.filter(chunk => chunk.score >= 0.08).slice(0, 10);

    if (!useful.length) {
        return {
            answer: `I don't have data on that in the indexed corpus.`,
            citations: [],
            retrievedTrials: [],
            refused: true,
            filters
        };
    }

    const retrievedTrials = [...new Set(useful.filter(chunk => chunk.nct_id).map(chunk => chunk.nct_id))];
    const trialMap = await getTrialMap(retrievedTrials);
    return {
        answer: buildGroundedAnswer(cleanQuestion, useful, trialMap, filters),
        citations: uniqueCitations(useful),
        retrievedTrials,
        refused: false,
        filters,
        debug: process.env.NODE_ENV === 'test' ? useful.map(({ chunk_id, score }) => ({ chunk_id, score })) : undefined
    };
}

module.exports = { answerQuestion, parseStructuredFilters, semanticSearch, structuredTrialIds };
