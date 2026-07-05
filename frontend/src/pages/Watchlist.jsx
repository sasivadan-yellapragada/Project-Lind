import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { Trash2, ExternalLink, Search, Filter } from 'lucide-react';

export default function Watchlist() {
  const [watchlist, setWatchlist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchWatchlist();
  }, []);

  const fetchWatchlist = async () => {
    try {
      const res = await api.get('/watchlist');
      setWatchlist(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const removeTrial = async (nctId) => {
    try {
      await api.delete(`/watchlist/${nctId}`);
      setWatchlist(watchlist.filter(t => t.nct_id !== nctId));
    } catch (err) {
      console.error(err);
    }
  };

  const filteredWatchlist = watchlist.filter(t => 
    t.title?.toLowerCase().includes(search.toLowerCase()) || 
    t.nct_id?.toLowerCase().includes(search.toLowerCase()) ||
    t.sponsor?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto h-full flex flex-col">
      <div className="flex justify-between items-end mb-6">
        <div>
          <div className="flex items-center gap-4 mb-2">
            <h2 className="text-3xl font-bold text-slate-800 tracking-tight">My Watchlist</h2>
            <span className="bg-blue-100 text-blue-700 font-bold px-3 py-1 rounded-full text-xs">{watchlist.length} Trials Bookmarked</span>
          </div>
          <p className="text-sm text-slate-500">High-priority monitoring for ongoing clinical datasets.</p>
        </div>
        
        <div className="flex gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder="Search within Watchlist..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-slate-300 rounded-xl text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none w-64"
            />
          </div>
          <button className="p-2 border border-slate-300 bg-white rounded-xl text-slate-500 hover:bg-slate-50">
            <Filter size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto pb-8">
        {loading ? (
          <div className="text-center p-8 text-slate-500">Loading watchlist...</div>
        ) : filteredWatchlist.length === 0 ? (
          <div className="text-center p-8 bg-white border border-slate-200 rounded-2xl text-slate-500 shadow-sm">
            No trials found in your watchlist.
          </div>
        ) : (
          filteredWatchlist.map(trial => (
            <div key={trial.nct_id} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow flex items-center justify-between group">
              <div className="flex gap-8 items-center flex-1">
                <Link to={`/trial/${trial.nct_id}`} className="font-bold text-slate-800 hover:text-blue-600 transition-colors w-32">
                  {trial.nct_id}
                </Link>
                <div className="flex-1 max-w-xl">
                  <h3 className="font-semibold text-slate-800 truncate" title={trial.title}>{trial.title}</h3>
                  <div className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-semibold flex items-center gap-2">
                    <span className="text-slate-700">{trial.conditions?.[0] || 'VARIOUS'}</span>
                    <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                    <span>{trial.sponsor}</span>
                  </div>
                </div>
                <div className="w-24">
                   <span className="text-sm font-medium text-slate-600">{trial.phase || 'N/A'}</span>
                </div>
                <div className="w-32">
                  <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${
                    trial.status === 'RECRUITING' ? 'bg-green-100 text-green-700' : 
                    trial.status === 'COMPLETED' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {trial.status}
                  </span>
                </div>
              </div>
              
              <div className="flex items-center gap-6 ml-8 pl-8 border-l border-slate-100">
                <div className="text-xs text-slate-400">
                  Added: <br/>
                  <span className="font-medium text-slate-600">{new Date(trial.added_at).toLocaleDateString()}</span>
                </div>
                <Link to={`/trial/${trial.nct_id}`} className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1">
                  Open Detail <ExternalLink size={14} />
                </Link>
                <button onClick={() => removeTrial(trial.nct_id)} className="text-slate-300 hover:text-red-500 transition-colors p-2 rounded-lg hover:bg-red-50">
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
