const { dbQuery, dbGet, sourceDb } = require('./db');
const { semanticSearch } = require('./ai');

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const LLM_MODEL = process.env.OLLAMA_LLM_MODEL || 'llama3.1:8b';

// Simple in-memory cache for agent responses
const responseCache = new Map();

// --- Tools ---

async function tool_query_trials_db(args) {
    const conditions = [];
    const params = [];
    let sql = 'SELECT nct_id, title, phase, status, sponsor FROM trials';

    if (args.keyword) {
        conditions.push('(title LIKE ? OR brief_summary LIKE ? OR sponsor LIKE ?)');
        params.push(`%${args.keyword}%`, `%${args.keyword}%`, `%${args.keyword}%`);
    }
    if (args.phase) {
        conditions.push('phase LIKE ?');
        params.push(`%${args.phase}%`);
    }
    if (args.status) {
        conditions.push('status = ?');
        params.push(args.status);
    }
    if (args.sponsor) {
        conditions.push('sponsor LIKE ?');
        params.push(`%${args.sponsor}%`);
    }
    
    if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' LIMIT 50';

    try {
        const rows = await dbQuery(sourceDb, sql, params);
        return JSON.stringify({ count: rows.length, trials: rows });
    } catch (err) {
        return JSON.stringify({ error: err.message });
    }
}

async function tool_get_trial_details(args) {
    if (!args.nct_id) return JSON.stringify({ error: 'nct_id is required' });
    try {
        const trial = await dbGet(sourceDb, 'SELECT * FROM trials WHERE nct_id = ?', [args.nct_id]);
        if (!trial) return JSON.stringify({ error: 'Trial not found' });
        return JSON.stringify(trial);
    } catch (err) {
        return JSON.stringify({ error: err.message });
    }
}

async function tool_search_fda_safety(args) {
    if (!args.drug_name) return JSON.stringify({ error: 'drug_name is required' });
    try {
        const chunks = await semanticSearch(args.drug_name, null, { source: 'openFDA', limit: 5 });
        if (!chunks || chunks.length === 0) return JSON.stringify({ result: 'No FDA safety signals found.' });
        
        const evidence = chunks.map(c => `[${c.chunk_id}] ${c.section}: ${c.text.substring(0, 300)}...`);
        return JSON.stringify({ signals: evidence });
    } catch (err) {
        return JSON.stringify({ error: err.message });
    }
}

const TOOLS_DEF = [
    {
        type: 'function',
        function: {
            name: 'query_trials_db',
            description: 'Query the clinical trials database for a list of trials matching criteria.',
            parameters: {
                type: 'object',
                properties: {
                    keyword: { type: 'string', description: 'Keyword to search in title, summary, or sponsor' },
                    phase: { type: 'string', description: 'Phase like PHASE3, PHASE2, etc.' },
                    status: { type: 'string', description: 'Status like RECRUITING, COMPLETED, etc.' },
                    sponsor: { type: 'string', description: 'Sponsor name' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_trial_details',
            description: 'Get detailed information about a specific trial by its NCT ID.',
            parameters: {
                type: 'object',
                properties: {
                    nct_id: { type: 'string', description: 'The NCT ID of the trial, e.g., NCT01234567' }
                },
                required: ['nct_id']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_fda_safety',
            description: 'Search openFDA for safety signals, adverse events, or warnings for a specific drug.',
            parameters: {
                type: 'object',
                properties: {
                    drug_name: { type: 'string', description: 'The name of the drug or intervention' }
                },
                required: ['drug_name']
            }
        }
    }
];

// --- Agent Loop ---

async function runAgent(requestText) {
    const cacheKey = requestText.trim().toLowerCase();
    if (responseCache.has(cacheKey)) {
        return responseCache.get(cacheKey);
    }

    const systemPrompt = `You are a clinical-trials intelligence agent. Your job is to research the user's request and produce a structured, cited briefing.
You have access to tools to query trial data, get specific trial details, and search openFDA safety signals.

CRITICAL INSTRUCTIONS:
1. WORKFLOW (Plan -> Act -> Synthesize): First, call tools to gather necessary data. You may call tools multiple times.
2. SYNTHESIZE: Once you have enough data, provide a final structured Markdown response.
3. MANDATORY SECTIONS: Your final output MUST include exactly these headers, even if you have no data for them (just write "Not applicable" under the header):
   - "## Trials by Phase"
   - "## Key Sponsors"
   - "## Safety Signals" (use search_fda_safety to populate this if a drug is mentioned)
4. CITATIONS: You must cite the NCT IDs or FDA chunk IDs in your text using brackets, e.g., [NCT01234567] or [chunk_id].
5. Do not include raw JSON in your final text. Keep it readable and professional.`;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: requestText }
    ];

    const trace = [];
    const startTime = Date.now();
    let totalTokens = 0;

    let iterations = 0;
    const MAX_ITERATIONS = 8;

    while (iterations < MAX_ITERATIONS) {
        iterations++;
        
        try {
            const response = await fetch(`${OLLAMA_URL}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: LLM_MODEL,
                    messages,
                    tools: TOOLS_DEF,
                    stream: false,
                    options: { temperature: 0.1 }
                })
            });

            if (!response.ok) {
                throw new Error(`Ollama chat failed: ${response.statusText}`);
            }

            const data = await response.json();
            const message = data.message;
            totalTokens += (data.prompt_eval_count || 0) + (data.eval_count || 0);

            if (message.tool_calls && message.tool_calls.length > 0) {
                // Agent decided to Act
                messages.push(message);
                trace.push({ type: 'thought', content: 'Agent decided to call tools.' });

                for (const toolCall of message.tool_calls) {
                    const fnName = toolCall.function.name;
                    const args = toolCall.function.arguments;
                    trace.push({ type: 'tool_call', name: fnName, args });

                    let result = '';
                    if (fnName === 'query_trials_db') result = await tool_query_trials_db(args);
                    else if (fnName === 'get_trial_details') result = await tool_get_trial_details(args);
                    else if (fnName === 'search_fda_safety') result = await tool_search_fda_safety(args);
                    else result = JSON.stringify({ error: 'Unknown tool' });

                    messages.push({
                        role: 'tool',
                        content: result
                    });
                    trace.push({ type: 'tool_result', name: fnName, result: result.substring(0, 500) + (result.length > 500 ? '...' : '') });
                }
            } else {
                // Agent decided to Synthesize
                trace.push({ type: 'synthesize', content: 'Agent generated final response.' });
                
                const executionTime = Date.now() - startTime;
                const resultObj = {
                    answer: message.content,
                    trace,
                    meta: {
                        executionTimeMs: executionTime,
                        tokens: totalTokens
                    }
                };
                
                // Cache the response
                responseCache.set(cacheKey, resultObj);
                
                return resultObj;
            }
        } catch (err) {
            trace.push({ type: 'error', content: err.message });
            return {
                answer: 'An error occurred while generating the briefing. See trace for details.',
                trace,
                meta: { executionTimeMs: Date.now() - startTime, tokens: totalTokens }
            };
        }
    }

    return {
        answer: 'The agent reached the maximum number of iterations without producing a final answer.',
        trace,
        meta: { executionTimeMs: Date.now() - startTime, tokens: totalTokens }
    };
}

module.exports = { runAgent };
