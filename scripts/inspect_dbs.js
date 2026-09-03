const { Pool } = require('pg');

async function run() {
    const sourceUrl = process.env.SOURCE_DATABASE_URL;
    const targetUrl = process.env.DATABASE_URL;

    console.log('=== VERIFICAÇÃO DE BANCOS ===');
    console.log('SOURCE (Replit/Neon):', sourceUrl ? 'Definido' : 'NÃO DEFINIDO');
    console.log('TARGET (Railway):', targetUrl ? 'Definido' : 'NÃO DEFINIDO');

    if (!sourceUrl || !targetUrl) {
        console.error('Erro: SOURCE_DATABASE_URL ou DATABASE_URL não configurado.');
        process.exit(1);
    }

    const sourcePool = new Pool({
        connectionString: sourceUrl,
        ssl: { rejectUnauthorized: false }
    });

    const targetPool = new Pool({
        connectionString: targetUrl,
        ssl: targetUrl.includes('railway.internal') ? false : { rejectUnauthorized: false }
    });

    try {
        console.log('\n[1] Lendo tabelas do banco SOURCE (Replit)...');
        const tablesRes = await sourcePool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);
        const tables = tablesRes.rows.map(r => r.table_name);
        console.log('Tabelas encontradas no Replit:', tables);

        console.log('\n[2] Comparando contagem de registros:');
        for (const table of tables) {
            try {
                const sCountRes = await sourcePool.query(`SELECT count(*) FROM "${table}"`);
                const sCount = sCountRes.rows[0].count;

                let tCount = 'N/A (tabela não existe)';
                try {
                    const tCountRes = await targetPool.query(`SELECT count(*) FROM "${table}"`);
                    tCount = tCountRes.rows[0].count;
                } catch (err) {
                    tCount = `Erro: ${err.message}`;
                }

                console.log(` - ${table.padEnd(22)} | Replit: ${sCount.toString().padStart(6)} | Railway: ${tCount.toString().padStart(6)}`);
            } catch (err) {
                console.log(` - ${table.padEnd(22)} | Erro: ${err.message}`);
            }
        }

    } catch (err) {
        console.error('Erro durante verificação:', err);
    } finally {
        await sourcePool.end();
        await targetPool.end();
    }
}

run();
