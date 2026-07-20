import React, { useState } from 'react';
import { AlertCircle, Brain, Loader2, Bot, TerminalSquare, Clock } from 'lucide-react';
import api from '../api';

export default function AgentBriefing() {
  const [question, setQuestion] = useState('Give me the competitive landscape for non-small cell lung cancer Phase 3 trials.');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runAgent = async (event) => {
    event?.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const response = await api.post('/agent', { question: question.trim() });
      setResult(response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to run agent');
    } finally {
      setLoading(false);
    }
  };

  const examples = [
    'Give me the competitive landscape for non-small cell lung cancer Phase 3 trials.',
    'Give me the competitive landscape for pembrolizumab including safety signals from openFDA.'
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Bot size={28} className="text-purple-600" />
          Agentic Briefing
        </h2>
        <p className="text-sm text-slate-500 mt-1">Multi-step planner agent that retrieves across databases to synthesize structured briefs.</p>
      </div>

      <form onSubmit={runAgent} className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 space-y-4">
        <label className="block text-sm font-semibold text-slate-700" htmlFor="ai-question">Topic</label>
        <div className="flex flex-col sm:flex-row gap-3">
          <textarea
            id="ai-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            className="flex-1 min-h-24 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-md bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 disabled:bg-slate-300 min-w-32"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Bot size={18} />}
            Generate
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

      {loading && (
        <div className="flex items-center justify-center p-12 text-slate-500 gap-3">
          <Loader2 size={24} className="animate-spin text-purple-600" />
          <span className="animate-pulse">Agent is thinking and querying tools...</span>
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <section className="lg:col-span-2 space-y-4">
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6 prose prose-slate prose-h2:text-lg prose-h2:text-purple-800 prose-h2:border-b prose-h2:pb-2 max-w-none">
              {/* Simple Markdown rendering fallback for raw text */}
              {result.answer.split('\n').map((line, i) => {
                if (line.startsWith('## ')) return <h2 key={i} className="text-xl font-bold mt-6 mb-3 text-purple-800 border-b pb-2">{line.replace('## ', '')}</h2>;
                if (line.startsWith('# ')) return <h1 key={i} className="text-2xl font-bold mt-6 mb-4">{line.replace('# ', '')}</h1>;
                if (line.startsWith('- ')) return <li key={i} className="ml-4">{line.substring(2)}</li>;
                if (line.trim() === '') return <br key={i} />;
                return <p key={i} className="mb-2">{line}</p>;
              })}
            </div>
          </section>

          <aside className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-lg shadow-sm p-4 overflow-hidden flex flex-col h-full max-h-[800px]">
              <div className="flex items-center gap-2 text-slate-300 border-b border-slate-700 pb-3 mb-3">
                <TerminalSquare size={18} className="text-emerald-400" />
                <h3 className="font-mono text-sm font-semibold tracking-wide">Observability Trace</h3>
              </div>
              <div className="flex-1 overflow-y-auto space-y-3 font-mono text-xs text-slate-300">
                {result.trace?.map((t, i) => (
                  <div key={i} className="border-l-2 border-slate-700 pl-3 py-1">
                    <span className="text-emerald-400 opacity-70">[{i+1}] </span>
                    {t.type === 'thought' && <span className="text-blue-300 italic">{t.content}</span>}
                    {t.type === 'tool_call' && <span><span className="text-purple-400 font-semibold">{t.name}</span>({JSON.stringify(t.args)})</span>}
                    {t.type === 'tool_result' && <span className="text-slate-500 italic block mt-1 overflow-hidden text-ellipsis whitespace-nowrap" title={t.result}>Result: {t.result}</span>}
                    {t.type === 'synthesize' && <span className="text-emerald-300 font-semibold">{t.content}</span>}
                    {t.type === 'error' && <span className="text-red-400 font-semibold">{t.content}</span>}
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-3 border-t border-slate-700 flex items-center justify-between text-xs text-slate-400">
                <div className="flex items-center gap-1"><Clock size={14}/> {result.meta?.executionTimeMs}ms</div>
                <div className="flex items-center gap-1"><Brain size={14}/> {result.meta?.tokens} tokens</div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
