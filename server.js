const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool, initSchema } = require('./database');
const { withTransaction, recalculate, recalculateWithExtrasReset, applyConsumption } = require('./cost-engine');
const { analyzeReceipt, analyzeInvoice, isSupportedDocument } = require('./ai');
const paymentGateway = require('./payment-gateway');
const telegram = require('./telegram');

const app = express();
const PORT = process.env.PORT || 5000;

// Sem JWT_SECRET qualquer um forja um token de admin. Em produção isso é fatal:
// aborta o boot em vez de subir com um segredo previsível.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    if (process.env.NODE_ENV === 'production') {
        console.error('JWT_SECRET não definido. Defina a variável antes de iniciar em produção.');
        process.exit(1);
    }
    console.warn('[auth] JWT_SECRET não definido — usando segredo de desenvolvimento. NÃO use assim em produção.');
}
const JWT_KEY = JWT_SECRET || 'mt_coffee_dev_only_secret';
const TOKEN_EXPIRY = '12h';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const uploadCoffeeImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Tipo de imagem não permitido. Use JPEG, PNG, WebP ou GIF.'));
    }
});

// Documents (nota fiscal, etc.): images or PDF — both readable by the AI.
const uploadDocument = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Tipo de arquivo não permitido. Use imagem ou PDF.'));
    }
});

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
        const payload = jwt.verify(token, JWT_KEY);
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

        const token = jwt.sign({ role: 'admin' }, JWT_KEY, { expiresIn: TOKEN_EXPIRY });
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
        const calc = await recalculate(pool);
        const stateResult = await pool.query('SELECT * FROM system_state ORDER BY id DESC LIMIT 1');
        const state = stateResult.rows.length ? stateResult.rows[0] : { coffee_stock_grams: 0, stock_total_cost: 0, qr_code_url: '', pix_key: '' };

        res.json({
            ...state,
            dose_grams: calc.doseGrams,
            current_price_per_dose: calc.currentPricePerDose,
            base_price_per_dose: calc.basePricePerDose,
            infra_cost_per_dose: calc.infraCostPerDose || 0,
            other_extra_cost_per_dose: calc.otherExtraCostPerDose || 0,
            extra_costs_total: calc.extraTotal,
            extra_cost_per_dose: calc.extraCostPerDose,
            fee_per_dose: calc.feePerDose || 0,
            mp_fee_percent: calc.mpFeePercent || 0,
            monthly_estimated_doses: calc.monthlyDoses || 200,
            remaining_extra_costs: calc.remainingExtraCosts,
            remaining_cost: calc.remainingPurchaseCost,
            total_purchased_grams: calc.totalPurchasedGrams,
            total_purchase_cost: calc.totalPurchaseCost,
            remaining_doses: calc.remainingDoses,
            total_consumptions: calc.totalConsumptions,
            dilution_doses: calc.dilutionDoses
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =====================
//  TRANSPARENCY & AUDIT (PUBLIC INDIVIDUAL MOVEMENTS & INVOICES)
// =====================
app.get('/api/transparency', async (req, res) => {
    try {
        // 1. Histórico de compras de café (remessas com indicador de nota)
        const coffeePurchasesRes = await pool.query(`
            SELECT sh.id, sh.added_grams, sh.added_cost, sh.timestamp,
                   sh.invoice_file_name, (sh.invoice_file_data IS NOT NULL) AS has_invoice,
                   c.name AS coffee_name, c.origin AS coffee_origin,
                   CASE WHEN sh.added_grams > 0 THEN ROUND((sh.added_cost / sh.added_grams * 1000)::numeric, 2) ELSE 0 END AS cost_per_kg
            FROM stock_history sh
            LEFT JOIN coffees c ON sh.coffee_id = c.id
            ORDER BY sh.timestamp DESC
            LIMIT 50
        `);

        // 2. Ajustes e inventário de estoque
        const stockAdjustmentsRes = await pool.query(`
            SELECT id, grams_before, grams_after, delta_grams, delta_cost, reason, timestamp
            FROM stock_adjustments
            ORDER BY timestamp DESC
            LIMIT 50
        `);

        // 3. Custos extras e infraestrutura diluídos
        const extraCostsRes = await pool.query(`
            SELECT id, description, amount, remaining, dilution_doses, created_at,
                   invoice_file_name, (invoice_file_data IS NOT NULL) AS has_invoice
            FROM extra_costs
            ORDER BY created_at DESC
            LIMIT 50
        `);

        // 4. Histórico de recargas 100% anônimo (sem identificação de colaborador)
        const rechargesRes = await pool.query(`
            SELECT t.id, t.amount, t.timestamp,
                   CASE WHEN pc.id IS NOT NULL THEN 'PIX Dinâmico'
                        WHEN pr.id IS NOT NULL THEN 'Comprovante'
                        ELSE 'PIX / Recarga' END AS method
            FROM transactions t
            LEFT JOIN pix_charges pc ON pc.user_id = t.user_id AND ABS(pc.amount - t.amount) < 0.01 AND ABS(EXTRACT(EPOCH FROM (t.timestamp - pc.paid_at))) < 15
            LEFT JOIN payment_receipts pr ON pr.user_id = t.user_id AND ABS(pr.amount_approved - t.amount) < 0.01 AND ABS(EXTRACT(EPOCH FROM (t.timestamp - pr.created_at))) < 15
            WHERE t.type = 'recharge'
            ORDER BY t.timestamp DESC
            LIMIT 100
        `);

        res.json({
            coffee_purchases: coffeePurchasesRes.rows.map(r => ({
                id: r.id,
                grams: parseFloat(r.added_grams),
                cost: parseFloat(r.added_cost),
                cost_per_kg: parseFloat(r.cost_per_kg),
                coffee_name: r.coffee_name || 'Café Especial',
                origin: r.coffee_origin || '',
                has_invoice: Boolean(r.has_invoice),
                invoice_file_name: r.invoice_file_name || null,
                timestamp: r.timestamp
            })),
            stock_adjustments: stockAdjustmentsRes.rows.map(r => ({
                id: r.id,
                grams_before: parseFloat(r.grams_before),
                grams_after: parseFloat(r.grams_after),
                delta_grams: parseFloat(r.delta_grams),
                delta_cost: parseFloat(r.delta_cost),
                reason: r.reason || 'Ajuste / Inventário',
                timestamp: r.timestamp
            })),
            extra_costs: extraCostsRes.rows.map(r => ({
                id: r.id,
                description: r.description,
                amount: parseFloat(r.amount),
                remaining: parseFloat(r.remaining),
                dilution_doses: parseInt(r.dilution_doses) || 200,
                has_invoice: Boolean(r.has_invoice),
                invoice_file_name: r.invoice_file_name || null,
                created_at: r.created_at
            })),
            recharges: rechargesRes.rows.map(r => ({
                id: r.id,
                amount: parseFloat(r.amount),
                method: r.method,
                timestamp: r.timestamp
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Download / visualização pública de nota fiscal ou comprovante de compra
app.get('/api/transparency/doc/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        const numId = parseInt(id);
        if (isNaN(numId)) return res.status(400).send('ID inválido');

        let row = null;
        if (type === 'stock') {
            const result = await pool.query(
                'SELECT invoice_file_data, invoice_file_name, invoice_file_type FROM stock_history WHERE id = $1',
                [numId]
            );
            row = result.rows[0];
        } else if (type === 'extra') {
            const result = await pool.query(
                'SELECT invoice_file_data, invoice_file_name, invoice_file_type FROM extra_costs WHERE id = $1',
                [numId]
            );
            row = result.rows[0];
        }

        if (!row || !row.invoice_file_data) {
            return res.status(404).send('Nota fiscal ou documento não encontrado para esta movimentação.');
        }

        res.set('Content-Type', row.invoice_file_type || 'application/pdf');
        res.set('Content-Disposition', `inline; filename="${encodeURIComponent(row.invoice_file_name || 'nota-fiscal')}"`);
        res.send(row.invoice_file_data);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// =====================
//  SYSTEM ADMIN ROUTES (PROTECTED)
// =====================
app.post('/api/system/stock', requireAdmin, uploadDocument.single('nota'), async (req, res) => {
    const { added_grams, added_cost, coffee_id } = req.body;
    if (!added_grams || added_grams <= 0) return res.status(400).json({ error: "Quantidade de gramas inválida." });
    const grams = parseFloat(added_grams);
    const cost = parseFloat(added_cost || 0);
    const coffeeId = (coffee_id && !isNaN(parseInt(coffee_id))) ? parseInt(coffee_id) : null;

    let fileBuffer = req.file ? req.file.buffer : null;
    let fileName = req.file ? req.file.originalname : null;
    let fileType = req.file ? req.file.mimetype : null;

    try {
        const calc = await withTransaction(async (client) => {
            const insRes = await client.query(
                `INSERT INTO stock_history (added_grams, added_cost, coffee_id, invoice_file_data, invoice_file_name, invoice_file_type)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [grams, cost, coffeeId, fileBuffer, fileName, fileType]
            );
            const c = await recalculate(client);
            await client.query(
                'UPDATE stock_history SET price_per_dose = $1 WHERE id = $2',
                [c.currentPricePerDose, insRes.rows[0].id]
            );
            return c;
        });
        res.json({ success: true, message: "Remessa adicionada ao estoque com sucesso!", newStock: calc.currentStock });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/price-history', requireAdmin, async (req, res) => {
    try {
        // Keep only the last value per day (Brazil timezone), oldest first.
        const result = await pool.query(`
            SELECT DISTINCT ON (day) day, price_per_dose, timestamp
            FROM (
                SELECT id, price_per_dose, timestamp,
                       DATE(timestamp AT TIME ZONE 'America/Sao_Paulo') AS day
                FROM price_history
            ) t
            ORDER BY day, id DESC
        `);
        const ordered = result.rows
            .map(r => ({
                day: r.day,
                price_per_dose: parseFloat(r.price_per_dose),
                timestamp: r.timestamp
            }))
            .sort((a, b) => new Date(a.day) - new Date(b.day));
        res.json(ordered);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/stock-history', requireAdmin, async (req, res) => {
    try {
        const doseRes = await pool.query("SELECT value FROM settings WHERE key='dose_grams'");
        const doseGrams = parseFloat(doseRes.rows[0]?.value) || 10;
        const result = await pool.query(`
            SELECT sh.id, sh.added_grams, sh.added_cost,
                   sh.invoice_file_name, (sh.invoice_file_data IS NOT NULL) AS has_invoice,
                   c.name AS coffee_name,
                   CASE WHEN sh.added_grams > 0 THEN ROUND((sh.added_cost / sh.added_grams * $1)::numeric, 4) ELSE 0 END AS price_per_dose,
                   CASE WHEN sh.added_grams > 0 THEN ROUND((sh.added_cost / sh.added_grams * 1000)::numeric, 2) ELSE 0 END AS cost_per_kg,
                   sh.timestamp
            FROM stock_history sh
            LEFT JOIN coffees c ON sh.coffee_id = c.id
            ORDER BY sh.timestamp DESC
            LIMIT 50
        `, [doseGrams]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Calculation logic extracted to cost-engine.js

app.put('/api/admin/stock-history/:id', requireAdmin, async (req, res) => {
    const { added_grams, added_cost, timestamp } = req.body;
    const grams = parseFloat(added_grams);
    const cost = parseFloat(added_cost || 0);
    if (isNaN(grams) || grams <= 0) return res.status(400).json({ error: 'Quantidade de gramas inválida.' });
    try {
        const calc = await withTransaction(async (client) => {
            const exists = await client.query('SELECT id FROM stock_history WHERE id=$1', [req.params.id]);
            if (exists.rows.length === 0) throw Object.assign(new Error('Remessa não encontrada.'), { status: 404 });
            const tsClause = timestamp ? `, timestamp = $3` : '';
            const params = timestamp ? [grams, cost, timestamp, req.params.id] : [grams, cost, req.params.id];
            await client.query(`UPDATE stock_history SET added_grams=$1, added_cost=$2${tsClause} WHERE id=$${params.length}`, params);
            return await recalculate(client);
        });
        res.json({ success: true, newStock: calc.currentStock });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

app.delete('/api/admin/stock-history/:id', requireAdmin, async (req, res) => {
    try {
        const calc = await withTransaction(async (client) => {
            const exists = await client.query('SELECT id FROM stock_history WHERE id=$1', [req.params.id]);
            if (exists.rows.length === 0) throw Object.assign(new Error('Remessa não encontrada.'), { status: 404 });
            await client.query('DELETE FROM stock_history WHERE id=$1', [req.params.id]);
            return await recalculate(client);
        });
        res.json({ success: true, newStock: calc.currentStock });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// =====================
//  STOCK ADJUSTMENTS
// =====================
app.post('/api/admin/stock/adjust', requireAdmin, async (req, res) => {
    const { physical_grams, reason } = req.body;
    const physicalGrams = parseFloat(physical_grams);
    if (isNaN(physicalGrams) || physicalGrams < 0) return res.status(400).json({ error: 'Quantidade inválida.' });
    try {
        const result = await withTransaction(async (client) => {
            const stateResult = await client.query('SELECT coffee_stock_grams FROM system_state ORDER BY id DESC LIMIT 1');
            const currentGrams = parseFloat(stateResult.rows[0].coffee_stock_grams);
            if (Math.abs(physicalGrams - currentGrams) < 0.01) {
                throw Object.assign(new Error('Estoque físico igual ao virtual. Nenhum ajuste necessário.'), { status: 400 });
            }
            const deltaGrams = physicalGrams - currentGrams;
            await client.query(
                'INSERT INTO stock_adjustments (grams_before, grams_after, delta_grams, delta_cost, reason) VALUES ($1,$2,$3,$4,$5)',
                [currentGrams, physicalGrams, deltaGrams, 0, reason || null]
            );
            await recalculate(client);
            return { grams_before: currentGrams, grams_after: physicalGrams, delta_grams: deltaGrams };
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
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
    try {
        const row = await withTransaction(async (client) => {
            const dilRes = await client.query("SELECT value FROM settings WHERE key = 'extra_dilution_doses'");
            const dilutionDoses = dilRes.rows.length ? parseInt(dilRes.rows[0].value) : 200;
            const result = await client.query(
                'INSERT INTO extra_costs (description, amount, remaining, dilution_doses) VALUES ($1, $2, $2, $3) RETURNING *',
                [description.trim(), amt, dilutionDoses]
            );
            await recalculate(client);
            return result.rows[0];
        });
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/extra-costs/:id', requireAdmin, async (req, res) => {
    try {
        await withTransaction(async (client) => {
            const result = await client.query('DELETE FROM extra_costs WHERE id=$1 RETURNING id', [req.params.id]);
            if (result.rows.length === 0) throw Object.assign(new Error('Custo não encontrado.'), { status: 404 });
            await recalculate(client);
        });
        res.json({ success: true });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
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

app.post('/api/system/dose-grams', requireAdmin, async (req, res) => {
    try {
        const dose = parseFloat(req.body.dose_grams);
        if (isNaN(dose) || dose <= 0 || dose > 100) {
            return res.status(400).json({ error: 'Valor inválido. Informe um número entre 0,1 e 100 gramas.' });
        }
        await pool.query("UPDATE settings SET value = $1 WHERE key = 'dose_grams'", [String(dose)]);
        res.json({ success: true, message: 'Gramas por dose atualizado.', dose_grams: dose });
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

// =====================
//  INTEGRAÇÕES ADMIN (MERCADO PAGO & TELEGRAM)
// =====================
app.get('/api/admin/integrations', requireAdmin, async (req, res) => {
    try {
        const resSettings = await pool.query(
            "SELECT key, value FROM settings WHERE key IN ('mp_access_token', 'telegram_bot_token', 'telegram_chat_id', 'low_stock_threshold_grams', 'mp_fee_percent', 'railway_monthly_cost')"
        );
        const map = {};
        resSettings.rows.forEach(r => { map[r.key] = r.value; });

        const mpToken = map['mp_access_token'] || process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || '';
        const tgToken = map['telegram_bot_token'] || process.env.TELEGRAM_BOT_TOKEN || '';
        const tgChat = map['telegram_chat_id'] || process.env.TELEGRAM_CHAT_ID || '';
        const lowStock = map['low_stock_threshold_grams'] || '200';
        const mpFee = map['mp_fee_percent'] || '0.99';
        const railwayCost = map['railway_monthly_cost'] || '28.00';

        res.json({
            mp_configured: Boolean(mpToken),
            mp_masked: mpToken ? (mpToken.slice(0, 10) + '...' + mpToken.slice(-4)) : '',
            telegram_configured: Boolean(tgToken && tgChat),
            telegram_bot_masked: tgToken ? (tgToken.slice(0, 8) + '...' + tgToken.slice(-4)) : '',
            telegram_chat_id: tgChat,
            low_stock_threshold_grams: parseFloat(lowStock) || 200,
            mp_fee_percent: parseFloat(mpFee) || 0.99,
            railway_monthly_cost: parseFloat(railwayCost) || 28.00
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/integrations', requireAdmin, async (req, res) => {
    try {
        const { mp_access_token, telegram_bot_token, telegram_chat_id, low_stock_threshold_grams, mp_fee_percent, railway_monthly_cost } = req.body;

        if (mp_access_token !== undefined) {
            await pool.query(
                `INSERT INTO settings (key, value) VALUES ('mp_access_token', $1)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
                [mp_access_token.trim()]
            );
        }
        if (telegram_bot_token !== undefined) {
            await pool.query(
                `INSERT INTO settings (key, value) VALUES ('telegram_bot_token', $1)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
                [telegram_bot_token.trim()]
            );
        }
        if (telegram_chat_id !== undefined) {
            await pool.query(
                `INSERT INTO settings (key, value) VALUES ('telegram_chat_id', $1)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
                [telegram_chat_id.trim()]
            );
        }
        if (low_stock_threshold_grams !== undefined) {
            const grams = parseFloat(low_stock_threshold_grams);
            if (!isNaN(grams) && grams > 0) {
                await pool.query(
                    `INSERT INTO settings (key, value) VALUES ('low_stock_threshold_grams', $1)
                     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
                    [String(grams)]
                );
            }
        }
        if (mp_fee_percent !== undefined) {
            const fee = parseFloat(mp_fee_percent);
            if (!isNaN(fee) && fee >= 0 && fee < 100) {
                await pool.query(
                    `INSERT INTO settings (key, value) VALUES ('mp_fee_percent', $1)
                     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
                    [String(fee)]
                );
                await recalculate(pool);
            }
        }
        if (railway_monthly_cost !== undefined) {
            const cost = parseFloat(railway_monthly_cost);
            if (!isNaN(cost) && cost >= 0) {
                await pool.query(
                    `INSERT INTO settings (key, value) VALUES ('railway_monthly_cost', $1)
                     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
                    [String(cost)]
                );
            }
        }

        res.json({ success: true, message: 'Configurações atualizadas com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/costs/railway-monthly', requireAdmin, async (req, res) => {
    try {
        const { amount, dilution_doses } = req.body;
        const settingRes = await pool.query("SELECT value FROM settings WHERE key IN ('railway_monthly_cost', 'extra_dilution_doses')");
        const settings = {};
        settingRes.rows.forEach(r => { settings[r.key] = r.value; });

        const numAmount = parseFloat(amount) || parseFloat(settings.railway_monthly_cost) || 28.00;
        const numDilution = parseInt(dilution_doses) || parseInt(settings.extra_dilution_doses) || 200;

        const dateStr = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        const desc = `Servidor Railway (${dateStr.charAt(0).toUpperCase() + dateStr.slice(1)})`;

        const result = await withTransaction(async (client) => {
            const ins = await client.query(
                'INSERT INTO extra_costs (description, amount, remaining, dilution_doses) VALUES ($1, $2, $2, $3) RETURNING *',
                [desc, numAmount, numDilution]
            );
            await recalculate(client);
            return ins.rows[0];
        });

        res.json({
            success: true,
            message: `Mensalidade do Railway de R$ ${numAmount.toFixed(2).replace('.', ',')} adicionada com sucesso (diluída em ${numDilution} doses)!`,
            cost: result
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/telegram/test', requireAdmin, async (req, res) => {
    try {
        const config = await telegram.getTelegramConfig(pool);
        if (!config.botToken || !config.chatId) {
            return res.status(400).json({ error: 'Token do Bot ou Chat ID do Telegram não configurados.' });
        }

        const text = `🤖 <b>Teste de Conexão — MT Coffee</b> ☕\n\n`
            + `O bot do Telegram foi conectado com sucesso ao sistema MT Coffee!\n`
            + `Você receberá avisos automáticos de estoque baixo (≤ ${config.thresholdGrams}g) e notificações de recargas neste chat.`;

        const sendRes = await telegram.sendTelegramMessage({
            botToken: config.botToken,
            chatId: config.chatId,
            text
        });

        if (sendRes.success) {
            res.json({ success: true, message: 'Mensagem de teste enviada com sucesso para o Telegram!' });
        } else {
            res.status(400).json({ error: sendRes.error || 'Falha ao enviar mensagem de teste.' });
        }
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
    const { matricula } = req.body;
    try {
        const result = await withTransaction(async (client) => {
            const userResult = await client.query('SELECT * FROM users WHERE matricula = $1', [matricula]);
            if (userResult.rows.length === 0) throw Object.assign(new Error('User not found'), { status: 404 });
            const user = userResult.rows[0];

            const stateResult = await client.query('SELECT * FROM system_state ORDER BY id DESC LIMIT 1');
            const state = stateResult.rows[0];

            const settingResult = await client.query("SELECT value FROM settings WHERE key = $1", ['dose_grams']);
            const doseGrams = settingResult.rows.length ? parseFloat(settingResult.rows[0].value) : 10;

            if (!state || state.coffee_stock_grams < doseGrams) {
                throw Object.assign(new Error('Not enough coffee stock!'), { status: 400 });
            }

            const deduction = await applyConsumption(client, state, doseGrams);

            await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [deduction.priceCharged, user.id]);
            await client.query(
                'INSERT INTO transactions (user_id, amount, type, grams_deducted, cost_deducted) VALUES ($1, $2, $3, $4, $5)',
                [user.id, -deduction.priceCharged, 'consumption', doseGrams, deduction.baseCostDeducted]
            );

            // Recompute state now that the consumption (with its cost_deducted)
            // is recorded, so the per-dose price stays constant for the next user.
            await recalculate(client);

            return { new_balance: user.balance - deduction.priceCharged, cost: deduction.priceCharged };
        });

        // Dispara verificação de estoque baixo no Telegram em segundo plano
        pool.query('SELECT coffee_stock_grams, current_price_per_dose FROM system_state ORDER BY id DESC LIMIT 1')
            .then(stRes => {
                if (stRes.rows.length) {
                    telegram.checkAndAlertLowStock({
                        pool,
                        remainingGrams: stRes.rows[0].coffee_stock_grams,
                        currentPrice: stRes.rows[0].current_price_per_dose
                    });
                }
            }).catch(() => {});

        res.json({ success: true, message: 'Coffee consumed!', ...result });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// =====================
//  PIX DINÂMICO & WEBHOOKS
// =====================
app.get('/api/pix/config', async (req, res) => {
    try {
        const settingRes = await pool.query("SELECT value FROM settings WHERE key = 'mp_access_token'");
        const mpToken = settingRes.rows.length ? settingRes.rows[0].value : null;
        res.json({
            enabled: paymentGateway.isConfigured(mpToken)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/pix/create', async (req, res) => {
    try {
        const { matricula, amount } = req.body;
        if (!matricula) return res.status(400).json({ error: 'Matrícula é obrigatória.' });
        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount < 0.50) {
            return res.status(400).json({ error: 'Valor mínimo para recarga via PIX é R$ 0,50.' });
        }

        const userRes = await pool.query('SELECT id, name, matricula FROM users WHERE matricula = $1', [matricula]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
        const user = userRes.rows[0];

        const settingRes = await pool.query("SELECT value FROM settings WHERE key = 'mp_access_token'");
        const settingsToken = settingRes.rows.length ? settingRes.rows[0].value : null;

        const pixData = await paymentGateway.createPixPayment({
            userId: user.id,
            matricula: user.matricula,
            name: user.name,
            amount: numAmount,
            settingsToken
        });

        await pool.query(
            `INSERT INTO pix_charges (payment_id, user_id, matricula, amount, status, qr_code, qr_code_base64, ticket_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [pixData.payment_id, user.id, user.matricula, numAmount, pixData.status, pixData.qr_code, pixData.qr_code_base64, pixData.ticket_url]
        );

        res.json({
            success: true,
            payment_id: pixData.payment_id,
            status: pixData.status,
            amount: pixData.amount,
            qr_code: pixData.qr_code,
            qr_code_base64: pixData.qr_code_base64,
            ticket_url: pixData.ticket_url,
            expires_at: pixData.expires_at
        });
    } catch (err) {
        console.error('[pix] Erro ao criar cobrança:', err.message);
        res.status(500).json({ error: err.message || 'Erro ao gerar PIX.' });
    }
});

app.get('/api/pix/status/:paymentId', async (req, res) => {
    try {
        const { paymentId } = req.params;
        const chargeRes = await pool.query('SELECT * FROM pix_charges WHERE payment_id = $1', [paymentId]);
        if (chargeRes.rows.length === 0) {
            return res.status(404).json({ error: 'Cobrança não encontrada.' });
        }
        const charge = chargeRes.rows[0];

        // Se já está aprovado no banco, retorna imediatamente
        if (charge.status === 'approved') {
            const userRes = await pool.query('SELECT balance FROM users WHERE id = $1', [charge.user_id]);
            return res.json({
                status: 'approved',
                paid: true,
                amount: charge.amount,
                new_balance: userRes.rows[0]?.balance
            });
        }

        // Caso contrário, consulta no Mercado Pago para verificar status
        const settingRes = await pool.query("SELECT value FROM settings WHERE key = 'mp_access_token'");
        const settingsToken = settingRes.rows.length ? settingRes.rows[0].value : null;
        const mpStatus = await paymentGateway.getPaymentStatus(paymentId, settingsToken).catch(() => null);

        if (mpStatus && mpStatus.status === 'approved') {
            let updatedBalance = null;
            await withTransaction(async (client) => {
                const check = await client.query('SELECT status, user_id, amount, matricula FROM pix_charges WHERE payment_id = $1 FOR UPDATE', [paymentId]);
                if (check.rows.length > 0 && check.rows[0].status !== 'approved') {
                    await client.query('UPDATE pix_charges SET status = $1, paid_at = NOW() WHERE payment_id = $2', ['approved', paymentId]);
                    await client.query('INSERT INTO transactions (user_id, amount, type) VALUES ($1, $2, $3)', [charge.user_id, charge.amount, 'recharge']);
                    const u = await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance, name', [charge.amount, charge.user_id]);
                    updatedBalance = u.rows[0]?.balance;

                    telegram.notifyRecharge({
                        pool,
                        userName: u.rows[0]?.name,
                        matricula: charge.matricula,
                        amount: charge.amount,
                        method: 'PIX Dinâmico (Mercado Pago)'
                    }).catch(() => {});
                }
            });

            return res.json({
                status: 'approved',
                paid: true,
                amount: charge.amount,
                new_balance: updatedBalance
            });
        }

        res.json({
            status: mpStatus?.status || charge.status,
            paid: false,
            amount: charge.amount
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/webhooks/mercadopago', async (req, res) => {
    try {
        const paymentId = req.query['data.id'] || req.body?.data?.id || (req.body?.type === 'payment' ? req.body?.data?.id : null) || req.body?.id;
        if (paymentId) {
            const settingRes = await pool.query("SELECT value FROM settings WHERE key = 'mp_access_token'");
            const settingsToken = settingRes.rows.length ? settingRes.rows[0].value : null;
            const mpStatus = await paymentGateway.getPaymentStatus(String(paymentId), settingsToken).catch(() => null);

            if (mpStatus && mpStatus.status === 'approved') {
                await withTransaction(async (client) => {
                    const check = await client.query('SELECT status, user_id, amount, matricula FROM pix_charges WHERE payment_id = $1 FOR UPDATE', [String(paymentId)]);
                    if (check.rows.length > 0 && check.rows[0].status !== 'approved') {
                        const charge = check.rows[0];
                        await client.query('UPDATE pix_charges SET status = $1, paid_at = NOW() WHERE payment_id = $2', ['approved', String(paymentId)]);
                        await client.query('INSERT INTO transactions (user_id, amount, type) VALUES ($1, $2, $3)', [charge.user_id, charge.amount, 'recharge']);
                        const u = await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance, name', [charge.amount, charge.user_id]);

                        telegram.notifyRecharge({
                            pool,
                            userName: u.rows[0]?.name,
                            matricula: charge.matricula,
                            amount: charge.amount,
                            method: 'PIX Dinâmico (Mercado Pago)'
                        }).catch(() => {});
                    }
                });
            }
        }
        res.status(200).send('OK');
    } catch (err) {
        console.warn('[webhook] Erro ao processar:', err.message);
        res.status(200).send('OK');
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
    try {
        await withTransaction(async (client) => {
            const old = await client.query('SELECT user_id, type, grams_deducted, cost_deducted FROM transactions WHERE id = $1', [id]);
            if (old.rows.length === 0) throw Object.assign(new Error('Transação não encontrada'), { status: 404 });
            const oldUserId = old.rows[0].user_id;
            // Preserve historical grams_deducted/cost_deducted when row was already a
            // consumption; when becoming a consumption, snapshot the current dose_grams
            // setting and the current purchase price/gram.
            let gramsDeducted;
            let costDeducted;
            if (type === 'consumption') {
                if (old.rows[0].type === 'consumption' && old.rows[0].grams_deducted != null) {
                    gramsDeducted = parseFloat(old.rows[0].grams_deducted);
                    costDeducted = old.rows[0].cost_deducted != null ? parseFloat(old.rows[0].cost_deducted) : 0;
                } else {
                    const s = await client.query("SELECT value FROM settings WHERE key='dose_grams'");
                    gramsDeducted = s.rows.length ? parseFloat(s.rows[0].value) : 10;
                    const ss = await client.query('SELECT coffee_stock_grams, stock_total_cost FROM system_state ORDER BY id DESC LIMIT 1');
                    const sg = ss.rows.length ? parseFloat(ss.rows[0].coffee_stock_grams) : 0;
                    const sc = ss.rows.length ? parseFloat(ss.rows[0].stock_total_cost) : 0;
                    const ratePerGram = sg > 0 ? sc / sg : 0;
                    costDeducted = ratePerGram * gramsDeducted;
                }
            } else {
                gramsDeducted = 0;
                costDeducted = 0;
            }
            await client.query(
                'UPDATE transactions SET user_id=$1, type=$2, amount=$3, timestamp=$4, grams_deducted=$5, cost_deducted=$6 WHERE id=$7',
                [user_id, type, finalAmount, timestamp, gramsDeducted, costDeducted, id]
            );
            const affectedUsers = [...new Set([parseInt(oldUserId), parseInt(user_id)])];
            for (const uid of affectedUsers) {
                await client.query(
                    'UPDATE users SET balance = COALESCE((SELECT SUM(amount) FROM transactions WHERE user_id=$1), 0) WHERE id=$1',
                    [uid]
                );
            }
            // Recalculate stock + reset extras remaining (consumption count changed)
            await recalculateWithExtrasReset(client);
        });
        res.json({ success: true });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

app.delete('/api/admin/transactions/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await withTransaction(async (client) => {
            const old = await client.query('SELECT user_id FROM transactions WHERE id=$1', [id]);
            if (old.rows.length === 0) throw Object.assign(new Error('Transação não encontrada'), { status: 404 });
            const userId = old.rows[0].user_id;
            await client.query('DELETE FROM transactions WHERE id=$1', [id]);
            await client.query(
                'UPDATE users SET balance = COALESCE((SELECT SUM(amount) FROM transactions WHERE user_id=$1), 0) WHERE id=$1',
                [userId]
            );
            // Recalculate stock + reset extras remaining (consumption count changed)
            await recalculateWithExtrasReset(client);
        });
        res.json({ success: true });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
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
        const fileData = fs.readFileSync(req.file.path);
        const fileHash = crypto.createHash('sha256').update(fileData).digest('hex');
        const inserted = await pool.query(
            `INSERT INTO payment_receipts (user_id, amount_declared, file_path, file_name, file_type, file_data, file_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [userId, amount, req.file.filename, req.file.originalname, req.file.mimetype, fileData, fileHash]
        );
        const receiptId = inserted.rows[0].id;

        // Anti-replay: if this exact file was already submitted before, it may be a
        // re-upload of the same proof. Never auto-credit a duplicate — leave it for
        // the admin to review.
        const dupResult = await pool.query(
            `SELECT 1 FROM payment_receipts WHERE file_hash=$1 AND id<>$2 LIMIT 1`,
            [fileHash, receiptId]
        );
        const isDuplicate = dupResult.rows.length > 0;

        // Try AI analysis + auto-credit. When the AI is highly confident the
        // document is a valid payment proof, credit the user automatically with
        // the amount the AI read from the proof (no admin approval needed).
        let autoCredited = false;
        let creditedAmount = 0;
        if (isSupportedDocument(req.file.mimetype)) {
            try {
                const ai = await analyzeReceipt(fileData, req.file.mimetype, req.file.originalname);
                const aiAmount = (ai && typeof ai.amount === 'number') ? ai.amount : null;
                await pool.query(
                    `UPDATE payment_receipts SET ai_amount=$1, ai_confidence=$2, ai_summary=$3, ai_processed=TRUE WHERE id=$4`,
                    [aiAmount, ai?.confidence || null, ai?.summary || null, receiptId]
                );
                // If the user declared an amount, require the AI value to match it
                // (guards against the proof showing a different value). When no
                // amount was declared, trust the high-confidence AI reading.
                const declaredOk = !(amount > 0) || (aiAmount !== null && Math.abs(aiAmount - amount) <= 0.05);
                const highConfidenceProof = ai?.is_payment_proof === true
                    && ai?.confidence === 'high'
                    && aiAmount !== null && aiAmount > 0
                    && declaredOk
                    && !isDuplicate;
                if (highConfidenceProof) {
                    await withTransaction(async (client) => {
                        const r = await client.query(
                            `SELECT user_id FROM payment_receipts WHERE id=$1 AND status='pending' FOR UPDATE`,
                            [receiptId]
                        );
                        if (r.rows.length === 0) return;
                        await client.query(
                            `UPDATE payment_receipts SET status='approved', amount_approved=$1, reviewed_at=NOW(), reviewed_by='IA' WHERE id=$2`,
                            [aiAmount, receiptId]
                        );
                        await client.query('INSERT INTO transactions (user_id, amount, type) VALUES ($1, $2, $3)', [userId, aiAmount, 'recharge']);
                        const u = await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING name, matricula', [aiAmount, userId]);

                        telegram.notifyRecharge({
                            pool,
                            userName: u.rows[0]?.name,
                            matricula: u.rows[0]?.matricula,
                            amount: aiAmount,
                            method: 'Comprovante PIX (Aprovado por IA)'
                        }).catch(() => {});
                    });
                    autoCredited = true;
                    creditedAmount = aiAmount;
                }
            } catch (aiErr) {
                console.warn('AI receipt analysis failed:', aiErr.message);
                await pool.query('UPDATE payment_receipts SET ai_processed=TRUE WHERE id=$1', [receiptId]).catch(() => {});
            }
        }

        res.json({
            success: true,
            auto_credited: autoCredited,
            credited_amount: creditedAmount,
            message: autoCredited
                ? `Comprovante validado pela IA! R$ ${creditedAmount.toFixed(2).replace('.', ',')} creditado automaticamente.`
                : 'Comprovante enviado! Aguardando aprovação do administrador.'
        });
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
            `SELECT pr.file_path, pr.file_name, pr.file_type, pr.file_data
             FROM payment_receipts pr
             JOIN users u ON pr.user_id = u.id
             WHERE pr.id = $1 AND u.matricula = $2`,
            [id, matricula]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Arquivo não encontrado.' });
        const { file_path, file_name, file_type, file_data } = result.rows[0];
        res.setHeader('Content-Type', file_type);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file_name)}"`);
        const fullPath = path.join(receiptsDir, file_path);
        if (fs.existsSync(fullPath)) {
            fs.createReadStream(fullPath).pipe(res);
        } else if (file_data) {
            res.send(file_data);
        } else {
            res.status(404).json({ error: 'Arquivo não encontrado no servidor.' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/receipts', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT pr.id, pr.user_id, pr.amount_declared, pr.amount_approved,
                   pr.file_path, pr.file_name, pr.file_type, pr.status,
                   pr.notes, pr.reviewed_by, pr.reviewed_at, pr.created_at,
                   pr.ai_amount, pr.ai_confidence, pr.ai_summary, pr.ai_processed,
                   u.name, u.matricula
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
        const result = await pool.query('SELECT file_path, file_name, file_type, file_data FROM payment_receipts WHERE id=$1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Comprovante não encontrado.' });
        const { file_path, file_name, file_type, file_data } = result.rows[0];
        res.setHeader('Content-Type', file_type);
        res.setHeader('Content-Disposition', `inline; filename="${file_name}"`);
        const fullPath = path.join(receiptsDir, file_path);
        if (fs.existsSync(fullPath)) {
            fs.createReadStream(fullPath).pipe(res);
        } else if (file_data) {
            res.send(file_data);
        } else {
            res.status(404).json({ error: 'Arquivo não encontrado no servidor.' });
        }
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
            `UPDATE payment_receipts SET status='approved', amount_approved=$1, reviewed_at=NOW(), reviewed_by='admin'
             WHERE id=$2 AND status='pending' RETURNING user_id`,
            [amount, req.params.id]
        );
        if (receipt.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Comprovante não encontrado ou já processado.' }); }
        const { user_id } = receipt.rows[0];
        await client.query(
            'INSERT INTO transactions (user_id, amount, type) VALUES ($1, $2, $3)',
            [user_id, amount, 'recharge']
        );
        const u = await client.query(
            'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING name, matricula',
            [amount, user_id]
        );
        await client.query('COMMIT');

        telegram.notifyRecharge({
            pool,
            userName: u.rows[0]?.name,
            matricula: u.rows[0]?.matricula,
            amount,
            method: 'Comprovante PIX (Aprovado pelo Admin)'
        }).catch(() => {});
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

// Patrimônio: passivo (créditos devidos) × ativos (estoque + caixa + a receber).
// Separa os dados do MOMENTO (snapshot atual) dos dados HISTÓRICOS (acumulado).
app.get('/api/admin/stats/equity', requireAdmin, async (req, res) => {
    try {
        const [stateRes, stockHistRes, extraRes, txRes, balRes] = await Promise.all([
            pool.query('SELECT coffee_stock_grams, stock_total_cost, remaining_extra_costs FROM system_state LIMIT 1'),
            pool.query(`
                SELECT COUNT(*) AS remessas,
                       COALESCE(SUM(added_cost), 0)  AS total_cost,
                       COALESCE(SUM(added_grams), 0) AS total_grams
                FROM stock_history
            `),
            pool.query('SELECT COALESCE(SUM(amount), 0) AS total_extra FROM extra_costs'),
            pool.query(`
                SELECT
                    COALESCE(SUM(amount) FILTER (WHERE type = 'recharge'), 0)              AS total_recharged,
                    COUNT(*) FILTER (WHERE type = 'recharge')                              AS recharges_count,
                    COALESCE(ABS(SUM(amount) FILTER (WHERE type = 'consumption')), 0)      AS total_consumed,
                    COUNT(*) FILTER (WHERE type = 'consumption')                          AS consumptions_count
                FROM transactions
            `),
            pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0)      AS credits_owed,
                    COALESCE(ABS(SUM(CASE WHEN balance < 0 THEN balance ELSE 0 END)), 0) AS receivable,
                    COUNT(*) FILTER (WHERE balance > 0)                                  AS users_credit,
                    COUNT(*) FILTER (WHERE balance < 0)                                  AS users_debt
                FROM users
                WHERE matricula <> '0000'
            `)
        ]);

        const st = stateRes.rows[0] || {};
        const sh = stockHistRes.rows[0];
        const ex = extraRes.rows[0];
        const tx = txRes.rows[0];
        const ba = balRes.rows[0];

        // --- Componentes do MOMENTO (estado atual) ---
        const stockValue   = parseFloat(st.stock_total_cost || 0) + parseFloat(st.remaining_extra_costs || 0);
        const totalRecharged = parseFloat(tx.total_recharged);
        const totalStockCost = parseFloat(sh.total_cost);
        const totalExtraCost = parseFloat(ex.total_extra);
        // Caixa = dinheiro que entrou (recargas) menos o que saiu (compras de café + custos extras).
        const cash         = totalRecharged - totalStockCost - totalExtraCost;
        const receivable   = parseFloat(ba.receivable);
        const creditsOwed  = parseFloat(ba.credits_owed);

        const assets       = stockValue + cash + receivable;
        const liabilities  = creditsOwed;
        const netEquity    = assets - liabilities;

        res.json({
            momento: {
                estoque:           stockValue,
                caixa:             cash,
                a_receber:         receivable,
                ativos_total:      assets,
                creditos_devidos:  creditsOwed,
                patrimonio_liquido: netEquity,
                stock_grams:       parseFloat(st.coffee_stock_grams || 0),
                users_credit:      parseInt(ba.users_credit),
                users_debt:        parseInt(ba.users_debt)
            },
            historico: {
                total_arrecadado:      totalRecharged,
                recargas_count:        parseInt(tx.recharges_count),
                total_remessas_cost:   totalStockCost,
                remessas_count:        parseInt(sh.remessas),
                total_extra_cost:      totalExtraCost,
                total_consumido:       parseFloat(tx.total_consumed),
                consumos_count:        parseInt(tx.consumptions_count),
                total_grams_comprados: parseFloat(sh.total_grams)
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Análise estatística de registro de consumo por usuário.
// Objetivo: identificar quem provavelmente consome café mas NÃO registra.
// Como não há como observar consumo não registrado diretamente, usamos
// indicadores: tempo desde o último registro, ritmo histórico vs. recente,
// e se o usuário continua "ativo" (recarregou / tem saldo).
app.get('/api/admin/stats/consumption-analysis', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            WITH cons AS (
                SELECT user_id,
                    COUNT(*)                                                              AS total,
                    MIN(timestamp)                                                        AS first_c,
                    MAX(timestamp)                                                        AS last_c,
                    COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '30 days')       AS last30,
                    COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days')        AS last7
                FROM transactions
                WHERE type = 'consumption'
                GROUP BY user_id
            ),
            rech AS (
                SELECT user_id,
                    MAX(timestamp)                                                        AS last_recharge,
                    COUNT(*)                                                              AS recharges
                FROM transactions
                WHERE type = 'recharge'
                GROUP BY user_id
            )
            SELECT
                u.id, u.name, u.matricula, u.balance,
                COALESCE(c.total, 0)        AS total_consumos,
                c.first_c, c.last_c,
                COALESCE(c.last30, 0)       AS consumos_30d,
                COALESCE(c.last7, 0)        AS consumos_7d,
                r.last_recharge,
                COALESCE(r.recharges, 0)    AS recargas,
                EXTRACT(EPOCH FROM (NOW() - c.last_c)) / 86400.0       AS dias_desde_ultimo,
                EXTRACT(EPOCH FROM (NOW() - r.last_recharge)) / 86400.0 AS dias_desde_recarga,
                EXTRACT(EPOCH FROM (c.last_c - c.first_c)) / 86400.0   AS span_dias
            FROM users u
            LEFT JOIN cons c ON c.user_id = u.id
            LEFT JOIN rech r ON r.user_id = u.id
            WHERE u.matricula <> '0000'
        `);

        const usuarios = result.rows.map(row => {
            const total = parseInt(row.total_consumos);
            const consumos30 = parseInt(row.consumos_30d);
            const diasDesdeUltimo = row.dias_desde_ultimo !== null ? parseFloat(row.dias_desde_ultimo) : null;
            const diasDesdeRecarga = row.dias_desde_recarga !== null ? parseFloat(row.dias_desde_recarga) : null;
            const spanDias = row.span_dias !== null ? parseFloat(row.span_dias) : 0;
            const balance = parseFloat(row.balance);

            // "Ainda ativo": sinais de que a pessoa continua por perto e deveria estar
            // consumindo — tem crédito a usar (saldo > 0) ou recarregou recentemente.
            const aindaAtivo = balance > 0 || (diasDesdeRecarga !== null && diasDesdeRecarga <= 60);

            // Ritmo histórico (consumos por semana) durante o período ativo.
            // Exige pelo menos uma semana de histórico para o ritmo ser confiável
            // (evita valores absurdos quando os poucos registros foram muito próximos).
            let ritmoSemanal = null;
            if (total > 1 && spanDias >= 7) {
                ritmoSemanal = total / (spanDias / 7);
            }
            // Quantos consumos seriam esperados nos últimos 30 dias mantendo o ritmo.
            const esperado30 = ritmoSemanal !== null ? ritmoSemanal * (30 / 7) : null;
            // Proporção do que foi registrado vs. esperado (1 = no ritmo; <1 = registrando menos).
            const proporcao30 = (esperado30 && esperado30 > 0) ? consumos30 / esperado30 : null;

            // Classificação do risco de "não estar registrando".
            let status, risco;
            if (total === 0) {
                status = 'Nunca registrou';
                // Saldo positivo + zero registros => pagou mas nunca lançou consumo.
                risco = balance > 0 ? 'alto' : 'medio';
            } else if (diasDesdeUltimo > 30) {
                status = 'Parou de registrar';
                // Bebedor de verdade (>=3 consumos) que sumiu há +30 dias mas continua
                // ativo (saldo positivo ou recarga recente) => alta suspeita de consumir
                // sem registrar. Caso contrário (provavelmente saiu/parou) => médio.
                risco = (aindaAtivo && total >= 3) ? 'alto' : 'medio';
            } else if (diasDesdeUltimo > 14) {
                status = 'Registro irregular';
                risco = 'medio';
            } else if (esperado30 && esperado30 >= 2 && proporcao30 !== null && proporcao30 < 0.4) {
                status = 'Registro em queda';
                risco = 'medio';
            } else {
                status = 'Ativo';
                risco = 'baixo';
            }

            return {
                id: row.id,
                name: row.name,
                matricula: row.matricula,
                balance,
                total_consumos: total,
                consumos_30d: consumos30,
                consumos_7d: parseInt(row.consumos_7d),
                recargas: parseInt(row.recargas),
                primeiro_consumo: row.first_c,
                ultimo_consumo: row.last_c,
                ultima_recarga: row.last_recharge,
                dias_desde_ultimo: diasDesdeUltimo !== null ? Math.round(diasDesdeUltimo) : null,
                ritmo_semanal: ritmoSemanal !== null ? Math.round(ritmoSemanal * 10) / 10 : null,
                esperado_30d: esperado30 !== null ? Math.round(esperado30) : null,
                proporcao_30d: proporcao30 !== null ? Math.round(proporcao30 * 100) / 100 : null,
                status,
                risco
            };
        });

        // Ordena: maior risco primeiro, depois quem está há mais tempo sem registrar.
        const ordemRisco = { alto: 0, medio: 1, baixo: 2 };
        usuarios.sort((a, b) => {
            if (ordemRisco[a.risco] !== ordemRisco[b.risco]) return ordemRisco[a.risco] - ordemRisco[b.risco];
            return (b.dias_desde_ultimo ?? 99999) - (a.dias_desde_ultimo ?? 99999);
        });

        const resumo = {
            total_usuarios: usuarios.length,
            risco_alto: usuarios.filter(u => u.risco === 'alto').length,
            risco_medio: usuarios.filter(u => u.risco === 'medio').length,
            ativos: usuarios.filter(u => u.risco === 'baixo').length,
            nunca_registraram: usuarios.filter(u => u.total_consumos === 0).length,
            sem_registro_30d: usuarios.filter(u => u.total_consumos > 0 && u.consumos_30d === 0).length
        };

        res.json({ resumo, usuarios });
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
            SELECT u.name, u.matricula,
                   COUNT(t.id) FILTER (
                       WHERE t.type = 'consumption'
                         AND t.timestamp >= NOW() - INTERVAL '30 days'
                   ) AS consumption_count
            FROM users u
            LEFT JOIN transactions t ON t.user_id = u.id
            GROUP BY u.id, u.name, u.matricula
            ORDER BY consumption_count DESC, u.name ASC
        `);

        const creditResult = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0) AS total_positive,
                COALESCE(SUM(CASE WHEN balance < 0 THEN balance ELSE 0 END), 0) AS total_negative,
                COALESCE(SUM(balance), 0) AS total_net,
                COUNT(*) FILTER (WHERE balance > 0) AS users_positive,
                COUNT(*) FILTER (WHERE balance < 0) AS users_negative
            FROM users
        `);
        const credit = creditResult.rows[0];

        res.json({
            avg_daily_business_days: parseFloat(avg.toFixed(2)),
            total_business_days_with_consumption: totalDays,
            total_consumptions_overall: totalConsumptions,
            this_month_consumptions: parseInt(thisMonthResult.rows[0].count),
            top_users_last_30_days: topUsersResult.rows,
            users_total_positive_credit: parseFloat(credit.total_positive),
            users_total_negative_credit: parseFloat(credit.total_negative),
            users_total_net_credit: parseFloat(credit.total_net),
            users_count_positive: parseInt(credit.users_positive),
            users_count_negative: parseInt(credit.users_negative)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =====================
//  INVOICES (NOTAS FISCAIS) - AI EXTRACTION
// =====================

// Analyze an invoice image with AI and return an editable preview (no DB writes).
app.post('/api/admin/invoices/analyze', requireAdmin, uploadDocument.single('nota'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Imagem ou PDF da nota fiscal é obrigatório.' });
        const coffeesResult = await pool.query('SELECT id, name, origin FROM coffees ORDER BY name');
        const data = await analyzeInvoice(req.file.buffer, req.file.mimetype, coffeesResult.rows, req.file.originalname);
        const coffees = Array.isArray(data?.coffees) ? data.coffees : [];
        const extras = Array.isArray(data?.extras) ? data.extras : [];
        res.json({
            success: true,
            summary: data?.summary || '',
            coffees: coffees.map(c => ({
                name: c?.name || '',
                grams: (typeof c?.grams === 'number') ? c.grams : null,
                value: (typeof c?.value === 'number') ? c.value : null,
                matched_coffee_id: (typeof c?.matched_coffee_id === 'number') ? c.matched_coffee_id : null
            })),
            extras: extras.map(e => ({
                description: e?.description || '',
                amount: (typeof e?.amount === 'number') ? e.amount : null
            })),
            existing_coffees: coffeesResult.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Commit the (admin-reviewed) invoice: create stock entries, new coffees and extra costs.
app.post('/api/admin/invoices/commit', requireAdmin, async (req, res) => {
    const { coffees, extras } = req.body;
    const items = Array.isArray(coffees) ? coffees : [];
    const extraItems = Array.isArray(extras) ? extras : [];
    if (items.length === 0 && extraItems.length === 0) {
        return res.status(400).json({ error: 'Nada para lançar.' });
    }
    for (const it of items) {
        const grams = parseFloat(it.grams);
        const value = parseFloat(it.value);
        if (isNaN(grams) || grams <= 0) return res.status(400).json({ error: `Peso inválido para "${it.name || 'café'}".` });
        if (isNaN(value) || value < 0) return res.status(400).json({ error: `Valor inválido para "${it.name || 'café'}".` });
    }
    for (const ex of extraItems) {
        const amt = parseFloat(ex.amount);
        if (!ex.description || !String(ex.description).trim()) return res.status(400).json({ error: 'Descrição obrigatória para custo extra.' });
        if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Valor inválido para custo extra.' });
    }
    try {
        const result = await withTransaction(async (client) => {
            let createdCoffees = 0, stockEntries = 0, extrasAdded = 0;
            for (const it of items) {
                const grams = parseFloat(it.grams);
                const value = parseFloat(it.value);
                let coffeeId = (typeof it.coffee_id === 'number') ? it.coffee_id : null;
                if (coffeeId !== null) {
                    const chk = await client.query('SELECT id FROM coffees WHERE id=$1', [coffeeId]);
                    if (chk.rows.length === 0) coffeeId = null;
                }
                if (coffeeId === null && it.create_new && it.name && String(it.name).trim()) {
                    const ins = await client.query(
                        'INSERT INTO coffees (name, active) VALUES ($1, TRUE) RETURNING id',
                        [String(it.name).trim()]
                    );
                    coffeeId = ins.rows[0].id;
                    createdCoffees++;
                }
                await client.query(
                    'INSERT INTO stock_history (added_grams, added_cost, coffee_id) VALUES ($1, $2, $3)',
                    [grams, value, coffeeId]
                );
                stockEntries++;
            }
            for (const ex of extraItems) {
                await client.query(
                    'INSERT INTO extra_costs (description, amount, remaining) VALUES ($1, $2, $2)',
                    [String(ex.description).trim(), parseFloat(ex.amount)]
                );
                extrasAdded++;
            }
            const calc = await recalculate(client);
            await client.query(
                'UPDATE stock_history SET price_per_dose = $1 WHERE price_per_dose = 0 OR price_per_dose IS NULL',
                [calc.currentPricePerDose]
            );
            return { createdCoffees, stockEntries, extrasAdded, newStock: calc.currentStock };
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =====================
//  COFFEES (PUBLIC LISTING + RATINGS)
// =====================
app.get('/api/coffees', async (req, res) => {
    try {
        // ?all=1 (admin-only) returns inactive too; public listing is active-only.
        let includeAll = false;
        if (req.query.all === '1') {
            const auth = req.headers['authorization'];
            const token = (auth && auth.startsWith('Bearer ')) ? auth.slice(7) : req.query.token;
            try {
                jwt.verify(token, JWT_KEY);
                includeAll = true;
            } catch (e) {
                // Silently ignore; fall back to public listing.
            }
        }
        const result = await pool.query(`
            SELECT c.id, c.name, c.description, c.origin, c.active, c.created_at,
                   (c.image_data IS NOT NULL) AS has_image,
                   COALESCE(AVG(r.rating), 0) AS avg_rating,
                   COUNT(r.id) AS rating_count
            FROM coffees c
            LEFT JOIN coffee_ratings r ON r.coffee_id = c.id
            ${includeAll ? "" : "WHERE c.active = TRUE"}
            GROUP BY c.id
            ORDER BY c.created_at DESC
        `);
        res.json(result.rows.map(r => ({
            ...r,
            avg_rating: parseFloat(r.avg_rating),
            rating_count: parseInt(r.rating_count)
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/coffees/:id/image', async (req, res) => {
    try {
        const result = await pool.query('SELECT image_data, image_type FROM coffees WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0 || !result.rows[0].image_data) {
            return res.status(404).send('No image');
        }
        const row = result.rows[0];
        res.set('Content-Type', row.image_type || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=300');
        res.send(row.image_data);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get('/api/coffees/:id/ratings', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT r.id, r.rating, r.comment, r.created_at, r.updated_at,
                   u.name AS user_name, u.matricula
            FROM coffee_ratings r
            JOIN users u ON u.id = r.user_id
            WHERE r.coffee_id = $1
            ORDER BY r.updated_at DESC
        `, [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/coffees/:id/ratings', async (req, res) => {
    try {
        const { matricula, rating, comment } = req.body;
        const ratingNum = parseInt(rating);
        if (!matricula) return res.status(400).json({ error: 'Matrícula obrigatória.' });
        if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
            return res.status(400).json({ error: 'Nota deve estar entre 1 e 5.' });
        }
        const userRes = await pool.query('SELECT id FROM users WHERE matricula = $1', [matricula]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
        const userId = userRes.rows[0].id;
        const coffeeRes = await pool.query('SELECT id FROM coffees WHERE id = $1 AND active = TRUE', [req.params.id]);
        if (coffeeRes.rows.length === 0) return res.status(404).json({ error: 'Café não encontrado.' });
        const commentText = (comment || '').toString().slice(0, 1000);
        await pool.query(`
            INSERT INTO coffee_ratings (coffee_id, user_id, rating, comment, created_at, updated_at)
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            ON CONFLICT (coffee_id, user_id)
            DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = NOW()
        `, [req.params.id, userId, ratingNum, commentText]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/coffees/:id/ratings/:matricula', async (req, res) => {
    try {
        const userRes = await pool.query('SELECT id FROM users WHERE matricula = $1', [req.params.matricula]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
        await pool.query('DELETE FROM coffee_ratings WHERE coffee_id = $1 AND user_id = $2',
            [req.params.id, userRes.rows[0].id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =====================
//  COFFEES (ADMIN MANAGEMENT)
// =====================
app.post('/api/admin/coffees', requireAdmin, uploadCoffeeImage.single('image'), async (req, res) => {
    try {
        const { name, description, origin, active } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'Nome obrigatório.' });
        const imgBuf = req.file ? req.file.buffer : null;
        const imgType = req.file ? req.file.mimetype : null;
        const isActive = active === undefined ? true : (active === 'true' || active === true);
        const result = await pool.query(`
            INSERT INTO coffees (name, description, origin, image_data, image_type, active)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
        `, [name.trim(), description || '', origin || '', imgBuf, imgType, isActive]);
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/coffees/:id', requireAdmin, uploadCoffeeImage.single('image'), async (req, res) => {
    try {
        const { name, description, origin, active, remove_image } = req.body;
        const exists = await pool.query('SELECT id FROM coffees WHERE id = $1', [req.params.id]);
        if (exists.rows.length === 0) return res.status(404).json({ error: 'Café não encontrado.' });
        const isActive = active === undefined ? null : (active === 'true' || active === true);
        const fields = [];
        const params = [];
        let i = 1;
        if (name !== undefined) { fields.push(`name = $${i++}`); params.push(name.trim()); }
        if (description !== undefined) { fields.push(`description = $${i++}`); params.push(description); }
        if (origin !== undefined) { fields.push(`origin = $${i++}`); params.push(origin); }
        if (isActive !== null) { fields.push(`active = $${i++}`); params.push(isActive); }
        if (req.file) {
            fields.push(`image_data = $${i++}`); params.push(req.file.buffer);
            fields.push(`image_type = $${i++}`); params.push(req.file.mimetype);
        } else if (remove_image === 'true' || remove_image === true) {
            fields.push(`image_data = NULL`);
            fields.push(`image_type = NULL`);
        }
        if (fields.length === 0) return res.json({ success: true });
        params.push(req.params.id);
        await pool.query(`UPDATE coffees SET ${fields.join(', ')} WHERE id = $${i}`, params);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/coffees/:id', requireAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM coffees WHERE id = $1', [req.params.id]);
        res.json({ success: true });
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
