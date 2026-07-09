import React from 'react';
import { NavLink } from 'react-router-dom';
import { Brain, LayoutDashboard, Bookmark } from 'lucide-react';

export default function Sidebar() {
  const navItems = [
    { name: 'All Trials', path: '/', icon: <LayoutDashboard size={20} /> },
    { name: 'Hybrid Q&A', path: '/ask', icon: <Brain size={20} /> },
    { name: 'My Watchlist', path: '/watchlist', icon: <Bookmark size={20} /> },
  ];

  return (
    <div className="hidden lg:flex w-64 bg-slate-50 border-r border-slate-200 h-screen flex-col fixed left-0 top-0">
      <div className="p-6 border-b border-slate-200">
        <h1 className="text-xl font-bold text-slate-800 tracking-tight">Intelligence v2</h1>
        <p className="text-sm text-slate-500">Clinical Data Unit</p>
      </div>
      
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                isActive 
                  ? 'bg-blue-500 text-white shadow-md shadow-blue-500/20' 
                  : 'text-slate-600 hover:bg-slate-100'
              }`
            }
          >
            {item.icon}
            <span className="font-medium text-sm">{item.name}</span>
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-slate-200 text-xs text-slate-500">
        Source database is opened read-only.
      </div>
    </div>
  );
}
