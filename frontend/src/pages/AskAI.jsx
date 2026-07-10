import React, { useState } from 'react';
import { AlertCircle, Brain, ExternalLink, Loader2, Search, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../api';

const examples = [
  'Recruiting Phase 3 trials whose eligibility allows prior chemotherapy',
  'Recruiting Phase 3 trials mentioning neoadjuvant immunotherapy',
  'What does openFDA say about pembrolizumab adverse reactions?',
  'Recruiting Phase 3 trials whose eligibility requires teleportation therapy'
];

export default function AskAI() {
  const [question, setQuestion] = useState(examples[0]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const ask = async (event) => {
    event?.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.post('/ask', { question: question.trim() });
      setResult(response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to answer question');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Grounded Q&A</h2>
          <p className="text-sm text-slate-500 mt-1">Ollama embeddings, SQLite vector search, and local LLM synthesis over trial text and openFDA evidence.</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-md">
          <ShieldCheck size={16} />
          Grounded citations only
        </div>
      </div>

      <form onSubmit={ask} className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 space-y-4">
        <label className="block text-sm font-semibold text-slate-700" htmlFor="ai-question">Question</label>
        <div className="flex flex-col sm:flex-row gap-3">
          <textarea
            id="ai-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            className="flex-1 min-h-24 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:bg-slate-300"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
            Ask
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setQuestion(example)}
              className="text-xs px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              {example}
            </button>
          ))}
        </div>
      </form>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 text-red-700 p-3 text-sm">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
          <section className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <Brain size={20} className="text-blue-600" />
              <h3 className="font-semibold text-slate-900">Answer</h3>
              {result.refused && <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md">Refused</span>}
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-slate-700">{result.answer}</pre>
          </section>

          <aside className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
              <h3 className="font-semibold text-slate-900 mb-3">Retrieved Trials</h3>
              {result.retrievedTrials?.length ? (
                <div className="space-y-2">
                  {result.retrievedTrials.map((nctId) => (
                    <Link key={nctId} to={`/trial/${nctId}`} className="flex items-center justify-between text-sm text-blue-700 hover:text-blue-900">
                      {nctId}
                      <ExternalLink size={15} />
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No trial IDs returned.</p>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
              <h3 className="font-semibold text-slate-900 mb-3">Citations</h3>
              {result.citations?.length ? (
                <div className="space-y-3">
                  {result.citations.map((citation) => (
                    <div key={citation.chunkId} className="border border-slate-200 rounded-md p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">{citation.source}</div>
                      <div className="text-sm font-semibold text-slate-800 mt-1">{citation.nctId || citation.drug}</div>
                      <div className="text-sm text-slate-600">{citation.section}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No citations because the system declined to answer.</p>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
