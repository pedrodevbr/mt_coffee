document.addEventListener('DOMContentLoaded', () => {
    const API_URL = '/api';
    const TOKEN_KEY = 'mt_admin_token';

    // =====================
    //  AUTH HELPERS
    // =====================
    function getToken() {
        return sessionStorage.getItem(TOKEN_KEY);
    }

    function saveToken(token) {
        sessionStorage.setItem(TOKEN_KEY, token);
    }

    function clearToken() {
        sessionStorage.removeItem(TOKEN_KEY);
    }

    function authHeaders() {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getToken()}`
        };
    }

    async function authFetch(url, options = {}) {
        const token = getToken();
        const headers = { ...(options.headers || {}), 'Authorization': `Bearer ${token}` };
        const res = await fetch(url, { ...options, headers });
        if (res.status === 401 || res.status === 403) {
            clearToken();
            showLoginOverlay();
        }
        return res;
    }

    // =====================
    //  LOGIN OVERLAY
    // =====================
    const overlay = document.getElementById('admin-login-overlay');
    const pinInput = document.getElementById('pin-input');
    const btnPinLogin = document.getElementById('btn-pin-login');
    const pinError = document.getElementById('pin-error');

    function showLoginOverlay() {
        overlay.style.display = 'flex';
        pinInput.value = '';
        pinError.textContent = '';
        setTimeout(() => pinInput.focus(), 100);
    }

    function hideLoginOverlay() {
        overlay.style.display = 'none';
    }

    async function handlePinLogin(e) {
        if (e) e.preventDefault();
        const pin = pinInput.value.trim();
        if (!pin) { pinError.textContent = 'Informe o PIN.'; return; }

        btnPinLogin.disabled = true;
        btnPinLogin.textContent = 'Verificando...';
        pinError.textContent = '';

        try {
            const res = await fetch(`${API_URL}/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            });
            const data = await res.json();
            if (res.ok && data.token) {
                saveToken(data.token);
                hideLoginOverlay();
                initAdminPanel();
            } else {
                pinError.textContent = data.error || 'PIN incorreto.';
                pinInput.value = '';
                pinInput.focus();
            }
        } catch {
            pinError.textContent = 'Erro de conexão. Tente novamente.';
        } finally {
            btnPinLogin.disabled = false;
            btnPinLogin.textContent = 'Entrar';
        }
    }

    document.getElementById('pin-form').addEventListener('submit', handlePinLogin);

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => {
        clearToken();
        showLoginOverlay();
    });

    // =====================
    //  CHANGE PIN MODAL
    // =====================
    const pinModal = document.getElementById('pin-modal');
    const closePinModal = document.getElementById('close-pin-modal');
    const currentPinInput = document.getElementById('current-pin');
    const newPinInput = document.getElementById('new-pin');
    const confirmPinInput = document.getElementById('confirm-pin');
    const btnChangePin = document.getElementById('btn-change-pin');
    const pinChangeMsg = document.getElementById('pin-change-msg');

    document.getElementById('btn-open-pin-modal').addEventListener('click', () => {
        currentPinInput.value = '';
        newPinInput.value = '';
        confirmPinInput.value = '';
        pinChangeMsg.textContent = '';
        pinModal.classList.remove('hidden');
    });

    closePinModal.addEventListener('click', () => pinModal.classList.add('hidden'));

    btnChangePin.addEventListener('click', async () => {
        const current_pin = currentPinInput.value.trim();
        const new_pin = newPinInput.value.trim();
        const confirm = confirmPinInput.value.trim();

        if (!current_pin || !new_pin || !confirm) {
            showMessage(pinChangeMsg, 'Preencha todos os campos.', true);
            return;
        }
        if (new_pin !== confirm) {
            showMessage(pinChangeMsg, 'Os PINs não coincidem.', true);
            return;
        }
        if (new_pin.length < 4) {
            showMessage(pinChangeMsg, 'O PIN deve ter ao menos 4 caracteres.', true);
            return;
        }

        btnChangePin.disabled = true;
        btnChangePin.textContent = 'Salvando...';
        try {
            const res = await authFetch(`${API_URL}/admin/pin`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ current_pin, new_pin })
            });
            const data = await res.json();
            if (res.ok) {
                showMessage(pinChangeMsg, 'PIN alterado com sucesso!');
                setTimeout(() => pinModal.classList.add('hidden'), 1500);
            } else {
                showMessage(pinChangeMsg, data.error || 'Erro ao alterar PIN.', true);
            }
        } catch {
            showMessage(pinChangeMsg, 'Erro de conexão.', true);
        } finally {
            btnChangePin.disabled = false;
            btnChangePin.textContent = 'Salvar novo PIN';
        }
    });

    // =====================
    //  ELEMENTS
    // =====================
    const adminCurrentStock = document.getElementById('admin-current-stock');
    const adminDosePrice = document.getElementById('admin-dose-price');
    const addGramsInput = document.getElementById('add-grams');
    const addCostInput = document.getElementById('add-cost');
    const btnAddStock = document.getElementById('btn-add-stock');
    const stockMsg = document.getElementById('stock-msg');

    const qrPreview = document.getElementById('admin-qr-preview');
    const qrFileInput = document.getElementById('qr-file');
    const btnUploadQr = document.getElementById('btn-upload-qr');
    const qrMsg = document.getElementById('qr-msg');
    const pixKeyInput = document.getElementById('pix-key-input');
    const btnSavePix = document.getElementById('btn-save-pix');

    const usersTbody = document.getElementById('users-tbody');
    const btnNewUser = document.getElementById('btn-new-user');
    const historyTbody = document.getElementById('history-tbody');

    const userModal = document.getElementById('user-modal');
    const closeUserModal = document.getElementById('close-user-modal');
    const newUserName = document.getElementById('new-user-name');
    const newUserMatricula = document.getElementById('new-user-matricula');
    const btnSaveUser = document.getElementById('btn-save-user');
    const userMsg = document.getElementById('user-msg');
    const userModalTitle = document.getElementById('user-modal-title');
    const editUserId = document.getElementById('edit-user-id');
    const newUserBalance = document.getElementById('new-user-balance');

    let chartCount = null;
    let chartValue = null;

    // =====================
    //  INIT
    // =====================
    function initAdminPanel() {
        loadSystemState();
        loadUsers();
        loadHistory();
        loadStats();
        loadStockHistory();
    }

    // Check token on load
    if (getToken()) {
        hideLoginOverlay();
        initAdminPanel();
    } else {
        showLoginOverlay();
    }

    // Events
    btnAddStock.addEventListener('click', handleAddStock);
    btnUploadQr.addEventListener('click', handleUploadQr);
    btnSavePix.addEventListener('click', handleSavePix);

    btnNewUser.addEventListener('click', () => {
        userModalTitle.textContent = 'Novo Usuário';
        editUserId.value = '';
        newUserName.value = '';
        newUserMatricula.value = '';
        newUserBalance.value = '0';
        userMsg.textContent = '';
        userModal.classList.remove('hidden');
    });

    closeUserModal.addEventListener('click', () => userModal.classList.add('hidden'));
    btnSaveUser.addEventListener('click', handleSaveUser);

    // =====================
    //  ANALYTICS / STATS
    // =====================
    async function loadStats() {
        try {
            const [weeklyRes, avgRes] = await Promise.all([
                authFetch(`${API_URL}/stats/weekly`),
                authFetch(`${API_URL}/stats/daily-average`)
            ]);
            if (!weeklyRes.ok || !avgRes.ok) return;
            const weekly = await weeklyRes.json();
            const avg = await avgRes.json();
            renderKPIs(avg);
            renderWeeklyCharts(weekly);
            renderTopUsers(avg.top_users_last_30_days);
        } catch (err) {
            console.error('Error loading stats:', err);
        }
    }

    function renderKPIs(data) {
        document.getElementById('kpi-avg-daily').textContent =
            data.avg_daily_business_days > 0 ? data.avg_daily_business_days.toFixed(1) : '0';
        document.getElementById('kpi-this-month').textContent = data.this_month_consumptions;
        document.getElementById('kpi-total').textContent = data.total_consumptions_overall;
        document.getElementById('kpi-days').textContent = data.total_business_days_with_consumption;
    }

    function renderWeeklyCharts(rows) {
        const labels = rows.map(r => 'Sem ' + r.label);
        const counts = rows.map(r => parseInt(r.consumption_count));
        const values = rows.map(r => parseFloat(r.total_consumed_value));

        const gridColor = 'rgba(255,255,255,0.07)';
        const tickColor = '#94a3b8';
        const amber = '#f59e0b';
        const blue = '#3b82f6';

        const baseOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: tickColor, font: { size: 10 } }, grid: { color: gridColor } },
                y: { ticks: { color: tickColor, font: { size: 10 } }, grid: { color: gridColor }, beginAtZero: true }
            }
        };

        if (chartCount) chartCount.destroy();
        chartCount = new Chart(document.getElementById('chart-weekly-count'), {
            type: 'bar',
            data: {
                labels,
                datasets: [{ data: counts, backgroundColor: `${amber}99`, borderColor: amber, borderWidth: 2, borderRadius: 6 }]
            },
            options: {
                ...baseOptions,
                plugins: { ...baseOptions.plugins, tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} doses` } } }
            }
        });

        if (chartValue) chartValue.destroy();
        chartValue = new Chart(document.getElementById('chart-weekly-value'), {
            type: 'bar',
            data: {
                labels,
                datasets: [{ data: values, backgroundColor: `${blue}99`, borderColor: blue, borderWidth: 2, borderRadius: 6 }]
            },
            options: {
                ...baseOptions,
                plugins: { ...baseOptions.plugins, tooltip: { callbacks: { label: ctx => `R$ ${ctx.parsed.y.toFixed(2).replace('.', ',')}` } } },
                scales: { ...baseOptions.scales, y: { ...baseOptions.scales.y, ticks: { color: tickColor, font: { size: 10 }, callback: v => `R$${v.toFixed(0)}` } } }
            }
        });
    }

    function renderTopUsers(users) {
        const el = document.getElementById('top-users-list');
        if (!users || users.length === 0) {
            el.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">Nenhum consumo nos últimos 30 dias.</p>';
            return;
        }
        const max = Math.max(...users.map(u => parseInt(u.consumption_count)));
        el.innerHTML = users.map(u => {
            const count = parseInt(u.consumption_count);
            const pct = max > 0 ? (count / max) * 100 : 0;
            return `
                <div class="top-user-row">
                    <span class="top-user-name" title="${u.name}">${u.name.split(' ')[0]}</span>
                    <div class="top-user-bar-wrap">
                        <div class="top-user-bar" style="width: ${pct}%"></div>
                    </div>
                    <span class="top-user-count">${count}</span>
                </div>`;
        }).join('');
    }

    // =====================
    //  SYSTEM STATE
    // =====================
    async function loadSystemState() {
        try {
            const res = await fetch(`${API_URL}/system`);
            if (res.ok) {
                const state = await res.json();
                adminCurrentStock.textContent = `${parseFloat(state.coffee_stock_grams).toFixed(0)} g`;
                adminDosePrice.textContent = `R$ ${parseFloat(state.current_price_per_dose).toFixed(2).replace('.', ',')}`;
                if (state.qr_code_url) qrPreview.src = state.qr_code_url;
                if (state.pix_key) pixKeyInput.value = state.pix_key;
            }
        } catch (err) {
            console.error('Error loading state:', err);
        }
    }

    async function loadStockHistory() {
        const tbody = document.getElementById('stock-history-body');
        if (!tbody) return;
        try {
            const res = await authFetch(`${API_URL}/admin/stock-history`);
            if (!res.ok) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Sem dados</td></tr>'; return; }
            const rows = await res.json();
            if (rows.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Nenhuma remessa registrada ainda.</td></tr>';
                return;
            }
            tbody.innerHTML = rows.map(r => {
                const date = new Date(r.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
                const costPer = parseFloat(r.cost_per_kg).toFixed(2).replace('.', ',');
                const cost = parseFloat(r.added_cost).toFixed(2).replace('.', ',');
                return `<tr>
                    <td>${date}</td>
                    <td>${parseFloat(r.added_grams).toFixed(0)} g</td>
                    <td>R$ ${cost}</td>
                    <td>R$ ${costPer}</td>
                </tr>`;
            }).join('');
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--danger)">Erro ao carregar histórico</td></tr>';
        }
    }

    async function handleSavePix() {
        const pix_key = pixKeyInput.value.trim();
        btnSavePix.disabled = true;
        btnSavePix.textContent = 'Salvando...';
        try {
            const res = await authFetch(`${API_URL}/system/pix`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ pix_key })
            });
            showMessage(qrMsg, res.ok ? 'Chave PIX atualizada!' : 'Erro ao salvar chave', !res.ok);
        } catch {
            showMessage(qrMsg, 'Erro de conexão', true);
        } finally {
            btnSavePix.disabled = false;
            btnSavePix.textContent = 'Salvar Chave PIX';
        }
    }

    async function handleUploadQr() {
        const file = qrFileInput.files[0];
        if (!file) { showMessage(qrMsg, 'Selecione uma imagem primeiro.', true); return; }

        const formData = new FormData();
        formData.append('qr_image', file);
        btnUploadQr.disabled = true;
        btnUploadQr.textContent = 'Enviando...';
        try {
            const res = await authFetch(`${API_URL}/system/qr`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${getToken()}` },
                body: formData
            });
            if (res.ok) {
                showMessage(qrMsg, 'QR Code salvo!');
                qrFileInput.value = '';
                loadSystemState();
            } else {
                const data = await res.json();
                showMessage(qrMsg, data.error || 'Erro no upload', true);
            }
        } catch {
            showMessage(qrMsg, 'Erro de conexão', true);
        } finally {
            btnUploadQr.disabled = false;
            btnUploadQr.textContent = 'Salvar QR Code';
        }
    }

    // =====================
    //  USERS
    // =====================
    async function loadUsers() {
        try {
            const res = await authFetch(`${API_URL}/users`);
            if (res.ok) renderUsers(await res.json());
        } catch {
            usersTbody.innerHTML = '<tr><td colspan="4">Erro ao carregar usuários.</td></tr>';
        }
    }

    function renderUsers(users) {
        usersTbody.innerHTML = '';
        if (users.length === 0) {
            usersTbody.innerHTML = '<tr><td colspan="4" style="text-align:center">Nenhum usuário cadastrado.</td></tr>';
            return;
        }
        users.forEach(user => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${user.name}</td>
                <td>${user.matricula}</td>
                <td>R$ ${parseFloat(user.balance).toFixed(2).replace('.', ',')}</td>
                <td>
                    <button onclick="editUser(${user.id}, '${user.name.replace(/'/g, "\\'")}', '${user.matricula}', ${user.balance})" style="padding: 4px 10px; font-size: 0.8rem; color: var(--secondary-color); cursor: pointer; background: transparent; border-radius: 6px; border: 1px solid var(--secondary-color); margin-right: 5px;">Editar</button>
                    <button onclick="deleteUser(${user.id})" style="padding: 4px 10px; font-size: 0.8rem; color: var(--danger); cursor: pointer; background: transparent; border-radius: 6px; border: 1px solid var(--danger);">Excluir</button>
                </td>`;
            usersTbody.appendChild(tr);
        });
    }

    // =====================
    //  HISTORY
    // =====================
    async function loadHistory() {
        try {
            const res = await authFetch(`${API_URL}/transactions`);
            if (res.ok) renderHistory(await res.json());
        } catch {
            historyTbody.innerHTML = '<tr><td colspan="5">Erro ao carregar histórico.</td></tr>';
        }
    }

    function renderHistory(transactions) {
        historyTbody.innerHTML = '';
        if (transactions.length === 0) {
            historyTbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Nenhuma transação registrada.</td></tr>';
            return;
        }
        transactions.forEach(t => {
            const tr = document.createElement('tr');
            const date = new Date(t.timestamp).toLocaleString('pt-BR');
            const isRecharge = t.type === 'recharge';
            tr.innerHTML = `
                <td>${date}</td>
                <td>${t.name}</td>
                <td>${t.matricula}</td>
                <td>${isRecharge ? 'Recarga' : 'Consumo'}</td>
                <td style="color: ${isRecharge ? 'var(--success)' : '#fff'}">${isRecharge ? '+' : '-'} R$ ${Math.abs(t.amount).toFixed(2).replace('.', ',')}</td>`;
            historyTbody.appendChild(tr);
        });
    }

    // =====================
    //  STOCK
    // =====================
    async function handleAddStock() {
        const grams = parseFloat(addGramsInput.value);
        const cost = parseFloat(addCostInput.value);
        if (isNaN(grams) || grams <= 0) {
            showMessage(stockMsg, 'Insira a quantidade em gramas.', true);
            return;
        }
        btnAddStock.disabled = true;
        btnAddStock.textContent = 'Adicionando...';
        try {
            const res = await authFetch(`${API_URL}/system/stock`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ added_grams: grams, added_cost: isNaN(cost) ? 0 : cost })
            });
            if (res.ok) {
                showMessage(stockMsg, 'Estoque adicionado com sucesso!');
                addGramsInput.value = '';
                addCostInput.value = '';
                loadSystemState();
                loadStockHistory();
            }
        } catch {
            showMessage(stockMsg, 'Erro de conexão', true);
        } finally {
            btnAddStock.disabled = false;
            btnAddStock.textContent = 'Adicionar ao Estoque';
        }
    }

    // =====================
    //  SAVE USER
    // =====================
    async function handleSaveUser() {
        const id = editUserId.value;
        const name = newUserName.value.trim();
        const matricula = newUserMatricula.value.trim();
        const balance = parseFloat(newUserBalance.value) || 0;
        if (!name || !matricula) {
            showMessage(userMsg, 'Preencha nome e matrícula.', true);
            return;
        }
        btnSaveUser.disabled = true;
        const url = id ? `${API_URL}/users/${id}` : `${API_URL}/users`;
        const method = id ? 'PUT' : 'POST';
        try {
            const res = await authFetch(url, {
                method,
                headers: authHeaders(),
                body: JSON.stringify({ name, matricula, balance })
            });
            if (res.ok) {
                showMessage(userMsg, id ? 'Usuário atualizado!' : 'Usuário cadastrado!');
                setTimeout(() => { userModal.classList.add('hidden'); loadUsers(); }, 1000);
            } else {
                const data = await res.json();
                showMessage(userMsg, data.error || 'Erro ao salvar', true);
            }
        } catch {
            showMessage(userMsg, 'Erro de conexão', true);
        } finally {
            btnSaveUser.disabled = false;
        }
    }

    // =====================
    //  GLOBALS
    // =====================
    window.editUser = function (id, name, matricula, balance) {
        userModalTitle.textContent = 'Editar Usuário';
        editUserId.value = id;
        newUserName.value = name;
        newUserMatricula.value = matricula;
        newUserBalance.value = balance;
        userMsg.textContent = '';
        userModal.classList.remove('hidden');
    };

    window.deleteUser = async function (id) {
        if (!confirm('Deseja realmente excluir este usuário?')) return;
        try {
            const res = await authFetch(`${API_URL}/users/${id}`, {
                method: 'DELETE',
                headers: authHeaders()
            });
            if (res.ok) loadUsers();
            else alert('Erro ao excluir usuário');
        } catch {
            alert('Erro de conexão');
        }
    };

    function showMessage(element, text, isError = false) {
        element.textContent = text;
        element.style.color = isError ? 'var(--danger)' : 'var(--success)';
        setTimeout(() => element.textContent = '', 4000);
    }
});
