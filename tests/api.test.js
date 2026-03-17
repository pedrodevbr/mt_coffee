const request = require('supertest');
const jwt = require('jsonwebtoken');
const { pool } = require('../database');
const { setupTestDb, cleanDb, closeDb } = require('./setup');

let app;

// Admin token signed with the test JWT_SECRET (avoids HTTP round-trip for every test)
function makeAdminToken() {
    return jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

beforeAll(async () => {
    app = require('../server');
    await setupTestDb();
});

beforeEach(async () => {
    await cleanDb();
});

afterAll(async () => {
    await closeDb();
});

// =====================
//  SYSTEM STATE
// =====================
describe('GET /api/system', () => {
    test('returns system state with required fields', async () => {
        const res = await request(app).get('/api/system');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('coffee_stock_grams');
        expect(res.body).toHaveProperty('current_price_per_dose');
        expect(res.body).toHaveProperty('dose_grams');
    });

    test('price reflects stock cost', async () => {
        const token = makeAdminToken();
        await request(app)
            .post('/api/system/stock')
            .set('Authorization', `Bearer ${token}`)
            .send({ added_grams: 1000, added_cost: 100 });

        const res = await request(app).get('/api/system');
        expect(res.body.coffee_stock_grams).toBe(1000);
        // base price: (100/1000) * 10 = 1.00
        expect(res.body.base_price_per_dose).toBeCloseTo(1.0, 2);
    });
});

// =====================
//  AUTH
// =====================
describe('Admin auth', () => {
    test('login with correct PIN returns token', async () => {
        const res = await request(app)
            .post('/api/admin/login')
            .send({ pin: '1234' });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('token');
    });

    test('login with wrong PIN returns 401', async () => {
        const res = await request(app)
            .post('/api/admin/login')
            .send({ pin: 'wrong' });
        expect(res.status).toBe(401);
    });

    test('admin route without token returns 401', async () => {
        const res = await request(app).get('/api/users');
        expect(res.status).toBe(401);
    });

    test('admin route with non-admin token returns 403', async () => {
        const token = jwt.sign({ role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const res = await request(app)
            .get('/api/users')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
    });

    test('admin route with valid token returns 200', async () => {
        const res = await request(app)
            .get('/api/users')
            .set('Authorization', `Bearer ${makeAdminToken()}`);
        expect(res.status).toBe(200);
    });
});

// =====================
//  USERS
// =====================
describe('Users', () => {
    test('POST /api/users creates a user', async () => {
        const res = await request(app)
            .post('/api/users')
            .send({ name: 'Ana Silva', matricula: '1001' });
        expect(res.status).toBe(201);
        expect(res.body.matricula).toBe('1001');
        expect(res.body.name).toBe('Ana Silva');
        expect(res.body.balance).toBe(0);
    });

    test('POST /api/users rejects reserved matricula 0000', async () => {
        const res = await request(app)
            .post('/api/users')
            .send({ name: 'Hack', matricula: '0000' });
        expect(res.status).toBe(400);
    });

    test('POST /api/users rejects duplicate matricula', async () => {
        await request(app).post('/api/users').send({ name: 'A', matricula: '2001' });
        const res = await request(app)
            .post('/api/users')
            .send({ name: 'B', matricula: '2001' });
        expect(res.status).toBe(400);
    });

    test('GET /api/users/:matricula returns user', async () => {
        await request(app).post('/api/users').send({ name: 'Carlos', matricula: '3001' });
        const res = await request(app).get('/api/users/3001');
        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Carlos');
    });

    test('GET /api/users/:matricula returns 404 for unknown', async () => {
        const res = await request(app).get('/api/users/9999');
        expect(res.status).toBe(404);
    });

    test('GET /api/users (admin) returns all users', async () => {
        await request(app).post('/api/users').send({ name: 'D', matricula: '4001' });
        const res = await request(app)
            .get('/api/users')
            .set('Authorization', `Bearer ${makeAdminToken()}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.some(u => u.matricula === '4001')).toBe(true);
    });
});

// =====================
//  STOCK
// =====================
describe('Stock management', () => {
    test('admin can add stock', async () => {
        const res = await request(app)
            .post('/api/system/stock')
            .set('Authorization', `Bearer ${makeAdminToken()}`)
            .send({ added_grams: 500, added_cost: 50 });
        expect(res.status).toBe(200);
        expect(res.body.newStock).toBe(500);
    });

    test('adding stock accumulates correctly', async () => {
        const token = makeAdminToken();
        await request(app)
            .post('/api/system/stock')
            .set('Authorization', `Bearer ${token}`)
            .send({ added_grams: 300, added_cost: 30 });
        await request(app)
            .post('/api/system/stock')
            .set('Authorization', `Bearer ${token}`)
            .send({ added_grams: 200, added_cost: 20 });

        const res = await request(app).get('/api/system');
        expect(res.body.coffee_stock_grams).toBe(500);
    });

    test('adding stock with zero grams returns 400', async () => {
        const res = await request(app)
            .post('/api/system/stock')
            .set('Authorization', `Bearer ${makeAdminToken()}`)
            .send({ added_grams: 0, added_cost: 10 });
        expect(res.status).toBe(400);
    });
});

// =====================
//  CONSUME
// =====================
describe('POST /api/consume', () => {
    beforeEach(async () => {
        await request(app)
            .post('/api/system/stock')
            .set('Authorization', `Bearer ${makeAdminToken()}`)
            .send({ added_grams: 500, added_cost: 50 });
        await request(app)
            .post('/api/users')
            .send({ name: 'Coffee Drinker', matricula: '5001', balance: 100 });
    });

    test('consumes coffee and deducts balance', async () => {
        const res = await request(app)
            .post('/api/consume')
            .send({ matricula: '5001' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.new_balance).toBeLessThan(100);
        expect(res.body.cost).toBeGreaterThan(0);
    });

    test('stock decreases after consumption', async () => {
        await request(app).post('/api/consume').send({ matricula: '5001' });
        const res = await request(app).get('/api/system');
        expect(res.body.coffee_stock_grams).toBe(490); // 500 - 10g dose
    });

    test('returns 404 for unknown matricula', async () => {
        const res = await request(app)
            .post('/api/consume')
            .send({ matricula: '9999' });
        expect(res.status).toBe(404);
    });

    test('returns 400 when stock is insufficient', async () => {
        await pool.query('UPDATE system_state SET coffee_stock_grams = 5'); // less than 10g dose
        const res = await request(app)
            .post('/api/consume')
            .send({ matricula: '5001' });
        expect(res.status).toBe(400);
    });
});

// =====================
//  RECHARGE
// =====================
describe('POST /api/recharge', () => {
    beforeEach(async () => {
        await request(app)
            .post('/api/users')
            .send({ name: 'Recharge User', matricula: '6001' });
    });

    test('increases user balance', async () => {
        const res = await request(app)
            .post('/api/recharge')
            .send({ matricula: '6001', amount: 50 });
        expect(res.status).toBe(200);
        expect(res.body.new_balance).toBe(50);
    });

    test('accumulates balance across recharges', async () => {
        await request(app).post('/api/recharge').send({ matricula: '6001', amount: 30 });
        const res = await request(app)
            .post('/api/recharge')
            .send({ matricula: '6001', amount: 20 });
        expect(res.body.new_balance).toBe(50);
    });

    test('returns 400 for negative amount', async () => {
        const res = await request(app)
            .post('/api/recharge')
            .send({ matricula: '6001', amount: -10 });
        expect(res.status).toBe(400);
    });

    test('returns 400 for zero amount', async () => {
        const res = await request(app)
            .post('/api/recharge')
            .send({ matricula: '6001', amount: 0 });
        expect(res.status).toBe(400);
    });

    test('returns 404 for unknown matricula', async () => {
        const res = await request(app)
            .post('/api/recharge')
            .send({ matricula: '9999', amount: 20 });
        expect(res.status).toBe(404);
    });
});

// =====================
//  TRANSACTIONS
// =====================
describe('Transactions', () => {
    test('consumption creates a transaction record', async () => {
        const token = makeAdminToken();
        await request(app)
            .post('/api/system/stock')
            .set('Authorization', `Bearer ${token}`)
            .send({ added_grams: 500, added_cost: 50 });
        await request(app)
            .post('/api/users')
            .send({ name: 'Tx Test', matricula: '7001', balance: 100 });
        await request(app).post('/api/consume').send({ matricula: '7001' });

        const res = await request(app)
            .get('/api/transactions/7001');
        expect(res.status).toBe(200);
        expect(res.body.length).toBeGreaterThan(0);
        expect(res.body[0].type).toBe('consumption');
    });
});
