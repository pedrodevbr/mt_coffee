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
    const [settingResult, stockSum, consResult, adjResult, extraResult, monthlyDosesResult] = await Promise.all([
        db.query("SELECT key, value FROM settings WHERE key IN ('dose_grams', 'extra_dilution_doses', 'mp_fee_percent', 'railway_monthly_cost')"),
        db.query('SELECT COALESCE(SUM(added_grams),0) AS tg, COALESCE(SUM(added_cost),0) AS tc FROM stock_history'),
        db.query("SELECT COUNT(*) AS cnt, COALESCE(SUM(grams_deducted),0) AS g, COALESCE(SUM(cost_deducted),0) AS c FROM transactions WHERE type='consumption'"),
        db.query('SELECT COALESCE(SUM(delta_grams),0) AS dg FROM stock_adjustments'),
        db.query(`SELECT COALESCE(SUM(amount),0) AS total,
                         COALESCE(SUM(remaining),0) AS total_remaining,
                         COALESCE(SUM(LEAST(remaining, amount / NULLIF(dilution_doses,0))),0) AS per_dose_total,
                         COALESCE(SUM(CASE WHEN (description ILIKE '%railway%' OR description ILIKE '%servidor%' OR description ILIKE '%infra%')
                                           THEN LEAST(remaining, amount / NULLIF(dilution_doses,0)) ELSE 0 END), 0) AS infra_per_dose,
                         COALESCE(SUM(CASE WHEN NOT (description ILIKE '%railway%' OR description ILIKE '%servidor%' OR description ILIKE '%infra%')
                                           THEN LEAST(remaining, amount / NULLIF(dilution_doses,0)) ELSE 0 END), 0) AS other_extra_per_dose
                  FROM extra_costs WHERE remaining > 0`),
        db.query(`
            SELECT COALESCE(
                NULLIF((
                    SELECT COUNT(*) FROM transactions 
                    WHERE type = 'consumption' 
                      AND timestamp >= NOW() - INTERVAL '30 days'
                ), 0),
                NULLIF(ROUND((
                    SELECT COUNT(*)::float / GREATEST(1, COUNT(DISTINCT DATE(timestamp AT TIME ZONE 'America/Sao_Paulo'))) * 22
                    FROM transactions WHERE type = 'consumption' AND EXTRACT(DOW FROM timestamp AT TIME ZONE 'America/Sao_Paulo') BETWEEN 1 AND 5
                )), 0),
                200
            ) AS monthly_doses
        `)
    ]);

    const settings = {};
    for (const row of settingResult.rows) settings[row.key] = row.value;

    const doseGrams = parseFloat(settings.dose_grams) || 10;
    const dilutionDoses = parseInt(settings.extra_dilution_doses) || 200;
    const mpFeePercent = parseFloat(settings.mp_fee_percent) || 0;
    const railwayMonthlyCost = parseFloat(settings.railway_monthly_cost) || 28.00;
    const monthlyDoses = parseInt(monthlyDosesResult.rows[0]?.monthly_doses) || 200;

    const totalPurchasedGrams = parseFloat(stockSum.rows[0].tg);
    const totalPurchaseCost = parseFloat(stockSum.rows[0].tc);
    const totalConsumptions = parseInt(consResult.rows[0].cnt);
    const consumedGrams = parseFloat(consResult.rows[0].g);
    const consumedCost = parseFloat(consResult.rows[0].c);
    const adjGrams = parseFloat(adjResult.rows[0].dg);
    const extraTotal = parseFloat(extraResult.rows[0].total);
    const extraRemaining = parseFloat(extraResult.rows[0].total_remaining);
    const extraPerDoseTotal = parseFloat(extraResult.rows[0].per_dose_total);
    const infraPerDose = parseFloat(extraResult.rows[0].infra_per_dose);
    const otherExtraPerDose = parseFloat(extraResult.rows[0].other_extra_per_dose);

    return {
        doseGrams, dilutionDoses, mpFeePercent, railwayMonthlyCost, monthlyDoses,
        totalPurchasedGrams, totalPurchaseCost, totalConsumptions, consumedGrams,
        consumedCost, adjGrams, extraTotal, extraRemaining, extraPerDoseTotal,
        infraPerDose, otherExtraPerDose
    };
}

// =====================
//  Pure Calculation (no DB)
// =====================

function calculateState(data) {
    const {
        doseGrams, dilutionDoses, mpFeePercent, railwayMonthlyCost, monthlyDoses,
        totalPurchasedGrams, totalPurchaseCost, consumedGrams, consumedCost,
        adjGrams, extraTotal, extraRemaining, extraPerDoseTotal,
        infraPerDose, otherExtraPerDose, totalConsumptions
    } = data;

    const currentStock = Math.max(0, totalPurchasedGrams - consumedGrams + adjGrams);
    const consumedFraction = totalPurchasedGrams > 0 ? Math.min(1, consumedGrams / totalPurchasedGrams) : 0;
    const remainingPurchaseCost = Math.max(0, totalPurchaseCost - consumedCost);

    // Custo base dos grãos de café por dose
    let basePricePerDose = 0;
    if (currentStock > 0) {
        basePricePerDose = (remainingPurchaseCost / currentStock) * doseGrams;
    }

    // Custo de infraestrutura por dose (se já houver lançamento ativo em extra_costs ou diluído na média mensal de doses)
    let infraCostPerDose = infraPerDose;
    // Se não houver lançamento ativo em extra_costs mas houver custo configurado de railway, estima com base na média mensal
    if (infraCostPerDose === 0 && railwayMonthlyCost > 0 && monthlyDoses > 0) {
        infraCostPerDose = railwayMonthlyCost / monthlyDoses;
    }

    // Outros custos extras (filtros, embalagens, etc.)
    const otherExtraCostPerDose = otherExtraPerDose;
    const extraCostPerDose = infraCostPerDose + otherExtraCostPerDose;

    // Subtotal antes da taxa de gateway
    const subtotalPerDose = basePricePerDose + extraCostPerDose;

    // Embutir taxa do Mercado Pago / Gateway se configurada
    const feePct = (typeof mpFeePercent === 'number' && mpFeePercent >= 0 && mpFeePercent < 100) ? mpFeePercent : 0;
    const currentPricePerDose = feePct > 0 ? subtotalPerDose / (1 - (feePct / 100)) : subtotalPerDose;
    const feePerDose = Math.max(0, currentPricePerDose - subtotalPerDose);

    const remainingDoses = doseGrams > 0 ? Math.floor(currentStock / doseGrams) : 0;

    return {
        currentStock, remainingPurchaseCost,
        remainingExtraCosts: extraRemaining,
        currentPricePerDose, basePricePerDose, extraCostPerDose,
        infraCostPerDose, otherExtraCostPerDose,
        subtotalPerDose, feePerDose, mpFeePercent: feePct,
        monthlyDoses, railwayMonthlyCost,
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
