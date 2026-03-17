const { pool, initSchema } = require('../database');

async function setupTestDb() {
    await initSchema();
    await cleanDb();
}

// Deletes all rows added during tests, in FK-safe order.
// Admin user (matricula='0000') and default settings are preserved.
async function cleanDb() {
    await pool.query('DELETE FROM payment_receipts');
    await pool.query('DELETE FROM transactions');
    await pool.query('DELETE FROM stock_adjustments');
    await pool.query('DELETE FROM stock_history');
    await pool.query('DELETE FROM extra_costs');
    await pool.query("DELETE FROM users WHERE matricula != '0000'");
    await pool.query('UPDATE system_state SET coffee_stock_grams = 0, stock_total_cost = 0');
    await pool.query("UPDATE settings SET value = '10' WHERE key = 'dose_grams'");
    await pool.query("UPDATE settings SET value = '1234' WHERE key = 'admin_pin'");
}

async function closeDb() {
    await pool.end();
}

module.exports = { setupTestDb, cleanDb, closeDb };
