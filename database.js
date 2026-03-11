const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false
});

async function initSchema() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                matricula TEXT UNIQUE NOT NULL,
                balance REAL DEFAULT 0.0
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                amount REAL NOT NULL,
                type TEXT NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS system_state (
                id SERIAL PRIMARY KEY,
                coffee_stock_grams REAL DEFAULT 0.0,
                stock_total_cost REAL DEFAULT 0.0,
                qr_code_url TEXT DEFAULT '',
                pix_key TEXT DEFAULT ''
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS stock_history (
                id SERIAL PRIMARY KEY,
                added_grams REAL NOT NULL,
                added_cost REAL NOT NULL DEFAULT 0,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        const stateCount = await client.query('SELECT COUNT(*) as count FROM system_state');
        if (parseInt(stateCount.rows[0].count) === 0) {
            await client.query("INSERT INTO system_state (coffee_stock_grams, stock_total_cost, qr_code_url, pix_key) VALUES (0, 0, '', '')");
        }

        const settingCount = await client.query("SELECT COUNT(*) as count FROM settings WHERE key = 'dose_grams'");
        if (parseInt(settingCount.rows[0].count) === 0) {
            await client.query("INSERT INTO settings (key, value) VALUES ('dose_grams', '10')");
        }

        const pinCount = await client.query("SELECT COUNT(*) as count FROM settings WHERE key = 'admin_pin'");
        if (parseInt(pinCount.rows[0].count) === 0) {
            await client.query("INSERT INTO settings (key, value) VALUES ('admin_pin', '1234')");
        }

        const adminCheck = await client.query("SELECT * FROM users WHERE matricula = '0000'");
        if (adminCheck.rows.length === 0) {
            await client.query("INSERT INTO users (name, matricula, balance) VALUES ('Admin', '0000', 0)");
        }

        console.log('Database schema initialized successfully.');
    } catch (err) {
        client.release();
        throw new Error('Failed to initialize database schema: ' + err.message);
    } finally {
        client.release();
    }
}

module.exports = { pool, initSchema };
