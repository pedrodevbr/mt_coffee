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
        db.query("SELECT key, value FROM settings WHERE key IN ('dose_grams', 'extra_dilution_doses')"),
        db.query('SELECT COALESCE(SUM(added_grams),0) AS tg, COALESCE(SUM(added_cost),0) AS tc FROM stock_history'),
        db.query("SELECT COUNT(*) AS cnt, COALESCE(SUM(grams_deducted),0) AS g, COALESCE(SUM(cost_deducted),0) AS c FROM transactions WHERE type='consumption'"),
        db.query('SELECT COALESCE(SUM(delta_grams),0) AS dg FROM stock_adjustments'),
        db.query(`SELECT COALESCE(SUM(amount),0) AS total,
                         COALESCE(SUM(remaining),0) AS total_remaining,
                         COALESCE(SUM(LEAST(remaining, amount / NULLIF(dilution_doses,0))),0) AS per_dose_total
                  FROM extra_costs WHERE remaining > 0`)
    ]);

    const settings = {};
    for (const row of settingResult.rows) settings[row.key] = row.value;

    const doseGrams = parseFloat(settings.dose_grams) || 10;
    const dilutionDoses = parseInt(settings.extra_dilution_doses) || 200;
    const totalPurchasedGrams = parseFloat(stockSum.rows[0].tg);
    const totalPurchaseCost = parseFloat(stockSum.rows[0].tc);
    const totalConsumptions = parseInt(consResult.rows[0].cnt);
    // Use the grams ACTUALLY deducted at the time of each consumption,
    // so changing dose_grams setting later does not retroactively change stock.
    const consumedGrams = parseFloat(consResult.rows[0].g);
    // Purchase cost ACTUALLY removed by past consumptions, recorded at the
    // price-per-gram in effect at each consumption. Summing it keeps the
    // per-dose price invariant to consumption (see calculateState).
    const consumedCost = parseFloat(consResult.rows[0].c);
    const adjGrams = parseFloat(adjResult.rows[0].dg);
    const extraTotal = parseFloat(extraResult.rows[0].total);
    const extraRemaining = parseFloat(extraResult.rows[0].total_remaining);
    const extraPerDoseTotal = parseFloat(extraResult.rows[0].per_dose_total);

    return {
        doseGrams, dilutionDoses, totalPurchasedGrams, totalPurchaseCost,
        totalConsumptions, consumedGrams, consumedCost, adjGrams,
        extraTotal, extraRemaining, extraPerDoseTotal
    };
}

// =====================
//  Pure Calculation (no DB)
// =====================

function calculateState(data) {
    const {
        doseGrams, dilutionDoses, totalPurchasedGrams, totalPurchaseCost,
        consumedGrams, consumedCost, adjGrams, extraTotal, extraRemaining, extraPerDoseTotal,
        totalConsumptions
    } = data;

    const currentStock = Math.max(0, totalPurchasedGrams - consumedGrams + adjGrams);

    // Only consumption reduces purchase cost. Adjustments do NOT (sunk cost).
    const consumedFraction = totalPurchasedGrams > 0 ? Math.min(1, consumedGrams / totalPurchasedGrams) : 0;
    // Remaining purchase cost is the total purchased cost minus the cost ACTUALLY
    // removed by each past consumption (recorded at the then-current price/gram).
    // Because each consumption removes (current price/gram × grams), the ratio
    // remainingPurchaseCost / currentStock stays constant across consumptions —
    // so the per-dose price does NOT drift after a consumption. It only moves on
    // admin events (new stock, adjustments) as intended.
    const remainingPurchaseCost = Math.max(0, totalPurchaseCost - consumedCost);

    // Base price: remaining purchase cost / remaining stock × dose
    let basePricePerDose = 0;
    if (currentStock > 0) {
        basePricePerDose = (remainingPurchaseCost / currentStock) * doseGrams;
    }

    // Extra price: fixed per-dose from each active extra (amount / dilution_doses)
    // extraPerDoseTotal = SUM( MIN(remaining, amount / dilution_doses) ) for active entries
    const extraCostPerDose = extraPerDoseTotal;

    const remainingDoses = doseGrams > 0 ? Math.floor(currentStock / doseGrams) : 0;
    const currentPricePerDose = basePricePerDose + extraCostPerDose;

    return {
        currentStock, remainingPurchaseCost,
        remainingExtraCosts: extraRemaining,
        currentPricePerDose, basePricePerDose, extraCostPerDose,
        remainingDoses, doseGrams, dilutionDoses, consumedFraction,
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
    // Snapshot a price-history entry whenever the per-dose price changes.
    const last = await db.query('SELECT price_per_dose FROM price_history ORDER BY id DESC LIMIT 1');
    const lastVal = last.rows.length ? parseFloat(last.rows[0].price_per_dose) : null;
    const newVal = Math.round(parseFloat(calc.currentPricePerDose) * 10000) / 10000;
    if (lastVal === null || Math.abs((lastVal || 0) - newVal) > 0.00005) {
        await db.query('INSERT INTO price_history (price_per_dose) VALUES ($1)', [newVal]);
    }
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
//  Recalculate with extras reset (for transaction edits)
// =====================

async function recalculateWithExtrasReset(db) {
    // Rebuild remaining for each extra based on how many consumptions
    // occurred since it was created.
    // per_dose_charge = amount / dilution_doses
    // doses_since = COUNT(consumptions after extra.created_at)
    // remaining = MAX(0, amount - per_dose_charge * MIN(doses_since, dilution_doses))
    await db.query(`
        UPDATE extra_costs ec SET remaining = GREATEST(0,
            ec.amount - (ec.amount / NULLIF(ec.dilution_doses, 0)) * LEAST(
                COALESCE((SELECT COUNT(*) FROM transactions t
                          WHERE t.type = 'consumption' AND t.timestamp >= ec.created_at), 0),
                ec.dilution_doses
            )
        )
    `);

    const data = await gatherSourceData(db);
    const calc = calculateState(data);
    await persistState(db, calc);
    return calc;
}

// =====================
//  Deduct extras for one consumption (fixed per-dose charge)
// =====================

async function deductExtrasForConsumption(client) {
    // Each active extra deducts: MIN(remaining, amount / dilution_doses)
    await client.query(`
        UPDATE extra_costs
        SET remaining = GREATEST(0, remaining - amount / NULLIF(dilution_doses, 0))
        WHERE remaining > 0
    `);
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

    // Deduct fixed amount from each active extra_costs entry
    await deductExtrasForConsumption(client);

    // NOTE: system_state is NOT written here. The caller records the consumption
    // transaction (storing baseCostDeducted as cost_deducted) and then calls
    // recalculate(), which derives the new state from source data — including the
    // just-inserted consumption. This keeps the per-dose price invariant to
    // consumption.
    return { priceCharged, baseCostDeducted };
}

module.exports = {
    withTransaction,
    recalculate,
    recalculateWithExtrasReset,
    applyConsumption
};
