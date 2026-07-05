const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to read-only source database
const sourceDbPath = path.resolve(__dirname, '../trials.db');
const sourceDb = new sqlite3.Database(sourceDbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error('Error opening source trials.db:', err.message);
    } else {
        console.log('Connected to source trials.db (Read-Only).');
    }
});

// Connect to read-write user database
const userDbPath = path.resolve(__dirname, 'user_data.db');
const userDb = new sqlite3.Database(userDbPath, (err) => {
    if (err) {
        console.error('Error opening user_data.db:', err.message);
    } else {
        console.log('Connected to user_data.db.');
        initializeUserDb();
    }
});

function initializeUserDb() {
    userDb.serialize(() => {
        userDb.run(`CREATE TABLE IF NOT EXISTS watchlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nct_id TEXT UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        userDb.run(`CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nct_id TEXT,
            note TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        userDb.run(`CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nct_id TEXT,
            tag TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(nct_id, tag)
        )`);
    });
}

const dbQuery = (db, query, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const dbGet = (db, query, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

const dbRun = (db, query, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
};

module.exports = { sourceDb, userDb, dbQuery, dbGet, dbRun };
