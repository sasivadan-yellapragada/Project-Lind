import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { RotateCcw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export default function TrialExplorer({ activeSearch }) {
  const [trials, setTrials] = useState([]);
  const [meta, setMeta] = useState({ totalCount: 0, page: 1, limit: 50, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ phases: [], statuses: [], sponsors: [], conditions: [] });

  // Filters
  const [phase, setPhase] = useState('');
  const [status, setStatus] = useState('');
  const [sponsor, setSponsor] = useState('');
  const [condition, setCondition] = useState('');

  // Pagination UI state
  const [jumpPage, setJumpPage] = useState('');

  useEffect(() => {
    api.get('/filters')
      .then(res => setFilters(res.data))
      .catch(err => console.error(err));
  }, []);

  const fetchTrials = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = {
        page,
        limit: 50,
      };
      if (activeSearch) params.keyword = activeSearch;
      if (phase) params.phase = phase;
      if (status) params.status = status;
      if (sponsor) params.sponsor = sponsor;
      if (condition) params.condition = condition;

      const res = await api.get('/trials', { params });
      setTrials(res.data.data);
      setMeta(res.data.meta);
      setJumpPage(res.data.meta.page.toString());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [activeSearch, phase, status, sponsor, condition]);

  useEffect(() => {
    fetchTrials(1);
  }, [fetchTrials]);

  const handleJump = (e) => {
    e.preventDefault();
    const p = parseInt(jumpPage, 10);
    if (p >= 1 && p <= meta.totalPages) {
      fetchTrials(p);
    }
  };

  const resetFilters = () => {
    setPhase('');
    setStatus('');
    setSponsor('');
    setCondition('');
  };

  const getStatusBadge = (statusStr) => {
    if (!statusStr) return null;
    const s = statusStr.toUpperCase();
    if (s.includes('RECRUITING') && !s.includes('NOT')) {
      return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">RECRUITING</span>;
    }
    if (s.includes('COMPLETED')) {
      return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">COMPLETED</span>;
    }
    return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">{statusStr}</span>;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-end mb-6">
        <div>
          <div className="text-sm text-slate-500 mb-1">Home &gt; Trial Listing</div>
          <h2 className="text-3xl font-bold text-slate-800 tracking-tight">Trial Explorer</h2>
        </div>
        <div className="flex gap-3">
          <button onClick={resetFilters} className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 font-medium text-sm transition-colors text-slate-700">
            <RotateCcw size={16} /> Reset Filters
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm mb-6 p-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex-1 min-w-[150px]">
          <label className="block text-xs font-semibold text-slate-500 mb-1">Phase</label>
          <select value={phase} onChange={e => setPhase(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 transition-colors">
            <option value="">All Phases</option>
            {filters.phases.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[150px]">
          <label className="block text-xs font-semibold text-slate-500 mb-1">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 transition-colors">
            <option value="">Any Status</option>
            {filters.statuses.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[150px]">
          <label className="block text-xs font-semibold text-slate-500 mb-1">Condition</label>
          <input type="text" value={condition} onChange={e => setCondition(e.target.value)} placeholder="Exact condition" list="condition-options" className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 transition-colors" />
          <datalist id="condition-options">
            {filters.conditions.map(value => <option key={value} value={value} />)}
          </datalist>
        </div>
        <div className="flex-1 min-w-[150px]">
          <label className="block text-xs font-semibold text-slate-500 mb-1">Sponsor</label>
          <input type="text" value={sponsor} onChange={e => setSponsor(e.target.value)} placeholder="Exact sponsor" list="sponsor-options" className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 transition-colors" />
          <datalist id="sponsor-options">
            {filters.sponsors.map(value => <option key={value} value={value} />)}
          </datalist>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex-1 flex flex-col overflow-hidden">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="p-4 pl-6">NCT ID</th>
                <th className="p-4">Title</th>
                <th className="p-4">Condition</th>
                <th className="p-4">Sponsor</th>
                <th className="p-4">Phase</th>
                <th className="p-4 pr-6">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan="6" className="p-8 text-center text-slate-400">Loading trials...</td></tr>
              ) : trials.length === 0 ? (
                <tr><td colSpan="6" className="p-8 text-center text-slate-400">No trials found matching your criteria.</td></tr>
              ) : (
                trials.map(trial => (
                  <tr key={trial.nct_id} className="hover:bg-blue-50/50 transition-colors group">
                    <td className="p-4 pl-6 font-medium text-blue-600">
                      <Link to={`/trial/${trial.nct_id}`} className="hover:underline">{trial.nct_id}</Link>
                    </td>
                    <td className="p-4 text-sm text-slate-800 font-medium max-w-md truncate" title={trial.title}>{trial.title}</td>
                    <td className="p-4 text-sm text-slate-500 max-w-[220px] truncate" title={trial.condition}>{trial.condition || 'N/A'}</td>
                    <td className="p-4 text-sm text-slate-500 max-w-[200px] truncate" title={trial.sponsor}>{trial.sponsor}</td>
                    <td className="p-4">
                      {trial.phase && (
                        <span className="bg-blue-50 text-blue-700 text-xs font-bold px-2 py-1 rounded-md border border-blue-100">
                          {trial.phase.replace('PHASE', 'PH ')}
                        </span>
                      )}
                    </td>
                    <td className="p-4 pr-6">
                      {getStatusBadge(trial.status)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination UI */}
        <div className="border-t border-slate-200 p-4 bg-slate-50 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between text-sm text-slate-600">
          <div>
            Showing <span className="font-semibold text-slate-800">{trials.length > 0 ? (meta.page - 1) * meta.limit + 1 : 0}</span> to <span className="font-semibold text-slate-800">{Math.min(meta.page * meta.limit, meta.totalCount)}</span> of <span className="font-semibold text-slate-800">{meta.totalCount.toLocaleString()}</span> trials
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => fetchTrials(1)} disabled={meta.page === 1} className="p-1 rounded hover:bg-slate-200 disabled:opacity-50 text-slate-500"><ChevronsLeft size={18} /></button>
            <button onClick={() => fetchTrials(meta.page - 1)} disabled={meta.page === 1} className="p-1 rounded hover:bg-slate-200 disabled:opacity-50 text-slate-500"><ChevronLeft size={18} /></button>
            
            <div className="flex items-center gap-1 mx-2">
              <span className="font-semibold text-slate-800 bg-white border border-slate-200 rounded px-3 py-1 shadow-sm">{meta.page}</span>
              <span className="text-slate-400">/</span>
              <span>{meta.totalPages.toLocaleString()}</span>
            </div>

            <button onClick={() => fetchTrials(meta.page + 1)} disabled={meta.page >= meta.totalPages} className="p-1 rounded hover:bg-slate-200 disabled:opacity-50 text-slate-500"><ChevronRight size={18} /></button>
            <button onClick={() => fetchTrials(meta.totalPages)} disabled={meta.page >= meta.totalPages} className="p-1 rounded hover:bg-slate-200 disabled:opacity-50 text-slate-500"><ChevronsRight size={18} /></button>
            
            <div className="ml-4 pl-4 border-l border-slate-300 flex items-center gap-2">
              <span>Go to page</span>
              <form onSubmit={handleJump}>
                <input 
                  type="number" 
                  value={jumpPage} 
                  onChange={e => setJumpPage(e.target.value)} 
                  className="w-16 border border-slate-300 rounded px-2 py-1 text-center outline-none focus:border-blue-500 bg-white"
                  min="1"
                  max={meta.totalPages}
                />
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
