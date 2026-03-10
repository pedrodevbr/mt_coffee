document.addEventListener('DOMContentLoaded', () => {
    const API_URL = '/api';

    // Elements – Stock
    const adminCurrentStock = document.getElementById('admin-current-stock');
    const adminDosePrice = document.getElementById('admin-dose-price');
    const addGramsInput = document.getElementById('add-grams');
    const addCostInput = document.getElementById('add-cost');
    const btnAddStock = document.getElementById('btn-add-stock');
    const stockMsg = document.getElementById('stock-msg');

    // Elements – PIX/QR
    const qrPreview = document.getElementById('admin-qr-preview');
    const qrFileInput = document.getElementById('qr-file');
    const btnUploadQr = document.getElementById('btn-upload-qr');
    const qrMsg = document.getElementById('qr-msg');
    const pixKeyInput = document.getElementById('pix-key-input');
    const btnSavePix = document.getElementById('btn-save-pix');

    // Elements – Users
    const usersTbody = document.getElementById('users-tbody');
    const btnNewUser = document.getElementById('btn-new-user');
    const historyTbody = document.getElementById('history-tbody');

    // Modal
    const userModal = document.getElementById('user-modal');
    const closeUserModal = document.getElementById('close-user-modal');
    const newUserName = document.getElementById('new-user-name');
    const newUserMatricula = document.getElementById('new-user-matricula');
    const btnSaveUser = document.getElementById('btn-save-user');
    const userMsg = document.getElementById('user-msg');
    const userModalTitle = document.getElementById('user-modal-title');
    const editUserId = document.getElementById('edit-user-id');
    const newUserBalance = document.getElementById('new-user-balance');

    // Charts
    let chartCount = null;
    let chartValue = null;

    // Init
    loadSystemState();
    loadUsers();
    loadHistory();
    loadStats();

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
            const [monthlyRes, avgRes] = await Promise.all([
                fetch(`${API_URL}/stats/monthly`),
                fetch(`${API_URL}/stats/daily-average`)
            ]);
            const monthly = await monthlyRes.json();
            const avg = await avgRes.json();

            renderKPIs(avg);
            renderMonthlyCharts(monthly);
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

    function renderMonthlyCharts(rows) {
        const labels = rows.map(r => r.label);
        const counts = rows.map(r => parseInt(r.consumption_count));
        const values = rows.map(r => parseFloat(r.total_consumed_value));

        const gridColor = 'rgba(255,255,255,0.07)';
        const tickColor = '#94a3b8';
        const amber = '#f59e0b';
        const blue = '#3b82f6';

        const baseOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    ticks: { color: tickColor, font: { size: 10 } },
                    grid: { color: gridColor }
                },
                y: {
                    ticks: { color: tickColor, font: { size: 10 } },
                    grid: { color: gridColor },
                    beginAtZero: true
                }
            }
        };

        if (chartCount) chartCount.destroy();
        chartCount = new Chart(document.getElementById('chart-monthly-count'), {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    data: counts,
                    backgroundColor: `${amber}99`,
                    borderColor: amber,
                    borderWidth: 2,
                    borderRadius: 6
                }]
            },
            options: {
                ...baseOptions,
                plugins: {
                    ...baseOptions.plugins,
                    tooltip: {
                        callbacks: {
                            label: ctx => `${ctx.parsed.y} doses`
                        }
                    }
                }
            }
        });

        if (chartValue) chartValue.destroy();
        chartValue = new Chart(document.getElementById('chart-monthly-value'), {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: `${blue}99`,
                    borderColor: blue,
                    borderWidth: 2,
                    borderRadius: 6
                }]
            },
            options: {
                ...baseOptions,
                plugins: {
                    ...baseOptions.plugins,
                    tooltip: {
                        callbacks: {
                            label: ctx => `R$ ${ctx.parsed.y.toFixed(2).replace('.', ',')}`
                        }
                    }
                },
                scales: {
                    ...baseOptions.scales,
                    y: {
                        ...baseOptions.scales.y,
                        ticks: {
                            color: tickColor,
                            font: { size: 10 },
                            callback: v => `R$${v.toFixed(0)}`
                        }
                    }
                }
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
                </div>
            `;
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
                adminCurrentStock.textContent = `${state.coffee_stock_grams.toFixed(0)} g`;
                adminDosePrice.textContent = `R$ ${state.current_price_per_dose.toFixed(2).replace('.', ',')}`;
                if (state.qr_code_url) qrPreview.src = state.qr_code_url;
                if (state.pix_key) pixKeyInput.value = state.pix_key;
            }
        } catch (err) {
            console.error('Error loading state:', err);
        }
    }

    async function handleSavePix() {
        const pix_key = pixKeyInput.value.trim();
        btnSavePix.disabled = true;
        btnSavePix.textContent = 'Salvando...';
        try {
            const res = await fetch(`${API_URL}/system/pix`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            const res = await fetch(`${API_URL}/system/qr`, { method: 'POST', body: formData });
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
            const res = await fetch(`${API_URL}/users`);
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
                    <button class="btn-outline" onclick="editUser(${user.id}, '${user.name.replace(/'/g, "\\'")}', '${user.matricula}', ${user.balance})" style="padding: 4px 10px; font-size: 0.8rem; border-color: var(--secondary-color); color: var(--secondary-color); margin-right: 5px; cursor: pointer; background: transparent; border-radius: 6px; border: 1px solid;">Editar</button>
                    <button class="btn-outline" onclick="deleteUser(${user.id})" style="padding: 4px 10px; font-size: 0.8rem; border-color: var(--danger); color: var(--danger); cursor: pointer; background: transparent; border-radius: 6px; border: 1px solid;">Excluir</button>
                </td>
            `;
            usersTbody.appendChild(tr);
        });
    }

    // =====================
    //  HISTORY
    // =====================
    async function loadHistory() {
        try {
            const res = await fetch(`${API_URL}/transactions`);
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
            const color = isRecharge ? 'var(--success)' : '#fff';
            const sign = isRecharge ? '+' : '-';
            tr.innerHTML = `
                <td>${date}</td>
                <td>${t.name}</td>
                <td>${t.matricula}</td>
                <td>${isRecharge ? 'Recarga' : 'Consumo'}</td>
                <td style="color: ${color}">${sign} R$ ${Math.abs(t.amount).toFixed(2).replace('.', ',')}</td>
            `;
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
            const res = await fetch(`${API_URL}/system/stock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ added_grams: grams, added_cost: isNaN(cost) ? 0 : cost })
            });
            if (res.ok) {
                showMessage(stockMsg, 'Estoque adicionado com sucesso!');
                addGramsInput.value = '';
                addCostInput.value = '';
                loadSystemState();
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
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
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
    //  GLOBAL HELPERS
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
            const res = await fetch(`${API_URL}/users/${id}`, { method: 'DELETE' });
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
