const { Pool } = require('pg');

async function sync() {
    console.log('====================================================');
    console.log('  SINCRONIZAÇÃO: BANCO DO REPLIT -> BANCO DO RAILWAY');
    console.log('====================================================');

    const sourceUrl = process.env.SOURCE_DATABASE_URL;
    const targetUrl = process.env.DATABASE_URL;

    if (!sourceUrl) {
        console.error('ERRO: SOURCE_DATABASE_URL (Replit) não definida.');
        process.exit(1);
    }
    if (!targetUrl) {
        console.error('ERRO: DATABASE_URL (Railway) não definida.');
        process.exit(1);
    }

    console.log('[1/4] Conectando aos bancos de dados...');
    const sourcePool = new Pool({
        connectionString: sourceUrl,
        ssl: { rejectUnauthorized: false }
    });

    const isTargetInternal = targetUrl.includes('railway.internal') || targetUrl.includes('localhost');
    const targetPool = new Pool({
        connectionString: targetUrl,
        ssl: isTargetInternal ? false : { rejectUnauthorized: false }
    });

    const targetClient = await targetPool.connect();

    try {
        console.log('[2/4] Identificando tabelas no banco de origem (Replit)...');
        const tablesRes = await sourcePool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);
        const tables = tablesRes.rows.map(r => r.table_name);
        console.log(`Encontradas ${tables.length} tabelas: ${tables.join(', ')}`);

        // Ordem recomendada para inserção respeitando FKs (ou desativando restrições)
        const orderedTables = [
            'users',
            'settings',
            'system_state',
            'coffees',
            'coffee_ratings',
            'extra_costs',
            'payment_receipts',
            'price_history',
            'stock_adjustments',
            'stock_history',
            'transactions'
        ];

        // Adicionar qualquer outra tabela que exista no source
        for (const t of tables) {
            if (!orderedTables.includes(t)) {
                orderedTables.push(t);
            }
        }

        console.log('\n[3/4] Sincronizando dados em transação...');
        await targetClient.query('BEGIN');
        await targetClient.query('SET CONSTRAINTS ALL DEFERRED');

        for (const table of orderedTables) {
            if (!tables.includes(table)) continue;

            console.log(`\n -> Processando tabela "${table}"...`);

            // Obter colunas e dados da origem
            const dataRes = await sourcePool.query(`SELECT * FROM "${table}"`);
            const rows = dataRes.rows;
            console.log(`    Registros no Replit: ${rows.length}`);

            // Limpar tabela de destino
            await targetClient.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);

            if (rows.length > 0) {
                const cols = Object.keys(rows[0]);
                const colNames = cols.map(c => `"${c}"`).join(', ');

                // Inserir em lotes de 100
                const batchSize = 100;
                for (let i = 0; i < rows.length; i += batchSize) {
                    const chunk = rows.slice(i, i + batchSize);
                    const values = [];
                    const valuePlaceholders = [];

                    let paramIdx = 1;
                    for (const row of chunk) {
                        const placeholders = [];
                        for (const col of cols) {
                            values.push(row[col]);
                            placeholders.push(`$${paramIdx++}`);
                        }
                        valuePlaceholders.push(`(${placeholders.join(', ')})`);
                    }

                    const insertQuery = `
                        INSERT INTO "${table}" (${colNames}) 
                        VALUES ${valuePlaceholders.join(', ')}
                    `;
                    await targetClient.query(insertQuery, values);
                }
                console.log(`    ✓ ${rows.length} registros inseridos com sucesso.`);

                // Atualizar sequences se houver coluna id
                if (cols.includes('id')) {
                    try {
                        await targetClient.query(`
                            SELECT setval(
                                pg_get_serial_sequence('"${table}"', 'id'), 
                                COALESCE((SELECT MAX(id) FROM "${table}"), 1), 
                                (SELECT count(*) > 0 FROM "${table}")
                            )
                        `);
                    } catch (seqErr) {
                        // Nem toda tabela tem sequence padrão; ignora se não tiver
                    }
                }
            } else {
                console.log(`    (Tabela vazia, limpa no destino)`);
            }
        }

        await targetClient.query('COMMIT');
        console.log('\n[4/4] Transação confirmada (COMMIT)!');

        console.log('\n====================================================');
        console.log('  CONTAGEM FINAL NO BANCO DO RAILWAY:');
        console.log('====================================================');
        for (const table of orderedTables) {
            if (!tables.includes(table)) continue;
            const cntRes = await targetClient.query(`SELECT count(*) FROM "${table}"`);
            console.log(` - ${table.padEnd(25)}: ${cntRes.rows[0].count} registros`);
        }
        console.log('\n🎉 Sincronização concluída com sucesso!');

    } catch (err) {
        await targetClient.query('ROLLBACK');
        console.error('\n❌ ERRO durante a sincronização (ROLLBACK executado):', err);
        process.exit(1);
    } finally {
        targetClient.release();
        await sourcePool.end();
        await targetPool.end();
    }
}

sync();
