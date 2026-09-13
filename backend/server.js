/**
 * TelecomStock Pro — API REST
 *
 * Exporte { app, start } pour être monté soit en process autonome (PWA/serveur),
 * soit directement dans le process principal Electron (aucun Node externe requis).
 */
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const path = require('path');

const { db, seedDemo, resetBusinessData } = require('./database');
const { generateToken, authMiddleware } = require('./auth');

const app = express();
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            scriptSrcAttr: ["'none'"],     // aucun handler inline
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            fontSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"]
            // Pas d'upgrade-insecure-requests : le poste de caisse sert en HTTP
            // sur le réseau local ; forcer HTTPS rendrait l'app mobile inutilisable.
        }
    },
    crossOriginEmbedderPolicy: false,
    // Pas de HSTS : même raison, l'accès local se fait en clair.
    hsts: false
}));
// 512 ko suffisent pour toute opération courante ; la restauration d'une
// sauvegarde complète est la seule exception et dispose de sa propre limite.
app.use('/api/import', express.json({ limit: '25mb' }));
app.use(express.json({ limit: '512kb' }));

app.use('/api/login', rateLimit({
    windowMs: 15 * 60 * 1000, max: 10,
    message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
    standardHeaders: true, legacyHeaders: false
}));
app.use('/api', rateLimit({
    windowMs: 60 * 1000, max: 300,
    message: { error: 'Trop de requêtes, ralentissez.' },
    standardHeaders: true, legacyHeaders: false
}));

app.use(express.static(PUBLIC_DIR));

/* ---------- helpers ---------- */

const asInt = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const asNum = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const asPositiveInt = v => { const n = asInt(v); return n !== null && n > 0 ? n : null; };
const text = (v, max = 255) => String(v ?? '').trim().slice(0, max);

/** Enveloppe une route : renvoie 400 pour les erreurs métier, 500 sinon. */
function route(handler) {
    return (req, res) => {
        try {
            handler(req, res);
        } catch (e) {
            if (e && e.statusCode) return res.status(e.statusCode).json({ error: e.message });
            console.error(`[${req.method} ${req.path}]`, e.message);
            res.status(500).json({ error: 'Erreur interne du serveur' });
        }
    };
}
function fail(statusCode, message) {
    const e = new Error(message);
    e.statusCode = statusCode;
    return e;
}

/* ---------- santé & auth ---------- */

app.get('/api/health', (req, res) => {
    // firstRun indique que le compte admin utilise encore le mot de passe
    // d'usine : l'interface peut alors guider le commerçant lors de sa
    // toute première connexion.
    let firstRun = false;
    try {
        const admin = db.prepare('SELECT password FROM users WHERE username = ?').get('admin');
        firstRun = !!admin && bcrypt.compareSync('admin123', admin.password);
    } catch { /* base non prête : on reste discret */ }
    res.json({ status: 'ok', version: '1.0.0', firstRun, timestamp: new Date().toISOString() });
});

app.post('/api/login', route((req, res) => {
    const username = text(req.body?.username, 64);
    const password = String(req.body?.password ?? '');
    if (!username || !password) throw fail(400, 'Identifiants requis');

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
        throw fail(401, 'Identifiants incorrects');
    }
    res.json({
        token: generateToken(user),
        user: { id: user.id, username: user.username, role: user.role }
    });
}));

app.get('/api/auth/check', authMiddleware, (req, res) => res.json({ user: req.user }));

app.post('/api/auth/password', authMiddleware, route((req, res) => {
    const current = String(req.body?.current_password ?? '');
    const next = String(req.body?.new_password ?? '');
    if (next.length < 6) throw fail(400, 'Le nouveau mot de passe doit faire au moins 6 caractères');

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user || !bcrypt.compareSync(current, user.password)) {
        throw fail(401, 'Mot de passe actuel incorrect');
    }
    db.prepare('UPDATE users SET password = ? WHERE id = ?')
        .run(bcrypt.hashSync(next, 12), user.id);
    res.json({ message: 'Mot de passe modifié' });
}));

/* ---------- tableau de bord ---------- */

app.get('/api/dashboard', authMiddleware, route((req, res) => {
    const one = (sql, ...p) => db.prepare(sql).get(...p);
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);

    const day = one("SELECT COALESCE(SUM(total),0) total, COUNT(*) count FROM sales WHERE date(created_at)=?", today);

    res.json({
        totalProducts: one('SELECT COUNT(*) c FROM products').c,
        totalStock: one('SELECT COALESCE(SUM(stock),0) s FROM products').s,
        lowStock: one('SELECT COUNT(*) c FROM products WHERE stock<=min_stock AND stock>0').c,
        outOfStock: one('SELECT COUNT(*) c FROM products WHERE stock=0').c,
        todaySales: day.total,
        todaySalesCount: day.count,
        monthSales: one("SELECT COALESCE(SUM(total),0) t FROM sales WHERE strftime('%Y-%m',created_at)=?", month).t,
        totalImeis: one("SELECT COUNT(*) c FROM imeis WHERE status='in_stock'").c,
        openCredits: one("SELECT COALESCE(SUM(amount-paid),0) t FROM credits WHERE status!='paid'").t,
        lowStockProducts: db.prepare('SELECT name, stock, min_stock FROM products WHERE stock<=min_stock ORDER BY stock ASC LIMIT 6').all(),
        recentSales: db.prepare(`SELECT s.id,s.total,s.payment_method,s.created_at,
                COALESCE(c.name,'Anonyme') customer_name
            FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
            ORDER BY s.created_at DESC, s.id DESC LIMIT 5`).all(),
        topProducts: db.prepare(`SELECT p.name, SUM(si.quantity) sold
            FROM sale_items si JOIN products p ON p.id=si.product_id
            GROUP BY si.product_id ORDER BY sold DESC LIMIT 5`).all()
    });
}));

/* ---------- produits ---------- */

app.get('/api/products', authMiddleware, route((req, res) => {
    const where = [];
    const params = [];
    if (req.query.search) {
        where.push('(p.name LIKE ? OR p.reference LIKE ?)');
        const like = `%${text(req.query.search, 80)}%`;
        params.push(like, like);
    }
    if (asInt(req.query.category_id)) { where.push('p.category_id=?'); params.push(asInt(req.query.category_id)); }
    if (req.query.low_stock === 'true') where.push('p.stock<=p.min_stock');

    res.json(db.prepare(`
        SELECT p.*, c.name category_name
        FROM products p LEFT JOIN categories c ON c.id=p.category_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY p.name`).all(...params));
}));

app.get('/api/products/:id', authMiddleware, route((req, res) => {
    const p = db.prepare(`SELECT p.*, c.name category_name
        FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?`).get(asInt(req.params.id));
    if (!p) throw fail(404, 'Produit non trouvé');
    res.json(p);
}));

/** Référence automatique PRD-001, PRD-002… si le commerçant n'en saisit pas. */
function nextReference() {
    const rows = db.prepare("SELECT reference FROM products WHERE reference LIKE 'PRD-%'").all();
    let max = 0;
    for (const r of rows) {
        const n = parseInt(String(r.reference).slice(4), 10);
        if (Number.isFinite(n) && n > max) max = n;
    }
    return `PRD-${String(max + 1).padStart(3, '0')}`;
}

function readProductBody(body, { autoRef = false } = {}) {
    let reference = text(body?.reference, 40);
    const name = text(body?.name, 120);
    if (!name) throw fail(400, 'Le nom du produit est obligatoire');
    // Saisir une référence n'a pas de sens pour un commerçant : on la génère.
    if (!reference) {
        if (!autoRef) throw fail(400, 'La référence est obligatoire');
        reference = nextReference();
    }
    return {
        reference, name,
        category_id: asInt(body?.category_id),
        purchase_price: Math.max(0, asNum(body?.purchase_price)),
        sale_price: Math.max(0, asNum(body?.sale_price)),
        stock: Math.max(0, asInt(body?.stock) ?? 0),
        min_stock: Math.max(0, asInt(body?.min_stock) ?? 5),
        has_imei: body?.has_imei ? 1 : 0,
        description: text(body?.description, 500)
    };
}

app.post('/api/products', authMiddleware, route((req, res) => {
    const p = readProductBody(req.body, { autoRef: true });
    if (db.prepare('SELECT id FROM products WHERE reference=?').get(p.reference)) {
        throw fail(409, 'Cette référence est déjà utilisée');
    }
    const info = db.prepare(`INSERT INTO products
        (reference,name,category_id,purchase_price,sale_price,stock,min_stock,has_imei,description)
        VALUES (@reference,@name,@category_id,@purchase_price,@sale_price,@stock,@min_stock,@has_imei,@description)`).run(p);
    res.status(201).json({ id: info.lastInsertRowid, message: 'Produit ajouté' });
}));

app.put('/api/products/:id', authMiddleware, route((req, res) => {
    const id = asInt(req.params.id);
    const actuel = db.prepare('SELECT reference FROM products WHERE id=?').get(id);
    if (!actuel) throw fail(404, 'Produit non trouvé');
    // Référence laissée vide lors d'une modification : on conserve l'existante
    // plutôt que de refuser l'enregistrement.
    const body = { ...req.body };
    if (!text(body.reference, 40)) body.reference = actuel.reference;
    const p = readProductBody(body);
    if (db.prepare('SELECT id FROM products WHERE reference=? AND id<>?').get(p.reference, id)) {
        throw fail(409, 'Cette référence est déjà utilisée');
    }
    db.prepare(`UPDATE products SET reference=@reference,name=@name,category_id=@category_id,
        purchase_price=@purchase_price,sale_price=@sale_price,stock=@stock,min_stock=@min_stock,
        has_imei=@has_imei,description=@description WHERE id=@id`).run({ ...p, id });
    res.json({ message: 'Produit modifié' });
}));

app.delete('/api/products/:id', authMiddleware, route((req, res) => {
    const id = asInt(req.params.id);
    const sold = db.prepare('SELECT COUNT(*) c FROM sale_items WHERE product_id=?').get(id).c;
    if (sold > 0) throw fail(409, 'Impossible : ce produit figure dans des ventes. Mettez son stock à 0.');
    if (db.prepare('DELETE FROM products WHERE id=?').run(id).changes === 0) throw fail(404, 'Produit non trouvé');
    res.json({ message: 'Produit supprimé' });
}));

/* ---------- catégories ---------- */

app.get('/api/categories', authMiddleware, route((req, res) => {
    res.json(db.prepare('SELECT * FROM categories ORDER BY name').all());
}));

app.post('/api/categories', authMiddleware, route((req, res) => {
    const name = text(req.body?.name, 60);
    if (!name) throw fail(400, 'Nom requis');
    if (db.prepare('SELECT id FROM categories WHERE name=?').get(name)) throw fail(409, 'Catégorie déjà existante');
    const info = db.prepare('INSERT INTO categories (name,description) VALUES (?,?)')
        .run(name, text(req.body?.description, 200));
    res.status(201).json({ id: info.lastInsertRowid });
}));

/* ---------- mouvements de stock ---------- */

app.get('/api/stock-movements', authMiddleware, route((req, res) => {
    const where = [];
    const params = [];
    if (asInt(req.query.product_id)) { where.push('m.product_id=?'); params.push(asInt(req.query.product_id)); }
    if (['entry', 'exit', 'adjustment'].includes(req.query.type)) { where.push('m.type=?'); params.push(req.query.type); }
    res.json(db.prepare(`
        SELECT m.*, p.name product_name, s.name supplier_name
        FROM stock_movements m
        LEFT JOIN products p ON p.id=m.product_id
        LEFT JOIN suppliers s ON s.id=m.supplier_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY m.created_at DESC, m.id DESC LIMIT 200`).all(...params));
}));

const applyMovement = db.transaction(({ product_id, type, quantity, reason, supplier_id, unit_price }) => {
    const product = db.prepare('SELECT * FROM products WHERE id=?').get(product_id);
    if (!product) throw fail(404, 'Produit non trouvé');

    const delta = type === 'entry' ? quantity : -quantity;
    const newStock = product.stock + delta;
    if (newStock < 0) throw fail(409, `Stock insuffisant pour ${product.name} (disponible : ${product.stock})`);

    db.prepare('UPDATE products SET stock=? WHERE id=?').run(newStock, product_id);
    db.prepare(`INSERT INTO stock_movements (product_id,type,quantity,reason,supplier_id,unit_price)
        VALUES (?,?,?,?,?,?)`).run(product_id, type, quantity, reason, supplier_id, unit_price);
    return newStock;
});

app.post('/api/stock-movements', authMiddleware, route((req, res) => {
    const product_id = asPositiveInt(req.body?.product_id);
    const type = req.body?.type;
    const quantity = asPositiveInt(req.body?.quantity);
    if (!product_id || !quantity) throw fail(400, 'Produit et quantité (> 0) requis');
    if (!['entry', 'exit', 'adjustment'].includes(type)) throw fail(400, 'Type de mouvement invalide');

    const newStock = applyMovement({
        product_id, type, quantity,
        reason: text(req.body?.reason, 200),
        supplier_id: asInt(req.body?.supplier_id),
        unit_price: req.body?.unit_price != null ? asNum(req.body.unit_price) : null
    });
    res.status(201).json({ message: 'Mouvement enregistré', newStock });
}));

/* ---------- ventes ---------- */

app.get('/api/sales', authMiddleware, route((req, res) => {
    const where = [];
    const params = [];
    if (asInt(req.query.customer_id)) { where.push('s.customer_id=?'); params.push(asInt(req.query.customer_id)); }
    res.json(db.prepare(`
        SELECT s.*, COALESCE(c.name,'Anonyme') customer_name
        FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY s.created_at DESC, s.id DESC LIMIT 200`).all(...params));
}));

app.get('/api/sales/:id', authMiddleware, route((req, res) => {
    const id = asInt(req.params.id);
    const sale = db.prepare(`SELECT s.*, COALESCE(c.name,'Anonyme') customer_name, c.phone customer_phone
        FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=?`).get(id);
    if (!sale) throw fail(404, 'Vente non trouvée');
    sale.items = db.prepare(`SELECT si.*, p.name product_name
        FROM sale_items si JOIN products p ON p.id=si.product_id WHERE si.sale_id=?`).all(id);
    res.json(sale);
}));

/** Vente atomique : stock, lignes, mouvements et crédit dans une seule transaction. */
const createSale = db.transaction(({ customer_id, payment_method, discount, items, amount_paid }) => {
    let subtotal = 0;
    const resolved = [];

    for (const raw of items) {
        const pid = asPositiveInt(raw?.product_id);
        const qty = asPositiveInt(raw?.quantity);
        if (!pid || !qty) throw fail(400, 'Ligne de vente invalide');

        const product = db.prepare('SELECT * FROM products WHERE id=?').get(pid);
        if (!product) throw fail(404, `Produit #${pid} introuvable`);
        if (product.stock < qty) {
            throw fail(409, `Stock insuffisant pour ${product.name} (disponible : ${product.stock})`);
        }
        const unit = raw.unit_price != null ? Math.max(0, asNum(raw.unit_price)) : product.sale_price;
        subtotal += unit * qty;
        resolved.push({ product, qty, unit });
    }

    const total = Math.max(0, subtotal - subtotal * (discount / 100));
    const saleId = db.prepare(`INSERT INTO sales (customer_id,total,payment_method,discount)
        VALUES (?,?,?,?)`).run(customer_id, total, payment_method, discount).lastInsertRowid;

    const insItem = db.prepare('INSERT INTO sale_items (sale_id,product_id,quantity,unit_price) VALUES (?,?,?,?)');
    const insMove = db.prepare('INSERT INTO stock_movements (product_id,type,quantity,reason) VALUES (?,?,?,?)');
    for (const { product, qty, unit } of resolved) {
        insItem.run(saleId, product.id, qty, unit);
        db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(qty, product.id);
        insMove.run(product.id, 'exit', qty, `Vente #V-${saleId}`);
    }

    if (customer_id) {
        db.prepare('UPDATE customers SET total_purchases=total_purchases+? WHERE id=?').run(total, customer_id);
        if (payment_method === 'credit') {
            // Acompte éventuel versé au moment de la vente (cas courant en boutique).
            const acompte = Math.max(0, Math.min(Number(amount_paid) || 0, total));
            const statut = acompte <= 0 ? 'unpaid'
                : (acompte >= total - 0.001 ? 'paid' : 'partial');
            db.prepare('INSERT INTO credits (customer_id,sale_id,amount,paid,status) VALUES (?,?,?,?,?)')
                .run(customer_id, saleId, total, acompte, statut);
            db.prepare('UPDATE customers SET total_credit=total_credit+? WHERE id=?')
                .run(total - acompte, customer_id);
        }
    }
    return { id: saleId, total };
});

app.post('/api/sales', authMiddleware, route((req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) throw fail(400, 'Ajoutez au moins un produit');

    const payment_method = ['cash', 'mobile_money', 'credit', 'card'].includes(req.body?.payment_method)
        ? req.body.payment_method : 'cash';
    const customer_id = asInt(req.body?.customer_id);
    if (payment_method === 'credit' && !customer_id) {
        throw fail(400, 'Une vente à crédit exige un client identifié');
    }
    if (customer_id && !db.prepare('SELECT id FROM customers WHERE id=?').get(customer_id)) {
        throw fail(404, 'Client introuvable');
    }
    const discount = Math.min(100, Math.max(0, asNum(req.body?.discount)));

    const result = createSale({ customer_id, payment_method, discount, items, amount_paid: req.body?.amount_paid });
    res.status(201).json({ ...result, message: 'Vente enregistrée' });
}));

app.delete('/api/sales/:id', authMiddleware, route((req, res) => {
    const id = asInt(req.params.id);
    const cancel = db.transaction(() => {
        const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(id);
        if (!sale) throw fail(404, 'Vente non trouvée');
        if (sale.status === 'cancelled') throw fail(409, 'Vente déjà annulée');

        for (const it of db.prepare('SELECT * FROM sale_items WHERE sale_id=?').all(id)) {
            db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(it.quantity, it.product_id);
            db.prepare('INSERT INTO stock_movements (product_id,type,quantity,reason) VALUES (?,?,?,?)')
                .run(it.product_id, 'entry', it.quantity, `Annulation vente #V-${id}`);
        }
        if (sale.customer_id) {
            db.prepare('UPDATE customers SET total_purchases=total_purchases-? WHERE id=?').run(sale.total, sale.customer_id);
            const credit = db.prepare('SELECT * FROM credits WHERE sale_id=?').get(id);
            if (credit) {
                db.prepare('UPDATE customers SET total_credit=total_credit-? WHERE id=?')
                    .run(credit.amount - credit.paid, sale.customer_id);
                db.prepare('DELETE FROM credits WHERE id=?').run(credit.id);
            }
        }
        db.prepare("UPDATE sales SET status='cancelled' WHERE id=?").run(id);
    });
    cancel();
    res.json({ message: 'Vente annulée, stock restitué' });
}));

/* ---------- clients ---------- */

app.get('/api/customers', authMiddleware, route((req, res) => {
    const where = [];
    const params = [];
    if (req.query.search) {
        where.push('(c.name LIKE ? OR c.phone LIKE ?)');
        const like = `%${text(req.query.search, 80)}%`;
        params.push(like, like);
    }
    res.json(db.prepare(`
        SELECT c.*, (SELECT COUNT(*) FROM sales s WHERE s.customer_id=c.id) purchase_count
        FROM customers c ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.name`).all(...params));
}));

app.get('/api/customers/:id', authMiddleware, route((req, res) => {
    const id = asInt(req.params.id);
    const c = db.prepare('SELECT * FROM customers WHERE id=?').get(id);
    if (!c) throw fail(404, 'Client non trouvé');
    c.sales = db.prepare('SELECT * FROM sales WHERE customer_id=? ORDER BY created_at DESC LIMIT 20').all(id);
    c.credits = db.prepare('SELECT * FROM credits WHERE customer_id=? ORDER BY created_at DESC').all(id);
    res.json(c);
}));

function readPersonBody(body) {
    const name = text(body?.name, 120);
    if (!name) throw fail(400, 'Le nom est obligatoire');
    return {
        name,
        phone: text(body?.phone, 40),
        email: text(body?.email, 120),
        address: text(body?.address, 200)
    };
}

app.post('/api/customers', authMiddleware, route((req, res) => {
    const c = readPersonBody(req.body);
    const info = db.prepare('INSERT INTO customers (name,phone,email,address) VALUES (@name,@phone,@email,@address)').run(c);
    res.status(201).json({ id: info.lastInsertRowid, message: 'Client ajouté' });
}));

app.put('/api/customers/:id', authMiddleware, route((req, res) => {
    const id = asInt(req.params.id);
    const c = readPersonBody(req.body);
    if (db.prepare('UPDATE customers SET name=@name,phone=@phone,email=@email,address=@address WHERE id=@id')
        .run({ ...c, id }).changes === 0) throw fail(404, 'Client non trouvé');
    res.json({ message: 'Client modifié' });
}));

app.delete('/api/customers/:id', authMiddleware, route((req, res) => {
    const id = asInt(req.params.id);
    const open = db.prepare("SELECT COUNT(*) c FROM credits WHERE customer_id=? AND status!='paid'").get(id).c;
    if (open > 0) throw fail(409, 'Ce client a des crédits en cours');
    if (db.prepare('DELETE FROM customers WHERE id=?').run(id).changes === 0) throw fail(404, 'Client non trouvé');
    res.json({ message: 'Client supprimé' });
}));

/* ---------- fournisseurs ---------- */

app.get('/api/suppliers', authMiddleware, route((req, res) => {
    res.json(db.prepare('SELECT * FROM suppliers ORDER BY name').all());
}));

app.post('/api/suppliers', authMiddleware, route((req, res) => {
    const s = readPersonBody(req.body);
    s.products = text(req.body?.products, 200);
    const info = db.prepare('INSERT INTO suppliers (name,phone,email,products) VALUES (@name,@phone,@email,@products)').run(s);
    res.status(201).json({ id: info.lastInsertRowid, message: 'Fournisseur ajouté' });
}));

app.put('/api/suppliers/:id', authMiddleware, route((req, res) => {
    const id = asInt(req.params.id);
    const s = readPersonBody(req.body);
    s.products = text(req.body?.products, 200);
    if (db.prepare('UPDATE suppliers SET name=@name,phone=@phone,email=@email,products=@products WHERE id=@id')
        .run({ ...s, id }).changes === 0) throw fail(404, 'Fournisseur non trouvé');
    res.json({ message: 'Fournisseur modifié' });
}));

app.delete('/api/suppliers/:id', authMiddleware, route((req, res) => {
    if (db.prepare('DELETE FROM suppliers WHERE id=?').run(asInt(req.params.id)).changes === 0) {
        throw fail(404, 'Fournisseur non trouvé');
    }
    res.json({ message: 'Fournisseur supprimé' });
}));

/* ---------- crédits ---------- */

app.get('/api/credits', authMiddleware, route((req, res) => {
    const where = [];
    const params = [];
    if (asInt(req.query.customer_id)) { where.push('cr.customer_id=?'); params.push(asInt(req.query.customer_id)); }
    if (['unpaid', 'partial', 'paid'].includes(req.query.status)) { where.push('cr.status=?'); params.push(req.query.status); }
    res.json(db.prepare(`
        SELECT cr.*, c.name customer_name
        FROM credits cr JOIN customers c ON c.id=cr.customer_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY cr.created_at DESC`).all(...params));
}));

const payCredit = db.transaction((credit_id, amount) => {
    const credit = db.prepare('SELECT * FROM credits WHERE id=?').get(credit_id);
    if (!credit) throw fail(404, 'Crédit non trouvé');
    if (credit.status === 'paid') throw fail(409, 'Ce crédit est déjà soldé');

    const due = credit.amount - credit.paid;
    if (amount > due + 0.001) throw fail(400, `Montant supérieur au reste dû (${Math.round(due)})`);

    const paid = credit.paid + amount;
    const status = paid >= credit.amount - 0.001 ? 'paid' : 'partial';
    db.prepare('UPDATE credits SET paid=?,status=? WHERE id=?').run(paid, status, credit_id);
    db.prepare('UPDATE customers SET total_credit=MAX(0,total_credit-?) WHERE id=?').run(amount, credit.customer_id);
    return { paid, status };
});

app.post('/api/credits/pay', authMiddleware, route((req, res) => {
    const credit_id = asPositiveInt(req.body?.credit_id);
    const amount = asNum(req.body?.amount);
    if (!credit_id || amount <= 0) throw fail(400, 'Crédit et montant (> 0) requis');
    res.json({ message: 'Paiement enregistré', ...payCredit(credit_id, amount) });
}));

/* ---------- paramètres ---------- */

const ALLOWED_SETTINGS = new Set([
    'store_name', 'store_address', 'store_phone', 'currency', 'vat_rate', 'min_stock_alert', 'ifu'
]);

app.get('/api/settings', authMiddleware, route((req, res) => {
    const out = {};
    for (const r of db.prepare('SELECT key,value FROM settings').all()) out[r.key] = r.value;
    res.json(out);
}));

app.put('/api/settings', authMiddleware, route((req, res) => {
    const stmt = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    const apply = db.transaction(entries => {
        for (const [k, v] of entries) if (ALLOWED_SETTINGS.has(k)) stmt.run(k, text(v, 200));
    });
    apply(Object.entries(req.body || {}));
    res.json({ message: 'Paramètres enregistrés' });
}));

/* ---------- rapports ---------- */

app.get('/api/reports/profit', authMiddleware, route((req, res) => {
    const items = db.prepare(`
        SELECT p.name,
               SUM(si.quantity) qty_sold,
               SUM(si.quantity*si.unit_price) revenue,
               SUM(si.quantity*p.purchase_price) cost
        FROM sale_items si
        JOIN products p ON p.id=si.product_id
        JOIN sales s ON s.id=si.sale_id AND s.status='completed'
        GROUP BY si.product_id
        ORDER BY (SUM(si.quantity*si.unit_price)-SUM(si.quantity*p.purchase_price)) DESC`).all()
        .map(i => ({ ...i, profit: i.revenue - i.cost }));

    res.json({
        items,
        totalRevenue: items.reduce((s, i) => s + i.revenue, 0),
        totalCost: items.reduce((s, i) => s + i.cost, 0),
        totalProfit: items.reduce((s, i) => s + i.profit, 0)
    });
}));

/* ---------- export / maintenance ---------- */

app.get('/api/export', authMiddleware, route((req, res) => {
    const dump = t => db.prepare(`SELECT * FROM ${t}`).all();
    res.json({
        exported_at: new Date().toISOString(),
        version: '1.0.0',
        categories: dump('categories'), products: dump('products'),
        customers: dump('customers'), suppliers: dump('suppliers'),
        sales: dump('sales'), sale_items: dump('sale_items'),
        credits: dump('credits'), stock_movements: dump('stock_movements'),
        imeis: dump('imeis'), settings: dump('settings')
    });
}));

app.post('/api/import', authMiddleware, route((req, res) => {
    // Restauration d'une sauvegarde : sans elle, l'export ne protège de rien.
    // L'opération est atomique — en cas de fichier incohérent, la base reste
    // telle qu'elle était.
    const sauvegarde = req.body;
    if (!sauvegarde || typeof sauvegarde !== 'object' || !Array.isArray(sauvegarde.products)) {
        throw fail(400, 'Fichier de sauvegarde invalide');
    }
    if (req.body?.confirm !== 'IMPORT') {
        throw fail(400, "Confirmation requise : envoyez { confirm: 'IMPORT' }");
    }

    const lignes = t => Array.isArray(sauvegarde[t]) ? sauvegarde[t] : [];
    const inserer = (table, colonnes) => {
        const donnees = lignes(table);
        if (!donnees.length) return 0;
        const noms = colonnes.join(',');
        const valeurs = colonnes.map(c => '@' + c).join(',');
        const stmt = db.prepare(`INSERT INTO ${table} (${noms}) VALUES (${valeurs})`);
        let n = 0;
        for (const ligne of donnees) {
            const propre = {};
            for (const c of colonnes) propre[c] = ligne[c] ?? null;
            stmt.run(propre);
            n++;
        }
        return n;
    };

    const restaurer = db.transaction(() => {
        // Ordre inverse des dépendances pour vider sans violer les clés.
        db.exec(`
            DELETE FROM sale_items; DELETE FROM credits; DELETE FROM imeis;
            DELETE FROM stock_movements; DELETE FROM sales; DELETE FROM products;
            DELETE FROM customers; DELETE FROM suppliers;
            DELETE FROM sqlite_sequence WHERE name IN
                ('sales','sale_items','products','customers','suppliers',
                 'credits','imeis','stock_movements');
        `);

        let total = 0;
        total += inserer('customers', ['id', 'name', 'phone', 'email', 'address',
            'total_purchases', 'total_credit', 'created_at']);
        total += inserer('suppliers', ['id', 'name', 'phone', 'email', 'address',
            'products', 'created_at']);
        total += inserer('products', ['id', 'reference', 'name', 'category_id',
            'purchase_price', 'sale_price', 'stock', 'min_stock', 'has_imei',
            'description', 'created_at']);
        total += inserer('sales', ['id', 'customer_id', 'total', 'payment_method',
            'discount', 'status', 'created_at']);
        total += inserer('sale_items', ['id', 'sale_id', 'product_id', 'quantity',
            'unit_price']);
        total += inserer('credits', ['id', 'customer_id', 'sale_id', 'amount',
            'paid', 'status', 'created_at']);
        total += inserer('stock_movements', ['id', 'product_id', 'type', 'quantity',
            'reason', 'supplier_id', 'unit_price', 'created_at']);
        total += inserer('imeis', ['id', 'product_id', 'imei', 'status']);

        // Les paramètres sont restaurés sans écraser les clés inconnues.
        for (const s of lignes('settings')) {
            if (s && ALLOWED_SETTINGS.has(s.key)) {
                db.prepare(`INSERT INTO settings (key,value) VALUES (?,?)
                    ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
                    .run(s.key, String(s.value ?? ''));
            }
        }
        return total;
    });

    const total = restaurer();
    res.json({ message: 'Sauvegarde restaurée', restored: total });
}));

app.post('/api/maintenance/reset', authMiddleware, route((req, res) => {
    if (req.body?.confirm !== 'RESET') {
        throw fail(400, "Confirmation requise : envoyez { confirm: 'RESET' }");
    }
    resetBusinessData(req.body?.with_demo === true);
    res.json({ message: 'Base réinitialisée' });
}));

/* ---------- SPA fallback + 404 ---------- */

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

/* ---------- démarrage ---------- */

/** Adresses IPv4 locales, pour indiquer où joindre le serveur depuis un mobile. */
function localAddresses() {
    const nets = require('os').networkInterfaces();
    const out = [];
    for (const iface of Object.values(nets)) {
        for (const net of iface || []) {
            if (net.family === 'IPv4' && !net.internal) out.push(net.address);
        }
    }
    return out;
}

function start(port = Number(process.env.PORT) || 3002, host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
        const server = app.listen(port, host, () => {
            const actual = server.address().port;
            console.log(`TelecomStock API → http://${host}:${actual}`);
            if (host === '0.0.0.0') {
                for (const ip of localAddresses()) {
                    console.log(`  Accessible depuis le réseau → http://${ip}:${actual}`);
                }
            }
            resolve(server);
        });
        server.on('error', reject);
    });
}

if (require.main === module) {
    start(Number(process.env.PORT) || 3002, process.env.HOST || '127.0.0.1')
        .catch(e => { console.error('Démarrage impossible :', e.message); process.exit(1); });
}

module.exports = { app, start, localAddresses };
