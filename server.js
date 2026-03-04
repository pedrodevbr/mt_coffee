const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { pool, initSchema } = require('./database');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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

app.post('/api/system/stock', async (req, res) => {
    try {
        const { added_grams, added_cost } = req.body;
        if (!added_grams || added_grams <= 0) return res.status(400).json({ error: "Invalid grams" });

        const stateResult = await pool.query('SELECT * FROM system_state ORDER BY id DESC LIMIT 1');
        const state = stateResult.rows[0];

        const currentGrams = state ? state.coffee_stock_grams : 0;
        const currentCost = state ? state.stock_total_cost : 0;

        const newGrams = currentGrams + parseFloat(added_grams);
        const newCost = currentCost + parseFloat(added_cost || 0);

        await pool.query('UPDATE system_state SET coffee_stock_grams = $1, stock_total_cost = $2', [newGrams, newCost]);
        res.json({ success: true, message: "Stock updated successfully", newStock: newGrams });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/system/qr', upload.single('qr_image'), async (req, res) => {
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

app.post('/api/system/pix', async (req, res) => {
    try {
        const { pix_key } = req.body;
        await pool.query('UPDATE system_state SET pix_key = $1', [pix_key || '']);
        res.json({ success: true, message: 'Chave PIX atualizada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM users ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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
            const existing = await pool.query('SELECT * FROM users WHERE matricula = $1', ['0000']);
            if (existing.rows.length > 0) {
                return res.status(400).json({ error: 'Matrícula reservada para administração.' });
            }
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

app.put('/api/users/:id', async (req, res) => {
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

app.delete('/api/users/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/transactions', async (req, res) => {
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
            LIMIT 20
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

        res.json({
            success: true,
            message: 'Coffee consumed!',
            new_balance: user.balance - pricePerDose,
            cost: pricePerDose
        });
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

        res.json({
            success: true,
            message: 'Balance recharged!',
            new_balance: user.balance + amount
        });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
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
