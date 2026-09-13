/**
 * TelecomStock Pro — Application front
 * Rendu sans innerHTML sur données utilisateur (protection XSS par construction).
 */
const API = '/api';
const LS_TOKEN = 'ts_token';

let token = localStorage.getItem(LS_TOKEN);
let currentUser = null;
let settings = {};

const state = {
    products: [], categories: [], customers: [],
    suppliers: [], sales: [], credits: [], saleItems: []
};

/* ---------- utilitaires DOM ---------- */

const $ = id => document.getElementById(id);

/** Crée un élément ; le texte passe par textContent → jamais d'injection HTML. */
function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'css') node.textContent = v;          // contenu de <style> : jamais interprété comme HTML
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined) node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
        if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
}

function fill(container, nodes) {
    container.textContent = '';
    for (const n of [].concat(nodes)) if (n) container.appendChild(n);
}

function emptyRow(colspan, message) {
    return el('tr', { class: 'empty-row' }, [el('td', { colspan, text: message })]);
}

function badge(label, kind) {
    return el('span', { class: `badge badge-${kind}`, text: label });
}

function iconBtn(label, cls, onclick, title) {
    return el('button', { class: `btn ${cls} btn-sm`, text: label, title: title || label, onclick });
}

/* ---------- formatage ---------- */

const money = v => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')} ${settings.currency || 'F'}`;
const dateTime = v => v ? new Date(v.replace(' ', 'T')).toLocaleString('fr-FR',
    { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const PAY_LABELS = { cash: 'Espèces', mobile_money: 'Mobile Money', credit: 'Crédit', card: 'Carte' };
const PAY_KIND = { cash: 'success', mobile_money: 'warning', credit: 'info', card: 'info' };
const CREDIT_LABELS = { unpaid: 'Impayé', partial: 'Partiel', paid: 'Soldé' };
const MOVE_LABELS = { entry: 'Entrée', exit: 'Sortie', adjustment: 'Ajustement' };

/* ---------- couche réseau ---------- */

async function api(endpoint, options = {}) {
    // Mode autonome : les données vivent dans l'appareil, aucun serveur requis.
    if (window.TelecomStockLocal && TelecomStockLocal.estActif()) {
        try {
            return await TelecomStockLocal.traiter(endpoint, options);
        } catch (e) {
            if (e.status === 401 && !endpoint.startsWith('/login')) forceLogout();
            throw e;
        }
    }

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
        res = await fetch(API + endpoint, { headers, ...options });
    } catch {
        throw new Error('Serveur injoignable');
    }

    const payload = await res.json().catch(() => ({}));

    // 401 sur /login = identifiants refusés : on laisse remonter le vrai message
    // du serveur. Ailleurs, cela signifie que le jeton n'est plus valable.
    if (res.status === 401 && !endpoint.startsWith('/login')) {
        forceLogout('Session expirée, reconnectez-vous');
        throw new Error('Session expirée');
    }
    if (!res.ok) throw new Error(payload.error || `Erreur ${res.status}`);
    return payload;
}

/* ---------- notifications ---------- */

function toast(message, kind = 'success') {
    const node = el('div', { class: `toast ${kind === 'error' ? 'error' : ''}`, text: message });
    $('toastContainer').appendChild(node);
    requestAnimationFrame(() => node.classList.add('show'));
    setTimeout(() => {
        node.classList.remove('show');
        setTimeout(() => node.remove(), 300);
    }, 3200);
}

/* ---------- authentification ---------- */

async function login() {
    const btn = $('loginBtn');
    const err = $('loginError');
    btn.disabled = true;
    btn.textContent = 'Connexion…';
    err.style.display = 'none';
    try {
        const data = await api('/login', {
            method: 'POST',
            body: JSON.stringify({ username: $('loginUser').value.trim(), password: $('loginPass').value })
        });
        token = data.token;
        currentUser = data.user;
        localStorage.setItem(LS_TOKEN, token);
        await enterApp();
    } catch (e) {
        err.textContent = e.message;
        err.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Se connecter';
    }
}

/**
 * Renvoie l'utilisateur à l'écran de connexion.
 * Le message n'est affiché que s'il y en a un : au tout premier lancement,
 * aucune bannière d'erreur ne doit apparaître.
 */
function forceLogout(message) {
    token = null;
    currentUser = null;
    localStorage.removeItem(LS_TOKEN);
    $('app').classList.remove('visible');
    $('loginPage').style.display = 'flex';
    const err = $('loginError');
    if (message) {
        err.textContent = message;
        err.style.display = 'block';
    } else {
        err.textContent = '';
        err.style.display = 'none';
    }
}

function logout() {
    if (confirm('Se déconnecter ?')) forceLogout();
}

async function enterApp() {
    $('loginPage').style.display = 'none';
    $('app').classList.add('visible');
    $('userName').textContent = currentUser?.username || 'Utilisateur';
    await loadSettings();
    await showPage('dashboard');
}

/**
 * Interroge le serveur : tant que le compte admin garde le mot de passe
 * d'usine, on affiche les identifiants sur l'écran de connexion. Dès qu'il
 * est changé, l'encadré disparaît définitivement.
 */
async function checkFirstRun() {
    try {
        const info = await api('/health');
        const hint = $('firstRunHint');
        if (info.firstRun) hint.removeAttribute('hidden');
        else hint.setAttribute('hidden', '');
    } catch { /* serveur injoignable : l'écran reste utilisable */ }
}

/**
 * Détermine comment l'appareil doit fonctionner.
 * Sur le poste de caisse (application Windows), la question ne se pose pas.
 * Ailleurs, si aucun choix n'a été fait, on laisse le commerçant décider —
 * une boutique sans ordinateur doit pouvoir travailler seule.
 */
async function setupMode() {
    const surPoste = !!(window.telecomstock && window.telecomstock.isDesktop);
    const choix = $('modeChoice');

    // Interface embarquée dans l'APK (file://) : aucun serveur n'existe,
    // le mode autonome est le seul possible.
    if (location.protocol === 'file:') {
        TelecomStockLocal.activer();
        choix.setAttribute('hidden', '');
        majBandeauMode();
        return;
    }

    if (surPoste || TelecomStockLocal.estActif() || localStorage.getItem('telecomstock_mode') === 'connecte') {
        choix.setAttribute('hidden', '');
        majBandeauMode();
        return;
    }

    // Aucun choix fait : le serveur répond-il ?
    let serveurJoignable = false;
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 2500);
        const r = await fetch(API + '/health', { signal: ctrl.signal });
        clearTimeout(t);
        serveurJoignable = r.ok;
    } catch { serveurJoignable = false; }

    if (serveurJoignable) {
        // Un serveur existe : on propose le choix, sans l'imposer.
        choix.removeAttribute('hidden');
    } else {
        // Personne à l'autre bout : le mode autonome est la seule option utile.
        TelecomStockLocal.activer();
        majBandeauMode();
    }
}

function modeAutonome() {
    TelecomStockLocal.activer();
    $('modeChoice').setAttribute('hidden', '');
    majBandeauMode();
    checkFirstRun();
}

function modeConnecte() {
    TelecomStockLocal.desactiver();
    localStorage.setItem('telecomstock_mode', 'connecte');
    $('modeChoice').setAttribute('hidden', '');
    majBandeauMode();
    checkFirstRun();
}

/** Rappelle en permanence où sont stockées les données. */
function majBandeauMode() {
    const badge = $('modeBadge');
    if (!badge) return;
    if (TelecomStockLocal.estActif()) {
        badge.textContent = 'Données sur cet appareil';
        badge.hidden = false;
    } else {
        badge.hidden = true;
    }
}

/** Pré-remplit les identifiants d'usine pour le tout premier accès. */
function fillDefaults() {
    $('loginUser').value = 'admin';
    $('loginPass').value = 'admin123';
    $('loginPass').focus();
}

async function restoreSession() {
    if (!token) return;
    try {
        const data = await api('/auth/check');
        currentUser = data.user;
        await enterApp();
    } catch {
        // Jeton périmé au démarrage : on repart proprement sur l'écran de
        // connexion, sans alarmer l'utilisateur avec une erreur.
        forceLogout();
    }
}

/* ---------- navigation ---------- */

const PAGE_TITLES = {
    dashboard: 'Tableau de bord', products: 'Produits', stock: 'Gestion du stock',
    sales: 'Ventes', customers: 'Clients', credits: 'Crédits',
    suppliers: 'Fournisseurs', reports: 'Rapports', settings: 'Paramètres'
};

const LOADERS = {
    dashboard: loadDashboard, products: loadProducts, stock: loadStock,
    sales: loadSales, customers: loadCustomers, credits: loadCredits,
    suppliers: loadSuppliers, reports: loadReports, settings: loadSettings
};

async function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === pageId));
    document.querySelectorAll('.nav-item[data-page]').forEach(n =>
        n.classList.toggle('active', n.dataset.page === pageId));
    $('pageTitle').textContent = PAGE_TITLES[pageId] || pageId;
    $('sidebar').classList.remove('open');
    try {
        if (LOADERS[pageId]) await LOADERS[pageId]();
    } catch (e) {
        toast(e.message, 'error');
    }
}

function currentPage() {
    return document.querySelector('.page.active')?.id || 'dashboard';
}

const refreshAll = () => showPage(currentPage());
const toggleSidebar = () => $('sidebar').classList.toggle('open');

/**
 * Recherche globale : redirige vers la page pertinente et y applique le filtre.
 * (Cette fonction manquait en v2.0 → crash au premier caractère saisi.)
 */
async function globalSearch() {
    const q = $('globalSearch').value.trim();
    if (!q) return;
    const page = currentPage();
    if (page === 'customers') {
        $('searchCustomers').value = q;
        filterCustomers();
    } else {
        if (page !== 'products') await showPage('products');
        $('searchProducts').value = q;
        filterProducts();
    }
}

/* ---------- modales ---------- */

const openModal = id => $(id).classList.add('show');
const closeModal = id => $(id).classList.remove('show');

/* ---------- tableau de bord ---------- */

async function loadDashboard() {
    const d = await api('/dashboard');
    $('statStock').textContent = Number(d.totalStock).toLocaleString('fr-FR');
    $('statTodaySales').textContent = money(d.todaySales);
    $('statLowStock').textContent = d.lowStock;
    $('statCredits').textContent = money(d.openCredits);

    fill($('recentSalesTable'), d.recentSales.length
        ? d.recentSales.map(s => el('tr', {}, [
            el('td', { text: `#V-${s.id}` }),
            el('td', { text: s.customer_name }),
            el('td', {}, [el('strong', { text: money(s.total) })]),
            el('td', {}, [badge(PAY_LABELS[s.payment_method] || s.payment_method, PAY_KIND[s.payment_method] || 'info')]),
            el('td', { text: dateTime(s.created_at) })
        ]))
        : [emptyRow(5, 'Aucune vente enregistrée')]);

    fill($('lowStockAlerts'), d.lowStockProducts.length
        ? d.lowStockProducts.map(p => el('div', { class: 'alert-item' }, [
            el('span', { class: 'alert-name', text: p.name }),
            badge(`${p.stock} / ${p.min_stock}`, p.stock === 0 ? 'danger' : 'warning')
        ]))
        : [el('div', { class: 'empty-state' }, [
            el('div', { class: 'empty-state-icon', text: '✅' }),
            el('p', { text: 'Tous les stocks sont corrects' })
        ])]);
}

/* ---------- produits ---------- */

async function loadProducts() {
    const [products, categories] = await Promise.all([api('/products'), api('/categories')]);
    state.products = products;
    state.categories = categories;

    const options = categories.map(c => el('option', { value: c.id, text: c.name }));
    fill($('productCategory'), [el('option', { value: '', text: '— Aucune —' }), ...options.map(o => o.cloneNode(true))]);
    fill($('filterCategory'), [el('option', { value: '', text: 'Toutes catégories' }), ...options]);

    renderProducts(products);
}

function renderProducts(list) {
    $('productsCount').textContent = `${list.length} produit${list.length > 1 ? 's' : ''}`;
    fill($('productsTable'), list.length
        ? list.map(p => el('tr', {}, [
            el('td', {}, [el('strong', { text: p.reference })]),
            el('td', { text: p.name }),
            el('td', { text: p.category_name || '—' }),
            el('td', { text: money(p.purchase_price) }),
            el('td', {}, [el('strong', { text: money(p.sale_price) })]),
            el('td', {}, [badge(String(p.stock),
                p.stock === 0 ? 'danger' : p.stock <= p.min_stock ? 'warning' : 'success')]),
            el('td', { text: p.has_imei ? 'Oui' : '—' }),
            el('td', {}, [
                iconBtn('✏️', 'btn-outline', () => openProductModal(p), 'Modifier'),
                iconBtn('🗑️', 'btn-danger', () => deleteProduct(p.id), 'Supprimer')
            ])
        ]))
        : [emptyRow(8, 'Aucun produit')]);
}

function filterProducts() {
    const q = $('searchProducts').value.toLowerCase();
    const cat = $('filterCategory').value;
    renderProducts(state.products.filter(p =>
        (!q || p.name.toLowerCase().includes(q) || p.reference.toLowerCase().includes(q)) &&
        (!cat || String(p.category_id) === cat)
    ));
}

function openProductModal(p = null) {
    $('productModalTitle').textContent = p ? 'Modifier le produit' : 'Nouveau produit';
    $('productId').value = p?.id ?? '';
    $('productRef').value = p?.reference ?? '';
    $('productName').value = p?.name ?? '';
    $('productCategory').value = p?.category_id ?? '';
    $('productImei').value = p?.has_imei ? '1' : '0';
    $('productPurchasePrice').value = p?.purchase_price ?? '';
    $('productSalePrice').value = p?.sale_price ?? '';
    $('productStock').value = p?.stock ?? 0;
    $('productMinStock').value = p?.min_stock ?? 5;
    openModal('productModal');
}

async function saveProduct() {
    const id = $('productId').value;
    const body = {
        reference: $('productRef').value.trim(),
        name: $('productName').value.trim(),
        category_id: $('productCategory').value || null,
        has_imei: $('productImei').value === '1',
        purchase_price: Number($('productPurchasePrice').value) || 0,
        sale_price: Number($('productSalePrice').value) || 0,
        stock: Number($('productStock').value) || 0,
        min_stock: Number($('productMinStock').value) || 0
    };
    if (!body.reference || !body.name) return toast('Référence et nom sont obligatoires', 'error');
    try {
        await api(id ? `/products/${id}` : '/products', {
            method: id ? 'PUT' : 'POST', body: JSON.stringify(body)
        });
        closeModal('productModal');
        toast(id ? 'Produit modifié' : 'Produit ajouté');
        await loadProducts();
    } catch (e) { toast(e.message, 'error'); }
}

async function deleteProduct(id) {
    if (!confirm('Supprimer définitivement ce produit ?')) return;
    try {
        await api(`/products/${id}`, { method: 'DELETE' });
        toast('Produit supprimé');
        await loadProducts();
    } catch (e) { toast(e.message, 'error'); }
}

/* ---------- stock ---------- */

async function loadStock() {
    const [movements, products, suppliers] = await Promise.all([
        api('/stock-movements'), api('/products'), api('/suppliers')
    ]);
    state.products = products;
    state.suppliers = suppliers;

    $('stockTotalProducts').textContent = products.length;
    $('stockValue').textContent = money(products.reduce((s, p) => s + p.stock * p.purchase_price, 0));
    $('stockLow').textContent = products.filter(p => p.stock > 0 && p.stock <= p.min_stock).length;
    $('stockOut').textContent = products.filter(p => p.stock === 0).length;

    fill($('stockProduct'), products.map(p =>
        el('option', { value: p.id, text: `${p.name} — stock ${p.stock}` })));
    fill($('stockSupplier'), [
        el('option', { value: '', text: '— Aucun —' }),
        ...suppliers.map(s => el('option', { value: s.id, text: s.name }))
    ]);

    fill($('stockMovementsTable'), movements.length
        ? movements.map(m => el('tr', {}, [
            el('td', { text: dateTime(m.created_at) }),
            el('td', {}, [badge(MOVE_LABELS[m.type],
                m.type === 'entry' ? 'success' : m.type === 'exit' ? 'danger' : 'warning')]),
            el('td', { text: m.product_name || '—' }),
            el('td', { text: `${m.type === 'entry' ? '+' : '−'}${m.quantity}` }),
            el('td', { text: m.reason || '—' }),
            el('td', { text: m.supplier_name || '—' })
        ]))
        : [emptyRow(6, 'Aucun mouvement')]);
}

function openStockModal(type) {
    $('stockModalTitle').textContent =
        type === 'entry' ? 'Entrée de stock' : type === 'exit' ? 'Sortie de stock' : 'Ajustement';
    $('stockMovementType').value = type;
    $('stockQuantity').value = 1;
    $('stockReason').value = '';
    openModal('stockModal');
}

async function saveStockMovement() {
    const body = {
        product_id: Number($('stockProduct').value),
        type: $('stockMovementType').value,
        quantity: Number($('stockQuantity').value),
        reason: $('stockReason').value.trim(),
        supplier_id: Number($('stockSupplier').value) || null
    };
    if (!body.product_id || body.quantity <= 0) return toast('Produit et quantité valides requis', 'error');
    try {
        const r = await api('/stock-movements', { method: 'POST', body: JSON.stringify(body) });
        closeModal('stockModal');
        toast(`Mouvement enregistré — nouveau stock : ${r.newStock}`);
        await loadStock();
    } catch (e) { toast(e.message, 'error'); }
}

/* ---------- ventes ---------- */

async function loadSales() {
    const [sales, customers, products, credits] = await Promise.all([
        api('/sales'), api('/customers'), api('/products'), api('/credits')
    ]);
    Object.assign(state, { sales, customers, products, credits });

    const today = new Date().toISOString().slice(0, 10);
    const todaySales = sales.filter(s => s.created_at.startsWith(today) && s.status !== 'cancelled');
    $('salesTodayCount').textContent = todaySales.length;
    $('salesTodayTotal').textContent = money(todaySales.reduce((s, x) => s + x.total, 0));
    $('salesMonth').textContent = money(sales
        .filter(s => s.created_at.startsWith(today.slice(0, 7)) && s.status !== 'cancelled')
        .reduce((s, x) => s + x.total, 0));
    $('salesCredits').textContent = money(credits
        .filter(c => c.status !== 'paid').reduce((s, c) => s + (c.amount - c.paid), 0));

    filterSalesByDate();
}

function renderSales(list) {
    fill($('salesTable'), list.length
        ? list.map(s => {
            const cancelled = s.status === 'cancelled';
            return el('tr', {}, [
                el('td', {}, [el('strong', { text: `#V-${s.id}` })]),
                el('td', { text: s.customer_name }),
                el('td', {}, [el('strong', { text: money(s.total) })]),
                el('td', {}, [cancelled
                    ? badge('Annulée', 'danger')
                    : badge(PAY_LABELS[s.payment_method] || s.payment_method, PAY_KIND[s.payment_method] || 'info')]),
                el('td', { text: dateTime(s.created_at) }),
                el('td', {}, [
                    iconBtn('🧾', 'btn-outline', () => viewReceipt(s.id), 'Voir le reçu'),
                    cancelled ? null : iconBtn('✖', 'btn-danger', () => cancelSale(s.id), 'Annuler la vente')
                ].filter(Boolean))
            ]);
        })
        : [emptyRow(6, 'Aucune vente sur cette période')]);
}

function filterSalesByDate() {
    const filter = $('salesDateFilter').value;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    let list = state.sales;
    if (filter === 'today') list = list.filter(s => s.created_at.startsWith(today));
    else if (filter === 'week') {
        const limit = new Date(now.getTime() - 7 * 864e5);
        list = list.filter(s => new Date(s.created_at.replace(' ', 'T')) >= limit);
    } else if (filter === 'month') list = list.filter(s => s.created_at.startsWith(today.slice(0, 7)));
    renderSales(list);
}

function openSaleModal() {
    state.saleItems = [];
    fill($('saleCustomer'), [
        el('option', { value: '', text: '— Client anonyme —' }),
        ...state.customers.map(c => el('option', { value: c.id, text: c.name }))
    ]);
    fill($('saleProduct'), [
        el('option', { value: '', text: '— Choisir un produit —' }),
        ...state.products.filter(p => p.stock > 0).map(p =>
            el('option', { value: p.id, text: `${p.name} — ${money(p.sale_price)} (stock ${p.stock})` }))
    ]);
    $('saleDiscount').value = 0;
    $('salePayment').value = 'cash';
    renderSaleItems();
    openModal('saleModal');
}

function addSaleItem() {
    const id = Number($('saleProduct').value);
    if (!id) return;
    const product = state.products.find(p => p.id === id);
    const line = state.saleItems.find(i => i.product_id === id);
    if (line) {
        if (line.quantity >= product.stock) return toast(`Stock maximum atteint (${product.stock})`, 'error');
        line.quantity++;
    } else {
        state.saleItems.push({ product_id: id, name: product.name, price: product.sale_price, quantity: 1, max: product.stock });
    }
    $('saleProduct').value = '';
    renderSaleItems();
}

function renderSaleItems() {
    fill($('saleItems'), state.saleItems.length
        ? state.saleItems.map((item, i) => el('div', { class: 'sale-item' }, [
            el('span', { class: 'sale-item-name', text: item.name }),
            el('input', {
                type: 'number', value: item.quantity, min: 1, max: item.max, class: 'sale-item-qty',
                onchange: e => {
                    const v = Math.min(item.max, Math.max(1, Number(e.target.value) || 1));
                    item.quantity = v;
                    renderSaleItems();
                }
            }),
            el('input', {
                type: 'number', value: item.price, min: 0, class: 'sale-item-price',
                onchange: e => { item.price = Math.max(0, Number(e.target.value) || 0); renderSaleItems(); }
            }),
            el('span', { class: 'sale-item-total', text: money(item.price * item.quantity) }),
            el('button', {
                class: 'btn btn-danger btn-sm', text: '×',
                onclick: () => { state.saleItems.splice(i, 1); renderSaleItems(); }
            })
        ]))
        : [el('p', { class: 'sale-empty', text: 'Aucun produit sélectionné' })]);
    calculateSaleTotal();
}

function calculateSaleTotal() {
    const subtotal = state.saleItems.reduce((s, i) => s + i.price * i.quantity, 0);
    const discount = Math.min(100, Math.max(0, Number($('saleDiscount').value) || 0));
    $('saleTotal').textContent = money(subtotal - subtotal * discount / 100);
}

async function saveSale() {
    if (!state.saleItems.length) return toast('Ajoutez au moins un produit', 'error');
    const payment = $('salePayment').value;
    const customer = $('saleCustomer').value;
    if (payment === 'credit' && !customer) return toast('Une vente à crédit exige un client', 'error');
    try {
        const r = await api('/sales', {
            method: 'POST',
            body: JSON.stringify({
                customer_id: customer || null,
                payment_method: payment,
                discount: Number($('saleDiscount').value) || 0,
                items: state.saleItems.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.price }))
            })
        });
        closeModal('saleModal');
        toast(`Vente #V-${r.id} enregistrée — ${money(r.total)}`);
        await loadSales();
        if (confirm('Imprimer le reçu ?')) viewReceipt(r.id);
    } catch (e) { toast(e.message, 'error'); }
}

async function cancelSale(id) {
    if (!confirm(`Annuler la vente #V-${id} ? Le stock sera restitué.`)) return;
    try {
        await api(`/sales/${id}`, { method: 'DELETE' });
        toast('Vente annulée, stock restitué');
        await loadSales();
    } catch (e) { toast(e.message, 'error'); }
}

/** Reçu imprimable — construit par DOM, aucune concaténation HTML. */
async function viewReceipt(saleId) {
    try {
        const sale = await api(`/sales/${saleId}`);
        const win = window.open('', '_blank', 'width=380,height=640');
        if (!win) return toast('Autorisez les fenêtres pop-up pour imprimer', 'error');

        const d = win.document;
        d.title = `Reçu V-${sale.id}`;
        d.head.appendChild(el('meta', { charset: 'UTF-8' }));
        d.head.appendChild(el('style', {
            css: `body{font-family:'Courier New',monospace;max-width:302px;margin:12px auto;font-size:12px;color:#000}
                   h2{text-align:center;font-size:15px;margin:0 0 4px}
                   .c{text-align:center}.muted{font-size:10px;color:#444}
                   hr{border:none;border-top:1px dashed #000;margin:8px 0}
                   table{width:100%;border-collapse:collapse}
                   th{text-align:left;font-size:10px;border-bottom:1px solid #000}
                   td{padding:2px 0;font-size:11px;vertical-align:top}
                   .r{text-align:right}
                   .total{display:flex;justify-content:space-between;font-size:14px;font-weight:bold;margin-top:6px}
                   @media print{.noprint{display:none}}`
        }));

        const body = d.body;
        body.appendChild(el('h2', { text: settings.store_name || 'TelecomStock' }));
        body.appendChild(el('p', { class: 'c muted', text: settings.store_address || '' }));
        body.appendChild(el('p', { class: 'c muted', text: settings.store_phone || '' }));
        if (settings.ifu) body.appendChild(el('p', { class: 'c muted', text: `IFU : ${settings.ifu}` }));
        body.appendChild(el('hr'));
        body.appendChild(el('p', {}, [el('strong', { text: `Reçu N° V-${sale.id}` })]));
        body.appendChild(el('p', { text: dateTime(sale.created_at) }));
        body.appendChild(el('p', { text: `Client : ${sale.customer_name}` }));
        body.appendChild(el('hr'));

        const table = el('table', {}, [
            el('thead', {}, [el('tr', {}, [
                el('th', { text: 'Article' }), el('th', { class: 'r', text: 'Qté' }),
                el('th', { class: 'r', text: 'PU' }), el('th', { class: 'r', text: 'Total' })
            ])]),
            el('tbody', {}, sale.items.map(i => el('tr', {}, [
                el('td', { text: i.product_name }),
                el('td', { class: 'r', text: String(i.quantity) }),
                el('td', { class: 'r', text: money(i.unit_price) }),
                el('td', { class: 'r', text: money(i.unit_price * i.quantity) })
            ])))
        ]);
        body.appendChild(table);
        body.appendChild(el('hr'));

        if (sale.discount > 0) {
            body.appendChild(el('p', { class: 'r', text: `Remise : ${sale.discount} %` }));
        }
        body.appendChild(el('div', { class: 'total' }, [
            el('span', { text: 'TOTAL' }), el('span', { text: money(sale.total) })
        ]));
        body.appendChild(el('p', { text: `Paiement : ${PAY_LABELS[sale.payment_method] || sale.payment_method}` }));
        body.appendChild(el('hr'));
        body.appendChild(el('p', { class: 'c muted', text: 'Merci de votre confiance' }));
        body.appendChild(el('button', {
            class: 'noprint', text: 'Imprimer',
            style: 'width:100%;padding:10px;margin-top:12px;cursor:pointer',
            onclick: () => win.print()
        }));
    } catch (e) { toast(e.message, 'error'); }
}

/* ---------- clients ---------- */

async function loadCustomers() {
    state.customers = await api('/customers');
    renderCustomers(state.customers);
}

function renderCustomers(list) {
    fill($('customersTable'), list.length
        ? list.map(c => el('tr', {}, [
            el('td', { text: `CL-${String(c.id).padStart(3, '0')}` }),
            el('td', {}, [el('strong', { text: c.name })]),
            el('td', { text: c.phone || '—' }),
            el('td', { text: String(c.purchase_count ?? 0) }),
            el('td', { text: money(c.total_purchases) }),
            el('td', {}, [c.total_credit > 0
                ? badge(money(c.total_credit), 'warning')
                : el('span', { text: '—' })]),
            el('td', {}, [
                iconBtn('✏️', 'btn-outline', () => openCustomerModal(c), 'Modifier'),
                iconBtn('🗑️', 'btn-danger', () => deleteCustomer(c.id), 'Supprimer')
            ])
        ]))
        : [emptyRow(7, 'Aucun client')]);
}

function filterCustomers() {
    const q = $('searchCustomers').value.toLowerCase();
    renderCustomers(state.customers.filter(c =>
        c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)));
}

function openCustomerModal(c = null) {
    $('customerModalTitle').textContent = c ? 'Modifier le client' : 'Nouveau client';
    $('customerId').value = c?.id ?? '';
    $('customerName').value = c?.name ?? '';
    $('customerPhone').value = c?.phone ?? '';
    $('customerEmail').value = c?.email ?? '';
    $('customerAddress').value = c?.address ?? '';
    openModal('customerModal');
}

async function saveCustomer() {
    const id = $('customerId').value;
    const body = {
        name: $('customerName').value.trim(),
        phone: $('customerPhone').value.trim(),
        email: $('customerEmail').value.trim(),
        address: $('customerAddress').value.trim()
    };
    if (!body.name) return toast('Le nom est obligatoire', 'error');
    try {
        await api(id ? `/customers/${id}` : '/customers', {
            method: id ? 'PUT' : 'POST', body: JSON.stringify(body)
        });
        closeModal('customerModal');
        toast(id ? 'Client modifié' : 'Client ajouté');
        await loadCustomers();
    } catch (e) { toast(e.message, 'error'); }
}

async function deleteCustomer(id) {
    if (!confirm('Supprimer ce client ?')) return;
    try {
        await api(`/customers/${id}`, { method: 'DELETE' });
        toast('Client supprimé');
        await loadCustomers();
    } catch (e) { toast(e.message, 'error'); }
}

/* ---------- fournisseurs ---------- */

async function loadSuppliers() {
    state.suppliers = await api('/suppliers');
    fill($('suppliersTable'), state.suppliers.length
        ? state.suppliers.map(s => el('tr', {}, [
            el('td', { text: `FR-${String(s.id).padStart(3, '0')}` }),
            el('td', {}, [el('strong', { text: s.name })]),
            el('td', { text: s.phone || '—' }),
            el('td', { text: s.email || '—' }),
            el('td', { text: s.products || '—' }),
            el('td', {}, [
                iconBtn('✏️', 'btn-outline', () => openSupplierModal(s), 'Modifier'),
                iconBtn('🗑️', 'btn-danger', () => deleteSupplier(s.id), 'Supprimer')
            ])
        ]))
        : [emptyRow(6, 'Aucun fournisseur')]);
}

function openSupplierModal(s = null) {
    $('supplierModalTitle').textContent = s ? 'Modifier le fournisseur' : 'Nouveau fournisseur';
    $('supplierId').value = s?.id ?? '';
    $('supplierName').value = s?.name ?? '';
    $('supplierPhone').value = s?.phone ?? '';
    $('supplierEmail').value = s?.email ?? '';
    $('supplierProducts').value = s?.products ?? '';
    openModal('supplierModal');
}

async function saveSupplier() {
    const id = $('supplierId').value;
    const body = {
        name: $('supplierName').value.trim(),
        phone: $('supplierPhone').value.trim(),
        email: $('supplierEmail').value.trim(),
        products: $('supplierProducts').value.trim()
    };
    if (!body.name) return toast('Le nom est obligatoire', 'error');
    try {
        await api(id ? `/suppliers/${id}` : '/suppliers', {
            method: id ? 'PUT' : 'POST', body: JSON.stringify(body)
        });
        closeModal('supplierModal');
        toast(id ? 'Fournisseur modifié' : 'Fournisseur ajouté');
        await loadSuppliers();
    } catch (e) { toast(e.message, 'error'); }
}

async function deleteSupplier(id) {
    if (!confirm('Supprimer ce fournisseur ?')) return;
    try {
        await api(`/suppliers/${id}`, { method: 'DELETE' });
        toast('Fournisseur supprimé');
        await loadSuppliers();
    } catch (e) { toast(e.message, 'error'); }
}

/* ---------- crédits ---------- */

async function loadCredits() {
    const status = $('creditsFilter').value;
    state.credits = await api('/credits' + (status ? `?status=${status}` : ''));
    fill($('creditsTable'), state.credits.length
        ? state.credits.map(c => el('tr', {}, [
            el('td', { text: c.customer_name }),
            el('td', { text: money(c.amount) }),
            el('td', { text: money(c.paid) }),
            el('td', {}, [el('strong', { text: money(c.amount - c.paid) })]),
            el('td', {}, [badge(CREDIT_LABELS[c.status] || c.status,
                c.status === 'paid' ? 'success' : c.status === 'unpaid' ? 'danger' : 'warning')]),
            el('td', {}, [c.status === 'paid'
                ? el('span', { text: '—' })
                : el('button', { class: 'btn btn-primary btn-sm', text: 'Encaisser', onclick: () => openCreditPayModal(c.id) })])
        ]))
        : [emptyRow(6, 'Aucun crédit')]);
}

function openCreditPayModal(creditId) {
    const c = state.credits.find(x => x.id === creditId);
    if (!c) return;
    const reste = Math.round(c.amount - c.paid);
    $('creditId').value = c.id;
    $('creditCustomerName').value = c.customer_name;
    $('creditAmountDue').value = reste;
    // Pré-rempli avec le reste dû : le cas courant est le solde complet, et le
    // commerçant n'a qu'à corriger s'il encaisse moins.
    const champ = $('creditPaymentAmount');
    champ.max = reste;
    champ.value = reste;
    openModal('creditPayModal');
    // Le champ est sélectionné : taper un montant remplace directement la valeur.
    setTimeout(() => { champ.focus(); champ.select(); }, 60);
}

async function payCredit() {
    const amount = Number($('creditPaymentAmount').value);
    if (!amount || amount <= 0) return toast('Montant invalide', 'error');
    try {
        const r = await api('/credits/pay', {
            method: 'POST',
            body: JSON.stringify({ credit_id: Number($('creditId').value), amount })
        });
        closeModal('creditPayModal');
        toast(r.status === 'paid' ? 'Crédit soldé' : 'Paiement partiel enregistré');
        await loadCredits();
    } catch (e) { toast(e.message, 'error'); }
}

/* ---------- rapports ---------- */

async function loadReports() {
    const d = await api('/reports/profit');
    $('reportRevenue').textContent = money(d.totalRevenue);
    $('reportCost').textContent = money(d.totalCost);
    $('reportProfit').textContent = money(d.totalProfit);
    $('reportProducts').textContent = d.items.reduce((s, i) => s + i.qty_sold, 0);

    fill($('profitTable'), d.items.length
        ? d.items.map(i => el('tr', {}, [
            el('td', {}, [el('strong', { text: i.name })]),
            el('td', { text: String(i.qty_sold) }),
            el('td', { text: money(i.revenue) }),
            el('td', { text: money(i.cost) }),
            el('td', {}, [el('strong', {
                text: money(i.profit),
                style: `color:${i.profit >= 0 ? 'var(--success)' : 'var(--danger)'}`
            })])
        ]))
        : [emptyRow(5, 'Aucune vente à analyser')]);
}

/* ---------- paramètres ---------- */

async function loadSettings() {
    settings = await api('/settings');
    const map = {
        settingStoreName: 'store_name', settingStoreAddress: 'store_address',
        settingStorePhone: 'store_phone', settingIfu: 'ifu',
        settingCurrency: 'currency', settingVat: 'vat_rate', settingMinStock: 'min_stock_alert'
    };
    for (const [id, key] of Object.entries(map)) {
        if ($(id)) $(id).value = settings[key] ?? '';
    }
    $('storeNameDisplay').textContent = settings.store_name || 'TelecomStock Pro';
}

async function saveSettings() {
    try {
        await api('/settings', {
            method: 'PUT',
            body: JSON.stringify({
                store_name: $('settingStoreName').value.trim(),
                store_address: $('settingStoreAddress').value.trim(),
                store_phone: $('settingStorePhone').value.trim(),
                ifu: $('settingIfu').value.trim(),
                currency: $('settingCurrency').value.trim() || 'FCFA',
                vat_rate: $('settingVat').value,
                min_stock_alert: $('settingMinStock').value
            })
        });
        toast('Paramètres enregistrés');
        await loadSettings();
    } catch (e) { toast(e.message, 'error'); }
}

async function changePassword() {
    const current = $('currentPassword').value;
    const next = $('newPassword').value;
    const confirmPwd = $('confirmPassword').value;
    if (next.length < 6) return toast('Le nouveau mot de passe doit faire au moins 6 caractères', 'error');
    if (next !== confirmPwd) return toast('Les deux mots de passe ne correspondent pas', 'error');
    try {
        await api('/auth/password', {
            method: 'POST',
            body: JSON.stringify({ current_password: current, new_password: next })
        });
        ['currentPassword', 'newPassword', 'confirmPassword'].forEach(id => { $(id).value = ''; });
        toast('Mot de passe modifié');
    } catch (e) { toast(e.message, 'error'); }
}

async function exportData() {
    try {
        const data = await api('/export');
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const a = el('a', { href: url, download: `telecomstock-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast('Sauvegarde téléchargée');
    } catch (e) { toast(e.message, 'error'); }
}

async function resetData(withDemo) {
    const label = withDemo ? 'recharger les données de démonstration' : 'TOUT effacer';
    if (!confirm(`Confirmez-vous de ${label} ? Cette action est irréversible.`)) return;
    if (!withDemo && !confirm('Dernière confirmation : toutes vos données seront perdues.')) return;
    try {
        await api('/maintenance/reset', {
            method: 'POST',
            body: JSON.stringify({ confirm: 'RESET', with_demo: withDemo })
        });
        toast(withDemo ? 'Données de démonstration rechargées' : 'Base vidée');
        await showPage('dashboard');
    } catch (e) { toast(e.message, 'error'); }
}

/* ---------- initialisation ---------- */

/** Table des actions déclenchées par [data-action] — évite tout handler inline (CSP stricte). */
const ACTIONS = {
    login, logout, toggleSidebar, refreshAll, exportData, fillDefaults,
    modeAutonome, modeConnecte,
    saveSettings, changePassword, saveProduct, saveStockMovement,
    saveSale, saveCustomer, saveSupplier, payCredit,
    loadDemo: () => resetData(true),
    resetAll: () => resetData(false)
};

const MODAL_OPENERS = {
    product: () => openProductModal(),
    sale: () => openSaleModal(),
    customer: () => openCustomerModal(),
    supplier: () => openSupplierModal()
};

document.addEventListener('DOMContentLoaded', () => {
    // Navigation latérale
    document.querySelectorAll('.nav-item[data-page]').forEach(item =>
        item.addEventListener('click', () => showPage(item.dataset.page)));

    // Délégation : actions, ouverture de modales, fermeture, raccourcis de page
    document.addEventListener('click', e => {
        const target = e.target.closest('[data-action],[data-modal],[data-close],[data-goto],[data-stock]');
        if (!target) return;

        if (target.dataset.action) ACTIONS[target.dataset.action]?.();
        else if (target.dataset.modal) MODAL_OPENERS[target.dataset.modal]?.();
        else if (target.dataset.close) closeModal(target.dataset.close);
        else if (target.dataset.goto) showPage(target.dataset.goto);
        else if (target.dataset.stock) openStockModal(target.dataset.stock);
    });

    // Filtres et champs réactifs
    $('globalSearch').addEventListener('input', globalSearch);
    $('searchProducts').addEventListener('input', filterProducts);
    $('filterCategory').addEventListener('change', filterProducts);
    $('searchCustomers').addEventListener('input', filterCustomers);
    $('salesDateFilter').addEventListener('change', filterSalesByDate);
    $('creditsFilter').addEventListener('change', () => loadCredits().catch(e => toast(e.message, 'error')));
    $('saleProduct').addEventListener('change', addSaleItem);
    $('saleDiscount').addEventListener('input', calculateSaleTotal);

    // Fermeture des modales : clic sur le fond ou touche Échap
    document.querySelectorAll('.modal-overlay').forEach(m =>
        m.addEventListener('click', e => { if (e.target === m) m.classList.remove('show'); }));
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show'));
    });

    $('loginPass').addEventListener('keypress', e => { if (e.key === 'Enter') login(); });

    // Service worker : uniquement en mode web (inutile et invalide sur file://).
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        navigator.serviceWorker.register('sw.js').catch(() => { /* hors PWA : sans effet */ });
    }

    setupMode().then(() => {
        checkFirstRun();
        restoreSession();
    });
});
