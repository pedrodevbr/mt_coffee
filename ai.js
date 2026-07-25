const OpenAI = require('openai');

// Aceita a chave da OpenAI direto (OPENAI_API_KEY) ou, se ainda houver,
// as variáveis da integração do Replit. baseURL só é passada se existir,
// senão o SDK usa o endpoint padrão da OpenAI.
const API_KEY = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const BASE_URL = process.env.OPENAI_BASE_URL || process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

const openai = API_KEY
    ? new OpenAI({ apiKey: API_KEY, ...(BASE_URL ? { baseURL: BASE_URL } : {}) })
    : null;

if (!openai) {
    console.warn('[ai] OPENAI_API_KEY não definida — análise automática de comprovantes e notas fiscais fica desativada.');
}

function requireClient() {
    if (!openai) throw new Error('OPENAI_API_KEY não configurada.');
    return openai;
}

const VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5.4';

function bufferToDataUrl(buffer, mimeType) {
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

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

// Build the right content part for the model: images go through image_url,
// PDFs go through the file content type (file_data data URL).
function buildDocumentContent(buffer, mimeType, filename) {
    const dataUrl = bufferToDataUrl(buffer, mimeType);
    if (isPdf(mimeType)) {
        return { type: 'file', file: { filename: filename || 'documento.pdf', file_data: dataUrl } };
    }
    return { type: 'image_url', image_url: { url: dataUrl } };
}

// Analyze a PIX/bank payment receipt image and extract the paid amount.
// Returns: { is_payment_proof, amount (number|null), confidence ('high'|'medium'|'low'), summary }
async function analyzeReceipt(buffer, mimeType, filename) {
    const docContent = buildDocumentContent(buffer, mimeType, filename);
    const completion = await requireClient().chat.completions.create({
        model: VISION_MODEL,
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: 'Você é um analista financeiro que lê comprovantes de pagamento PIX e transferências bancárias brasileiras. Responda SOMENTE com JSON válido.'
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: 'Analise este comprovante de pagamento. Retorne um JSON com exatamente estas chaves: '
                            + '{"is_payment_proof": boolean (true se for realmente um comprovante de pagamento/transferência/PIX), '
                            + '"amount": number|null (o valor pago em reais, apenas o número, ex: 25.5), '
                            + '"confidence": "high"|"medium"|"low" (sua confiança na leitura do valor), '
                            + '"summary": string (resumo curto em português: tipo de transação, data e destinatário se visíveis)}. '
                            + 'Se não conseguir ler o valor com clareza, use amount null e confidence "low".'
                    },
                    docContent
                ]
            }
        ]
    });
    return JSON.parse(completion.choices[0].message.content);
}

// Analyze a coffee purchase invoice (nota fiscal) image.
// existingCoffees: [{ id, name, origin }]
// Returns: { coffees: [{name, grams, value, matched_coffee_id}], extras: [{description, amount}], summary }
async function analyzeInvoice(buffer, mimeType, existingCoffees, filename) {
    const docContent = buildDocumentContent(buffer, mimeType, filename);
    const catalog = (existingCoffees || [])
        .map(c => `id=${c.id}: ${c.name}${c.origin ? ' (' + c.origin + ')' : ''}`)
        .join('\n') || '(catálogo vazio)';

    const completion = await requireClient().chat.completions.create({
        model: VISION_MODEL,
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: 'Você lê notas fiscais brasileiras de compra de café e extrai os itens de forma estruturada. Responda SOMENTE com JSON válido.'
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: 'Catálogo de cafés já cadastrado (use para casar itens iguais):\n' + catalog + '\n\n'
                            + 'Analise esta nota fiscal e retorne um JSON com exatamente estas chaves: '
                            + '{"coffees": [{"name": string (nome do café), "grams": number|null (peso TOTAL deste item em GRAMAS, converta kg para gramas multiplicando por 1000), "value": number (valor TOTAL pago neste item em reais), "matched_coffee_id": number|null (o id do catálogo acima se for claramente o mesmo café, senão null)}], '
                            + '"extras": [{"description": string, "amount": number}] (itens que NÃO são café, como frete, embalagem, taxas e impostos destacados), '
                            + '"summary": string (resumo curto em português da nota)}. '
                            + 'Inclua em "coffees" apenas itens que são café. Se o peso não estiver visível, use grams null.'
                    },
                    docContent
                ]
            }
        ]
    });
    return JSON.parse(completion.choices[0].message.content);
}

module.exports = { analyzeReceipt, analyzeInvoice, isSupportedImage, isSupportedDocument };
