const fs = require('fs');
const path = require('path');
process.env.NODE_ENV = 'test';

const { answerQuestion, parseStructuredFilters, semanticSearch, structuredTrialIds, getCorpusMetadata } = require('./ai');
const sqlite3 = require('sqlite3').verbose();
const aiDbPath = path.resolve(process.env.AI_DB_PATH || path.join(__dirname, 'ai_corpus.db'));

async function hasOpenFdaCorpus() {
    const db = new sqlite3.Database(aiDbPath, sqlite3.OPEN_READONLY);
    const row = await new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) AS c FROM ai_chunks WHERE source = 'openFDA'", [], (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
    db.close();
    return (row?.c || 0) > 0;
}

function scoreCase(testCase, result) {
    const expectedSet = new Set(testCase.expectedTrialIdsAny || []);
    const retrievedSet = new Set(result.retrievedTrials || []);
    const matchedExpected = [...expectedSet].filter(id => retrievedSet.has(id));
    const retrievalPass = expectedSet.size === 0 || matchedExpected.length > 0;
    const refusalPass = Boolean(result.refused) === Boolean(testCase.expectedRefused);
    const citationPass = testCase.expectedRefused
        ? (result.citations || []).length === 0
        : (result.citations || []).some(citation => citation.source === testCase.requiresCitationSource);
    const groundingPass = (result.citations || []).every(citation => citation.nctId || citation.drug);

    return {
        retrievalPass,
        refusalPass,
        citationPass,
        groundingPass,
        pass: retrievalPass && refusalPass && citationPass && groundingPass
    };
}

function retrievalOnlyPass(testCase, retrievedTrials) {
    const expectedSet = new Set(testCase.expectedTrialIdsAny || []);
    if (testCase.expectedRefused) return retrievedTrials.length === 0;
    if (expectedSet.size === 0) return retrievedTrials.length > 0;
    return [...expectedSet].some(id => retrievedTrials.includes(id));
}

async function ollamaReachable() {
    const url = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
    try {
        const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) });
        return response.ok;
    } catch {
        return false;
    }
}

async function compareRetrievalModes(testCases) {
    const modeScores = {
        structured: [],
        semantic: [],
        hybrid: []
    };

    for (const testCase of testCases) {
        if (testCase.requiresCitationSource === 'openFDA') continue;

        const filters = parseStructuredFilters(testCase.question);
        const structuredIds = await structuredTrialIds(filters);
        const structuredRetrieved = structuredIds ? [...structuredIds].slice(0, 25) : [];

        const semanticChunks = await semanticSearch(testCase.question, null, { limit: 25 });
        const semanticRetrieved = [...new Set(semanticChunks.filter(chunk => chunk.score >= 0.08 && chunk.nct_id).map(chunk => chunk.nct_id))];

        const hybrid = await answerQuestion(testCase.question);

        modeScores.structured.push(retrievalOnlyPass(testCase, structuredRetrieved));
        modeScores.semantic.push(retrievalOnlyPass(testCase, semanticRetrieved));
        modeScores.hybrid.push(retrievalOnlyPass(testCase, hybrid.refused ? [] : hybrid.retrievedTrials || []));
    }

    return Object.fromEntries(
        Object.entries(modeScores).map(([mode, scores]) => [
            mode,
            scores.length ? Number((scores.filter(Boolean).length / scores.length).toFixed(3)) : null
        ])
    );
}

async function main() {
    const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'eval_cases.json'), 'utf8'));
    const trialOnly = process.env.EVAL_TRIAL_ONLY === '1';
    const openFdaAvailable = trialOnly ? false : await hasOpenFdaCorpus();
    const metadata = await getCorpusMetadata();
    const ollamaUp = await ollamaReachable();
    const runnable = cases.filter(testCase => {
        if (trialOnly && testCase.requiresCitationSource === 'openFDA') return false;
        return !(testCase.skipWhenNoOpenFda && !openFdaAvailable);
    });
    const results = [];

    for (const testCase of runnable) {
        const result = await answerQuestion(testCase.question);
        const scored = scoreCase(testCase, result);
        results.push({ testCase, result, scored });
    }

    const totals = {
        cases: results.length,
        retrieval: results.filter(row => row.scored.retrievalPass).length,
        refusal: results.filter(row => row.scored.refusalPass).length,
        citation: results.filter(row => row.scored.citationPass).length,
        grounding: results.filter(row => row.scored.groundingPass).length,
        passed: results.filter(row => row.scored.pass).length
    };

    const metrics = {
        retrievalAccuracy: totals.retrieval / totals.cases,
        refusalAccuracy: totals.refusal / totals.cases,
        citationAccuracy: totals.citation / totals.cases,
        groundingAccuracy: totals.grounding / totals.cases,
        passRate: totals.passed / totals.cases
    };
    const retrievalModeComparison = ollamaUp
        ? await compareRetrievalModes(runnable)
        : { skipped: 'Ollama unavailable' };

    console.log(`Mode: ${trialOnly ? 'trial-only (openFDA excluded)' : openFdaAvailable ? 'full (openFDA present)' : 'trial-only (no openFDA chunks)'}`);
    console.log(`Ollama: ${ollamaUp ? 'reachable' : 'unreachable — start Ollama before running eval'}`);
    if (metadata.chunk_size || metadata.embedding_model) {
        console.log(`Corpus: chunk_size=${metadata.chunk_size || 1800} overlap=${metadata.chunk_overlap || 180} embed=${metadata.embedding_model || 'nomic-embed-text'}`);
    }

    for (const row of results) {
        const mark = row.scored.pass ? 'PASS' : 'FAIL';
        console.log(`${mark} ${row.testCase.question}`);
        if (!row.scored.pass) {
            console.log(`  retrieval=${row.scored.retrievalPass} refusal=${row.scored.refusalPass} citation=${row.scored.citationPass} grounding=${row.scored.groundingPass}`);
            console.log(`  retrieved=${JSON.stringify(row.result.retrievedTrials)} refused=${row.result.refused}`);
            if (row.result.answer) console.log(`  answer=${row.result.answer.slice(0, 200)}`);
        }
    }

    const spotlight = {
        groundedWithCitations: results.find(row => !row.testCase.expectedRefused && row.scored.pass),
        unsupportedRefusal: results.find(row => row.testCase.expectedRefused && row.testCase.question.includes('teleportation'))
    };
    console.log('\nSpotlight targets');
    console.log(JSON.stringify({
        groundedWithCitations: spotlight.groundedWithCitations
            ? { pass: true, question: spotlight.groundedWithCitations.testCase.question }
            : { pass: false },
        unsupportedRefusal: spotlight.unsupportedRefusal
            ? { pass: spotlight.unsupportedRefusal.scored.refusalPass, question: spotlight.unsupportedRefusal.testCase.question }
            : { pass: false }
    }, null, 2));

    console.log('\nMetrics');
    console.log(JSON.stringify(metrics, null, 2));
    console.log('\nRetrieval mode comparison');
    console.log(JSON.stringify(retrievalModeComparison, null, 2));
    console.log('\nThresholds: retrieval >= 0.75, citation >= 0.90, grounding >= 0.95, refusal = 1.00');

    const ok = ollamaUp
        && metrics.retrievalAccuracy >= 0.75
        && metrics.citationAccuracy >= 0.90
        && metrics.groundingAccuracy >= 0.95
        && metrics.refusalAccuracy === 1;

    if (!ollamaUp) {
        console.log('\nEval incomplete: Ollama is not running. Start Ollama, pull models, then re-run.');
        process.exit(2);
    }

    process.exit(ok ? 0 : 1);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
