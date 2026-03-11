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
    const rechargeAmount = document.getElementById('recharge-amount');
    const directRechargeMsg = document.getElementById('direct-recharge-msg');
    const btnDirectRecharge = document.getElementById('btn-direct-recharge');
    const receiptFile = document.getElementById('receipt-file');
    const receiptUploadMsg = document.getElementById('receipt-upload-msg');
    const userReceiptsWrap = document.getElementById('user-receipts-wrap');
    const userReceiptsList = document.getElementById('user-receipts-list');
    const btnConfirmRecharge = document.getElementById('btn-confirm-recharge');

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

    btnShowRecharge.addEventListener('click', () => {
        rechargeAmount.value = '';
        directRechargeMsg.textContent = '';
        receiptFile.value = '';
        receiptUploadMsg.textContent = '';
        rechargeModal.classList.remove('hidden');
        if (currentUser) loadUserReceipts();
    });

    closeModalBtn.addEventListener('click', () => {
        rechargeModal.classList.add('hidden');
    });

    btnDirectRecharge.addEventListener('click', handleDirectRecharge);
    btnConfirmRecharge.addEventListener('click', handleRecharge);
    btnShowHistory.addEventListener('click', handleToggleHistory);

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

    function updateSystemUI() {
        if (!systemState) return;

        stockLevel.textContent = `${systemState.coffee_stock_grams.toFixed(0)} g`;
        dosePrice.textContent = `R$ ${systemState.current_price_per_dose.toFixed(2).replace('.', ',')}`;

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

    async function handleDirectRecharge() {
        const amount = parseFloat(rechargeAmount.value);
        if (isNaN(amount) || amount <= 0) {
            directRechargeMsg.style.color = 'var(--danger)';
            directRechargeMsg.textContent = 'Informe um valor válido.';
            return;
        }
        btnDirectRecharge.disabled = true;
        btnDirectRecharge.textContent = 'Processando...';
        directRechargeMsg.textContent = '';
        try {
            const res = await fetch(`${API_URL}/recharge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ matricula: currentUser.matricula, amount })
            });
            const data = await res.json();
            if (res.ok) {
                rechargeAmount.value = '';
                directRechargeMsg.style.color = 'var(--success)';
                directRechargeMsg.textContent = `✓ Saldo de R$ ${amount.toFixed(2)} adicionado!`;
                currentUser.balance = data.balance;
                userBalanceEl.textContent = `R$ ${data.balance.toFixed(2)}`;
                setTimeout(() => { rechargeModal.classList.add('hidden'); }, 1200);
            } else {
                directRechargeMsg.style.color = 'var(--danger)';
                directRechargeMsg.textContent = data.error || 'Erro ao recarregar.';
            }
        } catch (error) {
            directRechargeMsg.style.color = 'var(--danger)';
            directRechargeMsg.textContent = 'Erro de conexão.';
        } finally {
            btnDirectRecharge.disabled = false;
            btnDirectRecharge.textContent = 'Confirmar Recarga';
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
                receiptUploadMsg.textContent = '✓ Comprovante enviado! Aguardando aprovação.';
                loadUserReceipts();
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
                const amtDeclared = parseFloat(r.amount_declared).toFixed(2).replace('.', ',');
                const amtApproved = r.amount_approved ? ` → aprovado R$ ${parseFloat(r.amount_approved).toFixed(2).replace('.', ',')}` : '';
                const note = r.notes ? `<span style="color:var(--danger); font-size:0.78rem;"> · ${r.notes}</span>` : '';
                return `<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.07);">
                    <div>
                        <span style="font-weight:500;">R$ ${amtDeclared}${amtApproved}</span>
                        <span style="color:var(--text-muted); font-size:0.78rem; margin-left:6px;">${date}</span>${note}
                    </div>
                    <span style="color:${color}; font-size:0.82rem; white-space:nowrap; margin-left:8px;">${label}</span>
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
});
