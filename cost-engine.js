const { pool } = require('./database');

// =====================
//  Transaction Helper
// =====================

async function withTransaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// =====================
//  Data Gathering (single batch of queries)
// =====================

async function gatherSourceData(db) {
    const [settingResult, stockSum, consResult, adjResult, extraResult] = await Promise.all([
        db.query("SELECT value FROM settings WHERE key = 'dose_grams'"),
        db.query('SELECT COALESCE(SUM(added_grams),0) AS tg, COALESCE(SUM(added_cost),0) AS tc FROM stock_history'),
        db.query("SELECT COUNT(*) AS cnt FROM transactions WHERE type='consumption'"),
        db.query('SELECT COALESCE(SUM(delta_grams),0) AS dg FROM stock_adjustments'),
        db.query('SELECT COALESCE(SUM(amount),0) AS total FROM extra_costs')
    ]);

    const doseGrams = settingResult.rows.length ? parseFloat(settingResult.rows[0].value) : 10;
    const totalPurchasedGrams = parseFloat(stockSum.rows[0].tg);
    const totalPurchaseCost = parseFloat(stockSum.rows[0].tc);
    const totalConsumptions = parseInt(consResult.rows[0].cnt);
    const consumedGrams = totalConsumptions * doseGrams;
    const adjGrams = parseFloat(adjResult.rows[0].dg);
    const extraTotal = parseFloat(extraResult.rows[0].total);

    return {
        doseGrams, totalPurchasedGrams, totalPurchaseCost,
        totalConsumptions, consumedGrams, adjGrams, extraTotal
    };
}

// =====================
//  Pure Calculation (no DB)
// =====================

function calculateState(data) {
    const { doseGrams, totalPurchasedGrams, totalPurchaseCost, consumedGrams, adjGrams, extraTotal, totalConsumptions } = data;

    const currentStock = Math.max(0, totalPurchasedGrams - consumedGrams + adjGrams);

    // Only consumption reduces cost. Adjustments do NOT change cost (sunk cost):
    // loss → fewer grams, same cost → higher price/dose
    // gain → more grams, same cost → lower price/dose
    const consumedFraction = totalPurchasedGrams > 0 ? Math.min(1, consumedGrams / totalPurchasedGrams) : 0;
    const remainingPurchaseCost = totalPurchaseCost * (1 - consumedFraction);
    const remainingExtraCosts = extraTotal * (1 - consumedFraction);

    // Base price: remaining purchase cost / remaining stock × dose
    let basePricePerDose = 0;
    if (currentStock > 0) {
        basePricePerDose = (remainingPurchaseCost / currentStock) * doseGrams;
    }

    // Extra price: remaining extras / remaining doses
    const remainingDoses = doseGrams > 0 ? Math.floor(currentStock / doseGrams) : 0;
    let extraCostPerDose = 0;
    if (remainingDoses > 0) {
        extraCostPerDose = remainingExtraCosts / remainingDoses;
    }

    const currentPricePerDose = basePricePerDose + extraCostPerDose;

    return {
        currentStock, remainingPurchaseCost, remainingExtraCosts,
        currentPricePerDose, basePricePerDose, extraCostPerDose,
        remainingDoses, doseGrams,
        extraTotal, totalPurchasedGrams, totalPurchaseCost, totalConsumptions
    };
}

// =====================
//  Persist State
// =====================

async function persistState(db, calc) {
    await db.query(
        `UPDATE system_state
         SET coffee_stock_grams = $1, stock_total_cost = $2,
             remaining_extra_costs = $3, current_price_per_dose = $4`,
        [calc.currentStock, calc.remainingPurchaseCost, calc.remainingExtraCosts, calc.currentPricePerDose]
    );
}

// =====================
//  Full Recalculate (gather → calculate → persist)
// =====================

async function recalculate(db) {
    const data = await gatherSourceData(db);
    const calc = calculateState(data);
    await persistState(db, calc);
    return calc;
}

// =====================
//  Consumption Deduction (pure)
// =====================

function computeConsumptionDeduction(state, doseGrams) {
    const stockGrams = parseFloat(state.coffee_stock_grams) || 0;
    const stockCost = parseFloat(state.stock_total_cost) || 0;
    const remainingExtras = parseFloat(state.remaining_extra_costs) || 0;
    const priceCharged = parseFloat(state.current_price_per_dose) || 0;

    const baseCostPerGram = stockGrams > 0 ? stockCost / stockGrams : 0;
    const baseCostDeducted = baseCostPerGram * doseGrams;

    const remainingDoses = Math.floor(stockGrams / doseGrams);
    const extraCostDeducted = remainingDoses > 0 ? remainingExtras / remainingDoses : 0;

    return {
        priceCharged,
        baseCostDeducted,
        extraCostDeducted,
        newStock: stockGrams - doseGrams,
        newCost: Math.max(0, stockCost - baseCostDeducted),
        newExtras: Math.max(0, remainingExtras - extraCostDeducted)
    };
}

// =====================
//  Apply Consumption (deduct + recalculate)
// =====================

async function applyConsumption(client, state, doseGrams) {
    const deduction = computeConsumptionDeduction(state, doseGrams);

    await client.query(
        `UPDATE system_state
         SET coffee_stock_grams = $1, stock_total_cost = $2, remaining_extra_costs = $3`,
        [deduction.newStock, deduction.newCost, deduction.newExtras]
    );

    // Recalculate price for next consumer
    await recalculate(client);

    return deduction;
}

module.exports = {
    withTransaction,
    gatherSourceData,
    calculateState,
    persistState,
    recalculate,
    computeConsumptionDeduction,
    applyConsumption
};
