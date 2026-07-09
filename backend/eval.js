const fs = require('fs');
const path = require('path');
process.env.NODE_ENV = 'test';

const { answerQuestion, parseStructuredFilters, semanticSearch, structuredTrialIds } = require('./ai');

async function hasOpenFdaCorpus() {
    const result = await answerQuestion('openFDA adverse reactions pembrolizumab');
    return result.citations.some(citation => citation.source === 'openFDA');
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
    const openFdaAvailable = await hasOpenFdaCorpus();
    const runnable = cases.filter(testCase => !(testCase.skipWhenNoOpenFda && !openFdaAvailable));
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
    const retrievalModeComparison = await compareRetrievalModes(runnable);

    for (const row of results) {
        const mark = row.scored.pass ? 'PASS' : 'FAIL';
        console.log(`${mark} ${row.testCase.question}`);
        if (!row.scored.pass) {
            console.log(`  retrieved=${JSON.stringify(row.result.retrievedTrials)} refused=${row.result.refused}`);
            console.log(`  citations=${JSON.stringify(row.result.citations)}`);
        }
    }

    console.log('\nMetrics');
    console.log(JSON.stringify(metrics, null, 2));
    console.log('\nRetrieval mode comparison');
    console.log(JSON.stringify(retrievalModeComparison, null, 2));
    console.log('\nThresholds: retrieval >= 0.75, citation >= 0.90, grounding >= 0.95, refusal = 1.00');

    const ok = metrics.retrievalAccuracy >= 0.75
        && metrics.citationAccuracy >= 0.90
        && metrics.groundingAccuracy >= 0.95
        && metrics.refusalAccuracy === 1;

    process.exit(ok ? 0 : 1);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
