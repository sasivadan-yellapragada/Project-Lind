const { answerQuestion } = require('./backend/ai.js');
async function run() {
  const t0 = Date.now();
  console.log('Starting answerQuestion...');
  await answerQuestion('Recruiting Phase 3 trials whose eligibility allows prior chemotherapy');
  console.log(`Total time: ${Date.now() - t0}ms`);
}
run();
