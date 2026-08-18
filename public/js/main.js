document.addEventListener('DOMContentLoaded', () => {
    // API URL
    const API_URL = '/api';

    // State
    let currentUser = null;
    let systemState = null;

    // Elements
    const authSection = document.getElementById('auth-section');
    const userDashboard = document.getElementById('user-dashboard');
    const matriculaInput = document.getElementById('matricula-input');
    const btnLogin = document.getElementById('btn-login');
    const authError = document.getElementById('auth-error');

    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const linkShowRegister = document.getElementById('link-show-register');
    const linkShowLogin = document.getElementById('link-show-login');
    const regNameInput = document.getElementById('reg-name-input');
    const regMatriculaInput = document.getElementById('reg-matricula-input');
    const btnRegister = document.getElementById('btn-register');
    const authSuccess = document.getElementById('auth-success');

    const userNameEl = document.getElementById('user-name');
    const userBalanceEl = document.getElementById('user-balance');
    const btnConsume = document.getElementById('btn-consume');
    const btnShowRecharge = document.getElementById('btn-show-recharge');
    const btnShowHistory = document.getElementById('btn-show-history');
    const btnDownloadReport = document.getElementById('btn-download-report');
    const historyContainer = document.getElementById('history-container');
    const historyList = document.getElementById('history-list');
    const btnLogout = document.getElementById('btn-logout');
    const actionMessage = document.getElementById('action-message');

    const stockLevel = document.getElementById('stock-level');
    const dosePrice = document.getElementById('dose-price');
    const stockProgress = document.getElementById('stock-progress');

    const rechargeModal = document.getElementById('recharge-modal');
    const closeModalBtn = document.getElementById('close-modal');
    const pixQr = document.getElementById('pix-qr');
    const pixKeyDisplay = document.getElementById('pix-key-display');
    const pixKeyValue = document.getElementById('pix-key-value');
    const btnDownloadQr = document.getElementById('btn-download-qr');
    const downloadQrContainer = document.getElementById('download-qr-container');
    const receiptFile = document.getElementById('receipt-file');
    const receiptUploadMsg = document.getElementById('receipt-upload-msg');
    const userReceiptsWrap = document.getElementById('user-receipts-wrap');
    const userReceiptsList = document.getElementById('user-receipts-list');
    const btnConfirmRecharge = document.getElementById('btn-confirm-recharge');

    // Dynamic PIX Elements
    const tabBtnPixAuto = document.getElementById('tab-btn-pix-auto');
    const tabBtnPixManual = document.getElementById('tab-btn-pix-manual');
    const rechargePanelAuto = document.getElementById('recharge-panel-auto');
    const rechargePanelManual = document.getElementById('recharge-panel-manual');
    const pixAmountStep = document.getElementById('pix-amount-step');
    const pixDisplayStep = document.getElementById('pix-display-step');
    const pixCustomAmount = document.getElementById('pix-custom-amount');
    const btnGeneratePix = document.getElementById('btn-generate-pix');
    const pixErrorMsg = document.getElementById('pix-error-msg');
    const pixDynamicQr = document.getElementById('pix-dynamic-qr');
    const pixDisplayAmount = document.getElementById('pix-display-amount');
    const pixCopyPasteInput = document.getElementById('pix-copy-paste-input');
    const btnCopyPix = document.getElementById('btn-copy-pix');
    const btnCancelPix = document.getElementById('btn-cancel-pix');
    let pixPollTimer = null;

    // Init
    fetchSystemState();

    // Event Listeners
    btnLogin.addEventListener('click', handleLogin);
    matriculaInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    linkShowRegister.addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
        authError.textContent = '';
        authSuccess.textContent = '';
    });

    linkShowLogin.addEventListener('click', (e) => {
        e.preventDefault();
        registerForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
        authError.textContent = '';
        authSuccess.textContent = '';
    });

    btnRegister.addEventListener('click', handleRegister);
    btnLogout.addEventListener('click', handleLogout);
    btnConsume.addEventListener('click', handleConsume);

    // Tab Switching in Recharge Modal
    if (tabBtnPixAuto && tabBtnPixManual) {
        tabBtnPixAuto.addEventListener('click', () => {
            tabBtnPixAuto.style.background = 'var(--accent)';
            tabBtnPixAuto.style.color = '#fff';
            tabBtnPixAuto.style.fontWeight = '600';
            tabBtnPixManual.style.background = 'rgba(255,255,255,0.06)';
            tabBtnPixManual.style.color = 'var(--text-muted)';
            tabBtnPixManual.style.fontWeight = 'normal';
            rechargePanelAuto.style.display = 'block';
            rechargePanelManual.style.display = 'none';
        });

        tabBtnPixManual.addEventListener('click', () => {
            stopPixPolling();
            tabBtnPixManual.style.background = 'var(--accent)';
            tabBtnPixManual.style.color = '#fff';
            tabBtnPixManual.style.fontWeight = '600';
            tabBtnPixAuto.style.background = 'rgba(255,255,255,0.06)';
            tabBtnPixAuto.style.color = 'var(--text-muted)';
            tabBtnPixAuto.style.fontWeight = 'normal';
            rechargePanelManual.style.display = 'block';
            rechargePanelAuto.style.display = 'none';
        });
    }

    // Quick amount buttons
    document.querySelectorAll('.btn-quick-amt').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-quick-amt').forEach(b => {
                b.style.background = 'rgba(255,255,255,0.08)';
                b.style.border = '1px solid rgba(255,255,255,0.15)';
                b.style.color = 'var(--text-primary)';
                b.style.fontWeight = 'normal';
            });
            btn.style.background = 'var(--accent)';
            btn.style.border = '1px solid var(--accent)';
            btn.style.color = '#fff';
            btn.style.fontWeight = '600';
            if (pixCustomAmount) {
                pixCustomAmount.value = parseFloat(btn.dataset.amount).toFixed(2);
            }
        });
    });

    if (btnGeneratePix) {
        btnGeneratePix.addEventListener('click', handleGenerateDynamicPix);
    }

    if (btnCancelPix) {
        btnCancelPix.addEventListener('click', () => {
            stopPixPolling();
            pixDisplayStep.style.display = 'none';
            pixAmountStep.style.display = 'block';
        });
    }

    if (btnCopyPix) {
        btnCopyPix.addEventListener('click', () => {
            if (pixCopyPasteInput && pixCopyPasteInput.value) {
                navigator.clipboard.writeText(pixCopyPasteInput.value).then(() => {
                    const original = btnCopyPix.textContent;
                    btnCopyPix.textContent = '✓ Copiado!';
                    btnCopyPix.style.background = '#10b981';
                    setTimeout(() => {
                        btnCopyPix.textContent = original;
                        btnCopyPix.style.background = 'var(--accent)';
                    }, 2000);
                });
            }
        });
    }

    btnShowRecharge.addEventListener('click', () => {
        receiptFile.value = '';
        receiptUploadMsg.textContent = '';
        if (pixErrorMsg) pixErrorMsg.style.display = 'none';
        if (pixDisplayStep) pixDisplayStep.style.display = 'none';
        if (pixAmountStep) pixAmountStep.style.display = 'block';
        rechargeModal.classList.remove('hidden');
        if (currentUser) loadUserReceipts();
    });

    closeModalBtn.addEventListener('click', () => {
        stopPixPolling();
        rechargeModal.classList.add('hidden');
    });

    btnConfirmRecharge.addEventListener('click', handleRecharge);
    btnShowHistory.addEventListener('click', handleToggleHistory);
    if (btnDownloadReport) btnDownloadReport.addEventListener('click', handleDownloadReport);

    // Functions
    async function fetchSystemState() {
        try {
            const res = await fetch(`${API_URL}/system`);
            if (res.ok) {
                systemState = await res.json();
                updateSystemUI();
            }
        } catch (error) {
            console.error('Error fetching system state:', error);
        }
    }

    function fmtR(v) { return parseFloat(v || 0).toFixed(2).replace('.', ','); }
    function fmtR4(v) { return parseFloat(v || 0).toFixed(4).replace('.', ','); }

    // Toggle dose price details
    const dosePriceToggle = document.getElementById('dose-price-toggle');
    const dosePriceDetails = document.getElementById('dose-price-details');
    if (dosePriceToggle && dosePriceDetails) {
        dosePriceToggle.addEventListener('click', () => {
            dosePriceDetails.style.display = dosePriceDetails.style.display === 'none' ? 'block' : 'none';
        });
    }

    function updateSystemUI() {
        if (!systemState) return;

        stockLevel.textContent = `${systemState.coffee_stock_grams.toFixed(0)} g`;
        dosePrice.textContent = `R$ ${systemState.current_price_per_dose.toFixed(2).replace('.', ',')}`;

        // Update price details breakdown
        if (dosePriceDetails) {
            const basePpd = parseFloat(systemState.base_price_per_dose || 0);
            const infraPpd = parseFloat(systemState.infra_cost_per_dose || 0);
            const otherExtraPpd = parseFloat(systemState.other_extra_cost_per_dose || 0);
            const feePpd = parseFloat(systemState.fee_per_dose || 0);
            const monthlyDoses = parseInt(systemState.monthly_estimated_doses || 200);
            const remainingCost = parseFloat(systemState.remaining_cost || 0);
            const stockGrams = parseFloat(systemState.coffee_stock_grams || 0);
            const doseGrams = parseFloat(systemState.dose_grams || 10);
            const currentPrice = parseFloat(systemState.current_price_per_dose || 0);

            let html = `<div style="font-weight:600; margin-bottom:6px; color:#fbbf24;">Composição Transparente do Preço da Dose (${doseGrams.toFixed(0)}g):</div>`;
            html += `<div style="display:flex; justify-content:space-between; margin-bottom:2px;"><span style="opacity:0.8;">☕ Grãos de Café (R$ ${fmtR(remainingCost)} / ${stockGrams.toFixed(0)}g)</span><span>R$ ${fmtR(basePpd)}</span></div>`;
            if (infraPpd > 0) {
                html += `<div style="display:flex; justify-content:space-between; margin-bottom:2px;"><span style="opacity:0.8;">🖥️ Servidor Railway (~${monthlyDoses} doses/mês)</span><span style="color:#60a5fa;">+ R$ ${fmtR(infraPpd)}</span></div>`;
            }
            if (otherExtraPpd > 0) {
                html += `<div style="display:flex; justify-content:space-between; margin-bottom:2px;"><span style="opacity:0.8;">📦 Insumos & Extras</span><span style="color:#f59e0b;">+ R$ ${fmtR(otherExtraPpd)}</span></div>`;
            }
            if (feePpd > 0) {
                html += `<div style="display:flex; justify-content:space-between; margin-bottom:2px;"><span style="opacity:0.8;">💳 Taxa Mercado Pago (${systemState.mp_fee_percent || 0.99}%)</span><span style="color:#10b981;">+ R$ ${fmtR(feePpd)}</span></div>`;
            }
            html += `<div style="display:flex; justify-content:space-between; font-weight:700; margin-top:6px; padding-top:6px; border-top:1px solid rgba(245,158,11,0.25);"><span>Preço Final por Dose</span><span style="color:#10b981; font-size:0.95rem;">R$ ${fmtR(currentPrice)}</span></div>`;
            dosePriceDetails.innerHTML = html;
        }

        const maxCapacity = 2000;
        let percentage = (systemState.coffee_stock_grams / maxCapacity) * 100;
        if (percentage > 100) percentage = 100;
        stockProgress.style.width = `${percentage}%`;

        if (percentage < 20) {
            stockProgress.style.background = 'var(--danger)';
        } else if (percentage < 50) {
            stockProgress.style.background = 'var(--primary-color)';
        } else {
            stockProgress.style.background = 'var(--success)';
        }

        if (systemState.qr_code_url) {
            pixQr.src = systemState.qr_code_url;
            btnDownloadQr.href = systemState.qr_code_url;
            downloadQrContainer.style.display = 'block';
        } else {
            downloadQrContainer.style.display = 'none';
        }

        if (systemState.pix_key) {
            pixKeyValue.textContent = systemState.pix_key;
            pixKeyDisplay.style.display = 'block';
        } else {
            pixKeyDisplay.style.display = 'none';
        }
    }

    async function handleLogin() {
        const matricula = matriculaInput.value.trim();
        if (!matricula) {
            showAuthError('Por favor, informe a matrícula.');
            return;
        }
        if (matricula === '0000') {
            window.location.href = '/admin.html';
            return;
        }
        btnLogin.textContent = 'Carregando...';
        btnLogin.disabled = true;
        try {
            const res = await fetch(`${API_URL}/users/${matricula}`);
            if (res.ok) {
                const user = await res.json();
                currentUser = user;
                showDashboard();
            } else {
                showAuthError('Matrícula não encontrada. Procure a administração.');
            }
        } catch (error) {
            showAuthError('Erro na conexão com o servidor.');
        } finally {
            btnLogin.textContent = 'Entrar';
            btnLogin.disabled = false;
        }
    }

    async function handleRegister() {
        const name = regNameInput.value.trim();
        const matricula = regMatriculaInput.value.trim();
        if (!name || !matricula) {
            showAuthError('Preencha nome e matrícula.');
            return;
        }
        btnRegister.disabled = true;
        btnRegister.textContent = 'Aguarde...';
        try {
            const res = await fetch(`${API_URL}/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, matricula, balance: 0 })
            });
            if (res.ok) {
                authSuccess.textContent = 'Cadastro realizado! Faça login.';
                regNameInput.value = '';
                regMatriculaInput.value = '';
                setTimeout(() => { linkShowLogin.click(); }, 2000);
            } else {
                const data = await res.json();
                showAuthError(data.error || 'Erro ao cadastrar.');
            }
        } catch (error) {
            showAuthError('Erro de conexão.');
        } finally {
            btnRegister.disabled = false;
            btnRegister.textContent = 'Cadastrar';
        }
    }

    function handleLogout() {
        currentUser = null;
        matriculaInput.value = '';
        authError.textContent = '';
        actionMessage.textContent = '';
        authSection.classList.remove('hidden');
        userDashboard.classList.add('hidden');
    }

    function showDashboard() {
        authSection.classList.add('hidden');
        userDashboard.classList.remove('hidden');
        userNameEl.textContent = currentUser.name.split(' ')[0];
        updateBalanceUI();
        fetchSystemState();
    }

    function updateBalanceUI() {
        userBalanceEl.textContent = `R$ ${currentUser.balance.toFixed(2).replace('.', ',')}`;
        userBalanceEl.style.color = currentUser.balance < 0 ? 'var(--danger)' : 'var(--primary-color)';
    }

    function showAuthError(msg) {
        authError.textContent = msg;
        setTimeout(() => authError.textContent = '', 4000);
    }

    function showActionMsg(msg, isError = false) {
        actionMessage.textContent = msg;
        actionMessage.style.color = isError ? 'var(--danger)' : 'var(--success)';
        setTimeout(() => actionMessage.textContent = '', 5000);
    }

    async function handleConsume() {
        if (!currentUser) return;
        if (systemState && systemState.coffee_stock_grams < systemState.dose_grams) {
            showActionMsg('Estoque de café insuficiente!', true);
            return;
        }
        btnConsume.disabled = true;
        const originalText = btnConsume.innerHTML;
        btnConsume.innerHTML = '<span class="icon">⏳</span> Preparando...';
        try {
            const res = await fetch(`${API_URL}/consume`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ matricula: currentUser.matricula })
            });
            const data = await res.json();
            if (res.ok) {
                currentUser.balance = data.new_balance;
                updateBalanceUI();
                showActionMsg(`Café consumido! Débito de R$ ${data.cost.toFixed(2).replace('.', ',')}`);
                fetchSystemState();
                if (!historyContainer.classList.contains('hidden')) loadHistory();
                btnConsume.innerHTML = '<span class="icon">✓</span> Aproveite!';
                setTimeout(() => {
                    btnConsume.innerHTML = originalText;
                    btnConsume.disabled = false;
                }, 2000);
            } else {
                showActionMsg(data.error || 'Erro ao consumir café', true);
                btnConsume.innerHTML = originalText;
                btnConsume.disabled = false;
            }
        } catch (error) {
            showActionMsg('Erro de conexão.', true);
            btnConsume.innerHTML = originalText;
            btnConsume.disabled = false;
        }
    }

    async function handleRecharge() {
        const file = receiptFile.files[0];
        if (!file) {
            receiptUploadMsg.style.color = 'var(--danger)';
            receiptUploadMsg.textContent = 'Selecione o arquivo do comprovante.';
            return;
        }
        btnConfirmRecharge.disabled = true;
        btnConfirmRecharge.textContent = 'Enviando...';
        receiptUploadMsg.textContent = '';
        try {
            const formData = new FormData();
            formData.append('matricula', currentUser.matricula);
            formData.append('comprovante', file);
            const res = await fetch(`${API_URL}/receipts`, { method: 'POST', body: formData });
            const data = await res.json();
            if (res.ok) {
                receiptFile.value = '';
                receiptUploadMsg.style.color = 'var(--success)';
                receiptUploadMsg.textContent = data.auto_credited
                    ? `✓ ${data.message}`
                    : '✓ Comprovante enviado! Aguardando aprovação.';
                loadUserReceipts();
                if (data.auto_credited && currentUser) {
                    currentUser.balance = (parseFloat(currentUser.balance) || 0) + (parseFloat(data.credited_amount) || 0);
                    updateBalanceUI();
                }
            } else {
                receiptUploadMsg.style.color = 'var(--danger)';
                receiptUploadMsg.textContent = data.error || 'Erro ao enviar comprovante.';
            }
        } catch (error) {
            receiptUploadMsg.style.color = 'var(--danger)';
            receiptUploadMsg.textContent = 'Erro de conexão.';
        } finally {
            btnConfirmRecharge.disabled = false;
            btnConfirmRecharge.textContent = 'Enviar Comprovante';
        }
    }

    async function loadUserReceipts() {
        if (!currentUser) return;
        try {
            const res = await fetch(`${API_URL}/receipts/${currentUser.matricula}`);
            if (!res.ok) return;
            const receipts = await res.json();
            if (receipts.length === 0) {
                userReceiptsWrap.style.display = 'none';
                return;
            }
            userReceiptsWrap.style.display = 'block';
            const statusMap = { pending: ['⏳ Pendente', '#f59e0b'], approved: ['✓ Aprovado', 'var(--success)'], rejected: ['✗ Rejeitado', 'var(--danger)'] };
            userReceiptsList.innerHTML = receipts.map(r => {
                const [label, color] = statusMap[r.status] || ['--', '#fff'];
                const date = new Date(r.created_at).toLocaleDateString('pt-BR');
                const amtApproved = r.amount_approved ? `<span style="color:var(--success); font-size:0.78rem;"> · Creditado R$ ${parseFloat(r.amount_approved).toFixed(2).replace('.', ',')}</span>` : '';
                const note = r.notes ? `<span style="color:var(--danger); font-size:0.78rem;"> · ${r.notes}</span>` : '';
                const viewLink = `<a href="/api/receipts/${currentUser.matricula}/${r.id}/file" target="_blank" style="color:#60a5fa; font-size:0.78rem; margin-left:8px; white-space:nowrap;">Ver ↗</a>`;
                return `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.07);">
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap;">
                            <span style="color:var(--text-muted); font-size:0.78rem;">${date}</span>
                            ${viewLink}
                            ${amtApproved}${note}
                        </div>
                        <div style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;">${r.file_name || ''}</div>
                    </div>
                    <span style="color:${color}; font-size:0.82rem; white-space:nowrap; margin-left:10px;">${label}</span>
                </div>`;
            }).join('');
        } catch {}
    }

    async function handleToggleHistory() {
        if (historyContainer.classList.contains('hidden')) {
            historyContainer.classList.remove('hidden');
            await loadHistory();
        } else {
            historyContainer.classList.add('hidden');
        }
    }

    async function loadHistory() {
        if (!currentUser) return;
        historyList.innerHTML = '<li>Carregando...</li>';
        try {
            const res = await fetch(`${API_URL}/transactions/${currentUser.matricula}`);
            if (res.ok) {
                const transactions = await res.json();
                renderHistory(transactions);
            } else {
                historyList.innerHTML = '<li>Erro ao carregar histórico.</li>';
            }
        } catch (error) {
            historyList.innerHTML = '<li>Erro de conexão.</li>';
        }
    }

    function renderHistory(transactions) {
        historyList.innerHTML = '';
        if (transactions.length === 0) {
            historyList.innerHTML = '<li>Nenhuma transação encontrada.</li>';
            return;
        }
        transactions.forEach(t => {
            const li = document.createElement('li');
            li.style.marginBottom = '8px';
            li.style.paddingBottom = '8px';
            li.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
            const date = new Date(t.timestamp).toLocaleString('pt-BR');
            const isRecharge = t.type === 'recharge';
            const color = isRecharge ? 'var(--success)' : '#fff';
            const sign = isRecharge ? '+' : '-';
            const amountStr = Math.abs(t.amount).toFixed(2).replace('.', ',');
            const icon = isRecharge ? '💳' : '☕';
            li.innerHTML = `
                <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                    <span>${icon} ${isRecharge ? 'Recarga' : 'Consumo'}</span>
                    <strong style="color: ${color}">${sign} R$ ${amountStr}</strong>
                </div>
                <div style="font-size: 0.8rem; color: var(--text-muted);">${date}</div>
            `;
            historyList.appendChild(li);
        });
    }

    async function handleDownloadReport() {
        if (!currentUser) return;
        const originalText = btnDownloadReport.innerHTML;
        btnDownloadReport.disabled = true;
        btnDownloadReport.innerHTML = 'Gerando...';
        try {
            const res = await fetch(`${API_URL}/transactions/${currentUser.matricula}`);
            if (!res.ok) throw new Error('fetch failed');
            const transactions = await res.json();
            buildAndOpenReport(transactions);
        } catch {
            actionMessage.textContent = 'Erro ao gerar relatório.';
            actionMessage.style.color = 'var(--error)';
        } finally {
            btnDownloadReport.disabled = false;
            btnDownloadReport.innerHTML = originalText;
        }
    }

    function buildAndOpenReport(transactions) {
        const fmtBRL = v => 'R$ ' + Math.abs(parseFloat(v || 0)).toFixed(2).replace('.', ',');
        const escapeHtml = s => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

        const consumptions = transactions.filter(t => t.type === 'consumption');
        const recharges = transactions.filter(t => t.type === 'recharge');
        const totalConsumed = consumptions.reduce((s, t) => s + Math.abs(parseFloat(t.amount)), 0);
        const totalRecharged = recharges.reduce((s, t) => s + parseFloat(t.amount), 0);

        const sorted = [...transactions].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const periodStart = sorted.length ? new Date(sorted[0].timestamp).toLocaleDateString('pt-BR') : '—';
        const periodEnd = sorted.length ? new Date(sorted[sorted.length - 1].timestamp).toLocaleDateString('pt-BR') : '—';

        const balance = parseFloat(currentUser.balance || 0);
        const balanceColor = balance >= 0 ? '#16a34a' : '#dc2626';
        const balanceLabel = balance >= 0 ? 'Saldo disponível' : 'Saldo devedor';

        const rowsHtml = transactions.map(t => {
            const dt = new Date(t.timestamp);
            const dateStr = dt.toLocaleDateString('pt-BR');
            const timeStr = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            const isRecharge = t.type === 'recharge';
            const amount = parseFloat(t.amount);
            const sign = isRecharge ? '+' : '−';
            const color = isRecharge ? '#16a34a' : '#dc2626';
            return `<tr>
                <td>${dateStr}</td>
                <td>${timeStr}</td>
                <td>${isRecharge ? 'Recarga' : 'Consumo'}</td>
                <td style="text-align:right; color:${color}; font-weight:600;">${sign} ${fmtBRL(amount)}</td>
            </tr>`;
        }).join('');

        const generatedAt = new Date().toLocaleString('pt-BR');
        const userName = escapeHtml(currentUser.name);
        const matricula = escapeHtml(currentUser.matricula);

        const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório de Consumo — ${userName}</title>
<style>
    * { box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1f2937; max-width: 800px; margin: 0 auto; padding: 30px; background: #fff; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #f59e0b; padding-bottom: 16px; margin-bottom: 24px; }
    .brand { font-size: 1.8rem; font-weight: 700; }
    .brand .accent { color: #f59e0b; }
    .meta { text-align: right; font-size: 0.85rem; color: #6b7280; }
    h1 { font-size: 1.4rem; margin: 0 0 4px; }
    .user-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px 20px; margin-bottom: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .user-card .label { font-size: 0.72rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .user-card .value { font-size: 1rem; font-weight: 600; }
    .balance-box { text-align: right; }
    .balance-box .amount { font-size: 1.8rem; font-weight: 700; color: ${balanceColor}; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
    .summary-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; text-align: center; }
    .summary-card .label { font-size: 0.72rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
    .summary-card .value { font-size: 1.4rem; font-weight: 700; }
    .summary-card .sub { font-size: 0.75rem; color: #6b7280; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    thead { background: #f59e0b; color: #fff; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { font-weight: 600; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; }
    tbody tr:nth-child(even) { background: #f9fafb; }
    .footer { margin-top: 30px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 0.75rem; color: #6b7280; text-align: center; }
    .actions { margin-bottom: 20px; text-align: right; }
    .actions button { background: #f59e0b; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-size: 0.9rem; font-weight: 600; cursor: pointer; }
    .actions button:hover { background: #d97706; }
    @media print {
        .actions { display: none; }
        body { padding: 0; }
    }
</style>
</head>
<body>
    <div class="actions">
        <button onclick="window.print()">Imprimir / Salvar como PDF</button>
    </div>
    <div class="header">
        <div>
            <div class="brand">MT <span class="accent">Coffee</span></div>
            <h1 style="margin-top:8px;">Relatório de Consumo</h1>
        </div>
        <div class="meta">
            Gerado em<br><strong>${generatedAt}</strong>
        </div>
    </div>

    <div class="user-card">
        <div>
            <div class="label">Usuário</div>
            <div class="value">${userName}</div>
            <div class="label" style="margin-top:10px;">Matrícula</div>
            <div class="value">${matricula}</div>
        </div>
        <div class="balance-box">
            <div class="label">${balanceLabel}</div>
            <div class="amount">${balance < 0 ? '−' : ''}${fmtBRL(balance)}</div>
            <div class="label" style="margin-top:10px;">Período do extrato</div>
            <div class="value">${periodStart} a ${periodEnd}</div>
        </div>
    </div>

    <div class="summary-grid">
        <div class="summary-card">
            <div class="label">Cafés consumidos</div>
            <div class="value">${consumptions.length}</div>
            <div class="sub">doses no período</div>
        </div>
        <div class="summary-card">
            <div class="label">Total consumido</div>
            <div class="value" style="color:#dc2626;">${fmtBRL(totalConsumed)}</div>
            <div class="sub">${consumptions.length > 0 ? 'média ' + fmtBRL(totalConsumed / consumptions.length) + '/dose' : '—'}</div>
        </div>
        <div class="summary-card">
            <div class="label">Total recarregado</div>
            <div class="value" style="color:#16a34a;">${fmtBRL(totalRecharged)}</div>
            <div class="sub">${recharges.length} recarga${recharges.length === 1 ? '' : 's'}</div>
        </div>
    </div>

    <h2 style="font-size:1.1rem; margin: 0 0 12px;">Movimentações (${transactions.length})</h2>
    <table>
        <thead>
            <tr>
                <th style="width:18%;">Data</th>
                <th style="width:14%;">Hora</th>
                <th style="width:38%;">Tipo</th>
                <th style="width:30%; text-align:right;">Valor</th>
            </tr>
        </thead>
        <tbody>
            ${rowsHtml || '<tr><td colspan="4" style="text-align:center; padding:30px; color:#6b7280;">Nenhuma transação encontrada.</td></tr>'}
        </tbody>
    </table>

    <div class="footer">
        Relatório gerado automaticamente pelo sistema MT Coffee.<br>
        Para dúvidas ou divergências, procure o administrador.
    </div>
</body>
</html>`;

        const w = window.open('', '_blank');
        if (!w) {
            actionMessage.textContent = 'Permita pop-ups para baixar o relatório.';
            actionMessage.style.color = 'var(--error)';
            return;
        }
        w.document.open();
        w.document.write(html);
        w.document.close();
    }

    // =====================
    //  COFFEE RATINGS (user-side)
    // =====================
    const btnRateCoffees = document.getElementById('btn-rate-coffees');
    const coffeesModal = document.getElementById('coffees-modal');
    const coffeesList = document.getElementById('coffees-list-user');
    const closeCoffeesModal = document.getElementById('close-coffees-modal');

    function escHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }
    function starHtml(value, interactive, coffeeId) {
        const v = Math.round(parseFloat(value) || 0);
        let h = `<span class="star-rating ${interactive ? 'interactive' : ''}" ${coffeeId ? `data-coffee="${coffeeId}"` : ''}>`;
        for (let i = 1; i <= 5; i++) {
            h += `<span class="star ${i <= v ? 'filled' : ''}" data-val="${i}">★</span>`;
        }
        h += '</span>';
        return h;
    }
    function fmtDate(ts) {
        if (!ts) return '';
        return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    async function loadCoffeesForUser() {
        if (!currentUser) return;
        coffeesList.innerHTML = '<p style="color: var(--text-muted); text-align:center;">Carregando...</p>';
        try {
            const res = await fetch(`${API_URL}/coffees`);
            const coffees = await res.json();
            if (!Array.isArray(coffees) || coffees.length === 0) {
                coffeesList.innerHTML = '<p style="color: var(--text-muted); text-align:center;">Nenhum café cadastrado ainda.</p>';
                return;
            }
            // Load this user's existing ratings for each coffee in parallel
            const ratingsArr = await Promise.all(coffees.map(c =>
                fetch(`${API_URL}/coffees/${c.id}/ratings`).then(r => r.json()).catch(() => [])
            ));
            coffeesList.innerHTML = coffees.map((c, idx) => {
                const allRatings = Array.isArray(ratingsArr[idx]) ? ratingsArr[idx] : [];
                const mine = allRatings.find(r => r.matricula === currentUser.matricula);
                const myRating = mine ? mine.rating : 0;
                const myComment = mine ? mine.comment : '';
                const img = c.has_image
                    ? `<img src="/api/coffees/${c.id}/image" alt="${escHtml(c.name)}" style="width:100%; height:140px; object-fit:cover; border-radius:8px;">`
                    : `<div style="width:100%; height:140px; background:linear-gradient(135deg,#3d2817,#1a0f08); border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:3rem; opacity:0.5;">☕</div>`;
                const avg = parseFloat(c.avg_rating).toFixed(1);
                const otherRatings = allRatings.filter(r => r.matricula !== currentUser.matricula);
                const othersHtml = otherRatings.length === 0 ? '' : `
                    <details style="margin-top:10px;">
                        <summary style="cursor:pointer; color:var(--text-muted); font-size:0.8rem;">
                            Ver ${otherRatings.length} ${otherRatings.length === 1 ? 'avaliação' : 'avaliações'} de outros
                        </summary>
                        <div style="margin-top:8px;">
                            ${otherRatings.map(r => `
                                <div class="rating-row">
                                    <div class="rating-head">
                                        <div><span class="rating-user">${escHtml(r.user_name)}</span> ${starHtml(r.rating, false)}</div>
                                        <span class="rating-date">${fmtDate(r.updated_at)}</span>
                                    </div>
                                    ${r.comment ? `<div class="rating-comment">${escHtml(r.comment)}</div>` : ''}
                                </div>`).join('')}
                        </div>
                    </details>`;
                return `
                    <div class="glass-panel" style="padding:14px; margin-bottom:14px; text-align:left;" data-coffee-id="${c.id}">
                        ${img}
                        <div style="margin-top:10px;">
                            <div style="font-weight:600; font-size:1.05rem;">${escHtml(c.name)}</div>
                            ${c.origin ? `<div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">📍 ${escHtml(c.origin)}</div>` : ''}
                            ${c.description ? `<div style="font-size:0.85rem; color:var(--text-muted); margin-top:6px; line-height:1.4;">${escHtml(c.description)}</div>` : ''}
                            <div style="display:flex; align-items:center; gap:10px; margin-top:8px; font-size:0.85rem; color:var(--text-muted);">
                                ${starHtml(c.avg_rating, false)}
                                <span><strong style="color:var(--text-primary);">${avg}</strong> · ${c.rating_count} ${c.rating_count === 1 ? 'avaliação' : 'avaliações'}</span>
                            </div>
                        </div>
                        <hr style="border-color: rgba(255,255,255,0.08); margin: 12px 0;">
                        <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:6px;">${mine ? 'Sua avaliação:' : 'Sua nota:'}</div>
                        ${starHtml(myRating, true, c.id)}
                        <textarea class="comment-input" data-coffee="${c.id}" placeholder="Comentário (opcional)" rows="2"
                            style="width:100%; margin-top:8px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); border-radius:8px; padding:8px; color:var(--text-primary); font-size:0.9rem; resize:vertical;">${escHtml(myComment)}</textarea>
                        <div style="display:flex; gap:8px; margin-top:8px;">
                            <button class="btn btn-secondary btn-submit-rating" data-coffee="${c.id}" style="flex:1; padding:8px;">
                                ${mine ? 'Atualizar Avaliação' : 'Enviar Avaliação'}
                            </button>
                            ${mine ? `<button class="btn btn-outline btn-delete-rating" data-coffee="${c.id}" style="flex:0 0 auto; padding:8px 12px;">Remover</button>` : ''}
                        </div>
                        <p class="rating-msg" data-coffee="${c.id}" style="font-size:0.85rem; min-height:18px; margin-top:6px; text-align:center;"></p>
                        ${othersHtml}
                    </div>`;
            }).join('');

            // Wire star clicks
            coffeesList.querySelectorAll('.star-rating.interactive').forEach(rating => {
                rating.querySelectorAll('.star').forEach(star => {
                    star.addEventListener('click', () => {
                        const val = parseInt(star.dataset.val);
                        rating.querySelectorAll('.star').forEach(s => {
                            s.classList.toggle('filled', parseInt(s.dataset.val) <= val);
                        });
                        rating.dataset.selected = val;
                    });
                });
            });
            // Wire submit
            coffeesList.querySelectorAll('.btn-submit-rating').forEach(btn => {
                btn.addEventListener('click', () => submitRating(btn.dataset.coffee));
            });
            coffeesList.querySelectorAll('.btn-delete-rating').forEach(btn => {
                btn.addEventListener('click', () => deleteRating(btn.dataset.coffee));
            });
        } catch (err) {
            coffeesList.innerHTML = `<p style="color: var(--danger); text-align:center;">Erro: ${err.message}</p>`;
        }
    }

    async function submitRating(coffeeId) {
        const rating = coffeesList.querySelector(`.star-rating.interactive[data-coffee="${coffeeId}"]`);
        const commentEl = coffeesList.querySelector(`.comment-input[data-coffee="${coffeeId}"]`);
        const msg = coffeesList.querySelector(`.rating-msg[data-coffee="${coffeeId}"]`);
        const selected = parseInt(rating.dataset.selected) || rating.querySelectorAll('.star.filled').length;
        if (!selected || selected < 1 || selected > 5) {
            msg.textContent = 'Escolha uma nota de 1 a 5 estrelas.';
            msg.style.color = 'var(--danger)';
            return;
        }
        try {
            const res = await fetch(`${API_URL}/coffees/${coffeeId}/ratings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    matricula: currentUser.matricula,
                    rating: selected,
                    comment: commentEl.value.trim()
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Falha ao salvar avaliação');
            msg.textContent = '✓ Avaliação salva!';
            msg.style.color = 'var(--success)';
            setTimeout(() => loadCoffeesForUser(), 600);
        } catch (err) {
            msg.textContent = err.message;
            msg.style.color = 'var(--danger)';
        }
    }

    async function deleteRating(coffeeId) {
        if (!confirm('Remover sua avaliação?')) return;
        try {
            const res = await fetch(`${API_URL}/coffees/${coffeeId}/ratings/${currentUser.matricula}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Falha ao remover');
            await loadCoffeesForUser();
        } catch (err) {
            alert('Erro: ' + err.message);
        }
    }

    async function handleGenerateDynamicPix() {
        if (!currentUser) return;
        const amount = parseFloat(pixCustomAmount.value);
        if (isNaN(amount) || amount < 0.50) {
            pixErrorMsg.textContent = 'Informe um valor válido a partir de R$ 0,50.';
            pixErrorMsg.style.display = 'block';
            return;
        }
        pixErrorMsg.style.display = 'none';
        btnGeneratePix.disabled = true;
        btnGeneratePix.textContent = 'Gerando PIX...';

        try {
            const res = await fetch(`${API_URL}/pix/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    matricula: currentUser.matricula,
                    amount
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro ao gerar cobrança PIX');

            // Preenche dados do PIX
            pixDisplayAmount.textContent = `R$ ${parseFloat(data.amount).toFixed(2).replace('.', ',')}`;
            pixDynamicQr.src = data.qr_code_base64;
            pixCopyPasteInput.value = data.qr_code;

            pixAmountStep.style.display = 'none';
            pixDisplayStep.style.display = 'block';

            // Inicia o polling para detecção em tempo real
            startPixPolling(data.payment_id);
        } catch (err) {
            pixErrorMsg.textContent = err.message;
            pixErrorMsg.style.display = 'block';
        } finally {
            btnGeneratePix.disabled = false;
            btnGeneratePix.textContent = 'Gerar QR Code PIX';
        }
    }

    function startPixPolling(paymentId) {
        stopPixPolling();
        pixPollTimer = setInterval(async () => {
            if (!currentUser || rechargeModal.classList.contains('hidden')) {
                stopPixPolling();
                return;
            }
            try {
                const res = await fetch(`${API_URL}/pix/status/${paymentId}`);
                if (!res.ok) return;
                const data = await res.json();
                if (data.paid && data.status === 'approved') {
                    stopPixPolling();
                    // Atualiza saldo do usuário
                    if (data.new_balance !== undefined) {
                        currentUser.balance = parseFloat(data.new_balance);
                    } else {
                        currentUser.balance = (parseFloat(currentUser.balance) || 0) + (parseFloat(data.amount) || 0);
                    }
                    updateBalanceUI();

                    pixDisplayStep.innerHTML = `
                        <div style="padding: 20px 10px; text-align: center;">
                            <div style="font-size: 3rem; margin-bottom: 10px;">🎉</div>
                            <h3 style="color: #10b981; margin-bottom: 8px;">PIX Confirmado com Sucesso!</h3>
                            <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 16px;">
                                O valor de <strong style="color: #fff;">R$ ${parseFloat(data.amount).toFixed(2).replace('.', ',')}</strong> já foi creditado no seu saldo.
                            </p>
                            <button id="btn-pix-done" class="btn btn-primary" style="padding: 10px 24px; background: #10b981; border: none; border-radius: 8px; font-weight: 600;">
                                Pronto!
                            </button>
                        </div>
                    `;
                    const doneBtn = document.getElementById('btn-pix-done');
                    if (doneBtn) {
                        doneBtn.addEventListener('click', () => {
                            rechargeModal.classList.add('hidden');
                        });
                    }
                    setTimeout(() => {
                        rechargeModal.classList.add('hidden');
                    }, 4000);
                }
            } catch {
                // Erro de rede pontual no polling ignorado
            }
        }, 2500);
    }

    function stopPixPolling() {
        if (pixPollTimer) {
            clearInterval(pixPollTimer);
            pixPollTimer = null;
        }
    }

    if (btnRateCoffees) btnRateCoffees.addEventListener('click', () => {
        coffeesModal.classList.remove('hidden');
        loadCoffeesForUser();
    });
    if (closeCoffeesModal) closeCoffeesModal.addEventListener('click', () => coffeesModal.classList.add('hidden'));
    if (coffeesModal) coffeesModal.addEventListener('click', (e) => {
        if (e.target === coffeesModal) coffeesModal.classList.add('hidden');
    });

    // ==========================================
    //  TRANSPARENCY & AUDIT MODAL LOGIC
    // ==========================================
    const transparencyModal = document.getElementById('transparency-modal');
    const btnShowTransparency = document.getElementById('btn-show-transparency');
    const closeTransparencyModal = document.getElementById('close-transparency-modal');
    const tabAuditPurchases = document.getElementById('tab-audit-purchases');
    const tabAuditAdjustments = document.getElementById('tab-audit-adjustments');
    const tabAuditRecharges = document.getElementById('tab-audit-recharges');
    const auditPanelPurchases = document.getElementById('audit-panel-purchases');
    const auditPanelAdjustments = document.getElementById('audit-panel-adjustments');
    const auditPanelRecharges = document.getElementById('audit-panel-recharges');

    async function loadTransparencyData() {
        try {
            const res = await fetch(`${API_URL}/transparency`);
            if (!res.ok) throw new Error('Falha ao carregar dados');
            const data = await res.json();

            // 1. Compras de café
            const coffeeTbody = document.getElementById('audit-coffee-tbody');
            if (data.coffee_purchases && data.coffee_purchases.length > 0) {
                coffeeTbody.innerHTML = data.coffee_purchases.map(p => {
                    const docBtn = p.has_invoice
                        ? `<a href="${API_URL}/transparency/doc/stock/${p.id}" target="_blank" class="btn" style="padding: 2px 8px; font-size: 0.72rem; background: rgba(96,165,250,0.2); color: #60a5fa; border-radius: 4px; text-decoration: none; display: inline-block;">📄 Ver Nota</a>`
                        : `<span style="color: var(--text-muted); opacity: 0.5;">-</span>`;
                    return `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                            <td style="padding: 6px; color: var(--text-muted);">${new Date(p.timestamp).toLocaleDateString('pt-BR')}</td>
                            <td style="padding: 6px; font-weight: 500;">${p.coffee_name}${p.origin ? ` <small style="opacity:0.7;">(${p.origin})</small>` : ''}</td>
                            <td style="padding: 6px;">${p.grams}g</td>
                            <td style="padding: 6px; color: #f87171;">R$ ${fmtR(p.cost)}</td>
                            <td style="padding: 6px; color: #fbbf24;">R$ ${fmtR(p.cost_per_kg)}</td>
                            <td style="padding: 6px; text-align: center;">${docBtn}</td>
                        </tr>
                    `;
                }).join('');
            } else {
                coffeeTbody.innerHTML = '<tr><td colspan="6" style="padding: 10px; text-align: center; color: var(--text-muted);">Nenhuma remessa registrada.</td></tr>';
            }

            // 2. Custos extras e infraestrutura
            const extraTbody = document.getElementById('audit-extra-tbody');
            if (data.extra_costs && data.extra_costs.length > 0) {
                extraTbody.innerHTML = data.extra_costs.map(e => {
                    const docBtn = e.has_invoice
                        ? `<a href="${API_URL}/transparency/doc/extra/${e.id}" target="_blank" class="btn" style="padding: 2px 8px; font-size: 0.72rem; background: rgba(96,165,250,0.2); color: #60a5fa; border-radius: 4px; text-decoration: none; display: inline-block;">📄 Comprovante</a>`
                        : `<span style="color: var(--text-muted); opacity: 0.5;">-</span>`;
                    return `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                            <td style="padding: 6px; color: var(--text-muted);">${new Date(e.created_at).toLocaleDateString('pt-BR')}</td>
                            <td style="padding: 6px; font-weight: 500;">${e.description}</td>
                            <td style="padding: 6px; color: #f87171;">R$ ${fmtR(e.amount)}</td>
                            <td style="padding: 6px; color: #60a5fa;">${e.dilution_doses} doses</td>
                            <td style="padding: 6px; text-align: center;">${docBtn}</td>
                        </tr>
                    `;
                }).join('');
            } else {
                extraTbody.innerHTML = '<tr><td colspan="5" style="padding: 10px; text-align: center; color: var(--text-muted);">Nenhum custo extra lançado.</td></tr>';
            }

            // 3. Ajustes de estoque
            const adjustmentsTbody = document.getElementById('audit-adjustments-tbody');
            if (data.stock_adjustments && data.stock_adjustments.length > 0) {
                adjustmentsTbody.innerHTML = data.stock_adjustments.map(a => {
                    const deltaGramsFormatted = a.delta_grams > 0 ? `+${a.delta_grams}g` : `${a.delta_grams}g`;
                    const deltaColor = a.delta_grams > 0 ? '#10b981' : '#f87171';
                    return `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                            <td style="padding: 6px; color: var(--text-muted);">${new Date(a.timestamp).toLocaleDateString('pt-BR')} ${new Date(a.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
                            <td style="padding: 6px;">${a.grams_before}g</td>
                            <td style="padding: 6px; font-weight: 500;">${a.grams_after}g</td>
                            <td style="padding: 6px; color: ${deltaColor}; font-weight: 600;">${deltaGramsFormatted}</td>
                            <td style="padding: 6px; color: ${deltaColor};">R$ ${fmtR(Math.abs(a.delta_cost))}</td>
                            <td style="padding: 6px; color: var(--text-muted); font-size: 0.74rem;">${a.reason}</td>
                        </tr>
                    `;
                }).join('');
            } else {
                adjustmentsTbody.innerHTML = '<tr><td colspan="6" style="padding: 10px; text-align: center; color: var(--text-muted);">Nenhum ajuste físico de estoque registrado.</td></tr>';
            }

            // 4. Recargas (sem coluna de colaborador)
            const rechargesTbody = document.getElementById('audit-recharges-tbody');
            if (data.recharges && data.recharges.length > 0) {
                rechargesTbody.innerHTML = data.recharges.map(r => `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                        <td style="padding: 6px; color: var(--text-muted);">${new Date(r.timestamp).toLocaleDateString('pt-BR')} ${new Date(r.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td style="padding: 6px; color: #10b981; font-weight: 600;">+ R$ ${fmtR(r.amount)}</td>
                        <td style="padding: 6px; color: var(--text-muted);"><span style="background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; font-size: 0.72rem;">${r.method}</span></td>
                    </tr>
                `).join('');
            } else {
                rechargesTbody.innerHTML = '<tr><td colspan="3" style="padding: 10px; text-align: center; color: var(--text-muted);">Nenhuma recarga recente.</td></tr>';
            }
        } catch (err) {
            console.error('Erro ao carregar transparência:', err);
        }
    }

    if (btnShowTransparency) {
        btnShowTransparency.addEventListener('click', () => {
            transparencyModal.classList.remove('hidden');
            loadTransparencyData();
        });
    }
    if (closeTransparencyModal) {
        closeTransparencyModal.addEventListener('click', () => transparencyModal.classList.add('hidden'));
    }
    if (transparencyModal) {
        transparencyModal.addEventListener('click', (e) => {
            if (e.target === transparencyModal) transparencyModal.classList.add('hidden');
        });
    }

    function selectTab(activeBtn, activePanel) {
        const tabs = [tabAuditPurchases, tabAuditAdjustments, tabAuditRecharges];
        const panels = [auditPanelPurchases, auditPanelAdjustments, auditPanelRecharges];

        tabs.forEach(t => {
            if (t) {
                t.style.background = 'rgba(255,255,255,0.06)';
                t.style.color = 'var(--text-muted)';
            }
        });
        panels.forEach(p => {
            if (p) p.style.display = 'none';
        });

        if (activeBtn) {
            activeBtn.style.background = 'var(--accent)';
            activeBtn.style.color = '#fff';
        }
        if (activePanel) {
            activePanel.style.display = 'block';
        }
    }

    if (tabAuditPurchases) tabAuditPurchases.addEventListener('click', () => selectTab(tabAuditPurchases, auditPanelPurchases));
    if (tabAuditAdjustments) tabAuditAdjustments.addEventListener('click', () => selectTab(tabAuditAdjustments, auditPanelAdjustments));
    if (tabAuditRecharges) tabAuditRecharges.addEventListener('click', () => selectTab(tabAuditRecharges, auditPanelRecharges));
});
