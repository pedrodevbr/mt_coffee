const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// SSL é exigido por praticamente todo Postgres gerenciado (Railway, Neon,
// Supabase, Render) e recusado por um Postgres local. Detecta pela URL em vez
// de fixar em um provedor; PGSSLMODE=disable/require força manualmente.
const DATABASE_URL = process.env.DATABASE_URL || '';

// Sem a URL o pg cai no fallback de PGHOST e falha com um ENOTFOUND obscuro,
// apontando para um host que não tem nada a ver com o banco configurado.
if (!DATABASE_URL) {
    console.error(
        'DATABASE_URL não definida. Configure a connection string do Postgres ' +
        'antes de iniciar (veja DEPLOY.md).'
    );
    process.exit(1);
}
if (!/^postgres(ql)?:\/\//.test(DATABASE_URL)) {
    console.error(
        'DATABASE_URL não parece uma connection string do Postgres ' +
        '(esperado começar com postgresql://). Valor recebido começa com: ' +
        JSON.stringify(DATABASE_URL.slice(0, 12))
    );
    process.exit(1);
}

const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])/.test(DATABASE_URL);

let useSsl = !isLocalDb;
if (process.env.PGSSLMODE === 'disable') useSsl = false;
if (process.env.PGSSLMODE === 'require') useSsl = true;

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : false
});

async function backfillReceiptFiles(client) {
    const receiptsDir = path.join(__dirname, 'uploads', 'receipts');
    if (!fs.existsSync(receiptsDir)) return;
    const result = await client.query(
        'SELECT id, file_path FROM payment_receipts WHERE file_data IS NULL'
    );
    let backfilled = 0;
    for (const row of result.rows) {
        const fullPath = path.join(receiptsDir, row.file_path);
        if (fs.existsSync(fullPath)) {
            try {
                const data = fs.readFileSync(fullPath);
                await client.query(
                    'UPDATE payment_receipts SET file_data=$1 WHERE id=$2',
                    [data, row.id]
                );
                backfilled++;
            } catch (e) {
                console.warn(`Backfill failed for receipt ${row.id}:`, e.message);
            }
        }
    }
    if (backfilled > 0) {
        console.log(`Backfilled ${backfilled} receipt file(s) into database.`);
    }
}

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
                price_per_dose REAL DEFAULT 0,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await client.query(`
            ALTER TABLE stock_history ADD COLUMN IF NOT EXISTS price_per_dose REAL DEFAULT 0
        `);

        await client.query(`
            ALTER TABLE transactions ADD COLUMN IF NOT EXISTS grams_deducted REAL
        `);

        // Tracks the purchase cost (base, excluding extras) removed by each
        // consumption, computed at the price-per-gram in effect AT THAT TIME.
        // Summing this gives a consumption-invariant remaining purchase cost,
        // so the per-dose price does NOT drift as people consume coffee.
        await client.query(`
            ALTER TABLE transactions ADD COLUMN IF NOT EXISTS cost_deducted REAL
        `);
        // Backfill historical consumption rows with the dose value in effect up to now,
        // so changing the dose_grams setting later does NOT alter past stock arithmetic.
        await client.query(`
            UPDATE transactions
            SET grams_deducted = COALESCE(
                (SELECT value::REAL FROM settings WHERE key = 'dose_grams'),
                10
            )
            WHERE type = 'consumption' AND grams_deducted IS NULL
        `);
        await client.query(`
            UPDATE transactions SET grams_deducted = 0
            WHERE type <> 'consumption' AND grams_deducted IS NULL
        `);

        // Backfill cost_deducted for past consumptions at the global average
        // purchase rate (totalCost / totalGrams). This sum exactly equals the
        // previously-derived "consumed cost", so the current price is preserved
        // continuously; only FUTURE consumptions stop drifting the price.
        await client.query(`
            UPDATE transactions
            SET cost_deducted = COALESCE(grams_deducted, 0) * (
                SELECT CASE WHEN SUM(added_grams) > 0
                            THEN SUM(added_cost) / SUM(added_grams)
                            ELSE 0 END
                FROM stock_history
            )
            WHERE type = 'consumption' AND cost_deducted IS NULL
        `);
        await client.query(`
            UPDATE transactions SET cost_deducted = 0
            WHERE type <> 'consumption' AND cost_deducted IS NULL
        `);

        await client.query(`
            ALTER TABLE system_state ADD COLUMN IF NOT EXISTS current_price_per_dose REAL DEFAULT 0.0
        `);

        await client.query(`
            ALTER TABLE system_state ADD COLUMN IF NOT EXISTS remaining_extra_costs REAL DEFAULT 0.0
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS price_history (
                id SERIAL PRIMARY KEY,
                price_per_dose REAL NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        const phCount = await client.query('SELECT COUNT(*) AS c FROM price_history');
        if (parseInt(phCount.rows[0].c) === 0) {
            await client.query(`
                INSERT INTO price_history (price_per_dose, timestamp)
                SELECT COALESCE(current_price_per_dose, 0), NOW()
                FROM system_state ORDER BY id DESC LIMIT 1
            `);
        }

        await client.query(`
            ALTER TABLE extra_costs ADD COLUMN IF NOT EXISTS dilution_doses INTEGER DEFAULT 200
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS stock_adjustments (
                id SERIAL PRIMARY KEY,
                grams_before REAL NOT NULL,
                grams_after  REAL NOT NULL,
                delta_grams  REAL NOT NULL,
                delta_cost   REAL NOT NULL,
                reason       TEXT,
                timestamp    TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS extra_costs (
                id SERIAL PRIMARY KEY,
                description TEXT NOT NULL,
                amount REAL NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        await client.query(`
            ALTER TABLE extra_costs ADD COLUMN IF NOT EXISTS remaining REAL
        `);
        await client.query(`
            UPDATE extra_costs SET remaining = amount WHERE remaining IS NULL
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS payment_receipts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                amount_declared REAL NOT NULL,
                amount_approved REAL,
                status TEXT NOT NULL DEFAULT 'pending',
                file_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_type TEXT NOT NULL,
                file_data BYTEA,
                notes TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                reviewed_at TIMESTAMPTZ,
                reviewed_by TEXT
            )
        `);

        await client.query(`ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS file_data BYTEA`);
        await client.query(`ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS ai_amount REAL`);
        await client.query(`ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS ai_confidence TEXT`);
        await client.query(`ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS ai_summary TEXT`);
        await client.query(`ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS ai_processed BOOLEAN DEFAULT FALSE`);
        await client.query(`ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS file_hash TEXT`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_payment_receipts_file_hash ON payment_receipts (file_hash)`);

        await backfillReceiptFiles(client);

        await client.query(`
            CREATE TABLE IF NOT EXISTS coffees (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                origin TEXT DEFAULT '',
                image_data BYTEA,
                image_type TEXT,
                active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        await client.query(`
            ALTER TABLE stock_history ADD COLUMN IF NOT EXISTS coffee_id INTEGER REFERENCES coffees(id) ON DELETE SET NULL
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS coffee_ratings (
                id SERIAL PRIMARY KEY,
                coffee_id INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
                comment TEXT DEFAULT '',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (coffee_id, user_id)
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

        const dilutionCount = await client.query("SELECT COUNT(*) as count FROM settings WHERE key = 'extra_dilution_doses'");
        if (parseInt(dilutionCount.rows[0].count) === 0) {
            await client.query("INSERT INTO settings (key, value) VALUES ('extra_dilution_doses', '200')");
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
