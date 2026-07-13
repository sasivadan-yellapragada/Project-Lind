const { answerQuestion } = require('./backend/ai.js');
async function run() {
  const res = await answerQuestion('Recruiting Phase 3 trials whose eligibility allows prior chemotherapy');
  console.log(JSON.stringify(res, null, 2));
}
run();
