const { MercadoPagoConfig, Payment } = require('mercadopago');
const crypto = require('crypto');

function getAccessToken(settingsToken) {
    return settingsToken || process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || '';
}

function getClient(token) {
    const accessToken = getAccessToken(token);
    if (!accessToken) return null;
    return new MercadoPagoConfig({
        accessToken,
        options: { timeout: 7000 }
    });
}

function isConfigured(settingsToken) {
    return Boolean(getAccessToken(settingsToken));
}

/**
 * Cria uma cobrança PIX dinâmica no Mercado Pago
 */
async function createPixPayment({ userId, matricula, name, email, amount, description, settingsToken }) {
    const client = getClient(settingsToken);
    if (!client) {
        throw new Error('Mercado Pago não está configurado. Configure o Access Token no painel de administração.');
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
        throw new Error('Valor inválido para cobrança PIX.');
    }

    const payment = new Payment(client);
    const idempotencyKey = crypto.randomUUID();

    const safeEmail = (email && typeof email === 'string' && email.includes('@') && email.includes('.'))
        ? email.trim()
        : `usuario_${matricula || userId || 'cliente'}@mtcoffee.com.br`;

    const cleanName = name ? name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() : `Usuario ${matricula || ''}`;
    const nameParts = cleanName.split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || 'Cliente';
    const lastName = nameParts.slice(1).join(' ') || 'MT Coffee';

    const body = {
        transaction_amount: Number(numAmount.toFixed(2)),
        description: description || `Recarga MT Coffee - Matrícula ${matricula}`,
        payment_method_id: 'pix',
        payer: {
            email: safeEmail,
            first_name: firstName,
            last_name: lastName
        },
        external_reference: JSON.stringify({
            userId,
            matricula,
            amount: Number(numAmount.toFixed(2)),
            type: 'recharge'
        })
    };

    const response = await payment.create({
        body,
        requestOptions: { idempotencyKey }
    });

    const txData = response.point_of_interaction?.transaction_data || {};

    return {
        payment_id: String(response.id),
        status: response.status,
        amount: response.transaction_amount,
        qr_code: txData.qr_code || '',
        qr_code_base64: txData.qr_code_base64 ? `data:image/png;base64,${txData.qr_code_base64}` : '',
        ticket_url: txData.ticket_url || '',
        expires_at: response.date_of_expiration || null
    };
}

/**
 * Consulta o status atual de uma cobrança PIX no Mercado Pago
 */
async function getPaymentStatus(paymentId, settingsToken) {
    const client = getClient(settingsToken);
    if (!client) {
        throw new Error('Mercado Pago não está configurado.');
    }

    const payment = new Payment(client);
    const response = await payment.get({ id: paymentId });

    let parsedRef = null;
    try {
        if (response.external_reference) {
            parsedRef = JSON.parse(response.external_reference);
        }
    } catch {
        // Formato livre
    }

    return {
        id: String(response.id),
        status: response.status, // 'pending', 'approved', 'rejected', 'cancelled'
        status_detail: response.status_detail,
        amount: response.transaction_amount,
        external_reference: parsedRef,
        date_approved: response.date_approved || null
    };
}

module.exports = {
    createPixPayment,
    getPaymentStatus,
    isConfigured,
    getAccessToken
};
