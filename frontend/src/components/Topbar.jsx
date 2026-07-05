import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Search } from 'lucide-react';

export default function Topbar({ searchTerm, setSearchTerm, onSearchSubmit }) {
  return (
    <div className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-3 xl:h-20 xl:flex-row xl:items-center xl:justify-between sticky top-0 z-10">
      <div className="flex-1 max-w-3xl flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            if (onSearchSubmit) onSearchSubmit(searchTerm);
          }}
          className="relative flex-1"
        >
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Search across titles, sponsors, and conditions..." 
            className="w-full bg-slate-100/70 border border-transparent focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 rounded-xl py-2.5 pl-12 pr-4 text-sm transition-all outline-none"
            value={searchTerm || ''}
            onChange={(e) => setSearchTerm && setSearchTerm(e.target.value)}
          />
        </form>
        
        <nav className="flex gap-5 text-sm font-medium text-slate-500">
          <NavLink to="/" className={({ isActive }) => isActive ? 'text-blue-600 border-b-2 border-blue-600 pb-1' : 'hover:text-slate-900 transition-colors'}>Trials</NavLink>
          <NavLink to="/watchlist" className={({ isActive }) => isActive ? 'text-blue-600 border-b-2 border-blue-600 pb-1' : 'hover:text-slate-900 transition-colors'}>Watchlist</NavLink>
        </nav>
      </div>

      <div className="hidden xl:flex items-center gap-5 text-slate-400">
        <Link to="/" className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">
          CT
        </Link>
      </div>
    </div>
  );
}
