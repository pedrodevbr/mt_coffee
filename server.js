const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Set up file storage for QR Code uploads
const dataDir = process.env.RENDER_DATA_DIR || path.join(__dirname, 'public');
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(dataDir, 'assets');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, 'qr_code' + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- SETTINGS AND SYSTEM STATE ROUTES ---
app.get('/api/system', (req, res) => {
    db.get('SELECT * FROM system_state ORDER BY id DESC LIMIT 1', (err, state) => {
        if (err) return res.status(500).json({ error: err.message });

        db.get('SELECT value FROM settings WHERE key = ?', ['dose_grams'], (err, setting) => {
            if (err) return res.status(500).json({ error: err.message });

            const doseGrams = setting ? parseFloat(setting.value) : 10;
            const stateObj = state || { coffee_stock_grams: 0, stock_total_cost: 0, qr_code_url: '', pix_key: '' };

            // Calculate dynamic price
            let currentPricePerDose = 0;
            if (stateObj.coffee_stock_grams > 0) {
                const costPerGram = stateObj.stock_total_cost / stateObj.coffee_stock_grams;
                currentPricePerDose = costPerGram * doseGrams;
            }

            res.json({
                ...stateObj,
                dose_grams: doseGrams,
                current_price_per_dose: currentPricePerDose
            });
        });
    });
});

app.post('/api/system/stock', (req, res) => {
    const { added_grams, added_cost } = req.body;
    if (!added_grams || added_grams <= 0) return res.status(400).json({ error: "Invalid grams" });

    db.get('SELECT * FROM system_state ORDER BY id DESC LIMIT 1', (err, state) => {
        if (err) return res.status(500).json({ error: err.message });

        const currentGrams = state ? state.coffee_stock_grams : 0;
        const currentCost = state ? state.stock_total_cost : 0;

        const newGrams = currentGrams + parseFloat(added_grams);
        const newCost = currentCost + parseFloat(added_cost || 0);

        db.run('UPDATE system_state SET coffee_stock_grams = ?, stock_total_cost = ?', [newGrams, newCost], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: "Stock updated successfully", newStock: newGrams });
        });
    });
});

app.post('/api/system/qr', upload.single('qr_image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const qrUrl = '/assets/' + req.file.filename;
    db.run('UPDATE system_state SET qr_code_url = ?', [qrUrl], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, url: qrUrl });
    });
});

app.post('/api/system/pix', (req, res) => {
    const { pix_key } = req.body;
    db.run('UPDATE system_state SET pix_key = ?', [pix_key || ''], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: 'Chave PIX atualizada' });
    });
});

app.use('/assets', express.static(path.join(dataDir, 'assets')));

// --- USERS ROUTES ---
app.get('/api/users', (req, res) => {
    db.all('SELECT * FROM users ORDER BY name', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/users/:matricula', (req, res) => {
    db.get('SELECT * FROM users WHERE matricula = ?', [req.params.matricula], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'User not found' });
        res.json(row);
    });
});

app.post('/api/users', (req, res) => {
    const { name, matricula, balance } = req.body;
    if (matricula === '0000') {
        db.get('SELECT * FROM users WHERE matricula = ?', ['0000'], (err, row) => {
            if (row) {
                return res.status(400).json({ error: 'Matrícula reservada para administração.' });
            } else {
                db.run('INSERT INTO users (name, matricula, balance) VALUES (?, ?, ?)',
                    [name, matricula, balance || 0], function (err) {
                        if (err) return res.status(400).json({ error: err.message });
                        return res.status(201).json({ id: this.lastID, name, matricula, balance: balance || 0 });
                    });
            }
        });
        return;
    }

    db.run('INSERT INTO users (name, matricula, balance) VALUES (?, ?, ?)',
        [name, matricula, balance || 0], function (err) {
            if (err) return res.status(400).json({ error: err.message });
            res.status(201).json({ id: this.lastID, name, matricula, balance: balance || 0 });
        });
});

app.put('/api/users/:id', (req, res) => {
    const { name, matricula, balance } = req.body;
    db.run('UPDATE users SET name = ?, matricula = ?, balance = ? WHERE id = ?',
        [name, matricula, balance, req.params.id], function (err) {
            if (err) return res.status(400).json({ error: err.message });
            res.json({ success: true });
        });
});

app.delete('/api/users/:id', (req, res) => {
    db.run('DELETE FROM users WHERE id = ?', [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- TRANSACTIONS ROUTES ---
app.get('/api/transactions', (req, res) => {
    db.all(`
        SELECT t.*, u.name, u.matricula 
        FROM transactions t 
        JOIN users u ON t.user_id = u.id 
        ORDER BY t.timestamp DESC
        LIMIT 100
    `, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/transactions/:matricula', (req, res) => {
    db.all(`
        SELECT t.* 
        FROM transactions t 
        JOIN users u ON t.user_id = u.id 
        WHERE u.matricula = ?
        ORDER BY t.timestamp DESC
        LIMIT 20
    `, [req.params.matricula], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/consume', (req, res) => {
    const { matricula } = req.body;
    db.get('SELECT * FROM users WHERE matricula = ?', [matricula], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });

        db.get('SELECT * FROM system_state ORDER BY id DESC LIMIT 1', (err, state) => {
            if (err) return res.status(500).json({ error: err.message });

            db.get('SELECT value FROM settings WHERE key = ?', ['dose_grams'], (err, setting) => {
                if (err) return res.status(500).json({ error: err.message });

                const doseGrams = setting ? parseFloat(setting.value) : 10;

                if (!state || state.coffee_stock_grams < doseGrams) {
                    return res.status(400).json({ error: 'Not enough coffee stock!' });
                }

                const costPerGram = state.stock_total_cost / state.coffee_stock_grams;
                const pricePerDose = costPerGram * doseGrams;

                db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [pricePerDose, user.id], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    db.run('INSERT INTO transactions (user_id, amount, type) VALUES (?, ?, ?)', [user.id, -pricePerDose, 'consumption']);
                    const newStock = state.coffee_stock_grams - doseGrams;
                    const newCost = state.stock_total_cost - pricePerDose;
                    db.run('UPDATE system_state SET coffee_stock_grams = ?, stock_total_cost = ?', [newStock, newCost], (err) => {
                        if (err) return res.status(500).json({ error: err.message });
                        res.json({
                            success: true,
                            message: 'Coffee consumed!',
                            new_balance: user.balance - pricePerDose,
                            cost: pricePerDose
                        });
                    });
                });
            });
        });
    });
});

app.post('/api/recharge', (req, res) => {
    const { matricula, amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    db.get('SELECT * FROM users WHERE matricula = ?', [matricula], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });

        db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, user.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            db.run('INSERT INTO transactions (user_id, amount, type) VALUES (?, ?, ?)', [user.id, amount, 'recharge']);
            res.json({
                success: true,
                message: 'Balance recharged!',
                new_balance: user.balance + amount
            });
        });
    });
});

app.use((req, res) => {
    if (req.accepts('html')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.status(404).send('Not found');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
