const { Pool } = require('pg');

const SOURCE_URL = process.env.SOURCE_DATABASE_URL || 'postgresql://neondb_owner:npg_W8pX5rCLgwAY@ep-misty-mouse-ajt4x1xu.c-3.us-east-2.aws.neon.tech/neondb?sslmode=require';
const TARGET_URL = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL;

if (!TARGET_URL) {
    console.error('TARGET_DATABASE_URL (ou DATABASE_URL) não foi informada.');
    process.exit(1);
}

const sourcePool = new Pool({
    connectionString: SOURCE_URL,
    ssl: { rejectUnauthorized: false }
});

const isLocalTarget = /@(localhost|127\.0\.0\.1|\[::1\])/.test(TARGET_URL);
const targetPool = new Pool({
    connectionString: TARGET_URL,
    ssl: isLocalTarget ? false : { rejectUnauthorized: false }
});

const TABLES_IN_ORDER = [
    { name: 'users', hasId: true },
    { name: 'coffees', hasId: true },
    { name: 'system_state', hasId: true },
    { name: 'settings', hasId: false, pk: 'key' },
    { name: 'stock_history', hasId: true },
    { name: 'price_history', hasId: true },
    { name: 'extra_costs', hasId: true },
    { name: 'stock_adjustments', hasId: true },
    { name: 'transactions', hasId: true },
    { name: 'payment_receipts', hasId: true },
    { name: 'coffee_ratings', hasId: true }
];

async function migrate() {
    console.log('--- Iniciando Migração do Neon para o PostgreSQL do Railway ---');
    console.log('Origem:', SOURCE_URL.replace(/:[^:@]+@/, ':***@'));
    console.log('Destino:', TARGET_URL.replace(/:[^:@]+@/, ':***@'));

    const sClient = await sourcePool.connect();
    const tClient = await targetPool.connect();

    try {
        // 1. Inicializar Schema no Destino
        console.log('\n1. Inicializando Schema no banco de destino...');
        // Executamos o initSchema usando a conexão do target
        const { initSchema } = require('../database');
        // Temporariamente sobrescreve pool se necessário, mas podemos rodar os CREATE TABLEs
        await tClient.query('BEGIN');

        // Criação das tabelas
        await tClient.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                matricula TEXT UNIQUE NOT NULL,
                balance REAL DEFAULT 0.0
            );
            CREATE TABLE IF NOT EXISTS coffees (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                origin TEXT DEFAULT '',
                image_data BYTEA,
                image_type TEXT,
                active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS system_state (
                id SERIAL PRIMARY KEY,
                coffee_stock_grams REAL DEFAULT 0.0,
                stock_total_cost REAL DEFAULT 0.0,
                qr_code_url TEXT DEFAULT '',
                pix_key TEXT DEFAULT '',
                current_price_per_dose REAL DEFAULT 0.0,
                remaining_extra_costs REAL DEFAULT 0.0
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS stock_history (
                id SERIAL PRIMARY KEY,
                coffee_id INTEGER REFERENCES coffees(id) ON DELETE SET NULL,
                added_grams REAL NOT NULL,
                added_cost REAL NOT NULL DEFAULT 0,
                price_per_dose REAL DEFAULT 0,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS price_history (
                id SERIAL PRIMARY KEY,
                price_per_dose REAL NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS extra_costs (
                id SERIAL PRIMARY KEY,
                description TEXT NOT NULL,
                amount REAL NOT NULL,
                remaining REAL,
                dilution_doses INTEGER DEFAULT 200,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS stock_adjustments (
                id SERIAL PRIMARY KEY,
                grams_before REAL NOT NULL,
                grams_after REAL NOT NULL,
                delta_grams REAL NOT NULL,
                delta_cost REAL NOT NULL,
                reason TEXT,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                amount REAL NOT NULL,
                type TEXT NOT NULL,
                grams_deducted REAL,
                cost_deducted REAL,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );
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
                file_hash TEXT,
                ai_amount REAL,
                ai_confidence TEXT,
                ai_summary TEXT,
                ai_processed BOOLEAN DEFAULT FALSE,
                notes TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                reviewed_at TIMESTAMPTZ,
                reviewed_by TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_payment_receipts_file_hash ON payment_receipts (file_hash);
            CREATE TABLE IF NOT EXISTS coffee_ratings (
                id SERIAL PRIMARY KEY,
                coffee_id INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
                comment TEXT DEFAULT '',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (coffee_id, user_id)
            );
        `);

        // Limpa tabelas no destino (em ordem reversa) para garantir importação limpa
        console.log('2. Limpando tabelas existentes no destino...');
        for (let i = TABLES_IN_ORDER.length - 1; i >= 0; i--) {
            const table = TABLES_IN_ORDER[i].name;
            await tClient.query(`TRUNCATE TABLE ${table} CASCADE`);
        }

        // 3. Migrar dados tabela por tabela
        console.log('\n3. Copiando registros...');
        for (const tableConfig of TABLES_IN_ORDER) {
            const table = tableConfig.name;
            const srcData = await sClient.query(`SELECT * FROM ${table} ${tableConfig.hasId ? 'ORDER BY id ASC' : ''}`);
            console.log(`- ${table}: ${srcData.rows.length} linha(s) encontrada(s) no Neon`);

            if (srcData.rows.length > 0) {
                const cols = Object.keys(srcData.rows[0]);
                const colNames = cols.map(c => `"${c}"`).join(', ');

                for (const row of srcData.rows) {
                    const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ');
                    const values = cols.map(c => row[c]);
                    await tClient.query(`INSERT INTO ${table} (${colNames}) VALUES (${placeholders})`, values);
                }
            }

            // Se a tabela possui ID serial, atualiza a sequência
            if (tableConfig.hasId) {
                await tClient.query(`
                    SELECT setval(
                        pg_get_serial_sequence('${table}', 'id'),
                        COALESCE((SELECT MAX(id) FROM ${table}), 1),
                        (SELECT MAX(id) IS NOT NULL FROM ${table})
                    )
                `);
            }
        }

        await tClient.query('COMMIT');
        console.log('\n✅ Migração concluída com sucesso no PostgreSQL de destino!');

        // 4. Verificação de integridade
        console.log('\n4. Verificação de Integridade (Origem vs Destino):');
        for (const tableConfig of TABLES_IN_ORDER) {
            const table = tableConfig.name;
            const sCount = await sClient.query(`SELECT COUNT(*) as c FROM ${table}`);
            const tCount = await tClient.query(`SELECT COUNT(*) as c FROM ${table}`);
            const countNeon = parseInt(sCount.rows[0].c);
            const countRailway = parseInt(tCount.rows[0].c);
            const ok = countNeon === countRailway ? '✅ OK' : '❌ DIVERGÊNCIA';
            console.log(`  ${table.padEnd(20)} | Neon: ${countNeon.toString().padStart(4)} | Railway: ${countRailway.toString().padStart(4)} | ${ok}`);
        }

    } catch (err) {
        await tClient.query('ROLLBACK');
        console.error('❌ Erro durante a migração:', err);
        throw err;
    } finally {
        sClient.release();
        tClient.release();
        await sourcePool.end();
        await targetPool.end();
    }
}

if (require.main === module) {
    migrate().catch(e => {
        console.error('Migração abortada:', e.message);
        process.exit(1);
    });
}

module.exports = { migrate };
