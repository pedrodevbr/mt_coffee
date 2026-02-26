document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'http://localhost:3000/api';

    // Elements
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

    const usersTbody = document.getElementById('users-tbody');
    const btnNewUser = document.getElementById('btn-new-user');

    const historyTbody = document.getElementById('history-tbody');

    // User Modal
    const userModal = document.getElementById('user-modal');
    const closeUserModal = document.getElementById('close-user-modal');
    const newUserName = document.getElementById('new-user-name');
    const newUserMatricula = document.getElementById('new-user-matricula');
    const btnSaveUser = document.getElementById('btn-save-user');
    const userMsg = document.getElementById('user-msg');
    const userModalTitle = document.getElementById('user-modal-title');
    const editUserId = document.getElementById('edit-user-id');
    const newUserBalance = document.getElementById('new-user-balance');

    // Init
    loadSystemState();
    loadUsers();
    loadHistory();

    // Events
    btnAddStock.addEventListener('click', handleAddStock);
    btnUploadQr.addEventListener('click', handleUploadQr);

    // User Modal Events
    btnNewUser.addEventListener('click', () => {
        userModalTitle.textContent = 'Novo Usuário';
        editUserId.value = '';
        newUserName.value = '';
        newUserMatricula.value = '';
        newUserBalance.value = '0';
        userMsg.textContent = '';
        userModal.classList.remove('hidden');
    });

    closeUserModal.addEventListener('click', () => {
        userModal.classList.add('hidden');
    });

    btnSaveUser.addEventListener('click', handleSaveUser);


    // Functions
    async function loadSystemState() {
        try {
            const res = await fetch(`${API_URL}/system`);
            if (res.ok) {
                const state = await res.json();
                adminCurrentStock.textContent = `${state.coffee_stock_grams.toFixed(0)} g`;
                adminDosePrice.textContent = `R$ ${state.current_price_per_dose.toFixed(2).replace('.', ',')}`;
                if (state.qr_code_url) {
                    qrPreview.src = state.qr_code_url;
                }
            }
        } catch (error) {
            console.error('Error loading state:', error);
        }
    }

    async function loadUsers() {
        try {
            const res = await fetch(`${API_URL}/users`);
            if (res.ok) {
                const users = await res.json();
                renderUsers(users);
            }
        } catch (error) {
            console.error('Error loading users:', error);
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
                <td>R$ ${user.balance.toFixed(2).replace('.', ',')}</td>
                <td>
                    <button class="btn-outline" onclick="editUser(${user.id}, '${user.name.replace(/'/g, "\\'")}', '${user.matricula}', ${user.balance})" style="padding: 5px 10px; font-size: 0.8rem; border-color: var(--secondary-color); color: var(--secondary-color); margin-right: 5px;">Editar</button>
                    <button class="btn-outline" onclick="deleteUser(${user.id})" style="padding: 5px 10px; font-size: 0.8rem; border-color: var(--danger); color: var(--danger);">Excluir</button>
                </td>
            `;
            usersTbody.appendChild(tr);
        });
    }

    async function loadHistory() {
        try {
            const res = await fetch(`${API_URL}/transactions`);
            if (res.ok) {
                const transactions = await res.json();
                renderHistory(transactions);
            }
        } catch (error) {
            console.error('Error loading history:', error);
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
            const typeStr = isRecharge ? 'Recarga' : 'Consumo';
            const color = isRecharge ? 'var(--success)' : '#fff';
            const sign = isRecharge ? '+' : '-';

            tr.innerHTML = `
                <td>${date}</td>
                <td>${t.name}</td>
                <td>${t.matricula}</td>
                <td>${typeStr}</td>
                <td style="color: ${color}">${sign} R$ ${Math.abs(t.amount).toFixed(2).replace('.', ',')}</td>
            `;
            historyTbody.appendChild(tr);
        });
    }

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
            if (res.ok) {
                loadUsers();
            } else {
                alert('Erro ao excluir usuário');
            }
        } catch (error) {
            alert('Erro de conexão');
        }
    };

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

            const data = await res.json();
            if (res.ok) {
                showMessage(stockMsg, 'Estoque adicionado com sucesso!');
                addGramsInput.value = '';
                addCostInput.value = '';
                loadSystemState();
            } else {
                showMessage(stockMsg, data.error || 'Erro ao adicionar', true);
            }
        } catch (error) {
            showMessage(stockMsg, 'Erro de conexão', true);
        } finally {
            btnAddStock.disabled = false;
            btnAddStock.textContent = 'Adicionar ao Estoque';
        }
    }

    async function handleUploadQr() {
        const file = qrFileInput.files[0];
        if (!file) {
            showMessage(qrMsg, 'Selecione uma imagem primeiro.', true);
            return;
        }

        const formData = new FormData();
        formData.append('qr_image', file);

        btnUploadQr.disabled = true;
        btnUploadQr.textContent = 'Enviando...';

        try {
            const res = await fetch(`${API_URL}/system/qr`, {
                method: 'POST',
                body: formData
            });

            const data = await res.json();
            if (res.ok) {
                showMessage(qrMsg, 'QR Code salvo!');
                qrFileInput.value = '';
                loadSystemState();
            } else {
                showMessage(qrMsg, data.error || 'Erro no upload', true);
            }
        } catch (error) {
            showMessage(qrMsg, 'Erro de conexão', true);
        } finally {
            btnUploadQr.disabled = false;
            btnUploadQr.textContent = 'Salvar QR Code';
        }
    }

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

            const data = await res.json();
            if (res.ok) {
                showMessage(userMsg, id ? 'Usuário atualizado!' : 'Usuário cadastrado!');
                setTimeout(() => {
                    userModal.classList.add('hidden');
                    loadUsers();
                }, 1000);
            } else {
                showMessage(userMsg, data.error || 'Erro ao salvar', true);
            }
        } catch (error) {
            showMessage(userMsg, 'Erro de conexão', true);
        } finally {
            btnSaveUser.disabled = false;
        }
    }

    function showMessage(element, text, isError = false) {
        element.textContent = text;
        element.style.color = isError ? 'var(--danger)' : 'var(--success)';
        setTimeout(() => element.textContent = '', 4000);
    }
});
