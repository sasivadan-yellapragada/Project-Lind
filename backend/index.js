const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { sourceDb, userDb, dbQuery, dbGet, dbRun } = require('./db');
const { answerQuestion } = require('./ai');
const { runAgent } = require('./agent');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5001;
const frontendDistPath = path.resolve(__dirname, '../frontend/dist');

if (process.env.NODE_ENV !== 'production') {
    app.use(cors());
}

const toPositiveInt = (value, fallback, max = 500) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
};

const compactTrialSelect = `
    SELECT
        t.nct_id,
        t.title,
        COALESCE((
            SELECT GROUP_CONCAT(tc.condition_name, ', ')
            FROM trial_conditions tc
            WHERE tc.nct_id = t.nct_id
        ), '') AS condition,
        t.phase,
        t.status,
        t.sponsor,
        t.start_date
    FROM trials t
`;

const buildTrialWhere = ({ keyword, phase, status, sponsor, condition }) => {
    const conditions = [];
    const params = [];

    if (keyword) {
        conditions.push(`(
            t.title LIKE ?
            OR t.sponsor LIKE ?
            OR t.brief_summary LIKE ?
            OR t.detailed_description LIKE ?
            OR EXISTS (
                SELECT 1
                FROM trial_conditions tc
                WHERE tc.nct_id = t.nct_id
                  AND tc.condition_name LIKE ?
            )
        )`);
        const kw = `%${keyword.trim()}%`;
        params.push(kw, kw, kw, kw, kw);
    }

    if (phase) {
        conditions.push('t.phase = ?');
        params.push(phase);
    }

    if (status) {
        conditions.push('t.status = ?');
        params.push(status);
    }

    if (sponsor) {
        conditions.push('t.sponsor = ?');
        params.push(sponsor);
    }

    if (condition) {
        conditions.push(`EXISTS (
            SELECT 1
            FROM trial_conditions tc
            WHERE tc.nct_id = t.nct_id
              AND tc.condition_name = ?
        )`);
        params.push(condition);
    }

    return {
        whereClause: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '',
        params
    };
};

const requireExistingTrial = async (nctId) => {
    if (!nctId) return null;
    return dbGet(sourceDb, 'SELECT nct_id FROM trials WHERE nct_id = ?', [nctId]);
};

// GET /api/trials
app.get('/api/trials', async (req, res) => {
    try {
        const { keyword, phase, status, sponsor, condition, page = 1, limit = 50 } = req.query;
        const pageNumber = toPositiveInt(page, 1);
        const pageLimit = toPositiveInt(limit, 50, 100);
        const offset = (pageNumber - 1) * pageLimit;
        const { whereClause, params } = buildTrialWhere({ keyword, phase, status, sponsor, condition });
        const countQuery = `SELECT COUNT(*) as total FROM trials t${whereClause}`;
        const query = `${compactTrialSelect}${whereClause} ORDER BY t.start_date DESC, t.nct_id ASC LIMIT ? OFFSET ?`;

        const countResult = await dbGet(sourceDb, countQuery, params);
        const totalCount = countResult?.total || 0;
        const rows = await dbQuery(sourceDb, query, [...params, pageLimit, offset]);

        res.json({
            data: rows,
            meta: {
                totalCount,
                page: pageNumber,
                limit: pageLimit,
                totalPages: Math.max(1, Math.ceil(totalCount / pageLimit))
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch trials' });
    }
});

app.get('/api/filters', async (req, res) => {
    try {
        const [phases, statuses, sponsors, conditions] = await Promise.all([
            dbQuery(sourceDb, `SELECT DISTINCT phase AS value FROM trials WHERE phase IS NOT NULL AND phase != '' ORDER BY phase ASC`),
            dbQuery(sourceDb, `SELECT DISTINCT status AS value FROM trials WHERE status IS NOT NULL AND status != '' ORDER BY status ASC`),
            dbQuery(sourceDb, `SELECT DISTINCT sponsor AS value FROM trials WHERE sponsor IS NOT NULL AND sponsor != '' ORDER BY sponsor ASC LIMIT 500`),
            dbQuery(sourceDb, `SELECT DISTINCT condition_name AS value FROM trial_conditions WHERE condition_name IS NOT NULL AND condition_name != '' ORDER BY condition_name ASC LIMIT 500`)
        ]);

        res.json({
            phases: phases.map(row => row.value),
            statuses: statuses.map(row => row.value),
            sponsors: sponsors.map(row => row.value),
            conditions: conditions.map(row => row.value)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch filters' });
    }
});

app.post('/api/ask', async (req, res) => {
    try {
        const { question } = req.body;
        const result = await answerQuestion(question);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to answer question' });
    }
});

app.post('/api/agent', async (req, res) => {
    try {
        const { question } = req.body;
        if (!question) return res.status(400).json({ error: 'question required' });
        const result = await runAgent(question);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to run agent' });
    }
});

// GET /api/trials/:nctId
app.get('/api/trials/:nctId', async (req, res) => {
    try {
        const { nctId } = req.params;
        const trial = await dbGet(sourceDb, 'SELECT * FROM trials WHERE nct_id = ?', [nctId]);
        if (!trial) return res.status(404).json({ error: 'Trial not found' });

        const conditions = await dbQuery(sourceDb, 'SELECT condition_name FROM trial_conditions WHERE nct_id = ?', [nctId]);
        const interventions = await dbQuery(sourceDb, 'SELECT intervention_type, intervention_name FROM trial_interventions WHERE nct_id = ?', [nctId]);

        trial.conditions = conditions.map(c => c.condition_name);
        trial.interventions = interventions;
        
        res.json(trial);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch trial details' });
    }
});

// --- User Data APIs ---

// Watchlist
app.get('/api/watchlist', async (req, res) => {
    try {
        const watchlist = await dbQuery(userDb, 'SELECT nct_id, created_at FROM watchlist ORDER BY created_at DESC');
        
        // Fetch details from source DB for each item in watchlist
        const data = [];
        for (const item of watchlist) {
            const trial = await dbGet(sourceDb, 'SELECT nct_id, title, phase, status, sponsor FROM trials WHERE nct_id = ?', [item.nct_id]);
            if (trial) {
                const conditions = await dbQuery(sourceDb, 'SELECT condition_name FROM trial_conditions WHERE nct_id = ?', [item.nct_id]);
                data.push({
                    ...trial,
                    conditions: conditions.map(c => c.condition_name),
                    added_at: item.created_at
                });
            }
        }
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch watchlist' });
    }
});

app.post('/api/watchlist', async (req, res) => {
    try {
        const { nctId } = req.body;
        if (!nctId) return res.status(400).json({ error: 'nctId required' });
        const trial = await requireExistingTrial(nctId);
        if (!trial) return res.status(404).json({ error: 'Trial not found' });
        
        await dbRun(userDb, 'INSERT OR IGNORE INTO watchlist (nct_id) VALUES (?)', [nctId]);
        res.json({ success: true, message: 'Added to watchlist' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to add to watchlist' });
    }
});

app.delete('/api/watchlist/:nctId', async (req, res) => {
    try {
        await dbRun(userDb, 'DELETE FROM watchlist WHERE nct_id = ?', [req.params.nctId]);
        res.json({ success: true, message: 'Removed from watchlist' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to remove from watchlist' });
    }
});

// Notes
app.get('/api/notes/:nctId', async (req, res) => {
    try {
        const notes = await dbQuery(userDb, 'SELECT * FROM notes WHERE nct_id = ? ORDER BY created_at DESC', [req.params.nctId]);
        res.json(notes);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch notes' });
    }
});

app.post('/api/notes', async (req, res) => {
    try {
        const { nctId, note } = req.body;
        if (!nctId || !note?.trim()) return res.status(400).json({ error: 'nctId and note required' });
        const trial = await requireExistingTrial(nctId);
        if (!trial) return res.status(404).json({ error: 'Trial not found' });
        
        const result = await dbRun(userDb, 'INSERT INTO notes (nct_id, note) VALUES (?, ?)', [nctId, note.trim()]);
        const created = await dbGet(userDb, 'SELECT * FROM notes WHERE id = ?', [result.lastID]);
        res.status(201).json(created);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to add note' });
    }
});

app.put('/api/notes/:id', async (req, res) => {
    try {
        const { note } = req.body;
        if (!note?.trim()) return res.status(400).json({ error: 'note required' });
        const result = await dbRun(userDb, 'UPDATE notes SET note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [note.trim(), req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: 'Note not found' });
        const updated = await dbGet(userDb, 'SELECT * FROM notes WHERE id = ?', [req.params.id]);
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update note' });
    }
});

app.delete('/api/notes/:id', async (req, res) => {
    try {
        await dbRun(userDb, 'DELETE FROM notes WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete note' });
    }
});

// Tags
app.get('/api/tags/:nctId', async (req, res) => {
    try {
        const tags = await dbQuery(userDb, 'SELECT * FROM tags WHERE nct_id = ? ORDER BY created_at ASC', [req.params.nctId]);
        res.json(tags);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch tags' });
    }
});

app.post('/api/tags', async (req, res) => {
    try {
        const { nctId, tag } = req.body;
        if (!nctId || !tag?.trim()) return res.status(400).json({ error: 'nctId and tag required' });
        const trial = await requireExistingTrial(nctId);
        if (!trial) return res.status(404).json({ error: 'Trial not found' });
        
        await dbRun(userDb, 'INSERT OR IGNORE INTO tags (nct_id, tag) VALUES (?, ?)', [nctId, tag.trim()]);
        const created = await dbGet(userDb, 'SELECT * FROM tags WHERE nct_id = ? AND tag = ?', [nctId, tag.trim()]);
        res.status(201).json(created);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to add tag' });
    }
});

app.put('/api/tags/:id', async (req, res) => {
    try {
        const { tag } = req.body;
        if (!tag?.trim()) return res.status(400).json({ error: 'tag required' });

        const existing = await dbGet(userDb, 'SELECT nct_id FROM tags WHERE id = ?', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'Tag not found' });

        await dbRun(userDb, 'UPDATE OR IGNORE tags SET tag = ? WHERE id = ?', [tag.trim(), req.params.id]);
        const updated = await dbGet(userDb, 'SELECT * FROM tags WHERE id = ?', [req.params.id]);
        if (!updated) return res.status(409).json({ error: 'Duplicate tag for this trial' });
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update tag' });
    }
});

app.delete('/api/tags/:id', async (req, res) => {
    try {
        await dbRun(userDb, 'DELETE FROM tags WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete tag' });
    }
});

app.use(express.static(frontendDistPath));

app.get(/.*/, (req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
