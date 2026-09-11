/**
 * TelecomStock Pro — Frontend JS
 * PWA + Auth JWT + XSS-safe rendering
 */
const API = '/api';
let token = localStorage.getItem('ts_token') || null;
let currentUser = null;
let products = [], categories = [], customers = [], suppliers = [], sales = [], credits = [], saleItems = [];

// ===================== API =====================

async function api(endpoint, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(API + endpoint, { headers, ...options });
    if (res.status === 401) { logout(); throw new Error('Session expirée'); }
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erreur réseau' }));
        throw new Error(err.error || 'Erreur inconnue');
    }
    return res.json();
}

// ===================== AUTH =====================

async function login() {
    const btn = document.getElementById('loginBtn');
    const errDiv = document.getElementById('loginError');
    btn.disabled = true; btn.textContent = 'Connexion...';
    errDiv.style.display = 'none';
    try {
        const data = await api('/login', {
            method: 'POST',
            body: JSON.stringify({
                username: document.getElementById('loginUser').value.trim(),
                password: document.getElementById('loginPass').value
            })
        });
        token = data.token;
        currentUser = data.user;
        localStorage.setItem('ts_token', token);
        localStorage.setItem('ts_user', JSON.stringify(currentUser));
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        await loadDashboard();
        showToast('Bienvenue ! 👋');
    } catch (e) {
        errDiv.textContent = e.message;
        errDiv.style.display = 'block';
    } finally {
        btn.disabled = false; btn.textContent = 'Se connecter';
    }
}

function logout() {
    token = null; currentUser = null;
    localStorage.removeItem('ts_token');
    localStorage.removeItem('ts_user');
    location.reload();
}

async function checkAuth() {
    if (!token) return;
    try {
        const data = await api('/auth/check');
        currentUser = data.user;
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        await loadDashboard();
    } catch (e) { logout(); }
}

// ===================== UTILS =====================

function showToast(msg, type = '') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('show'); }, 10);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
}

function formatMoney(amount) {
    return Math.round(amount || 0).toLocaleString('fr-FR') + ' F';
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const page = document.getElementById(pageId);
    if (page) page.classList.add('active');
    const nav = document.querySelector(`.nav-item[data-page="${pageId}"]`);
    if (nav) nav.classList.add('active');
    const titles = {
        dashboard: 'Tableau de bord', products: 'Produits', stock: 'Gestion du stock',
        sales: 'Ventes', customers: 'Clients', credits: 'Crédits',
        suppliers: 'Fournisseurs', reports: 'Rapports', settings: 'Paramètres'
    };
    document.getElementById('pageTitle').textContent = titles[pageId] || pageId;
    if (pageId === 'dashboard') loadDashboard();
    if (pageId === 'products') loadProducts();
    if (pageId === 'stock') loadStock();
    if (pageId === 'sales') loadSales();
    if (pageId === 'customers') loadCustomers();
    if (pageId === 'credits') loadCredits();
    if (pageId === 'suppliers') loadSuppliers();
    if (pageId === 'reports') loadReports();
    if (pageId === 'settings') loadSettings();
    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
}

function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
document.querySelectorAll('.modal-overlay').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('show'); }));

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

async function refreshAll() {
    showPage(document.querySelector('.page.active').id);
}

// ===================== DASHBOARD =====================

async function loadDashboard() {
    try {
        const d = await api('/dashboard');
        document.getElementById('statStock').textContent = d.totalStock.toLocaleString();
        document.getElementById('statTodaySales').textContent = formatMoney(d.todaySales);
        document.getElementById('statLowStock').textContent = d.lowStock;
        document.getElementById('statImeis').textContent = d.totalImeis;

        const salesRows = (d.recentSales || []).map(s => `
            <tr><td>#V-${s.id}</td><td>${escapeHtml(s.customer_name || 'Anonyme')}</td><td><strong>${formatMoney(s.total)}</strong></td>
            <td><span class="badge ${s.payment_method === 'cash' ? 'badge-success' : s.payment_method === 'credit' ? 'badge-info' : 'badge-warning'}">${escapeHtml(s.payment_method)}</span></td>
            <td>${formatDate(s.created_at)}</td></tr>
        `).join('');
        document.getElementById('recentSalesTable').innerHTML = salesRows || '<tr class="empty-row"><td colspan="5">Aucune vente</td></tr>';

        const alertsHtml = (d.lowStockProducts || []).map(p => `
            <div class="alert-item">
                <span class="alert-name">${escapeHtml(p.name)}</span>
                <span class="badge ${p.stock === 0 ? 'badge-danger' : 'badge-warning'}">${p.stock}</span>
            </div>
        `).join('');
        document.getElementById('lowStockAlerts').innerHTML = alertsHtml || '<div class="empty-state"><div class="empty-state-icon">✅</div><p>Aucune alerte</p></div>';
    } catch (e) { showToast(e.message, 'error'); }
}

// ===================== PRODUCTS =====================

async function loadProducts() {
    try {
        products = await api('/products');
        categories = await api('/categories');
        document.getElementById('productsCount').textContent = `${products.length} produits`;
        document.getElementById('productCategory').innerHTML = categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
        document.getElementById('filterCategory').innerHTML = '<option value="">Toutes catégories</option>' + categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
        renderProducts(products);
    } catch (e) { showToast(e.message, 'error'); }
}

function renderProducts(p) {
    const rows = p.map(x => `
        <tr><td><strong>${escapeHtml(x.reference)}</strong></td><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.category_name || '-')}</td>
        <td>${formatMoney(x.purchase_price)}</td><td><strong>${formatMoney(x.sale_price)}</strong></td>
        <td><span class="badge ${x.stock <= x.min_stock ? (x.stock === 0 ? 'badge-danger' : 'badge-warning') : 'badge-success'}">${x.stock}</span></td>
        <td>${x.has_imei ? '✅' : '❌'}</td>
        <td><button class="btn btn-outline btn-sm" onclick="editProduct(${x.id})">✏️</button> <button class="btn btn-danger btn-sm" onclick="deleteProduct(${x.id})">🗑️</button></td></tr>
    `).join('');
    document.getElementById('productsTable').innerHTML = rows || '<tr class="empty-row"><td colspan="8">Aucun produit</td></tr>';
}

function filterProducts() {
    const q = document.getElementById('searchProducts').value.toLowerCase();
    const cat = document.getElementById('filterCategory').value;
    let filtered = products.filter(p => p.name.toLowerCase().includes(q) || p.reference.toLowerCase().includes(q));
    if (cat) filtered = filtered.filter(p => p.category_id == cat);
    renderProducts(filtered);
}

function openProductModal(p = null) {
    document.getElementById('productModalTitle').textContent = p ? '✏️ Modifier le produit' : '📦 Nouveau produit';
    document.getElementById('productId').value = p?.id || '';
    document.getElementById('productRef').value = p?.reference || '';
    document.getElementById('productName').value = p?.name || '';
    document.getElementById('productCategory').value = p?.category_id || '';
    document.getElementById('productImei').value = p?.has_imei ? '1' : '0';
    document.getElementById('productPurchasePrice').value = p?.purchase_price || '';
    document.getElementById('productSalePrice').value = p?.sale_price || '';
    document.getElementById('productStock').value = p?.stock || '';
    document.getElementById('productMinStock').value = p?.min_stock || '5';
    openModal('productModal');
}

function editProduct(id) { openProductModal(products.find(p => p.id === id)); }

async function saveProduct() {
    const id = document.getElementById('productId').value;
    const data = {
        reference: document.getElementById('productRef').value.trim(),
        name: document.getElementById('productName').value.trim(),
        category_id: document.getElementById('productCategory').value || null,
        has_imei: document.getElementById('productImei').value === '1',
        purchase_price: parseFloat(document.getElementById('productPurchasePrice').value) || 0,
        sale_price: parseFloat(document.getElementById('productSalePrice').value) || 0,
        stock: parseInt(document.getElementById('productStock').value) || 0,
        min_stock: parseInt(document.getElementById('productMinStock').value) || 5
    };
    if (!data.reference || !data.name) return showToast('Champs obligatoires', 'error');
    try {
        if (id) { await api('/products/' + id, { method: 'PUT', body: JSON.stringify(data) }); showToast('Produit modifié !'); }
        else { await api('/products', { method: 'POST', body: JSON.stringify(data) }); showToast('Produit ajouté !'); }
        closeModal('productModal'); loadProducts();
    } catch (e) { showToast(e.message, 'error'); }
}

async function deleteProduct(id) {
    if (!confirm('Supprimer ce produit ?')) return;
    try { await api('/products/' + id, { method: 'DELETE' }); showToast('Produit supprimé'); loadProducts(); }
    catch (e) { showToast(e.message, 'error'); }
}

// ===================== STOCK =====================

async function loadStock() {
    try {
        const [movements, productsData, supps] = await Promise.all([api('/stock-movements'), api('/products'), api('/suppliers')]);
        products = productsData; suppliers = supps;
        document.getElementById('stockTotalProducts').textContent = products.length;
        document.getElementById('stockValue').textContent = formatMoney(products.reduce((s, p) => s + (p.stock * p.purchase_price), 0));
        document.getElementById('stockLow').textContent = products.filter(p => p.stock <= p.min_stock && p.stock > 0).length;
        document.getElementById('stockOut').textContent = products.filter(p => p.stock === 0).length;
        document.getElementById('stockProduct').innerHTML = products.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${p.stock})</option>`).join('');
        document.getElementById('stockSupplier').innerHTML = '<option value="">-- Aucun --</option>' + suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
        const rows = movements.map(m => `
            <tr><td>${formatDate(m.created_at)}</td><td><span class="badge ${m.type === 'entry' ? 'badge-success' : m.type === 'exit' ? 'badge-danger' : 'badge-warning'}">${m.type === 'entry' ? 'Entrée' : m.type === 'exit' ? 'Sortie' : 'Ajustement'}</span></td>
            <td>${escapeHtml(m.product_name)}</td><td>${m.type === 'entry' ? '+' : '-'}${m.quantity}</td><td>${escapeHtml(m.reason || '-')}</td><td>${escapeHtml(m.supplier_name || '-')}</td></tr>
        `).join('');
        document.getElementById('stockMovementsTable').innerHTML = rows || '<tr class="empty-row"><td colspan="6">Aucun mouvement</td></tr>';
    } catch (e) { showToast(e.message, 'error'); }
}

function openStockModal(type) {
    document.getElementById('stockModalTitle').textContent = type === 'entry' ? '📥 Entrée de stock' : type === 'exit' ? '📤 Sortie de stock' : '🔧 Ajustement';
    document.getElementById('stockMovementType').value = type;
    document.getElementById('stockQuantity').value = '1';
    document.getElementById('stockReason').value = '';
    openModal('stockModal');
}

async function saveStockMovement() {
    const data = {
        product_id: parseInt(document.getElementById('stockProduct').value),
        type: document.getElementById('stockMovementType').value,
        quantity: parseInt(document.getElementById('stockQuantity').value),
        reason: document.getElementById('stockReason').value.trim(),
        supplier_id: parseInt(document.getElementById('stockSupplier').value) || null
    };
    if (!data.product_id || !data.quantity) return showToast('Champs obligatoires', 'error');
    try {
        const result = await api('/stock-movements', { method: 'POST', body: JSON.stringify(data) });
        showToast(`Mouvement enregistré ! Stock: ${result.newStock}`);
        closeModal('stockModal'); loadStock();
    } catch (e) { showToast(e.message, 'error'); }
}

// ===================== SALES =====================

async function loadSales() {
    try {
        sales = await api('/sales');
        customers = await api('/customers');
        products = await api('/products');
        credits = await api('/credits');
        renderKPIs();
        renderSales(sales);
    } catch (e) { showToast(e.message, 'error'); }
}

function renderKPIs() {
    const today = new Date().toISOString().split('T')[0];
    const todaySales = sales.filter(s => s.created_at.startsWith(today));
    document.getElementById('salesTodayCount').textContent = todaySales.length;
    document.getElementById('salesTodayTotal').textContent = formatMoney(todaySales.reduce((s, x) => s + x.total, 0));
    const monthStart = today.substring(0, 7);
    document.getElementById('salesMonth').textContent = formatMoney(sales.filter(s => s.created_at.startsWith(monthStart)).reduce((s, x) => s + x.total, 0));
    document.getElementById('salesCredits').textContent = formatMoney(credits.filter(c => c.status !== 'paid').reduce((s, c) => s + (c.amount - c.paid), 0));
}

function renderSales(salesToRender) {
    const rows = salesToRender.map(s => `
        <tr><td><strong>#V-${s.id}</strong></td><td>${escapeHtml(s.customer_name || 'Anonyme')}</td><td><strong>${formatMoney(s.total)}</strong></td>
        <td><span class="badge ${s.payment_method === 'cash' ? 'badge-success' : s.payment_method === 'credit' ? 'badge-info' : 'badge-warning'}">${escapeHtml(s.payment_method)}</span></td>
        <td>${formatDate(s.created_at)}</td><td><button class="btn btn-outline btn-sm" onclick="viewReceipt(${s.id})">🧾</button></td></tr>
    `).join('');
    document.getElementById('salesTable').innerHTML = rows || '<tr class="empty-row"><td colspan="6">Aucune vente</td></tr>';
}

function filterSalesByDate() {
    const filter = document.getElementById('salesDateFilter').value;
    const today = new Date();
    let filtered = sales;
    if (filter === 'today') filtered = sales.filter(s => s.created_at.startsWith(today.toISOString().split('T')[0]));
    else if (filter === 'week') filtered = sales.filter(s => new Date(s.created_at) >= new Date(today.getTime() - 7 * 86400000));
    else if (filter === 'month') filtered = sales.filter(s => s.created_at.startsWith(today.toISOString().substring(0, 7)));
    renderSales(filtered);
}

function openSaleModal() {
    saleItems = [];
    document.getElementById('saleCustomer').innerHTML = '<option value="">--- Client anonyme ---</option>' + customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    document.getElementById('saleProduct').innerHTML = '<option value="">-- Cliquez pour ajouter --</option>' + products.filter(p => p.stock > 0).map(p => `<option value="${p.id}" data-price="${p.sale_price}" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)} - ${formatMoney(p.sale_price)}</option>`).join('');
    document.getElementById('saleItems').innerHTML = '';
    document.getElementById('saleTotal').textContent = '0 F';
    openModal('saleModal');
}

function addSaleItem() {
    const sel = document.getElementById('saleProduct');
    const id = parseInt(sel.value);
    if (!id) return;
    const opt = sel.selectedOptions[0];
    const existing = saleItems.find(i => i.product_id === id);
    if (existing) { existing.quantity++; }
    else saleItems.push({ product_id: id, name: opt.dataset.name, price: parseFloat(opt.dataset.price), quantity: 1 });
    renderSaleItems();
    sel.value = '';
}

function removeSaleItem(idx) { saleItems.splice(idx, 1); renderSaleItems(); }
function updateItemPrice(idx, val) { saleItems[idx].price = parseFloat(val) || 0; calculateSaleTotal(); }
function updateItemQty(idx, val) { saleItems[idx].quantity = parseInt(val) || 1; calculateSaleTotal(); }

function renderSaleItems() {
    document.getElementById('saleItems').innerHTML = saleItems.map((item, i) => `
        <div class="sale-item">
            <span style="flex:1">${escapeHtml(item.name)}</span>
            <input type="number" value="${item.quantity}" min="1" onchange="updateItemQty(${i}, this.value)" style="width:60px">
            <input type="number" value="${item.price}" onchange="updateItemPrice(${i}, this.value)" style="width:100px">
            <span style="font-weight:600;min-width:80px;text-align:right">${formatMoney(item.price * item.quantity)}</span>
            <button onclick="removeSaleItem(${i})" class="btn btn-danger btn-sm">×</button>
        </div>
    `).join('');
    calculateSaleTotal();
}

function calculateSaleTotal() {
    let total = saleItems.reduce((s, i) => s + (i.price * i.quantity), 0);
    const discount = parseFloat(document.getElementById('saleDiscount').value) || 0;
    total = total - (total * discount / 100);
    document.getElementById('saleTotal').textContent = formatMoney(total);
}

async function saveSale() {
    if (!saleItems.length) return showToast('Ajoutez au moins un produit', 'error');
    const data = {
        customer_id: document.getElementById('saleCustomer').value || null,
        payment_method: document.getElementById('salePayment').value,
        items: saleItems.map(i => ({ product_id: i.product_id, quantity: i.quantity })),
        discount: parseFloat(document.getElementById('saleDiscount').value) || 0
    };
    try {
        const result = await api('/sales', { method: 'POST', body: JSON.stringify(data) });
        showToast(`Vente #${result.id} enregistrée !`);
        closeModal('saleModal'); loadSales(); loadDashboard();
    } catch (e) { showToast(e.message, 'error'); }
}

async function viewReceipt(saleId) {
    try {
        const sale = await api('/sales/' + saleId);
        const settings = await api('/settings');
        let itemsHtml = (sale.items || []).map(i => `<tr><td>${escapeHtml(i.product_name)}</td><td>${i.quantity}</td><td>${formatMoney(i.unit_price)}</td><td>${formatMoney(i.unit_price * i.quantity)}</td></tr>`).join('');
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html><head><title>Reçu #V-${sale.id}</title>
            <style>body{font-family:monospace,sans-serif;max-width:300px;margin:20px auto;font-size:12px}
            h2{text-align:center;margin:0}hr{border-style:dashed;margin:10px 0}
            table{width:100%;border-collapse:collapse}td{padding:2px}
            .total{font-size:16px;font-weight:bold;text-align:right;margin-top:10px}
            @media print{button{display:none}}</style></head>
            <body>
            <h2>📱 ${escapeHtml(settings.store_name || 'TelecomStock')}</h2>
            <p style="text-align:center;font-size:11px">${escapeHtml(settings.store_address || '')}<br>${escapeHtml(settings.store_phone || '')}</p>
            <hr><p><strong>Reçu #V-${sale.id}</strong></p>
            <p>Date: ${formatDate(sale.created_at)}</p>
            <p>Client: ${escapeHtml(sale.customer_name || 'Anonyme')}</p>
            <hr>
            <table><thead><tr><th>Prod</th><th>Qté</th><th>Prix</th><th>Total</th></tr></thead><tbody>${itemsHtml}</tbody></table>
            <hr>
            <div class="total">TOTAL: ${formatMoney(sale.total)}</div>
            <p>Paiement: ${escapeHtml(sale.payment_method)}</p>
            <hr><p style="text-align:center;font-size:11px">Merci de votre achat ! 🙏</p>
            <button onclick="window.print()" style="width:100%;padding:10px;margin-top:10px;cursor:pointer">🖨️ Imprimer</button>
            </body></html>
        `);
    } catch (e) { showToast(e.message, 'error'); }
}

// ===================== CUSTOMERS =====================

async function loadCustomers() {
    try {
        customers = await api('/customers');
        renderCustomers(customers);
    } catch (e) { showToast(e.message, 'error'); }
}

function renderCustomers(c) {
    const rows = c.map(x => `
        <tr><td>CL-${String(x.id).padStart(3, '0')}</td><td><strong>${escapeHtml(x.name)}</strong></td><td>${escapeHtml(x.phone || '-')}</td>
        <td>${x.purchase_count || 0}</td><td><strong>${formatMoney(x.total_purchases)}</strong></td>
        <td>${formatMoney(x.total_credit || 0)}</td>
        <td><button class="btn btn-outline btn-sm" onclick="editCustomer(${x.id})">✏️</button> <button class="btn btn-danger btn-sm" onclick="deleteCustomer(${x.id})">🗑️</button></td></tr>
    `).join('');
    document.getElementById('customersTable').innerHTML = rows || '<tr class="empty-row"><td colspan="7">Aucun client</td></tr>';
}

function filterCustomers() {
    const q = document.getElementById('searchCustomers').value.toLowerCase();
    renderCustomers(customers.filter(c => c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q))));
}

function openCustomerModal(c = null) {
    document.getElementById('customerModalTitle').textContent = c ? '✏️ Modifier le client' : '👤 Nouveau client';
    document.getElementById('customerId').value = c?.id || '';
    document.getElementById('customerName').value = c?.name || '';
    document.getElementById('customerPhone').value = c?.phone || '';
    document.getElementById('customerEmail').value = c?.email || '';
    document.getElementById('customerAddress').value = c?.address || '';
    openModal('customerModal');
}

function editCustomer(id) { openCustomerModal(customers.find(c => c.id === id)); }

async function saveCustomer() {
    const id = document.getElementById('customerId').value;
    const data = { name: document.getElementById('customerName').value.trim(), phone: document.getElementById('customerPhone').value.trim(), email: document.getElementById('customerEmail').value.trim(), address: document.getElementById('customerAddress').value.trim() };
    if (!data.name) return showToast('Le nom est obligatoire', 'error');
    try {
        if (id) { await api('/customers/' + id, { method: 'PUT', body: JSON.stringify(data) }); showToast('Client modifié !'); }
        else { await api('/customers', { method: 'POST', body: JSON.stringify(data) }); showToast('Client ajouté !'); }
        closeModal('customerModal'); loadCustomers();
    } catch (e) { showToast(e.message, 'error'); }
}

async function deleteCustomer(id) {
    if (!confirm('Supprimer ce client ?')) return;
    try { await api('/customers/' + id, { method: 'DELETE' }); showToast('Client supprimé'); loadCustomers(); }
    catch (e) { showToast(e.message, 'error'); }
}

// ===================== SUPPLIERS =====================

async function loadSuppliers() {
    try {
        suppliers = await api('/suppliers');
        const rows = suppliers.map(s => `
            <tr><td>FRN-${String(s.id).padStart(3, '0')}</td><td><strong>${escapeHtml(s.name)}</strong></td><td>${escapeHtml(s.phone || '-')}</td>
            <td>${escapeHtml(s.email || '-')}</td><td>${escapeHtml(s.products || '-')}</td>
            <td><button class="btn btn-outline btn-sm" onclick="editSupplier(${s.id})">✏️</button> <button class="btn btn-danger btn-sm" onclick="deleteSupplier(${s.id})">🗑️</button></td></tr>
        `).join('');
        document.getElementById('suppliersTable').innerHTML = rows || '<tr class="empty-row"><td colspan="6">Aucun fournisseur</td></tr>';
    } catch (e) { showToast(e.message, 'error'); }
}

function openSupplierModal(s = null) {
    document.getElementById('supplierModalTitle').textContent = s ? '✏️ Modifier le fournisseur' : '🚚 Nouveau fournisseur';
    document.getElementById('supplierId').value = s?.id || '';
    document.getElementById('supplierName').value = s?.name || '';
    document.getElementById('supplierPhone').value = s?.phone || '';
    document.getElementById('supplierEmail').value = s?.email || '';
    document.getElementById('supplierProducts').value = s?.products || '';
    openModal('supplierModal');
}

function editSupplier(id) { openSupplierModal(suppliers.find(s => s.id === id)); }

async function saveSupplier() {
    const id = document.getElementById('supplierId').value;
    const data = { name: document.getElementById('supplierName').value.trim(), phone: document.getElementById('supplierPhone').value.trim(), email: document.getElementById('supplierEmail').value.trim(), products: document.getElementById('supplierProducts').value.trim() };
    if (!data.name) return showToast('Le nom est obligatoire', 'error');
    try {
        if (id) { await api('/suppliers/' + id, { method: 'PUT', body: JSON.stringify(data) }); showToast('Fournisseur modifié !'); }
        else { await api('/suppliers', { method: 'POST', body: JSON.stringify(data) }); showToast('Fournisseur ajouté !'); }
        closeModal('supplierModal'); loadSuppliers();
    } catch (e) { showToast(e.message, 'error'); }
}

async function deleteSupplier(id) {
    if (!confirm('Supprimer ce fournisseur ?')) return;
    try { await api('/suppliers/' + id, { method: 'DELETE' }); showToast('Fournisseur supprimé'); loadSuppliers(); }
    catch (e) { showToast(e.message, 'error'); }
}

// ===================== CREDITS =====================

async function loadCredits() {
    try {
        const status = document.getElementById('creditsFilter').value;
        credits = await api('/credits' + (status ? `?status=${status}` : ''));
        const rows = credits.map(c => `
            <tr><td>${escapeHtml(c.customer_name)}</td><td>${formatMoney(c.amount)}</td><td>${formatMoney(c.paid)}</td>
            <td><strong>${formatMoney(c.amount - c.paid)}</strong></td>
            <td><span class="badge ${c.status === 'paid' ? 'badge-success' : c.status === 'unpaid' ? 'badge-danger' : 'badge-warning'}">${escapeHtml(c.status)}</span></td>
            <td>${c.status !== 'paid' ? `<button class="btn btn-sm btn-primary" onclick="openCreditPayModal(${c.id})">💰 Payer</button>` : '-'}</td></tr>
        `).join('');
        document.getElementById('creditsTable').innerHTML = rows || '<tr class="empty-row"><td colspan="6">Aucun crédit</td></tr>';
    } catch (e) { showToast(e.message, 'error'); }
}

function openCreditPayModal(creditId) {
    const credit = credits.find(c => c.id === creditId);
    if (!credit) return;
    document.getElementById('creditId').value = credit.id;
    document.getElementById('creditCustomerName').value = credit.customer_name;
    document.getElementById('creditAmountDue').value = credit.amount - credit.paid;
    document.getElementById('creditPaymentAmount').value = '';
    openModal('creditPayModal');
}

async function payCredit() {
    const creditId = document.getElementById('creditId').value;
    const amount = parseFloat(document.getElementById('creditPaymentAmount').value);
    if (!amount || amount <= 0) return showToast('Montant invalide', 'error');
    try {
        await api('/credits/pay', { method: 'POST', body: JSON.stringify({ credit_id: parseInt(creditId), amount }) });
        closeModal('creditPayModal'); showToast('Paiement enregistré !'); loadCredits(); loadCustomers();
    } catch (e) { showToast(e.message, 'error'); }
}

// ===================== REPORTS =====================

async function loadReports() {
    try {
        const d = await api('/reports/profit');
        document.getElementById('reportRevenue').textContent = formatMoney(d.totalRevenue);
        document.getElementById('reportCost').textContent = formatMoney(d.totalCost);
        document.getElementById('reportProfit').textContent = formatMoney(d.totalProfit);
        document.getElementById('reportProducts').textContent = d.items.reduce((s, i) => s + i.qty_sold, 0);
        const rows = d.items.map(i => `
            <tr><td><strong>${escapeHtml(i.name)}</strong></td><td>${i.qty_sold}</td><td>${formatMoney(i.revenue)}</td><td>${formatMoney(i.cost)}</td>
            <td style="font-weight:600;color:${i.profit >= 0 ? 'var(--success)' : 'var(--danger)'}">${formatMoney(i.profit)}</td></tr>
        `).join('');
        document.getElementById('profitTable').innerHTML = rows || '<tr class="empty-row"><td colspan="5">Aucune donnée</td></tr>';
    } catch (e) { showToast(e.message, 'error'); }
}

// ===================== SETTINGS =====================

async function loadSettings() {
    try {
        const s = await api('/settings');
        document.getElementById('settingStoreName').value = s.store_name || '';
        document.getElementById('settingStoreAddress').value = s.store_address || '';
        document.getElementById('settingStorePhone').value = s.store_phone || '';
        document.getElementById('settingIfu').value = s.ifu || '';
        document.getElementById('settingCurrency').value = s.currency || 'FCFA';
        document.getElementById('settingVat').value = s.vat_rate || '18';
        document.getElementById('settingMinStock').value = s.min_stock_alert || '5';
        document.getElementById('userName').textContent = s.store_name || 'Propriétaire';
    } catch (e) { showToast(e.message, 'error'); }
}

async function saveSettings() {
    const data = {
        store_name: document.getElementById('settingStoreName').value.trim(),
        store_address: document.getElementById('settingStoreAddress').value.trim(),
        store_phone: document.getElementById('settingStorePhone').value.trim(),
        ifu: document.getElementById('settingIfu').value.trim(),
        currency: document.getElementById('settingCurrency').value.trim(),
        vat_rate: document.getElementById('settingVat').value,
        min_stock_alert: document.getElementById('settingMinStock').value
    };
    try { await api('/settings', { method: 'PUT', body: JSON.stringify(data) }); showToast('Paramètres sauvegardés !'); loadSettings(); }
    catch (e) { showToast(e.message, 'error'); }
}

// ===================== EXPORT/RESET =====================

async function exportData() {
    try {
        const data = await api('/export');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `telecomstock-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Données exportées !');
    } catch (e) { showToast(e.message, 'error'); }
}

async function loadDemoData() {
    if (!confirm('Charger des données de démo ? Cela remplacera toutes les données existantes.')) return;
    try {
        await api('/reset', { method: 'POST' });
        location.reload();
    } catch (e) { showToast(e.message, 'error'); }
}

async function clearAllData() {
    if (!confirm('Effacer toutes les données ?')) return;
    try { await api('/reset', { method: 'POST' }); showToast('Données effacées !'); location.reload(); }
    catch (e) { showToast(e.message, 'error'); }
}

async function resetAllData() {
    if (!confirm('⚠️ ATTENTION ! Cette action est IRRÉVERSIBLE. Toutes les données seront supprimées. Continuer ?')) return;
    if (!confirm('DERNIÈRE CONFIRMATION : Êtes-vous VRAIMENT sûr ?')) return;
    try { await api('/reset', { method: 'POST' }); showToast('✅ Toutes les données ont été supprimées !'); setTimeout(() => location.reload(), 1500); }
    catch (e) { showToast(e.message, 'error'); }
}

// ===================== PWA =====================

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ===================== INIT =====================

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    // Login on Enter
    document.getElementById('loginPass').addEventListener('keypress', e => { if (e.key === 'Enter') login(); });
});
