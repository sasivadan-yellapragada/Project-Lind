process.env.NODE_ENV = 'test';

const { performance } = require('perf_hooks');
const {
    answerQuestion,
    parseStructuredFilters,
    semanticSearch,
    structuredTrialIds,
    getCorpusMetadata,
    _debug
} = require('./ai');

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const LLM_MODEL = process.env.OLLAMA_LLM_MODEL || 'llama3.1:8b';
const TOP_K_VALUES = (process.env.DIAG_TOP_K || '3,8').split(',').map(value => Number.parseInt(value, 10));

const CASES = [
    {
        id: 'prior-chemo',
        question: 'Recruiting Phase 3 trials whose eligibility allows prior chemotherapy',
        semanticQuery: 'eligibility prior chemotherapy',
        expectedTerms: ['prior', 'chemotherapy'],
        expectedTrialIdsAny: ['NCT06422143', 'NCT02468024', 'NCT07365319', 'NCT07144280', 'NCT07660094', 'NCT06300177']
    },
    {
        id: 'neoadjuvant-immunotherapy',
        question: 'Recruiting Phase 3 trials mentioning neoadjuvant immunotherapy',
        semanticQuery: 'neoadjuvant immunotherapy',
        expectedTerms: ['neoadjuvant', 'immunotherapy'],
        expectedTrialIdsAny: ['NCT07431827', 'NCT06498635', 'NCT06734702', 'NCT07251582', 'NCT05429463']
    },
    {
        id: 'prior-radiation',
        question: 'Recruiting trials that mention prior radiation',
        semanticQuery: 'prior radiation',
        expectedTerms: ['prior', 'radiation'],
        expectedTrialIdsAny: ['NCT06500481', 'NCT05317858', 'NCT04181060', 'NCT06124118', 'NCT06627647', 'NCT02468024']
    }
];

const REFUSAL_CASE = {
    id: 'teleportation-therapy',
    question: 'Recruiting Phase 3 trials whose eligibility requires teleportation therapy'
};

function containsAnswer(chunk, expectedTerms) {
    const text = `${chunk.section} ${chunk.title || ''} ${chunk.text || ''}`.toLowerCase();
    return expectedTerms.every(term => text.includes(term));
}

function estimateTokens(text) {
    return Math.ceil(String(text || '').length / 4);
}

async function ollamaReachable() {
    try {
        const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
        return response.ok;
    } catch {
        return false;
    }
}

async function timedGenerate(prompt, numPredict = 160) {
    const start = performance.now();
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: LLM_MODEL,
            prompt,
            stream: false,
            options: {
                temperature: 0,
                num_predict: numPredict
            }
        })
    });
    const elapsedMs = performance.now() - start;
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ollama generation failed: ${response.status} ${body}`);
    }
    const payload = await response.json();
    const evalSeconds = (payload.eval_duration || 0) / 1e9;
    const totalSeconds = elapsedMs / 1000;
    return {
        response: String(payload.response || '').trim(),
        totalResponseTimeSec: Number(totalSeconds.toFixed(2)),
        promptEvalCount: payload.prompt_eval_count || null,
        outputTokens: payload.eval_count || null,
        tokensPerSecond: payload.eval_count && evalSeconds
            ? Number((payload.eval_count / evalSeconds).toFixed(2))
            : null
    };
}

function summarizeRetrieval(topKResults) {
    const best = topKResults.find(row => row.topK === Math.max(...TOP_K_VALUES)) || topKResults[topKResults.length - 1];
    return {
        verdict: best.anyChunkContainsAnswer && best.anyExpectedTrialRetrieved ? 'likely-ok' : 'needs-attention',
        anyChunkContainsAnswer: best.anyChunkContainsAnswer,
        anyExpectedTrialRetrieved: best.anyExpectedTrialRetrieved,
        topChunkScores: best.retrieved.map(chunk => chunk.score)
    };
}

function summarizePrompt(topKResults) {
    const rows = topKResults.map(row => ({
        topK: row.topK,
        promptTokenEstimate: row.promptTokenEstimate,
        promptEvalCount: row.promptEvalCount
    }));
    const noisy = rows.some(row => row.promptTokenEstimate > 6000);
    return {
        verdict: noisy ? 'possibly-noisy' : 'acceptable',
        byTopK: rows
    };
}

function summarizeLlm(topKResults, generic) {
    const rows = topKResults.map(row => ({
        topK: row.topK,
        tokensPerSecond: row.tokensPerSecond,
        totalResponseTimeSec: row.totalResponseTimeSec
    }));
    const slow = (generic.tokensPerSecond || 0) < 8 || (generic.totalResponseTimeSec || 0) > 20;
    return {
        verdict: slow ? 'possibly-too-slow' : 'acceptable',
        genericBaseline: {
            tokensPerSecond: generic.tokensPerSecond,
            totalResponseTimeSec: generic.totalResponseTimeSec
        },
        groundedByTopK: rows,
        tradeoffNote: slow
            ? 'llama3.1:8b may be heavy on this machine; smaller models (llama3.2:3b, phi3:mini) are faster but weaker at citation discipline.'
            : 'llama3.1:8b baseline looks acceptable; prioritize retrieval tuning before switching models.'
    };
}

async function diagnoseCase(testCase, corpusConfig, ollamaUp) {
    const filters = parseStructuredFilters(testCase.question);
    const candidateIds = await structuredTrialIds(filters);

    if (!ollamaUp) {
        return {
            id: testCase.id,
            question: testCase.question,
            skipped: true,
            reason: 'Ollama unavailable — run diagnose:corpus for offline evidence check'
        };
    }

    const chunks = await semanticSearch(testCase.semanticQuery, candidateIds, { limit: Math.max(...TOP_K_VALUES) });
    const trialMap = await _debug.getTrialMap([...new Set(chunks.filter(chunk => chunk.nct_id).map(chunk => chunk.nct_id))]);

    const topKResults = [];
    for (const topK of TOP_K_VALUES) {
        const selected = chunks.slice(0, topK);
        const prompt = _debug.buildPrompt(testCase.question, selected, trialMap, filters, { forceEvidenceSummary: true });
        const generation = await timedGenerate(prompt);
        const citedIds = [...new Set([...generation.response.matchAll(/\[C(\d+)\]/g)].map(match => Number.parseInt(match[1], 10)))];
        topKResults.push({
            topK,
            retrieved: selected.map(chunk => ({
                chunkId: chunk.chunk_id,
                nctId: chunk.nct_id,
                section: chunk.section,
                score: Number(chunk.score.toFixed(4)),
                containsAnswer: containsAnswer(chunk, testCase.expectedTerms)
            })),
            anyExpectedTrialRetrieved: selected.some(chunk => testCase.expectedTrialIdsAny.includes(chunk.nct_id)),
            anyChunkContainsAnswer: selected.some(chunk => containsAnswer(chunk, testCase.expectedTerms)),
            promptTokenEstimate: estimateTokens(prompt),
            promptEvalCount: generation.promptEvalCount,
            model: LLM_MODEL,
            tokensPerSecond: generation.tokensPerSecond,
            totalResponseTimeSec: generation.totalResponseTimeSec,
            citesRetrievedEvidenceCorrectly: citedIds.length > 0 && citedIds.every(id => id >= 1 && id <= selected.length),
            answerPreview: generation.response.slice(0, 500)
        });
    }

    const finalResult = await answerQuestion(testCase.question);
    return {
        id: testCase.id,
        question: testCase.question,
        filters,
        candidateTrialCount: candidateIds ? candidateIds.size : null,
        ...corpusConfig,
        topKValuesTested: TOP_K_VALUES,
        topKResults,
        threeQuestions: {
            retrieval: summarizeRetrieval(topKResults),
            promptSize: summarizePrompt(topKResults),
            llmSpeed: null
        },
        finalAnswer: {
            refused: finalResult.refused,
            retrievedTrials: finalResult.retrievedTrials,
            citationCount: finalResult.citations?.length || 0,
            citesCorrectly: !finalResult.refused && (finalResult.citations || []).length > 0,
            answerPreview: finalResult.answer?.slice(0, 500)
        }
    };
}

async function main() {
    const metadata = await getCorpusMetadata();
    const corpusConfig = {
        chunkSize: metadata.chunk_size || 1800,
        overlap: metadata.chunk_overlap || 180,
        embeddedFields: metadata.embedded_fields || ['brief_summary', 'detailed_description', 'eligibility_criteria'],
        embeddingModel: metadata.embedding_model || 'nomic-embed-text',
        vectorStore: metadata.vector_store || 'SQLite ai_chunks + exact cosine scan'
    };

    const ollamaUp = await ollamaReachable();
    let generic = null;
    if (ollamaUp) {
        const genericPrompt = 'In two short sentences, explain what a clinical trial eligibility criterion is.';
        generic = {
            model: LLM_MODEL,
            prompt: genericPrompt,
            promptTokenEstimate: estimateTokens(genericPrompt),
            ...(await timedGenerate(genericPrompt, 80)),
            responsePreview: ''
        };
        generic.responsePreview = generic.response.slice(0, 300);
    }

    const cases = [];
    for (const testCase of CASES) {
        const row = await diagnoseCase(testCase, corpusConfig, ollamaUp);
        if (row.threeQuestions && generic) {
            row.threeQuestions.llmSpeed = summarizeLlm(row.topKResults, generic);
        }
        cases.push(row);
    }

    let refusalResult = null;
    if (ollamaUp) {
        refusalResult = await answerQuestion(REFUSAL_CASE.question);
    }

    const report = {
        generatedAt: new Date().toISOString(),
        ollamaReachable: ollamaUp,
        vectorStoreNote: 'SQLite exact cosine is fine for this corpus size (~36k chunks); move to FAISS/Chroma/Qdrant when ANN latency or corpus scale makes linear scan costly.',
        openFdaNote: 'openFDA is out of the critical path; build with --skip-openfda or tolerate timeouts; eval skips FDA cases when no openFDA chunks exist.',
        genericPrompt: generic,
        cases,
        refusalCase: refusalResult
            ? {
                question: REFUSAL_CASE.question,
                refused: refusalResult.refused,
                pass: refusalResult.refused === true
            }
            : { question: REFUSAL_CASE.question, skipped: true, reason: 'Ollama unavailable' },
        targets: {
            groundedAnswerWithCitations: cases.some(row => row.finalAnswer && !row.finalAnswer.refused && row.finalAnswer.citesCorrectly),
            unsupportedQuestionRefusal: refusalResult ? refusalResult.refused === true : null
        }
    };

    console.log(JSON.stringify(report, null, 2));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
