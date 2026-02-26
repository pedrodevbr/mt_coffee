const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Support custom data path for Render persistent disk
const dataDir = process.env.RENDER_DATA_DIR || __dirname;
const dbPath = path.resolve(dataDir, 'mt_coffee.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initSchema();
    }
});

function initSchema() {
    db.serialize(() => {
        // Users Table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            matricula TEXT UNIQUE NOT NULL,
            balance REAL DEFAULT 0.0
        )`);

        // Transactions Table
        db.run(`CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            type TEXT NOT NULL, -- 'consumption' or 'recharge'
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);

        // System State / Stock Table
        db.run(`CREATE TABLE IF NOT EXISTS system_state (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coffee_stock_grams REAL DEFAULT 0.0,
            stock_total_cost REAL DEFAULT 0.0,
            qr_code_url TEXT DEFAULT ''
        )`);

        // Insert default system state if empty
        db.get(`SELECT COUNT(*) as count FROM system_state`, (err, row) => {
            if (row && row.count === 0) {
                db.run(`INSERT INTO system_state (coffee_stock_grams, stock_total_cost, qr_code_url) VALUES (0, 0, '')`);
            }
        });

        // Settings for dose size
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )`);

        db.get(`SELECT COUNT(*) as count FROM settings WHERE key = 'dose_grams'`, (err, row) => {
            if (row && row.count === 0) {
                db.run(`INSERT INTO settings (key, value) VALUES ('dose_grams', '10')`);
            }
        });
    });
}

module.exports = db;
