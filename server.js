const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
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

const receiptsDir = path.join(__dirname, 'uploads', 'receipts');
if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });

const receiptStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, receiptsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `receipt_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    }
});
const uploadReceipt = multer({
    storage: receiptStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Tipo de arquivo não permitido. Use imagem ou PDF.'));
    }
});

// =====================
//  AUTH MIDDLEWARE
// =====================
function requireAdmin(req, res, next) {
    const auth = req.headers['authorization'];
    const queryToken = req.query.token;
    const token = (auth && auth.startsWith('Bearer ')) ? auth.slice(7) : queryToken;
    if (!token) {
        return res.status(401).json({ error: 'Acesso restrito ao administrador.' });
    }
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
        const priceData = await computeAndStoreDosePrice();
        const stateResult = await pool.query('SELECT * FROM system_state ORDER BY id DESC LIMIT 1');
        const state = stateResult.rows.length ? stateResult.rows[0] : { coffee_stock_grams: 0, stock_total_cost: 0, qr_code_url: '', pix_key: '' };

        res.json({
            ...state,
            dose_grams: priceData.doseGrams,
            current_price_per_dose: priceData.currentPricePerDose,
            base_price_per_dose: priceData.basePricePerDose,
            extra_costs_total: priceData.extraTotal,
            extra_cost_per_dose: priceData.extraCostPerDose,
            remaining_extra_costs: priceData.remainingExtraCosts,
            remaining_cost: priceData.remainingCost,
            total_purchased_grams: priceData.totalPurchasedGrams,
            total_purchase_cost: priceData.totalPurchaseCost,
            remaining_doses: priceData.remainingDoses,
            total_consumptions: priceData.totalConsumptions
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

        await pool.query('INSERT INTO stock_history (added_grams, added_cost) VALUES ($1, $2)', [grams, cost]);

        // Recalculate full state (stock + cost including extras) and dose price
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { currentStock } = await recalculateStockState(client);
            const priceData = await computeAndStoreDosePrice(client);
            // Update price_per_dose on the just-inserted stock_history entry
            await client.query(
                'UPDATE stock_history SET price_per_dose = $1 WHERE id = (SELECT MAX(id) FROM stock_history)',
                [priceData.currentPricePerDose]
            );
            await client.query('COMMIT');
            res.json({ success: true, message: "Stock updated successfully", newStock: currentStock });
        } catch (innerErr) {
            await client.query('ROLLBACK');
            throw innerErr;
        } finally {
            client.release();
        }
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

async function recalculateStockState(client) {
    const doseResult = await client.query("SELECT value FROM settings WHERE key = 'dose_grams'");
    const doseGrams = doseResult.rows.length ? parseFloat(doseResult.rows[0].value) : 10;
    const stockSum = await client.query(
        'SELECT COALESCE(SUM(added_grams),0) AS tg, COALESCE(SUM(added_cost),0) AS tc FROM stock_history'
    );
    const totalPurchasedGrams = parseFloat(stockSum.rows[0].tg);
    const totalPurchaseCost = parseFloat(stockSum.rows[0].tc);
    const consResult = await client.query("SELECT COUNT(*) AS cnt FROM transactions WHERE type='consumption'");
    const consumedGrams = parseInt(consResult.rows[0].cnt) * doseGrams;
    const adjResult = await client.query(
        'SELECT COALESCE(SUM(delta_grams),0) AS dg FROM stock_adjustments'
    );
    const adjGrams = parseFloat(adjResult.rows[0].dg);
    const extraResult = await client.query('SELECT COALESCE(SUM(amount),0) AS total FROM extra_costs');
    const extraTotal = parseFloat(extraResult.rows[0].total);

    const currentStock = Math.max(0, totalPurchasedGrams - consumedGrams + adjGrams);

    // Only consumption reduces cost (proportional to purchased grams).
    // Adjustments do NOT change cost — losses make remaining stock more expensive,
    // gains make it cheaper (sunk cost principle).
    const consumedFraction = totalPurchasedGrams > 0 ? Math.min(1, consumedGrams / totalPurchasedGrams) : 0;
    const remainingPurchaseCost = totalPurchaseCost * (1 - consumedFraction);

    // Extra costs also consumed proportionally to doses consumed
    const remainingExtraCosts = extraTotal * (1 - consumedFraction);

    await client.query(
        'UPDATE system_state SET coffee_stock_grams = $1, stock_total_cost = $2, remaining_extra_costs = $3',
        [currentStock, remainingPurchaseCost, remainingExtraCosts]
    );
    return { currentStock, remainingPurchaseCost, remainingExtraCosts };
}

async function computeAndStoreDosePrice(clientOrPool) {
    const db = clientOrPool || pool;
    const [stateResult, settingResult, extraResult, stockSumResult, consResult] = await Promise.all([
        db.query('SELECT coffee_stock_grams, stock_total_cost, remaining_extra_costs FROM system_state ORDER BY id DESC LIMIT 1'),
        db.query("SELECT value FROM settings WHERE key = 'dose_grams'"),
        db.query('SELECT COALESCE(SUM(amount), 0) AS total FROM extra_costs'),
        db.query('SELECT COALESCE(SUM(added_grams),0) AS tg, COALESCE(SUM(added_cost),0) AS tc FROM stock_history'),
        db.query("SELECT COUNT(*) AS cnt FROM transactions WHERE type='consumption'")
    ]);
    const state = stateResult.rows[0] || { coffee_stock_grams: 0, stock_total_cost: 0, remaining_extra_costs: 0 };
    const doseGrams = settingResult.rows.length ? parseFloat(settingResult.rows[0].value) : 10;
    const extraTotal = parseFloat(extraResult.rows[0].total);
    const totalPurchasedGrams = parseFloat(stockSumResult.rows[0].tg);
    const totalPurchaseCost = parseFloat(stockSumResult.rows[0].tc);
    const totalConsumptions = parseInt(consResult.rows[0].cnt);
    const remainingExtraCosts = parseFloat(state.remaining_extra_costs) || 0;
    const stockGrams = parseFloat(state.coffee_stock_grams) || 0;
    const stockCost = parseFloat(state.stock_total_cost) || 0;

    // Base price: remaining purchase cost / remaining stock
    let basePricePerDose = 0;
    if (stockGrams > 0) {
        basePricePerDose = (stockCost / stockGrams) * doseGrams;
    }

    // Extra price: remaining extras / remaining doses
    const remainingDoses = doseGrams > 0 ? Math.floor(stockGrams / doseGrams) : 0;
    let extraCostPerDose = 0;
    if (remainingDoses > 0) {
        extraCostPerDose = remainingExtraCosts / remainingDoses;
    }

    const currentPricePerDose = basePricePerDose + extraCostPerDose;

    await db.query('UPDATE system_state SET current_price_per_dose = $1', [currentPricePerDose]);

    return {
        currentPricePerDose, basePricePerDose, extraCostPerDose,
        extraTotal, remainingExtraCosts, doseGrams,
        totalPurchasedGrams, totalPurchaseCost,
        remainingStock: stockGrams,
        remainingCost: stockCost,
        remainingDoses,
        totalConsumptions
    };
}

app.put('/api/admin/stock-history/:id', requireAdmin, async (req, res) => {
    const { added_grams, added_cost, timestamp } = req.body;
    const grams = parseFloat(added_grams);
    const cost = parseFloat(added_cost || 0);
    if (isNaN(grams) || grams <= 0) return res.status(400).json({ error: 'Quantidade de gramas inválida.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const exists = await client.query('SELECT id FROM stock_history WHERE id=$1', [req.params.id]);
        if (exists.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Remessa não encontrada.' }); }
        const tsClause = timestamp ? `, timestamp = $3` : '';
        const params = timestamp ? [grams, cost, timestamp, req.params.id] : [grams, cost, req.params.id];
        await client.query(
            `UPDATE stock_history SET added_grams=$1, added_cost=$2${tsClause} WHERE id=$${params.length}`,
            params
        );
        const { currentStock } = await recalculateStockState(client);
        await computeAndStoreDosePrice(client);
        await client.query('COMMIT');
        res.json({ success: true, newStock: currentStock });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.delete('/api/admin/stock-history/:id', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const exists = await client.query('SELECT id FROM stock_history WHERE id=$1', [req.params.id]);
        if (exists.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Remessa não encontrada.' }); }
        await client.query('DELETE FROM stock_history WHERE id=$1', [req.params.id]);
        const { currentStock } = await recalculateStockState(client);
        await computeAndStoreDosePrice(client);
        await client.query('COMMIT');
        res.json({ success: true, newStock: currentStock });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// =====================
//  STOCK ADJUSTMENTS
// =====================
app.post('/api/admin/stock/adjust', requireAdmin, async (req, res) => {
    const { physical_grams, reason } = req.body;
    const physicalGrams = parseFloat(physical_grams);
    if (isNaN(physicalGrams) || physicalGrams < 0) return res.status(400).json({ error: 'Quantidade inválida.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const stateResult = await client.query('SELECT * FROM system_state ORDER BY id DESC LIMIT 1');
        const state = stateResult.rows[0];
        const currentGrams = parseFloat(state.coffee_stock_grams);
        const currentCost  = parseFloat(state.stock_total_cost);
        if (Math.abs(physicalGrams - currentGrams) < 0.01) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Estoque físico igual ao virtual. Nenhum ajuste necessário.' });
        }
        const deltaGrams = physicalGrams - currentGrams;
        // delta_cost is always 0: the purchase cost was already spent (sunk cost).
        // A loss means fewer grams carry the same total cost → higher price per dose.
        // A gain means more grams carry the same total cost → lower price per dose.
        await client.query(
            'INSERT INTO stock_adjustments (grams_before, grams_after, delta_grams, delta_cost, reason) VALUES ($1,$2,$3,$4,$5)',
            [currentGrams, physicalGrams, deltaGrams, 0, reason || null]
        );
        // Recalculate full state from source of truth (includes adjustments)
        await recalculateStockState(client);
        await computeAndStoreDosePrice(client);
        await client.query('COMMIT');
        res.json({ success: true, grams_before: currentGrams, grams_after: physicalGrams, delta_grams: deltaGrams });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.get('/api/admin/stock/adjustments', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM stock_adjustments ORDER BY timestamp DESC LIMIT 30');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/extra-costs', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM extra_costs ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/extra-costs', requireAdmin, async (req, res) => {
    const { description, amount } = req.body;
    if (!description || !description.trim()) return res.status(400).json({ error: 'Descrição obrigatória.' });
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Valor inválido.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            'INSERT INTO extra_costs (description, amount) VALUES ($1, $2) RETURNING *',
            [description.trim(), amt]
        );
        await recalculateStockState(client);
        await computeAndStoreDosePrice(client);
        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.delete('/api/admin/extra-costs/:id', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query('DELETE FROM extra_costs WHERE id=$1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Custo não encontrado.' }); }
        await recalculateStockState(client);
        await computeAndStoreDosePrice(client);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
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

        // Use stored price (base + extras)
        const pricePerDose = parseFloat(state.current_price_per_dose) || 0;

        // Deduct base cost from stock_total_cost (purchase cost only)
        const baseCostPerGram = state.coffee_stock_grams > 0 ? state.stock_total_cost / state.coffee_stock_grams : 0;
        const baseCostDeducted = baseCostPerGram * doseGrams;

        // Deduct extra cost from remaining_extra_costs
        const remainingExtras = parseFloat(state.remaining_extra_costs) || 0;
        const remainingDoses = Math.floor(state.coffee_stock_grams / doseGrams);
        const extraCostDeducted = remainingDoses > 0 ? remainingExtras / remainingDoses : 0;

        await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [pricePerDose, user.id]);
        await client.query('INSERT INTO transactions (user_id, amount, type) VALUES ($1, $2, $3)', [user.id, -pricePerDose, 'consumption']);

        const newStock = state.coffee_stock_grams - doseGrams;
        const newCost = Math.max(0, state.stock_total_cost - baseCostDeducted);
        const newExtras = Math.max(0, remainingExtras - extraCostDeducted);
        await client.query(
            'UPDATE system_state SET coffee_stock_grams = $1, stock_total_cost = $2, remaining_extra_costs = $3',
            [newStock, newCost, newExtras]
        );

        // Update stored dose price for next consumer
        await computeAndStoreDosePrice(client);

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

app.put('/api/admin/transactions/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { user_id, type, amount, timestamp } = req.body;
    if (!user_id || !type || amount === undefined || !timestamp) {
        return res.status(400).json({ error: 'Campos obrigatórios: user_id, type, amount, timestamp' });
    }
    if (!['consumption', 'recharge'].includes(type)) {
        return res.status(400).json({ error: 'Tipo inválido' });
    }
    const finalAmount = type === 'consumption' ? -Math.abs(parseFloat(amount)) : Math.abs(parseFloat(amount));
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const old = await client.query('SELECT user_id FROM transactions WHERE id = $1', [id]);
        if (old.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Transação não encontrada' }); }
        const oldUserId = old.rows[0].user_id;
        await client.query(
            'UPDATE transactions SET user_id=$1, type=$2, amount=$3, timestamp=$4 WHERE id=$5',
            [user_id, type, finalAmount, timestamp, id]
        );
        const affectedUsers = [...new Set([parseInt(oldUserId), parseInt(user_id)])];
        for (const uid of affectedUsers) {
            await client.query(
                'UPDATE users SET balance = COALESCE((SELECT SUM(amount) FROM transactions WHERE user_id=$1), 0) WHERE id=$1',
                [uid]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.delete('/api/admin/transactions/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const old = await client.query('SELECT user_id FROM transactions WHERE id=$1', [id]);
        if (old.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Transação não encontrada' }); }
        const userId = old.rows[0].user_id;
        await client.query('DELETE FROM transactions WHERE id=$1', [id]);
        await client.query(
            'UPDATE users SET balance = COALESCE((SELECT SUM(amount) FROM transactions WHERE user_id=$1), 0) WHERE id=$1',
            [userId]
        );
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// =====================
//  PAYMENT RECEIPTS
// =====================

app.post('/api/receipts', uploadReceipt.single('comprovante'), async (req, res) => {
    try {
        const { matricula, amount_declared } = req.body;
        if (!matricula || !req.file) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Matrícula e comprovante são obrigatórios.' });
        }
        const amount = amount_declared ? parseFloat(amount_declared) : 0;
        const userResult = await pool.query('SELECT id FROM users WHERE matricula=$1', [matricula]);
        if (userResult.rows.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }
        const userId = userResult.rows[0].id;
        await pool.query(
            `INSERT INTO payment_receipts (user_id, amount_declared, file_path, file_name, file_type)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, amount, req.file.filename, req.file.originalname, req.file.mimetype]
        );
        res.json({ success: true, message: 'Comprovante enviado! Aguardando aprovação do administrador.' });
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/receipts/:matricula', async (req, res) => {
    try {
        const userResult = await pool.query('SELECT id FROM users WHERE matricula=$1', [req.params.matricula]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
        const result = await pool.query(
            `SELECT id, amount_declared, amount_approved, status, file_name, notes, created_at, reviewed_at
             FROM payment_receipts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`,
            [userResult.rows[0].id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/receipts/:matricula/:id/file', async (req, res) => {
    try {
        const { matricula, id } = req.params;
        const result = await pool.query(
            `SELECT pr.file_path, pr.file_name, pr.file_type
             FROM payment_receipts pr
             JOIN users u ON pr.user_id = u.id
             WHERE pr.id = $1 AND u.matricula = $2`,
            [id, matricula]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Arquivo não encontrado.' });
        const { file_path, file_name, file_type } = result.rows[0];
        const fullPath = path.join(receiptsDir, file_path);
        if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Arquivo não encontrado no servidor.' });
        res.setHeader('Content-Type', file_type);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file_name)}"`);
        fs.createReadStream(fullPath).pipe(res);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/receipts', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT pr.*, u.name, u.matricula
            FROM payment_receipts pr
            JOIN users u ON pr.user_id = u.id
            ORDER BY pr.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/receipts/:id/file', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT file_path, file_name, file_type FROM payment_receipts WHERE id=$1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Comprovante não encontrado.' });
        const { file_path, file_name, file_type } = result.rows[0];
        const fullPath = path.join(receiptsDir, file_path);
        if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Arquivo não encontrado no servidor.' });
        res.setHeader('Content-Type', file_type);
        res.setHeader('Content-Disposition', `inline; filename="${file_name}"`);
        fs.createReadStream(fullPath).pipe(res);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/receipts/:id/approve', requireAdmin, async (req, res) => {
    const { amount_approved } = req.body;
    const amount = parseFloat(amount_approved);
    if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'Valor aprovado inválido.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const receipt = await client.query(
            'SELECT * FROM payment_receipts WHERE id=$1 AND status=$2',
            [req.params.id, 'pending']
        );
        if (receipt.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Comprovante não encontrado ou já processado.' }); }
        const { user_id } = receipt.rows[0];
        await client.query(
            `UPDATE payment_receipts SET status='approved', amount_approved=$1, reviewed_at=NOW(), reviewed_by='admin' WHERE id=$2`,
            [amount, req.params.id]
        );
        await client.query(
            'INSERT INTO transactions (user_id, amount, type) VALUES ($1, $2, $3)',
            [user_id, amount, 'recharge']
        );
        await client.query(
            'UPDATE users SET balance = balance + $1 WHERE id = $2',
            [amount, user_id]
        );
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.put('/api/admin/receipts/:id/reject', requireAdmin, async (req, res) => {
    const { notes } = req.body;
    try {
        const result = await pool.query(
            `UPDATE payment_receipts SET status='rejected', notes=$1, reviewed_at=NOW(), reviewed_by='admin' WHERE id=$2 AND status='pending' RETURNING id`,
            [notes || null, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Comprovante não encontrado ou já processado.' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
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
