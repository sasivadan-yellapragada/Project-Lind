const fs = require('fs');
const path = require('path');
process.env.NODE_ENV = 'test';

const { runAgent } = require('./agent');

async function main() {
    console.log("Starting Agent Eval...");

    const testCases = [
        "Give me the competitive landscape for non-small cell lung cancer phase 3 trials.",
        "What is the landscape for pembrolizumab including safety signals from openFDA?"
    ];

    let passed = 0;
    
    for (const testCase of testCases) {
        console.log(`\nEvaluating: "${testCase}"`);
        const result = await runAgent(testCase);
        
        let pass = true;
        
        // Check if tools were called
        const toolCalls = result.trace.filter(t => t.type === 'tool_call');
        if (toolCalls.length === 0) {
            console.error("  FAIL: No tools were called by the agent.");
            pass = false;
        } else {
            console.log(`  PASS: Agent called ${toolCalls.length} tools.`);
        }
        
        // Check if final answer has structured sections
        const answer = result.answer || "";
        const hasPhase = answer.toLowerCase().includes('trials by phase');
        const hasSponsor = answer.toLowerCase().includes('key sponsors');
        const hasSafety = answer.toLowerCase().includes('safety signals');
        
        if (!hasPhase || !hasSponsor || !hasSafety) {
            console.error("  FAIL: Final output is missing required structured sections.");
            console.error(`    Found Phase: ${hasPhase}, Sponsor: ${hasSponsor}, Safety: ${hasSafety}`);
            pass = false;
        } else {
            console.log("  PASS: Final output contains required structured sections.");
        }
        
        // Check citations
        const hasCitations = /\[(?:NCT\d+|chunk_[a-zA-Z0-9]+|c\d+)\]/i.test(answer) || /\[.*\]/.test(answer);
        if (!hasCitations) {
            console.error("  FAIL: Final output is missing citations.");
            pass = false;
        } else {
            console.log("  PASS: Final output contains citations.");
        }
        
        if (pass) {
            passed++;
            console.log(`  RESULT: PASS`);
        } else {
            console.log(`  RESULT: FAIL`);
        }
    }
    
    console.log(`\nEval Complete: ${passed}/${testCases.length} Passed`);
    process.exit(passed === testCases.length ? 0 : 1);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
