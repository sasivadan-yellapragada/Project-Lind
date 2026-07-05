import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api';
import { ArrowLeft, Bookmark, Tag, Info, List, Pencil, Check, X } from 'lucide-react';

export default function TrialDetail() {
  const { nctId } = useParams();
  const [trial, setTrial] = useState(null);
  const [watchlist, setWatchlist] = useState(false);
  const [notes, setNotes] = useState([]);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);

  const [newNote, setNewNote] = useState('');
  const [newTag, setNewTag] = useState('');
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [editingTagId, setEditingTagId] = useState(null);
  const [editingTagText, setEditingTagText] = useState('');

  const [activeTab, setActiveTab] = useState('basic');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, wRes, nRes, tgRes] = await Promise.all([
        api.get(`/trials/${nctId}`),
        api.get('/watchlist'),
        api.get(`/notes/${nctId}`),
        api.get(`/tags/${nctId}`)
      ]);
      setTrial(tRes.data);
      setWatchlist(wRes.data.some(w => w.nct_id === nctId));
      setNotes(nRes.data);
      setTags(tgRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [nctId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleWatchlist = async () => {
    try {
      if (watchlist) {
        await api.delete(`/watchlist/${nctId}`);
        setWatchlist(false);
      } else {
        await api.post('/watchlist', { nctId });
        setWatchlist(true);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const addNote = async () => {
    if (!newNote.trim()) return;
    try {
      await api.post('/notes', { nctId, note: newNote });
      setNewNote('');
      const res = await api.get(`/notes/${nctId}`);
      setNotes(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const deleteNote = async (id) => {
    try {
      await api.delete(`/notes/${id}`);
      setNotes(notes.filter(n => n.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const startEditNote = (note) => {
    setEditingNoteId(note.id);
    setEditingNoteText(note.note);
  };

  const saveNote = async (id) => {
    if (!editingNoteText.trim()) return;
    try {
      const res = await api.put(`/notes/${id}`, { note: editingNoteText });
      setNotes(notes.map(note => note.id === id ? res.data : note));
      setEditingNoteId(null);
      setEditingNoteText('');
    } catch (err) {
      console.error(err);
    }
  };

  const addTag = async (e) => {
    e.preventDefault();
    if (!newTag.trim()) return;
    try {
      await api.post('/tags', { nctId, tag: newTag });
      setNewTag('');
      const res = await api.get(`/tags/${nctId}`);
      setTags(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const deleteTag = async (id) => {
    try {
      await api.delete(`/tags/${id}`);
      setTags(tags.filter(t => t.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const startEditTag = (tag) => {
    setEditingTagId(tag.id);
    setEditingTagText(tag.tag);
  };

  const saveTag = async (id) => {
    if (!editingTagText.trim()) return;
    try {
      const res = await api.put(`/tags/${id}`, { tag: editingTagText });
      setTags(tags.map(tag => tag.id === id ? res.data : tag));
      setEditingTagId(null);
      setEditingTagText('');
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading trial details...</div>;
  if (!trial) return <div className="p-8 text-center text-slate-500">Trial not found.</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <Link to="/" className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-blue-600 mb-6 transition-colors">
        <ArrowLeft size={16} className="mr-1" /> Back to Explorer
      </Link>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 lg:p-8 mb-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:justify-between lg:items-start mb-6">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="bg-blue-100 text-blue-700 font-bold px-3 py-1 rounded text-sm tracking-wide">{trial.nct_id}</span>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${trial.status === 'RECRUITING' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                <span className="mr-1.5 inline-block w-2 h-2 rounded-full bg-current"></span>
                {trial.status}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-slate-800 leading-tight max-w-3xl">{trial.title}</h1>
            <div className="text-slate-500 mt-2 text-sm">
              Sponsor: <span className="font-medium text-slate-700 mr-4">{trial.sponsor}</span>
              Phase: <span className="font-medium text-slate-700 mr-4">{trial.phase}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={toggleWatchlist}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                watchlist 
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-500/20' 
                : 'bg-white border border-blue-200 text-blue-600 hover:bg-blue-50'
              }`}
            >
              <Bookmark size={16} className={watchlist ? "fill-current" : ""} /> 
              {watchlist ? 'Added to Watchlist' : 'Add to Watchlist'}
            </button>
          </div>
        </div>

        <div className="border-b border-slate-200 flex gap-6">
          <button onClick={() => setActiveTab('basic')} className={`pb-3 font-medium text-sm border-b-2 transition-colors ${activeTab === 'basic' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Basic Info & Summary</button>
          <button onClick={() => setActiveTab('details')} className={`pb-3 font-medium text-sm border-b-2 transition-colors ${activeTab === 'details' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Detailed Description</button>
          <button onClick={() => setActiveTab('eligibility')} className={`pb-3 font-medium text-sm border-b-2 transition-colors ${activeTab === 'eligibility' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Eligibility</button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 space-y-6">
          {activeTab === 'basic' && (
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 lg:p-8">
              <h3 className="flex items-center gap-2 font-bold text-slate-800 text-lg mb-4"><Info size={20} className="text-blue-500"/> Summary</h3>
              <p className="text-slate-600 leading-relaxed text-sm whitespace-pre-wrap">{trial.brief_summary || 'No summary provided.'}</p>
              
              <div className="grid gap-4 mt-8 sm:grid-cols-2">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Start Date</div>
                  <div className="font-medium text-slate-800">{trial.start_date || 'N/A'}</div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Completion Date</div>
                  <div className="font-medium text-slate-800">{trial.completion_date || 'N/A'}</div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Target Enrollment</div>
                  <div className="font-medium text-slate-800">{trial.enrollment || 'N/A'} Patients</div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Conditions</div>
                  <div className="font-medium text-slate-800 truncate" title={trial.conditions.join(', ')}>{trial.conditions.join(', ') || 'N/A'}</div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'details' && (
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 lg:p-8">
               <h3 className="font-bold text-slate-800 text-lg mb-4">Detailed Description</h3>
               <p className="text-slate-600 leading-relaxed text-sm whitespace-pre-wrap">{trial.detailed_description || 'No detailed description provided.'}</p>
            </div>
          )}

          {activeTab === 'eligibility' && (
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 lg:p-8">
               <h3 className="flex items-center gap-2 font-bold text-slate-800 text-lg mb-4"><List size={20} className="text-blue-500"/> Eligibility Criteria</h3>
               <p className="text-slate-600 leading-relaxed text-sm whitespace-pre-wrap">{trial.eligibility_criteria || 'No eligibility criteria provided.'}</p>
            </div>
          )}
        </div>

        <div className="w-full lg:w-[350px] space-y-6">
          {/* Tags */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Tag size={16} className="text-slate-400"/> Research Tags</h3>
            <div className="flex flex-wrap gap-2 mb-4">
              {tags.map(t => (
                <span key={t.id} className="bg-slate-100 text-slate-600 text-xs font-medium px-2.5 py-1 rounded-md flex items-center gap-1 border border-slate-200">
                  {editingTagId === t.id ? (
                    <>
                      <input value={editingTagText} onChange={e => setEditingTagText(e.target.value)} className="w-24 bg-white border border-slate-300 rounded px-1 py-0.5 outline-none" />
                      <button onClick={() => saveTag(t.id)} className="hover:text-green-600"><Check size={12} /></button>
                      <button onClick={() => setEditingTagId(null)} className="hover:text-slate-800"><X size={12} /></button>
                    </>
                  ) : (
                    <>
                      {t.tag}
                      <button onClick={() => startEditTag(t)} className="hover:text-blue-600 ml-1"><Pencil size={11} /></button>
                      <button onClick={() => deleteTag(t.id)} className="hover:text-red-500"><X size={12} /></button>
                    </>
                  )}
                </span>
              ))}
            </div>
            <form onSubmit={addTag} className="flex gap-2">
              <input 
                type="text" 
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                placeholder="Add tag..." 
                className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-500"
              />
              <button type="submit" className="bg-slate-900 text-white text-xs font-semibold px-3 rounded-lg hover:bg-slate-800">Add</button>
            </form>
          </div>

          {/* Notes */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
            <h3 className="font-bold text-slate-800 mb-4">Researcher Notes</h3>
            <div className="space-y-4 mb-4 max-h-[300px] overflow-y-auto">
              {notes.map(note => (
                <div key={note.id} className="bg-amber-50/50 border border-amber-100 rounded-lg p-3 relative group">
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">
                    {new Date(note.created_at).toLocaleDateString()}
                  </div>
                  {editingNoteId === note.id ? (
                    <div className="space-y-2">
                      <textarea value={editingNoteText} onChange={e => setEditingNoteText(e.target.value)} className="w-full bg-white border border-amber-200 rounded-lg p-2 text-sm min-h-[80px] outline-none focus:border-blue-500" />
                      <div className="flex gap-2">
                        <button onClick={() => saveNote(note.id)} className="inline-flex items-center gap-1 bg-blue-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-blue-700"><Check size={13} /> Save</button>
                        <button onClick={() => setEditingNoteId(null)} className="inline-flex items-center gap-1 border border-slate-300 text-slate-600 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-white"><X size={13} /> Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap pr-12">{note.note}</p>
                      <div className="absolute top-2 right-2 flex gap-1 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => startEditNote(note)} className="hover:text-blue-600"><Pencil size={14} /></button>
                        <button onClick={() => deleteNote(note.id)} className="hover:text-red-500"><X size={15} /></button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {notes.length === 0 && <p className="text-xs text-slate-400 italic">No notes added yet.</p>}
            </div>
            
            <div className="pt-4 border-t border-slate-100">
              <textarea 
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="Write a new note..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm min-h-[100px] resize-y outline-none focus:border-blue-500 mb-3"
              ></textarea>
              <button onClick={addNote} className="w-full bg-blue-600 text-white font-medium text-sm py-2 rounded-lg hover:bg-blue-700 transition-colors">
                Save Note
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
