const { Client } = require('pg');

async function testNeon() {
  const neon = new Client({
    connectionString: 'postgresql://neondb_owner:npg_W8pX5rCLgwAY@ep-misty-mouse-ajt4x1xu.c-3.us-east-2.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
  });
  await neon.connect();
  console.log('Connected to Neon!');
  const tables = ['users', 'coffees', 'transactions', 'payment_receipts', 'system_state', 'settings', 'stock_history', 'price_history', 'extra_costs', 'stock_adjustments', 'coffee_ratings'];
  for (const t of tables) {
    try {
      const res = await neon.query(`SELECT count(*) FROM ${t}`);
      console.log(`${t}: ${res.rows[0].count} rows`);
    } catch (e) {
      console.log(`${t}: error - ${e.message}`);
    }
  }
  await neon.end();
}

testNeon().catch(console.error);
