const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dataDir = process.env.DATA_DIR || __dirname;
const sourceDbPath = path.resolve(process.env.SOURCE_DB_PATH || path.join(__dirname, '../trials.db'));
const userDbPath = path.resolve(process.env.USER_DB_PATH || path.join(dataDir, 'user_data.db'));

function ensureDirectory(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function initializeSourceDbIfMissing() {
    if (fs.existsSync(sourceDbPath)) return;

    ensureDirectory(sourceDbPath);
    const setupDb = new sqlite3.Database(sourceDbPath);
    setupDb.serialize(() => {
        setupDb.run(`CREATE TABLE IF NOT EXISTS trials (
            nct_id TEXT PRIMARY KEY,
            title TEXT,
            phase TEXT,
            status TEXT,
            sponsor TEXT,
            start_date TEXT,
            completion_date TEXT,
            enrollment INTEGER,
            brief_summary TEXT,
            detailed_description TEXT,
            eligibility_criteria TEXT,
            last_update_date TEXT,
            raw_json TEXT
        )`);

        setupDb.run(`CREATE TABLE IF NOT EXISTS trial_conditions (
            nct_id TEXT,
            condition_name TEXT,
            PRIMARY KEY (nct_id, condition_name),
            FOREIGN KEY (nct_id) REFERENCES trials(nct_id)
        )`);

        setupDb.run(`CREATE TABLE IF NOT EXISTS trial_interventions (
            nct_id TEXT,
            intervention_type TEXT,
            intervention_name TEXT,
            PRIMARY KEY (nct_id, intervention_type, intervention_name),
            FOREIGN KEY (nct_id) REFERENCES trials(nct_id)
        )`);
    });
    setupDb.close();
    console.warn(`Source database was missing. Created empty trials schema at ${sourceDbPath}.`);
}

initializeSourceDbIfMissing();

// Connect to read-only source database
const sourceDb = new sqlite3.Database(sourceDbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error('Error opening source trials.db:', err.message);
    } else {
        console.log(`Connected to source trials database at ${sourceDbPath} (Read-Only).`);
    }
});

// Connect to read-write user database
ensureDirectory(userDbPath);
const userDb = new sqlite3.Database(userDbPath, (err) => {
    if (err) {
        console.error('Error opening user_data.db:', err.message);
    } else {
        console.log(`Connected to user data database at ${userDbPath}.`);
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
