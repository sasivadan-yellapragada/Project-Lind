process.env.NODE_ENV = 'test';

const { getCorpusMetadata } = require('./ai');
const { sourceDb } = require('./db');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const aiDbPath = path.resolve(process.env.AI_DB_PATH || path.join(__dirname, 'ai_corpus.db'));

const CASES = [
    {
        id: 'prior-chemo',
        question: 'Recruiting Phase 3 trials whose eligibility allows prior chemotherapy',
        expectedTerms: ['prior', 'chemotherapy'],
        expectedTrialIdsAny: ['NCT06422143', 'NCT02468024', 'NCT07365319', 'NCT07144280', 'NCT07660094', 'NCT06300177'],
        filters: { phase: 'PHASE3', status: 'RECRUITING' }
    },
    {
        id: 'neoadjuvant-immunotherapy',
        question: 'Recruiting Phase 3 trials mentioning neoadjuvant immunotherapy',
        expectedTerms: ['neoadjuvant', 'immunotherapy'],
        expectedTrialIdsAny: ['NCT07431827', 'NCT06498635', 'NCT06734702', 'NCT07251582', 'NCT05429463'],
        filters: { phase: 'PHASE3', status: 'RECRUITING' }
    },
    {
        id: 'prior-radiation',
        question: 'Recruiting trials that mention prior radiation',
        expectedTerms: ['prior', 'radiation'],
        expectedTrialIdsAny: ['NCT06500481', 'NCT05317858', 'NCT04181060'],
        filters: { status: 'RECRUITING' }
    }
];

const REFUSAL_CASE = {
    id: 'teleportation-therapy',
    question: 'Recruiting Phase 3 trials whose eligibility requires teleportation therapy',
    unsupportedTerm: 'teleportation'
};

function aiQuery(db, query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

function dbQuery(db, query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

function chunkContainsAnswer(chunk, expectedTerms) {
    const text = `${chunk.section} ${chunk.title || ''} ${chunk.text || ''}`.toLowerCase();
    return expectedTerms.every(term => text.includes(term));
}

async function structuredCandidateIds(db, filters) {
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
    if (!clauses.length) return null;
    const rows = await dbQuery(
        db,
        `SELECT t.nct_id FROM trials t WHERE ${clauses.join(' AND ')} LIMIT 2000`,
        params
    );
    return new Set(rows.map(row => row.nct_id));
}

async function evidenceInCorpus(aiDb, testCase, candidateIds) {
    const idList = [...candidateIds].filter(id => testCase.expectedTrialIdsAny.includes(id));
    const hits = [];
    for (const nctId of idList) {
        const rows = await aiQuery(
            aiDb,
            `SELECT chunk_id, nct_id, section, title, text
             FROM ai_chunks
             WHERE nct_id = ? AND source = 'ClinicalTrials.gov'`,
            [nctId]
        );
        const answerChunks = rows.filter(row => chunkContainsAnswer(row, testCase.expectedTerms));
        hits.push({
            nctId,
            totalChunks: rows.length,
            answerChunkCount: answerChunks.length,
            answerChunkIds: answerChunks.map(row => row.chunk_id)
        });
    }
    return hits;
}

async function main() {
    const aiDb = new sqlite3.Database(aiDbPath, sqlite3.OPEN_READONLY);
    const metadata = await getCorpusMetadata();
    const openFdaCount = (await aiQuery(aiDb, "SELECT COUNT(*) AS c FROM ai_chunks WHERE source = 'openFDA'"))[0]?.c || 0;

    const corpusConfig = {
        chunkSize: metadata.chunk_size || 1800,
        overlap: metadata.chunk_overlap || 180,
        embeddedFields: metadata.embedded_fields || ['brief_summary', 'detailed_description', 'eligibility_criteria'],
        embeddingModel: metadata.embedding_model || 'nomic-embed-text',
        totalChunks: metadata.total_chunks || metadata.trial_chunks || null,
        sourceTrialCount: metadata.source_trial_count || null,
        openFdaChunks: openFdaCount,
        vectorStore: metadata.vector_store || 'SQLite ai_chunks + exact cosine scan'
    };

    const caseResults = [];
    for (const testCase of CASES) {
        const candidateIds = await structuredCandidateIds(sourceDb, testCase.filters);
        const evidenceHits = await evidenceInCorpus(aiDb, testCase, candidateIds || new Set());
        const anyExpectedHasAnswer = evidenceHits.some(hit => hit.answerChunkCount > 0);
        caseResults.push({
            id: testCase.id,
            question: testCase.question,
            structuredCandidateCount: candidateIds ? candidateIds.size : null,
            expectedTrialsWithAnswerChunks: evidenceHits.filter(hit => hit.answerChunkCount > 0),
            corpusContainsAnswer: anyExpectedHasAnswer,
            retrievalPrerequisite: anyExpectedHasAnswer
                ? 'PASS — expected trials have answer-bearing chunks in corpus'
                : 'FAIL — no expected trial has chunks containing all answer terms'
        });
    }

    const unsupportedRows = await aiQuery(
        aiDb,
        'SELECT 1 AS hit FROM ai_chunks WHERE LOWER(text) LIKE ? LIMIT 1',
        [`%${REFUSAL_CASE.unsupportedTerm}%`]
    );

    const report = {
        generatedAt: new Date().toISOString(),
        mode: 'offline-corpus-check',
        note: 'Verifies indexed evidence exists before Ollama retrieval/LLM timing tests. Run npm run diagnose:ai when Ollama is up for full metrics.',
        corpusConfig,
        openFdaStatus: openFdaCount > 0 ? 'present' : 'absent — trial-only path is active',
        diagnosis: {
            retrievalEvidencePresent: caseResults.every(row => row.corpusContainsAnswer),
            refusalTermAbsent: unsupportedRows.length === 0
        },
        cases: caseResults,
        refusalCase: {
            question: REFUSAL_CASE.question,
            unsupportedTermInCorpus: unsupportedRows.length > 0,
            expectedRefusal: true,
            prerequisite: unsupportedRows.length === 0
                ? 'PASS — unsupported term absent from corpus; refusal path should trigger'
                : 'FAIL — unsupported term found in corpus'
        }
    };

    console.log(JSON.stringify(report, null, 2));
    aiDb.close();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
