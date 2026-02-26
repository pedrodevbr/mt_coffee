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

    // Auth Toggles & Registration
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
    const rechargeAmount = document.getElementById('recharge-amount');
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

    // Modal Listeners
    btnShowRecharge.addEventListener('click', () => {
        rechargeAmount.value = '';
        rechargeModal.classList.remove('hidden');
    });

    closeModalBtn.addEventListener('click', () => {
        rechargeModal.classList.add('hidden');
    });

    btnConfirmRecharge.addEventListener('click', handleRecharge);

    // History Listeners
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

        // Progress bar (Assuming max capacity is 2000g for visual purposes, adjust as needed)
        const maxCapacity = 2000;
        let percentage = (systemState.coffee_stock_grams / maxCapacity) * 100;
        if (percentage > 100) percentage = 100;

        stockProgress.style.width = `${percentage}%`;

        // Change color based on stock
        if (percentage < 20) {
            stockProgress.style.background = 'var(--danger)';
        } else if (percentage < 50) {
            stockProgress.style.background = 'var(--primary-color)';
        } else {
            stockProgress.style.background = 'var(--success)';
        }

        // Update QR
        if (systemState.qr_code_url) {
            pixQr.src = systemState.qr_code_url;
        }
    }

    async function handleLogin() {
        const matricula = matriculaInput.value.trim();
        if (!matricula) {
            showAuthError('Por favor, informe a matrícula.');
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

            const data = await res.json();
            if (res.ok) {
                authSuccess.textContent = 'Cadastro realizado! Faça login.';
                regNameInput.value = '';
                regMatriculaInput.value = '';
                setTimeout(() => {
                    linkShowLogin.click();
                }, 2000);
            } else {
                showAuthError(data.error || 'Erro ao cadastrar. Matrícula já existe?');
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

        userNameEl.textContent = currentUser.name.split(' ')[0]; // First name
        updateBalanceUI();
        fetchSystemState(); // Refresh stock
    }

    function updateBalanceUI() {
        userBalanceEl.textContent = `R$ ${currentUser.balance.toFixed(2).replace('.', ',')}`;
        // Color based on balance
        if (currentUser.balance < 0) {
            userBalanceEl.style.color = 'var(--danger)';
        } else {
            userBalanceEl.style.color = 'var(--primary-color)';
        }
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

        // Check if there's enough stock for 1 dose
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
                fetchSystemState(); // update stock visually
                if (!historyContainer.classList.contains('hidden')) {
                    loadHistory();
                }

                // Success animation
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
        const amount = parseFloat(rechargeAmount.value);
        if (isNaN(amount) || amount <= 0) {
            alert('Por favor, insira um valor válido de recarga.');
            return;
        }

        btnConfirmRecharge.disabled = true;
        btnConfirmRecharge.textContent = 'Processando...';

        try {
            const res = await fetch(`${API_URL}/recharge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ matricula: currentUser.matricula, amount: amount })
            });

            const data = await res.json();

            if (res.ok) {
                currentUser.balance = data.new_balance;
                updateBalanceUI();
                rechargeModal.classList.add('hidden');
                showActionMsg(`Recarga de R$ ${amount.toFixed(2).replace('.', ',')} confirmada!`);
                if (!historyContainer.classList.contains('hidden')) {
                    loadHistory();
                }
            } else {
                alert(data.error || 'Erro ao processar recarga');
            }
        } catch (error) {
            alert('Erro de conexão.');
        } finally {
            btnConfirmRecharge.disabled = false;
            btnConfirmRecharge.textContent = 'Confirmar Recarga';
        }
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
