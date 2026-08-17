/**
 * Módulo de Integração com o Telegram para o MT Coffee
 * Utiliza fetch nativo (Node.js 18+) para chamar a API de Bots do Telegram.
 */

async function getTelegramConfig(pool) {
    let botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    let chatId = process.env.TELEGRAM_CHAT_ID || '';
    let thresholdGrams = 200;

    if (pool) {
        try {
            const res = await pool.query(
                "SELECT key, value FROM settings WHERE key IN ('telegram_bot_token', 'telegram_chat_id', 'low_stock_threshold_grams')"
            );
            for (const row of res.rows) {
                if (row.key === 'telegram_bot_token' && row.value) botToken = row.value;
                if (row.key === 'telegram_chat_id' && row.value) chatId = row.value;
                if (row.key === 'low_stock_threshold_grams' && row.value) {
                    const parsed = parseFloat(row.value);
                    if (!isNaN(parsed) && parsed > 0) thresholdGrams = parsed;
                }
            }
        } catch {
            // Ignora falhas de leitura
        }
    }

    return { botToken, chatId, thresholdGrams };
}

/**
 * Envia uma mensagem via Bot do Telegram
 */
async function sendTelegramMessage({ botToken, chatId, text, parseMode = 'HTML' }) {
    if (!botToken || !chatId) {
        return { success: false, error: 'Telegram não configurado (botToken ou chatId ausente).' };
    }

    try {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: parseMode,
                disable_web_page_preview: true
            })
        });

        const data = await res.json();
        if (!data.ok) {
            console.warn('[telegram] Falha ao enviar mensagem:', data.description);
            return { success: false, error: data.description };
        }
        return { success: true, messageId: data.result?.message_id };
    } catch (err) {
        console.warn('[telegram] Erro de rede:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Verifica se o estoque está baixo e dispara alerta com controle anti-spam
 */
async function checkAndAlertLowStock({ pool, remainingGrams, doseGrams = 10, currentPrice = 0 }) {
    if (!pool) return;

    try {
        const { botToken, chatId, thresholdGrams } = await getTelegramConfig(pool);
        if (!botToken || !chatId) return;

        // Se o estoque estiver acima do limite, resetamos a trava para o próximo ciclo
        if (remainingGrams > thresholdGrams) {
            await pool.query("UPDATE settings SET value = '0' WHERE key = 'last_low_stock_alert_sent'").catch(() => {});
            return;
        }

        // Se o estoque está abaixo do limite, verifica se já alertamos
        const alertSettingRes = await pool.query(
            "SELECT value FROM settings WHERE key = 'last_low_stock_alert_sent'"
        );
        const alreadyAlerted = alertSettingRes.rows.length > 0 && alertSettingRes.rows[0].value === '1';

        if (!alreadyAlerted) {
            const dosesRestantes = Math.floor(remainingGrams / (doseGrams || 10));
            const text = `⚠️ <b>Alerta de Estoque Baixo — MT Coffee</b> ☕\n\n`
                + `O estoque de café atingiu o limite crítico:\n`
                + `📦 <b>Restam apenas:</b> ${remainingGrams.toFixed(0)}g (~${dosesRestantes} doses)\n`
                + `💰 <b>Preço atual por dose:</b> R$ ${currentPrice.toFixed(2).replace('.', ',')}\n\n`
                + `👉 <i>Lembre-se de providenciar a compra de novos grãos para o escritório!</i>`;

            const result = await sendTelegramMessage({ botToken, chatId, text });
            if (result.success) {
                // Marca que já alertamos para não mandar a cada consumo
                await pool.query(
                    `INSERT INTO settings (key, value) VALUES ('last_low_stock_alert_sent', '1')
                     ON CONFLICT (key) DO UPDATE SET value = '1'`
                );
                console.log(`[telegram] Alerta de estoque baixo enviado (${remainingGrams}g restantes).`);
            }
        }
    } catch (err) {
        console.warn('[telegram] Erro ao checar alerta de estoque:', err.message);
    }
}

/**
 * Envia notificação de recarga confirmada
 */
async function notifyRecharge({ pool, userName, matricula, amount, method = 'PIX Dinâmico' }) {
    if (!pool) return;
    try {
        const { botToken, chatId } = await getTelegramConfig(pool);
        if (!botToken || !chatId) return;

        const text = `💵 <b>Recarga Confirmada — MT Coffee</b> ⚡\n\n`
            + `👤 <b>Usuário:</b> ${userName || 'Colaborador'} (Matrícula: <code>${matricula}</code>)\n`
            + `💰 <b>Valor Creditado:</b> R$ ${parseFloat(amount).toFixed(2).replace('.', ',')}\n`
            + `🏷️ <b>Método:</b> ${method}`;

        await sendTelegramMessage({ botToken, chatId, text });
    } catch (err) {
        console.warn('[telegram] Erro ao notificar recarga:', err.message);
    }
}

/**
 * Envia notificação de novo café adicionado
 */
async function notifyNewCoffee({ pool, coffeeName, origin, grams, pricePerDose }) {
    if (!pool) return;
    try {
        const { botToken, chatId } = await getTelegramConfig(pool);
        if (!botToken || !chatId) return;

        const text = `🎉 <b>Novo Café Adicionado ao Estoque!</b> ☕\n\n`
            + `✨ <b>Café:</b> ${coffeeName}${origin ? ` (<i>${origin}</i>)` : ''}\n`
            + `📦 <b>Quantidade:</b> ${grams}g adicionadas\n`
            + `🏷️ <b>Novo Preço da Dose:</b> R$ ${parseFloat(pricePerDose).toFixed(2).replace('.', ',')}\n\n`
            + `Venha experimentar uma dose fresquinha! 😋`;

        await sendTelegramMessage({ botToken, chatId, text });
    } catch (err) {
        console.warn('[telegram] Erro ao notificar novo café:', err.message);
    }
}

module.exports = {
    getTelegramConfig,
    sendTelegramMessage,
    checkAndAlertLowStock,
    notifyRecharge,
    notifyNewCoffee
};
