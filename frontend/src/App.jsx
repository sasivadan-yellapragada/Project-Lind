import React, { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import TrialExplorer from './pages/TrialExplorer';
import TrialDetail from './pages/TrialDetail';
import Watchlist from './pages/Watchlist';
import AskAI from './pages/AskAI';

function App() {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearch, setActiveSearch] = useState('');

  const handleSearchSubmit = (term) => {
    setActiveSearch(term);
  };

  return (
    <BrowserRouter>
      <div className="flex bg-slate-50 min-h-screen">
        <Sidebar />
        <div className="flex-1 lg:ml-64 flex flex-col min-h-screen min-w-0">
          <Topbar 
            searchTerm={searchTerm} 
            setSearchTerm={setSearchTerm} 
            onSearchSubmit={handleSearchSubmit} 
          />
          <main className="p-4 sm:p-6 lg:p-8 flex-1 overflow-x-hidden">
            <Routes>
              <Route path="/" element={<TrialExplorer activeSearch={activeSearch} />} />
              <Route path="/ask" element={<AskAI />} />
              <Route path="/trial/:nctId" element={<TrialDetail />} />
              <Route path="/watchlist" element={<Watchlist />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
