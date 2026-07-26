// Confere contra qual banco o ambiente atual aponta e o que tem dentro.
// Uso: npm run db:check
const { Pool } = require('pg');

const url = process.env.DATABASE_URL || '';
if (!url) {
    console.error('DATABASE_URL não definida. Preencha o .env (veja DEV.md).');
    process.exit(1);
}

const parsed = new URL(url);
const isProd = process.env.PROD_DB_HOST && parsed.hostname === process.env.PROD_DB_HOST;

console.log(`Host:  ${parsed.hostname}`);
console.log(`Base:  ${parsed.pathname.replace(/^\//, '')}`);
console.log(isProd ? 'Ambiente: PRODUÇÃO — escritas afetam dados reais.' : 'Ambiente: desenvolvimento.');
if (!process.env.PROD_DB_HOST) {
    console.log('(PROD_DB_HOST não definido no .env — não dá para distinguir de produção.)');
}
console.log('');

const TABELAS = [
    'users', 'transactions', 'coffees', 'coffee_ratings', 'payment_receipts',
    'price_history', 'settings', 'stock_adjustments', 'stock_history',
    'system_state', 'extra_costs'
];

(async () => {
    const pool = new Pool({
        connectionString: url,
        ssl: /@(localhost|127\.0\.0\.1|\[::1\])/.test(url) ? false : { rejectUnauthorized: false }
    });
    try {
        for (const t of TABELAS) {
            try {
                const r = await pool.query(`SELECT count(*)::int AS n FROM ${t}`);
                console.log(`  ${t.padEnd(20)} ${r.rows[0].n}`);
            } catch {
                console.log(`  ${t.padEnd(20)} (tabela ausente)`);
            }
        }
        console.log('\nConexão OK.');
    } catch (err) {
        console.error(`\nFalha ao conectar: ${err.message}`);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
