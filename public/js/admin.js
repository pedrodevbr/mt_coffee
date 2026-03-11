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

    const receiptsTbody = document.getElementById('receipts-tbody');
    const receiptsPendingBadge = document.getElementById('receipts-pending-badge');
    const approveReceiptModal = document.getElementById('approve-receipt-modal');
    const closeApproveModal = document.getElementById('close-approve-modal');
    const approveReceiptId = document.getElementById('approve-receipt-id');
    const approveUserName = document.getElementById('approve-user-name');
    const approveDeclaredAmount = document.getElementById('approve-declared-amount');
    const approveViewFile = document.getElementById('approve-view-file');
    const approveAmountInput = document.getElementById('approve-amount-input');
    const approveMsg = document.getElementById('approve-msg');
    const btnConfirmApprove = document.getElementById('btn-confirm-approve');
    const btnConfirmReject = document.getElementById('btn-confirm-reject');

    const txModal = document.getElementById('tx-modal');
    const closeTxModal = document.getElementById('close-tx-modal');
    const txEditId = document.getElementById('tx-edit-id');
    const txEditUser = document.getElementById('tx-edit-user');
    const txEditType = document.getElementById('tx-edit-type');
    const txEditAmount = document.getElementById('tx-edit-amount');
    const txEditTimestamp = document.getElementById('tx-edit-timestamp');
    const txEditMsg = document.getElementById('tx-edit-msg');
    const btnSaveTx = document.getElementById('btn-save-tx');
    const btnDeleteTx = document.getElementById('btn-delete-tx');

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
    let chartPrice = null;
    let chartUserWeekly = null;
    let chartBalance = null;

    // =====================
    //  INIT
    // =====================
    function initAdminPanel() {
        loadSystemState();
        loadUsers();
        loadHistory();
        loadStats();
        loadStockHistory();
        loadPriceHistory();
        loadBalanceCard();
        loadReceipts();
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
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Nenhuma remessa registrada ainda.</td></tr>';
                return;
            }
            tbody.innerHTML = rows.map(r => {
                const date = new Date(r.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
                const costPer = parseFloat(r.cost_per_kg).toFixed(2).replace('.', ',');
                const cost = parseFloat(r.added_cost).toFixed(2).replace('.', ',');
                const price = parseFloat(r.price_per_dose || 0).toFixed(3).replace('.', ',');
                return `<tr>
                    <td>${date}</td>
                    <td>${parseFloat(r.added_grams).toFixed(0)} g</td>
                    <td>R$ ${cost}</td>
                    <td>R$ ${costPer}</td>
                    <td>R$ ${price}</td>
                </tr>`;
            }).join('');
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--danger)">Erro ao carregar histórico</td></tr>';
        }
    }

    async function loadPriceHistory() {
        const canvas = document.getElementById('chart-price-history');
        if (!canvas) return;
        try {
            const res = await authFetch(`${API_URL}/admin/stock-history`);
            if (!res.ok) return;
            const rows = await res.json();
            if (rows.length === 0) return;

            const sorted = [...rows].reverse();
            const labels = sorted.map(r => new Date(r.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
            const prices = sorted.map(r => parseFloat(parseFloat(r.price_per_dose || 0).toFixed(4)));

            const gridColor = 'rgba(255,255,255,0.07)';
            const tickColor = '#94a3b8';
            const green = '#22c55e';

            if (chartPrice) chartPrice.destroy();
            chartPrice = new Chart(canvas, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        data: prices,
                        borderColor: green,
                        backgroundColor: `${green}22`,
                        borderWidth: 2,
                        pointBackgroundColor: green,
                        pointRadius: 4,
                        tension: 0.3,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: ctx => `R$ ${ctx.parsed.y.toFixed(3).replace('.', ',')}` } }
                    },
                    scales: {
                        x: { ticks: { color: tickColor, font: { size: 10 } }, grid: { color: gridColor } },
                        y: {
                            ticks: { color: tickColor, font: { size: 10 }, callback: v => `R$${v.toFixed(2)}` },
                            grid: { color: gridColor },
                            beginAtZero: false
                        }
                    }
                }
            });
        } catch (err) {
            console.error('Error loading price history:', err);
        }
    }

    async function loadBalanceCard() {
        try {
            const res = await authFetch(`${API_URL}/admin/stats/balance`);
            if (!res.ok) return;
            const d = await res.json();

            const fmt = v => parseFloat(v).toFixed(2).replace('.', ',');

            document.getElementById('bal-stock-cost').textContent = `R$ ${fmt(d.total_stock_cost)}`;
            document.getElementById('bal-remessas-count').textContent = `${d.total_remessas} remessa${d.total_remessas !== 1 ? 's' : ''}`;
            document.getElementById('bal-collected').textContent = `R$ ${fmt(d.total_recharged)}`;
            document.getElementById('bal-consumptions-count').textContent = `${d.total_recharges_count} recarga${d.total_recharges_count !== 1 ? 's' : ''}`;
            document.getElementById('bal-recharged').textContent = `R$ ${fmt(d.total_collected)}`;

            const balEl = document.getElementById('bal-balance');
            const bal = d.balance;
            balEl.textContent = `R$ ${fmt(Math.abs(bal))}`;
            balEl.style.color = bal >= 0 ? '#4ade80' : '#f87171';
            document.getElementById('bal-balance-label').textContent = bal >= 0 ? 'superávit' : 'déficit';

            if (d.total_stock_cost > 0) {
                const pct = Math.min(100, (d.total_recharged / d.total_stock_cost) * 100);
                document.getElementById('bal-coverage-pct').textContent = `${pct.toFixed(1)}%`;
                document.getElementById('bal-coverage-bar').style.width = `${pct}%`;
                document.getElementById('bal-coverage-bar').style.background =
                    pct >= 100 ? '#4ade80' : pct >= 70 ? '#f59e0b' : '#f87171';
                document.getElementById('bal-bar-wrap').style.display = 'block';
            }

            const gridColor = 'rgba(255,255,255,0.07)';
            const tickColor = '#94a3b8';
            const labels = d.weekly.map(r => 'Sem ' + r.label);
            const collected = d.weekly.map(r => parseFloat(r.collected));
            const cost = d.weekly.map(r => parseFloat(r.cost));

            if (chartBalance) chartBalance.destroy();
            chartBalance = new Chart(document.getElementById('chart-balance-weekly'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: 'Arrecadado', data: collected, backgroundColor: '#4ade8099', borderColor: '#4ade80', borderWidth: 2, borderRadius: 5 },
                        { label: 'Custo Remessa', data: cost,      backgroundColor: '#f8717199', borderColor: '#f87171', borderWidth: 2, borderRadius: 5 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: true, labels: { color: tickColor, font: { size: 11 }, boxWidth: 12 } },
                        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: R$ ${ctx.parsed.y.toFixed(2).replace('.', ',')}` } }
                    },
                    scales: {
                        x: { ticks: { color: tickColor, font: { size: 10 } }, grid: { color: gridColor } },
                        y: { ticks: { color: tickColor, font: { size: 10 }, callback: v => `R$${v.toFixed(0)}` }, grid: { color: gridColor }, beginAtZero: true }
                    }
                }
            });
        } catch (err) {
            console.error('Error loading balance card:', err);
        }
    }

    // =====================
    //  RECEIPTS
    // =====================
    let allReceipts = [];
    let currentReceiptFilter = 'pending';

    async function loadReceipts() {
        try {
            const res = await authFetch(`${API_URL}/admin/receipts`);
            if (!res.ok) return;
            allReceipts = await res.json();
            const pendingCount = allReceipts.filter(r => r.status === 'pending').length;
            if (pendingCount > 0) {
                receiptsPendingBadge.textContent = `${pendingCount} pendente${pendingCount > 1 ? 's' : ''}`;
                receiptsPendingBadge.style.display = 'inline-block';
            } else {
                receiptsPendingBadge.style.display = 'none';
            }
            renderReceipts(currentReceiptFilter);
        } catch (err) {
            receiptsTbody.innerHTML = '<tr><td colspan="6">Erro ao carregar comprovantes.</td></tr>';
        }
    }

    function renderReceipts(filter) {
        currentReceiptFilter = filter;
        const filtered = filter === 'all' ? allReceipts : allReceipts.filter(r => r.status === filter);
        if (filtered.length === 0) {
            receiptsTbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Nenhum comprovante ${filter === 'pending' ? 'pendente' : filter === 'approved' ? 'aprovado' : filter === 'rejected' ? 'rejeitado' : ''}.</td></tr>`;
            return;
        }
        const statusStyles = {
            pending: ['⏳ Pendente', '#f59e0b'],
            approved: ['✓ Aprovado', '#4ade80'],
            rejected: ['✗ Rejeitado', '#f87171']
        };
        receiptsTbody.innerHTML = filtered.map(r => {
            const [statusLabel, statusColor] = statusStyles[r.status] || ['--', '#fff'];
            const date = new Date(r.created_at).toLocaleDateString('pt-BR');
            const approvedAmt = r.amount_approved ? `<br><span style="font-size:0.78rem; color:#4ade80;">Aprovado: R$ ${parseFloat(r.amount_approved).toFixed(2).replace('.', ',')}</span>` : '';
            const noteCell = r.notes ? `<br><span style="font-size:0.78rem; color:#f87171;">${r.notes}</span>` : '';
            const reviewBtn = r.status === 'pending'
                ? `<button class="btn-review-receipt" data-id="${r.id}" data-user="${r.name}" data-amt="${r.amount_declared}" style="background:none; border:1px solid #f59e0b; color:#f59e0b; border-radius:6px; padding:3px 10px; cursor:pointer; font-size:0.8rem;">Revisar</button>`
                : '';
            return `<tr>
                <td>${date}</td>
                <td>${r.name}</td>
                <td>${r.matricula}</td>
                <td style="color:${statusColor}; font-weight:600;">${statusLabel}${approvedAmt}${noteCell}</td>
                <td>${reviewBtn}</td>
            </tr>`;
        }).join('');
        receiptsTbody.querySelectorAll('.btn-review-receipt').forEach(btn => {
            btn.addEventListener('click', () => openApproveModal(btn.dataset.id, btn.dataset.user, btn.dataset.amt));
        });
    }

    document.querySelectorAll('[data-filter]').forEach(btn => {
        btn.addEventListener('click', () => renderReceipts(btn.dataset.filter));
    });

    function openApproveModal(id, userName, declared) {
        approveReceiptId.value = id;
        approveUserName.textContent = userName;
        approveDeclaredAmount.textContent = `R$ ${parseFloat(declared).toFixed(2).replace('.', ',')}`;
        approveAmountInput.value = parseFloat(declared).toFixed(2);
        approveMsg.textContent = '';
        approveViewFile.href = `/api/admin/receipts/${id}/file?token=${getToken()}`;
        approveReceiptModal.classList.remove('hidden');
    }

    closeApproveModal.addEventListener('click', () => approveReceiptModal.classList.add('hidden'));
    approveReceiptModal.addEventListener('click', e => { if (e.target === approveReceiptModal) approveReceiptModal.classList.add('hidden'); });

    btnConfirmApprove.addEventListener('click', async () => {
        const id = approveReceiptId.value;
        const amount = parseFloat(approveAmountInput.value);
        if (isNaN(amount) || amount <= 0) {
            approveMsg.style.color = '#f87171';
            approveMsg.textContent = 'Informe um valor válido.';
            return;
        }
        btnConfirmApprove.disabled = true;
        btnConfirmApprove.textContent = 'Aprovando...';
        try {
            const res = await authFetch(`${API_URL}/admin/receipts/${id}/approve`, {
                method: 'PUT',
                headers: authHeaders(),
                body: JSON.stringify({ amount_approved: amount })
            });
            const data = await res.json();
            if (res.ok) {
                approveReceiptModal.classList.add('hidden');
                loadReceipts();
                loadUsers();
                loadBalanceCard();
            } else {
                approveMsg.style.color = '#f87171';
                approveMsg.textContent = data.error || 'Erro ao aprovar.';
            }
        } catch {
            approveMsg.style.color = '#f87171';
            approveMsg.textContent = 'Erro de conexão.';
        } finally {
            btnConfirmApprove.disabled = false;
            btnConfirmApprove.textContent = 'Confirmar Aprovação';
        }
    });

    btnConfirmReject.addEventListener('click', async () => {
        const notes = prompt('Motivo da rejeição (opcional):');
        if (notes === null) return;
        const id = approveReceiptId.value;
        try {
            const res = await authFetch(`${API_URL}/admin/receipts/${id}/reject`, {
                method: 'PUT',
                headers: authHeaders(),
                body: JSON.stringify({ notes: notes || null })
            });
            if (res.ok) {
                approveReceiptModal.classList.add('hidden');
                loadReceipts();
            }
        } catch {}
    });

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
        cachedUsers = users;
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
                    <button onclick="openUserSummary(${user.id})" style="padding: 4px 10px; font-size: 0.8rem; color: #a78bfa; cursor: pointer; background: transparent; border-radius: 6px; border: 1px solid #a78bfa; margin-right: 5px;">Ver</button>
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
            historyTbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Nenhuma transação registrada.</td></tr>';
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
                <td style="color: ${isRecharge ? 'var(--success)' : '#fff'}">${isRecharge ? '+' : '-'} R$ ${Math.abs(t.amount).toFixed(2).replace('.', ',')}</td>
                <td style="text-align:center;">
                    <button class="btn-edit-tx" data-id="${t.id}" data-user="${t.user_id}" data-type="${t.type}" data-amount="${Math.abs(t.amount)}" data-ts="${t.timestamp}" title="Editar" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:1rem;padding:2px 6px;border-radius:5px;transition:color .2s;">✏️</button>
                </td>`;
            historyTbody.appendChild(tr);
        });
        historyTbody.querySelectorAll('.btn-edit-tx').forEach(btn => {
            btn.addEventListener('click', () => openTxModal(btn.dataset));
        });
    }

    let cachedUsers = [];

    function openTxModal(data) {
        txEditId.value = data.id;
        txEditType.value = data.type;
        txEditAmount.value = parseFloat(data.amount).toFixed(2);
        const localDt = new Date(data.ts);
        localDt.setMinutes(localDt.getMinutes() - localDt.getTimezoneOffset());
        txEditTimestamp.value = localDt.toISOString().slice(0, 16);
        txEditMsg.textContent = '';

        txEditUser.innerHTML = '<option value="">Selecionar usuário...</option>';
        cachedUsers.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = `${u.name} (${u.matricula})`;
            if (String(u.id) === String(data.user)) opt.selected = true;
            txEditUser.appendChild(opt);
        });

        txModal.classList.remove('hidden');
    }

    closeTxModal.addEventListener('click', () => txModal.classList.add('hidden'));
    txModal.addEventListener('click', e => { if (e.target === txModal) txModal.classList.add('hidden'); });

    btnSaveTx.addEventListener('click', async () => {
        const id = txEditId.value;
        const user_id = txEditUser.value;
        const type = txEditType.value;
        const amount = parseFloat(txEditAmount.value);
        const timestamp = txEditTimestamp.value;
        if (!user_id || !timestamp || isNaN(amount) || amount <= 0) {
            txEditMsg.style.color = '#f87171';
            txEditMsg.textContent = 'Preencha todos os campos corretamente.';
            return;
        }
        btnSaveTx.disabled = true;
        btnSaveTx.textContent = 'Salvando...';
        try {
            const res = await authFetch(`${API_URL}/admin/transactions/${id}`, {
                method: 'PUT',
                headers: authHeaders(),
                body: JSON.stringify({ user_id: parseInt(user_id), type, amount, timestamp })
            });
            const data = await res.json();
            if (res.ok) {
                txModal.classList.add('hidden');
                loadHistory();
                loadUsers();
                loadBalanceCard();
            } else {
                txEditMsg.style.color = '#f87171';
                txEditMsg.textContent = data.error || 'Erro ao salvar.';
            }
        } catch {
            txEditMsg.style.color = '#f87171';
            txEditMsg.textContent = 'Erro de conexão.';
        } finally {
            btnSaveTx.disabled = false;
            btnSaveTx.textContent = 'Salvar';
        }
    });

    btnDeleteTx.addEventListener('click', async () => {
        if (!confirm('Excluir esta transação? O saldo do usuário será recalculado.')) return;
        const id = txEditId.value;
        btnDeleteTx.disabled = true;
        try {
            const res = await authFetch(`${API_URL}/admin/transactions/${id}`, { method: 'DELETE' });
            if (res.ok) {
                txModal.classList.add('hidden');
                loadHistory();
                loadUsers();
                loadBalanceCard();
            } else {
                const d = await res.json();
                txEditMsg.style.color = '#f87171';
                txEditMsg.textContent = d.error || 'Erro ao excluir.';
            }
        } catch {
            txEditMsg.style.color = '#f87171';
            txEditMsg.textContent = 'Erro de conexão.';
        } finally {
            btnDeleteTx.disabled = false;
        }
    });

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
                loadPriceHistory();
                loadBalanceCard();
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

    // =====================
    //  USER SUMMARY PANEL
    // =====================
    const summaryOverlay = document.getElementById('user-summary-overlay');
    const btnCloseSummary = document.getElementById('btn-close-summary');

    function openSummaryPanel() {
        summaryOverlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function closeSummaryPanel() {
        summaryOverlay.classList.remove('open');
        document.body.style.overflow = '';
    }

    if (btnCloseSummary) btnCloseSummary.addEventListener('click', closeSummaryPanel);
    if (summaryOverlay) summaryOverlay.addEventListener('click', e => { if (e.target === summaryOverlay) closeSummaryPanel(); });

    window.openUserSummary = async function (id) {
        document.getElementById('usr-name').textContent = '—';
        document.getElementById('usr-meta').textContent = '—';
        document.getElementById('usr-avatar').textContent = '…';
        document.getElementById('usr-balance').textContent = 'R$ —';
        document.getElementById('usr-last-tx').textContent = '—';
        document.getElementById('usr-total-cons').textContent = '—';
        document.getElementById('usr-total-val').textContent = '—';
        document.getElementById('usr-total-rec').textContent = '—';
        document.getElementById('usr-total-rec-val').textContent = '—';
        document.getElementById('usr-tx-list').innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Carregando...</p>';
        openSummaryPanel();

        try {
            const res = await authFetch(`${API_URL}/admin/users/${id}/summary`);
            if (!res.ok) { document.getElementById('usr-tx-list').innerHTML = '<p style="color:var(--danger)">Erro ao carregar dados.</p>'; return; }
            const data = await res.json();
            const { user, stats, weekly, recent_transactions } = data;

            const initials = user.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
            document.getElementById('usr-avatar').textContent = initials;
            document.getElementById('usr-name').textContent = user.name;
            document.getElementById('usr-meta').textContent = `Matrícula: ${user.matricula}`;
            document.getElementById('usr-balance').textContent = `R$ ${parseFloat(user.balance).toFixed(2).replace('.', ',')}`;

            const lastTx = stats.last_transaction
                ? new Date(stats.last_transaction).toLocaleDateString('pt-BR')
                : 'Nenhuma';
            document.getElementById('usr-last-tx').textContent = lastTx;

            document.getElementById('usr-total-cons').textContent = stats.total_consumptions;
            document.getElementById('usr-total-val').textContent = `R$ ${parseFloat(stats.total_consumed_value).toFixed(2).replace('.', ',')}`;
            document.getElementById('usr-total-rec').textContent = stats.total_recharges;
            document.getElementById('usr-total-rec-val').textContent = `R$ ${parseFloat(stats.total_recharged_value).toFixed(2).replace('.', ',')}`;

            const gridColor = 'rgba(255,255,255,0.07)';
            const tickColor = '#94a3b8';
            const amber = '#f59e0b';
            if (chartUserWeekly) chartUserWeekly.destroy();
            chartUserWeekly = new Chart(document.getElementById('chart-user-weekly'), {
                type: 'bar',
                data: {
                    labels: weekly.map(r => 'Sem ' + r.label),
                    datasets: [{ data: weekly.map(r => parseInt(r.count)), backgroundColor: `${amber}99`, borderColor: amber, borderWidth: 2, borderRadius: 5 }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} doses` } } },
                    scales: {
                        x: { ticks: { color: tickColor, font: { size: 9 } }, grid: { color: gridColor } },
                        y: { ticks: { color: tickColor, font: { size: 9 } }, grid: { color: gridColor }, beginAtZero: true }
                    }
                }
            });

            if (recent_transactions.length === 0) {
                document.getElementById('usr-tx-list').innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Sem transações registradas.</p>';
            } else {
                document.getElementById('usr-tx-list').innerHTML = recent_transactions.map(tx => {
                    const isConsumption = tx.type === 'consumption';
                    const sign = isConsumption ? '−' : '+';
                    const cls = isConsumption ? 'tx-type-consumption' : 'tx-type-recharge';
                    const label = isConsumption ? 'Consumo' : 'Recarga';
                    const date = new Date(tx.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
                    return `<div class="usr-tx-row">
                        <div>
                            <span class="${cls}">${label}</span>
                            <div class="usr-tx-date">${date}</div>
                        </div>
                        <span class="${cls}" style="font-weight:600;">${sign} R$ ${Math.abs(parseFloat(tx.amount)).toFixed(2).replace('.', ',')}</span>
                    </div>`;
                }).join('');
            }
        } catch (err) {
            document.getElementById('usr-tx-list').innerHTML = '<p style="color:var(--danger)">Erro de conexão.</p>';
        }
    };

    function showMessage(element, text, isError = false) {
        element.textContent = text;
        element.style.color = isError ? 'var(--danger)' : 'var(--success)';
        setTimeout(() => element.textContent = '', 4000);
    }
});
