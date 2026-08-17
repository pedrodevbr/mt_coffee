const { GoogleGenAI } = require('@google/genai');

// Aceita a chave do Google Gemini (GEMINI_API_KEY) ou Google AI Studio
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

let aiClient = null;
if (API_KEY) {
    try {
        aiClient = new GoogleGenAI({ apiKey: API_KEY });
    } catch (err) {
        console.error('[ai] Erro ao inicializar cliente Google Gemini:', err.message);
    }
}

if (!aiClient) {
    console.warn('[ai] GEMINI_API_KEY não definida — análise automática de comprovantes e notas fiscais fica desativada.');
}

function requireClient() {
    if (!aiClient) {
        throw new Error('GEMINI_API_KEY não configurada. Configure a variável GEMINI_API_KEY para habilitar a IA.');
    }
    return aiClient;
}

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

function isSupportedImage(mimeType) {
    return typeof mimeType === 'string' && mimeType.startsWith('image/');
}

function isPdf(mimeType) {
    return mimeType === 'application/pdf';
}

// Documents the AI can read: images (vision) or PDF (file input).
function isSupportedDocument(mimeType) {
    return isSupportedImage(mimeType) || isPdf(mimeType);
}

function cleanJsonResponse(text) {
    if (!text) return '{}';
    let cleaned = text.trim();
    if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    return cleaned.trim();
}

// Analyze a PIX/bank payment receipt image and extract the paid amount.
// Returns: { is_payment_proof, amount (number|null), confidence ('high'|'medium'|'low'), summary }
async function analyzeReceipt(buffer, mimeType, filename) {
    const client = requireClient();

    const prompt = 'Você é um analista financeiro que lê comprovantes de pagamento PIX e transferências bancárias brasileiras.\n'
        + 'Analise este comprovante de pagamento e retorne SOMENTE um JSON com exatamente estas chaves:\n'
        + '{\n'
        + '  "is_payment_proof": boolean (true se for realmente um comprovante de pagamento/transferência/PIX realizado com sucesso),\n'
        + '  "amount": number|null (o valor pago em reais, apenas o número puro, ex: 25.50),\n'
        + '  "confidence": "high"|"medium"|"low" (sua confiança na leitura do valor),\n'
        + '  "summary": string (resumo curto em português: tipo de transação, data e destinatário se visíveis)\n'
        + '}\n'
        + 'Se não conseguir ler o valor com clareza, use amount null e confidence "low". Retorne apenas o JSON puro.';

    const response = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
            {
                inlineData: {
                    mimeType: mimeType || 'image/jpeg',
                    data: buffer.toString('base64')
                }
            },
            prompt
        ],
        config: {
            responseMimeType: 'application/json'
        }
    });

    const text = response.text || '';
    return JSON.parse(cleanJsonResponse(text));
}

// Analyze a coffee purchase invoice (nota fiscal) image.
// existingCoffees: [{ id, name, origin }]
// Returns: { coffees: [{name, grams, value, matched_coffee_id}], extras: [{description, amount}], summary }
async function analyzeInvoice(buffer, mimeType, existingCoffees, filename) {
    const client = requireClient();

    const catalog = (existingCoffees || [])
        .map(c => `id=${c.id}: ${c.name}${c.origin ? ' (' + c.origin + ')' : ''}`)
        .join('\n') || '(catálogo vazio)';

    const prompt = 'Você lê notas fiscais e cupons brasileiros de compra de café e extrai os itens de forma estruturada.\n\n'
        + 'Catálogo de cafés já cadastrados no sistema (use para casar itens iguais se aplicável):\n'
        + catalog + '\n\n'
        + 'Analise esta nota fiscal e retorne SOMENTE um JSON com exatamente estas chaves:\n'
        + '{\n'
        + '  "coffees": [\n'
        + '    {\n'
        + '      "name": string (nome do café),\n'
        + '      "grams": number|null (peso TOTAL deste item em GRAMAS, converta kg para gramas multiplicando por 1000),\n'
        + '      "value": number (valor TOTAL pago neste item em reais),\n'
        + '      "matched_coffee_id": number|null (o id do catálogo acima se for claramente o mesmo café, senão null)\n'
        + '    }\n'
        + '  ],\n'
        + '  "extras": [\n'
        + '    {\n'
        + '      "description": string,\n'
        + '      "amount": number\n'
        + '    }\n'
        + '  ] (itens que NÃO são café, como frete, embalagem, taxas e impostos destacados),\n'
        + '  "summary": string (resumo curto em português da nota fiscal)\n'
        + '}\n'
        + 'Inclua em "coffees" apenas itens que são café. Se o peso não estiver visível, use grams null. Retorne apenas o JSON puro.';

    const response = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
            {
                inlineData: {
                    mimeType: mimeType || 'image/jpeg',
                    data: buffer.toString('base64')
                }
            },
            prompt
        ],
        config: {
            responseMimeType: 'application/json'
        }
    });

    const text = response.text || '';
    return JSON.parse(cleanJsonResponse(text));
}

module.exports = { analyzeReceipt, analyzeInvoice, isSupportedImage, isSupportedDocument };
