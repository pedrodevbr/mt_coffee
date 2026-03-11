const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const { pool, initSchema } = require('./database');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'mt_coffee_fallback_secret';
const TOKEN_EXPIRY = '12h';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// =====================
//  AUTH MIDDLEWARE
// =====================
function requireAdmin(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Acesso restrito ao administrador.' });
    }
    const token = auth.slice(7);
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (payload.role !== 'admin') {
            return res.status(403).json({ error: 'Permissão negada.' });
        }
        req.admin = payload;
        next();
    } catch {
        return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
}

// =====================
//  ADMIN AUTH ROUTES
// =====================
app.post('/api/admin/login', async (req, res) => {
    try {
        const { pin } = req.body;
        if (!pin) return res.status(400).json({ error: 'PIN é obrigatório.' });

        const result = await pool.query("SELECT value FROM settings WHERE key = 'admin_pin'");
        const storedPin = result.rows.length ? result.rows[0].value : '1234';

        if (pin !== storedPin) {
            return res.status(401).json({ error: 'PIN incorreto.' });
        }

        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
        res.json({ success: true, token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/pin', requireAdmin, async (req, res) => {
    try {
        const { current_pin, new_pin } = req.body;
        if (!new_pin || new_pin.length < 4) {
            return res.status(400).json({ error: 'O novo PIN deve ter ao menos 4 caracteres.' });
        }

        const result = await pool.query("SELECT value FROM settings WHERE key = 'admin_pin'");
        const storedPin = result.rows.length ? result.rows[0].value : '1234';

        if (current_pin !== storedPin) {
            return res.status(401).json({ error: 'PIN atual incorreto.' });
        }

        await pool.query("UPDATE settings SET value = $1 WHERE key = 'admin_pin'", [new_pin]);
        res.json({ success: true, message: 'PIN atualizado com sucesso.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =====================
//  SYSTEM STATE (PUBLIC)
// =====================
app.get('/api/system', async (req, res) => {
    try {
        const stateResult = await pool.query('SELECT * FROM system_state ORDER BY id DESC LIMIT 1');
        const settingResult = await pool.query("SELECT value FROM settings WHERE key = $1", ['dose_grams']);

        const doseGrams = settingResult.rows.length ? parseFloat(settingResult.rows[0].value) : 10;
        const state = stateResult.rows.length ? stateResult.rows[0] : { coffee_stock_grams: 0, stock_total_cost: 0, qr_code_url: '', pix_key: '' };

        let currentPricePerDose = 0;
        if (state.coffee_stock_grams > 0) {
            const costPerGram = state.stock_total_cost / state.coffee_stock_grams;
            currentPricePerDose = costPerGram * doseGrams;
        }

        res.json({
            ...state,
            dose_grams: doseGrams,
            current_price_per_dose: currentPricePerDose
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =====================
//  SYSTEM ADMIN ROUTES (PROTECTED)
// =====================
app.post('/api/system/stock', requireAdmin, async (req, res) => {
    try {
        const { added_grams, added_cost } = req.body;
        if (!added_grams || added_grams <= 0) return res.status(400).json({ error: "Invalid grams" });

        const grams = parseFloat(added_grams);
        const cost = parseFloat(added_cost || 0);

        const stateResult = await pool.query('SELECT * FROM system_state ORDER BY id DESC LIMIT 1');
        const state = stateResult.rows[0];

        const newGrams = (state ? state.coffee_stock_grams : 0) + grams;
        const newCost = (state ? state.stock_total_cost : 0) + cost;

        await pool.query('UPDATE system_state SET coffee_stock_grams = $1, stock_total_cost = $2', [newGrams, newCost]);

        const doseResult = await pool.query("SELECT value FROM settings WHERE key = 'dose_grams'");
        const doseGrams = doseResult.rows.length ? parseFloat(doseResult.rows[0].value) : 10;
        const pricePerDose = newGrams > 0 ? (newCost / newGrams) * doseGrams : 0;

        await pool.query('INSERT INTO stock_history (added_grams, added_cost, price_per_dose) VALUES ($1, $2, $3)', [grams, cost, pricePerDose]);

        res.json({ success: true, message: "Stock updated successfully", newStock: newGrams });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/stock-history', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, added_grams, added_cost, price_per_dose,
                   CASE WHEN added_grams > 0 THEN ROUND((added_cost / added_grams * 1000)::numeric, 2) ELSE 0 END AS cost_per_kg,
                   timestamp
            FROM stock_history
            ORDER BY timestamp DESC
            LIMIT 30
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/system/qr', requireAdmin, upload.single('qr_image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const mimeType = req.file.mimetype;
        const base64 = req.file.buffer.toString('base64');
        const dataUrl = `data:${mimeType};base64,${base64}`;
        await pool.query('UPDATE system_state SET qr_code_url = $1', [dataUrl]);
        res.json({ success: true, url: dataUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/system/pix', requireAdmin, async (req, res) => {
    try {
        const { pix_key } = req.body;
        await pool.query('UPDATE system_state SET pix_key = $1', [pix_key || '']);
        res.json({ success: true, message: 'Chave PIX atualizada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/users/:id/summary', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
        const user = userResult.rows[0];

        const statsResult = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE type = 'consumption')                          AS total_consumptions,
                COALESCE(ABS(SUM(amount) FILTER (WHERE type = 'consumption')), 0)     AS total_consumed_value,
                COUNT(*) FILTER (WHERE type = 'recharge')                             AS total_recharges,
                COALESCE(SUM(amount) FILTER (WHERE type = 'recharge'), 0)             AS total_recharged_value,
                MIN(timestamp)                                                         AS first_transaction,
                MAX(timestamp)                                                         AS last_transaction
            FROM transactions WHERE user_id = $1
        `, [id]);

        const weeklyResult = await pool.query(`
            SELECT
                DATE_TRUNC('week', timestamp AT TIME ZONE 'America/Sao_Paulo') AS week_start,
                TO_CHAR(DATE_TRUNC('week', timestamp AT TIME ZONE 'America/Sao_Paulo'), 'DD/MM') AS label,
                COUNT(*) AS count
            FROM transactions
            WHERE user_id = $1 AND type = 'consumption'
              AND timestamp >= NOW() - INTERVAL '8 weeks'
            GROUP BY DATE_TRUNC('week', timestamp AT TIME ZONE 'America/Sao_Paulo')
            ORDER BY week_start ASC
        `, [id]);

        const recentResult = await pool.query(`
            SELECT id, type, amount, timestamp
            FROM transactions WHERE user_id = $1
            ORDER BY timestamp DESC LIMIT 20
        `, [id]);

        res.json({
            user,
            stats: statsResult.rows[0],
            weekly: weeklyResult.rows,
            recent_transactions: recentResult.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =====================
//  USERS — PUBLIC
// =====================
app.get('/api/users/:matricula', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM users WHERE matricula = $1', [req.params.matricula]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users', async (req, res) => {
    try {
        const { name, matricula, balance } = req.body;

        if (matricula === '0000') {
            return res.status(400).json({ error: 'Matrícula reservada para administração.' });
        }

        const result = await pool.query(
            'INSERT INTO users (name, matricula, balance) VALUES ($1, $2, $3) RETURNING *',
            [name, matricula, balance || 0]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// =====================
//  USERS — ADMIN ONLY
// =====================
app.get('/api/users', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM users ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
    try {
        const { name, matricula, balance } = req.body;
        await pool.query(
            'UPDATE users SET name = $1, matricula = $2, balance = $3 WHERE id = $4',
            [name, matricula, balance, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =====================
//  TRANSACTIONS
// =====================
app.get('/api/transactions', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, u.name, u.matricula 
            FROM transactions t 
            JOIN users u ON t.user_id = u.id 
            ORDER BY t.timestamp DESC
            LIMIT 100
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/transactions/:matricula', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.* 
            FROM transactions t 
            JOIN users u ON t.user_id = u.id 
            WHERE u.matricula = $1
            ORDER BY t.timestamp DESC
            LIMIT 50
        `, [req.params.matricula]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/consume', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { matricula } = req.body;

        const userResult = await client.query('SELECT * FROM users WHERE matricula = $1', [matricula]);
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'User not found' });
        }
        const user = userResult.rows[0];

        const stateResult = await client.query('SELECT * FROM system_state ORDER BY id DESC LIMIT 1');
        const state = stateResult.rows[0];

        const settingResult = await client.query("SELECT value FROM settings WHERE key = $1", ['dose_grams']);
        const doseGrams = settingResult.rows.length ? parseFloat(settingResult.rows[0].value) : 10;

        if (!state || state.coffee_stock_grams < doseGrams) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Not enough coffee stock!' });
        }

        const costPerGram = state.stock_total_cost / state.coffee_stock_grams;
        const pricePerDose = costPerGram * doseGrams;

        await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [pricePerDose, user.id]);
        await client.query('INSERT INTO transactions (user_id, amount, type) VALUES ($1, $2, $3)', [user.id, -pricePerDose, 'consumption']);

        const newStock = state.coffee_stock_grams - doseGrams;
        const newCost = state.stock_total_cost - pricePerDose;
        await client.query('UPDATE system_state SET coffee_stock_grams = $1, stock_total_cost = $2', [newStock, newCost]);

        await client.query('COMMIT');
        res.json({ success: true, message: 'Coffee consumed!', new_balance: user.balance - pricePerDose, cost: pricePerDose });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.post('/api/recharge', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { matricula, amount } = req.body;
        if (!amount || amount <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Invalid amount' });
        }

        const userResult = await client.query('SELECT * FROM users WHERE matricula = $1', [matricula]);
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'User not found' });
        }
        const user = userResult.rows[0];

        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, user.id]);
        await client.query('INSERT INTO transactions (user_id, amount, type) VALUES ($1, $2, $3)', [user.id, amount, 'recharge']);

        await client.query('COMMIT');
        res.json({ success: true, message: 'Balance recharged!', new_balance: user.balance + amount });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.get('/api/admin/stats/balance', requireAdmin, async (req, res) => {
    try {
        const stockResult = await pool.query(`
            SELECT
                COUNT(*)                                            AS total_remessas,
                COALESCE(SUM(added_cost), 0)                       AS total_stock_cost,
                COALESCE(SUM(added_grams), 0)                      AS total_grams_bought
            FROM stock_history
        `);

        const revenueResult = await pool.query(`
            SELECT
                COALESCE(ABS(SUM(amount) FILTER (WHERE type = 'consumption')), 0) AS total_collected,
                COUNT(*) FILTER (WHERE type = 'consumption')                     AS total_consumptions,
                COALESCE(SUM(amount) FILTER (WHERE type = 'recharge'), 0)        AS total_recharged,
                COUNT(*) FILTER (WHERE type = 'recharge')                        AS total_recharges_count
            FROM transactions
        `);

        const weeklyResult = await pool.query(`
            WITH weeks AS (
                SELECT generate_series(
                    DATE_TRUNC('week', NOW() AT TIME ZONE 'America/Sao_Paulo') - INTERVAL '7 weeks',
                    DATE_TRUNC('week', NOW() AT TIME ZONE 'America/Sao_Paulo'),
                    '1 week'
                ) AS week_start
            ),
            tx_weekly AS (
                SELECT
                    DATE_TRUNC('week', timestamp AT TIME ZONE 'America/Sao_Paulo') AS week_start,
                    COALESCE(SUM(CASE WHEN type = 'recharge' THEN amount END), 0) AS collected
                FROM transactions
                WHERE timestamp >= NOW() - INTERVAL '8 weeks'
                GROUP BY 1
            ),
            stock_weekly AS (
                SELECT
                    DATE_TRUNC('week', timestamp AT TIME ZONE 'America/Sao_Paulo') AS week_start,
                    COALESCE(SUM(added_cost), 0) AS cost
                FROM stock_history
                WHERE timestamp >= NOW() - INTERVAL '8 weeks'
                GROUP BY 1
            )
            SELECT
                TO_CHAR(w.week_start, 'DD/MM') AS label,
                COALESCE(tx.collected, 0)      AS collected,
                COALESCE(st.cost, 0)           AS cost
            FROM weeks w
            LEFT JOIN tx_weekly tx  ON tx.week_start  = w.week_start
            LEFT JOIN stock_weekly st ON st.week_start = w.week_start
            ORDER BY w.week_start ASC
        `);

        const s = stockResult.rows[0];
        const r = revenueResult.rows[0];
        res.json({
            total_remessas:    parseInt(s.total_remessas),
            total_stock_cost:  parseFloat(s.total_stock_cost),
            total_grams_bought: parseFloat(s.total_grams_bought),
            total_collected:       parseFloat(r.total_collected),
            total_consumptions:    parseInt(r.total_consumptions),
            total_recharged:       parseFloat(r.total_recharged),
            total_recharges_count: parseInt(r.total_recharges_count),
            balance:               parseFloat(r.total_recharged) - parseFloat(s.total_stock_cost),
            weekly:            weeklyResult.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =====================
//  STATS — ADMIN ONLY
// =====================
app.get('/api/stats/weekly', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                DATE_TRUNC('week', timestamp AT TIME ZONE 'America/Sao_Paulo') AS week_start,
                TO_CHAR(DATE_TRUNC('week', timestamp AT TIME ZONE 'America/Sao_Paulo'), 'DD/MM') AS label,
                COUNT(*) FILTER (WHERE type = 'consumption') AS consumption_count,
                COALESCE(ABS(SUM(amount) FILTER (WHERE type = 'consumption')), 0) AS total_consumed_value,
                COALESCE(SUM(amount) FILTER (WHERE type = 'recharge'), 0) AS total_recharged
            FROM transactions
            WHERE timestamp >= NOW() - INTERVAL '12 weeks'
            GROUP BY DATE_TRUNC('week', timestamp AT TIME ZONE 'America/Sao_Paulo')
            ORDER BY week_start ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/stats/daily-average', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                DATE(timestamp AT TIME ZONE 'America/Sao_Paulo') AS day,
                COUNT(*) AS count
            FROM transactions
            WHERE type = 'consumption'
              AND EXTRACT(DOW FROM timestamp AT TIME ZONE 'America/Sao_Paulo') BETWEEN 1 AND 5
            GROUP BY DATE(timestamp AT TIME ZONE 'America/Sao_Paulo')
            ORDER BY day ASC
        `);

        const rows = result.rows;
        const totalDays = rows.length;
        const totalConsumptions = rows.reduce((sum, r) => sum + parseInt(r.count), 0);
        const avg = totalDays > 0 ? (totalConsumptions / totalDays) : 0;

        const thisMonthResult = await pool.query(`
            SELECT COUNT(*) AS count FROM transactions
            WHERE type = 'consumption'
              AND DATE_TRUNC('month', timestamp AT TIME ZONE 'America/Sao_Paulo') = DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo')
        `);

        const topUsersResult = await pool.query(`
            SELECT u.name, u.matricula, COUNT(*) AS consumption_count
            FROM transactions t
            JOIN users u ON t.user_id = u.id
            WHERE t.type = 'consumption'
              AND t.timestamp >= NOW() - INTERVAL '30 days'
            GROUP BY u.id, u.name, u.matricula
            ORDER BY consumption_count DESC
            LIMIT 5
        `);

        res.json({
            avg_daily_business_days: parseFloat(avg.toFixed(2)),
            total_business_days_with_consumption: totalDays,
            total_consumptions_overall: totalConsumptions,
            this_month_consumptions: parseInt(thisMonthResult.rows[0].count),
            top_users_last_30_days: topUsersResult.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.use((req, res) => {
    if (req.accepts('html')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.status(404).send('Not found');
    }
});

initSchema().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
