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
        db.query('SELECT COALESCE(SUM(amount),0) AS total, COALESCE(SUM(remaining),0) AS total_remaining FROM extra_costs')
    ]);

    const doseGrams = settingResult.rows.length ? parseFloat(settingResult.rows[0].value) : 10;
    const totalPurchasedGrams = parseFloat(stockSum.rows[0].tg);
    const totalPurchaseCost = parseFloat(stockSum.rows[0].tc);
    const totalConsumptions = parseInt(consResult.rows[0].cnt);
    const consumedGrams = totalConsumptions * doseGrams;
    const adjGrams = parseFloat(adjResult.rows[0].dg);
    const extraTotal = parseFloat(extraResult.rows[0].total);
    const extraRemaining = parseFloat(extraResult.rows[0].total_remaining);

    return {
        doseGrams, totalPurchasedGrams, totalPurchaseCost,
        totalConsumptions, consumedGrams, adjGrams, extraTotal, extraRemaining
    };
}

// =====================
//  Pure Calculation (no DB)
// =====================

function calculateState(data) {
    const { doseGrams, totalPurchasedGrams, totalPurchaseCost, consumedGrams, adjGrams, extraTotal, extraRemaining, totalConsumptions } = data;

    const currentStock = Math.max(0, totalPurchasedGrams - consumedGrams + adjGrams);

    // Only consumption reduces purchase cost. Adjustments do NOT (sunk cost):
    // loss → fewer grams, same cost → higher price/dose
    // gain → more grams, same cost → lower price/dose
    const consumedFraction = totalPurchasedGrams > 0 ? Math.min(1, consumedGrams / totalPurchasedGrams) : 0;
    const remainingPurchaseCost = totalPurchaseCost * (1 - consumedFraction);

    // Extra costs: read directly from per-entry remaining (NOT derived from formula)
    const remainingExtraCosts = extraRemaining;

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
        remainingDoses, doseGrams, consumedFraction,
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
//  Recalculate with extras reset (for transaction edits that change consumption count)
// =====================

async function recalculateWithExtrasReset(db) {
    // When consumption count changes (transaction edit/delete), we must
    // redistribute the consumed fraction across all extra_costs entries.
    const data = await gatherSourceData(db);
    const consumedFraction = data.totalPurchasedGrams > 0
        ? Math.min(1, data.consumedGrams / data.totalPurchasedGrams) : 0;

    await db.query(
        'UPDATE extra_costs SET remaining = amount * (1 - $1)',
        [consumedFraction]
    );

    // Re-gather now that remaining values are updated
    const freshData = await gatherSourceData(db);
    const calc = calculateState(freshData);
    await persistState(db, calc);
    return calc;
}

// =====================
//  Deduct extras from individual entries (for consumption)
// =====================

async function deductExtrasForConsumption(client, totalDeduction) {
    if (totalDeduction <= 0) return;

    const result = await client.query('SELECT id, remaining FROM extra_costs WHERE remaining > 0');
    const entries = result.rows;
    if (entries.length === 0) return;

    const totalRemaining = entries.reduce((sum, e) => sum + parseFloat(e.remaining), 0);
    if (totalRemaining <= 0) return;

    for (const entry of entries) {
        const share = parseFloat(entry.remaining) / totalRemaining;
        const deduction = Math.min(parseFloat(entry.remaining), totalDeduction * share);
        await client.query(
            'UPDATE extra_costs SET remaining = GREATEST(0, remaining - $1) WHERE id = $2',
            [deduction, entry.id]
        );
    }
}

// =====================
//  Apply Consumption (deduct base + extras + recalculate)
// =====================

async function applyConsumption(client, state, doseGrams) {
    const stockGrams = parseFloat(state.coffee_stock_grams) || 0;
    const stockCost = parseFloat(state.stock_total_cost) || 0;
    const priceCharged = parseFloat(state.current_price_per_dose) || 0;

    // Base cost deduction
    const baseCostPerGram = stockGrams > 0 ? stockCost / stockGrams : 0;
    const baseCostDeducted = baseCostPerGram * doseGrams;

    // Extra cost deduction (from per-entry remaining)
    const extrasResult = await client.query('SELECT COALESCE(SUM(remaining),0) AS total FROM extra_costs');
    const remainingExtras = parseFloat(extrasResult.rows[0].total);
    const remainingDoses = Math.floor(stockGrams / doseGrams);
    const extraCostDeducted = remainingDoses > 0 ? remainingExtras / remainingDoses : 0;

    // Deduct from individual extra_costs entries
    await deductExtrasForConsumption(client, extraCostDeducted);

    // Update system_state (base cost only — extras are in their own table)
    const newStock = stockGrams - doseGrams;
    const newCost = Math.max(0, stockCost - baseCostDeducted);
    await client.query(
        'UPDATE system_state SET coffee_stock_grams = $1, stock_total_cost = $2',
        [newStock, newCost]
    );

    // Recalculate price for next consumer (reads fresh SUM(remaining) from extra_costs)
    await recalculate(client);

    return { priceCharged, baseCostDeducted, extraCostDeducted };
}

module.exports = {
    withTransaction,
    recalculate,
    recalculateWithExtrasReset,
    applyConsumption
};
