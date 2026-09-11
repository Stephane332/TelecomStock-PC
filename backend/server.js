const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./database');
const { generateToken, authMiddleware } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3002;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(cors({ origin: ['http://localhost:3002', 'http://127.0.0.1:3002', 'file://'] }));
app.use(express.json({ limit: '1mb' }));

// Rate limiting
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' }
});
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: 'Trop de requêtes.' }
});

// Apply rate limiting
app.use('/api/login', loginLimiter);
app.use('/api/', apiLimiter);

// Static files
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// ===================== AUTH =====================

app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Identifiants requis' });
        }
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Identifiants incorrects' });
        }
        const token = generateToken(user);
        res.json({
            success: true,
            token,
            user: { id: user.id, username: user.username, role: user.role }
        });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/auth/check', authMiddleware, (req, res) => {
    res.json({ user: req.user });
});

// ===================== DASHBOARD =====================

app.get('/api/dashboard', authMiddleware, (req, res) => {
    try {
        const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
        const totalStock = db.prepare('SELECT COALESCE(SUM(stock), 0) as total FROM products').get().total;
        const lowStock = db.prepare('SELECT COUNT(*) as count FROM products WHERE stock <= min_stock AND stock > 0').get().count;
        const outOfStock = db.prepare('SELECT COUNT(*) as count FROM products WHERE stock = 0').get().count;

        const today = new Date().toISOString().split('T')[0];
        const todaySales = db.prepare('SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count FROM sales WHERE DATE(created_at) = ?').get(today);
        const monthStart = today.substring(0, 7);
        const monthSales = db.prepare('SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE strftime("%Y-%m", created_at) = ?').get(monthStart).total;
        const totalImeis = db.prepare("SELECT COUNT(*) as count FROM imeis WHERE status = 'in_stock'").get().count;

        const lowStockProducts = db.prepare('SELECT name, stock FROM products WHERE stock <= min_stock ORDER BY stock ASC LIMIT 5').all();
        const recentSales = db.prepare(`
            SELECT s.*, c.name as customer_name 
            FROM sales s LEFT JOIN customers c ON s.customer_id = c.id 
            ORDER BY s.created_at DESC LIMIT 5
        `).all();

        const salesByProduct = db.prepare(`
            SELECT p.name, SUM(si.quantity) as sold 
            FROM sale_items si 
            JOIN products p ON si.product_id = p.id 
            GROUP BY si.product_id 
            ORDER BY sold DESC LIMIT 5
        `).all();

        res.json({
            totalProducts, totalStock, lowStock, outOfStock,
            todaySales: todaySales.total || 0,
            todaySalesCount: todaySales.count || 0,
            monthSales: monthSales || 0,
            totalImeis, lowStockProducts, recentSales,
            topProducts: salesByProduct
        });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ===================== PRODUCTS =====================

app.get('/api/products', authMiddleware, (req, res) => {
    try {
        let query = 'SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id';
        const params = [];
        const conditions = [];

        if (req.query.search) {
            conditions.push('(p.name LIKE ? OR p.reference LIKE ?)');
            params.push(`%${req.query.search}%`, `%${req.query.search}%`);
        }
        if (req.query.category_id) {
            conditions.push('p.category_id = ?');
            params.push(req.query.category_id);
        }
        if (req.query.low_stock === 'true') {
            conditions.push('p.stock <= p.min_stock');
        }
        if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY p.created_at DESC';

        res.json(db.prepare(query).all(...params));
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/products/:id', authMiddleware, (req, res) => {
    try {
        const product = db.prepare('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?').get(req.params.id);
        if (!product) return res.status(404).json({ error: 'Produit non trouvé' });
        res.json(product);
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/products', authMiddleware, (req, res) => {
    try {
        const { reference, name, category_id, purchase_price, sale_price, stock, min_stock, has_imei, description } = req.body;
        if (!reference || !name) return res.status(400).json({ error: 'Référence et nom requis' });

        const existing = db.prepare('SELECT id FROM products WHERE reference = ?').get(reference);
        if (existing) return res.status(400).json({ error: 'Référence déjà utilisée' });

        const result = db.prepare(`
            INSERT INTO products (reference, name, category_id, purchase_price, sale_price, stock, min_stock, has_imei, description) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(reference, name, category_id || null, purchase_price || 0, sale_price || 0, stock || 0, min_stock || 5, has_imei ? 1 : 0, description || '');

        res.json({ id: result.lastInsertRowid, message: 'Produit ajouté' });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.put('/api/products/:id', authMiddleware, (req, res) => {
    try {
        const { reference, name, category_id, purchase_price, sale_price, stock, min_stock, has_imei, description } = req.body;
        if (!reference || !name) return res.status(400).json({ error: 'Référence et nom requis' });

        const existing = db.prepare('SELECT id FROM products WHERE reference = ? AND id != ?').get(reference, req.params.id);
        if (existing) return res.status(400).json({ error: 'Référence déjà utilisée' });

        db.prepare(`
            UPDATE products SET reference=?, name=?, category_id=?, purchase_price=?, sale_price=?, stock=?, min_stock=?, has_imei=?, description=? WHERE id=?
        `).run(reference, name, category_id || null, purchase_price || 0, sale_price || 0, stock || 0, min_stock || 5, has_imei ? 1 : 0, description || '', req.params.id);

        res.json({ message: 'Produit modifié' });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.delete('/api/products/:id', authMiddleware, (req, res) => {
    try {
        const result = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
        if (result.changes === 0) return res.status(404).json({ error: 'Produit non trouvé' });
        res.json({ message: 'Produit supprimé' });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ===================== CATEGORIES =====================

app.get('/api/categories', authMiddleware, (req, res) => {
    res.json(db.prepare('SELECT * FROM categories ORDER BY name').all());
});

app.post('/api/categories', authMiddleware, (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'Nom requis' });
        const result = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)').run(name, description || '');
        res.json({ id: result.lastInsertRowid });
    } catch (e) {
        if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Catégorie déjà existante' });
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ===================== STOCK MOVEMENTS =====================

app.get('/api/stock-movements', authMiddleware, (req, res) => {
    try {
        let query = `
            SELECT m.*, p.name as product_name, s.name as supplier_name 
            FROM stock_movements m 
            LEFT JOIN products p ON m.product_id = p.id 
            LEFT JOIN suppliers s ON m.supplier_id = s.id
        `;
        const params = [];
        const conditions = [];
        if (req.query.product_id) { conditions.push('m.product_id = ?'); params.push(req.query.product_id); }
        if (req.query.type) { conditions.push('m.type = ?'); params.push(req.query.type); }
        if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY m.created_at DESC LIMIT 100';
        res.json(db.prepare(query).all(...params));
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/stock-movements', authMiddleware, (req, res) => {
    try {
        const { product_id, type, quantity, reason, supplier_id } = req.body;
        if (!product_id || !type || !quantity) return res.status(400).json({ error: 'Champs requis' });

        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
        if (!product) return res.status(404).json({ error: 'Produit non trouvé' });

        let newStock = product.stock;
        if (type === 'entry') newStock += quantity;
        else if (type === 'exit') newStock -= quantity;
        else if (type === 'adjustment') newStock -= quantity;

        if (newStock < 0) return res.status(400).json({ error: 'Stock insuffisant' });

        db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(newStock, product_id);
        db.prepare('INSERT INTO stock_movements (product_id, type, quantity, reason, supplier_id) VALUES (?, ?, ?, ?, ?)')
            .run(product_id, type, quantity, reason || '', supplier_id || null);

        res.json({ message: 'Mouvement enregistré', newStock });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ===================== SALES =====================

app.get('/api/sales', authMiddleware, (req, res) => {
    try {
        let query = `
            SELECT s.*, c.name as customer_name 
            FROM sales s LEFT JOIN customers c ON s.customer_id = c.id
        `;
        const params = [];
        if (req.query.customer_id) {
            query += ' WHERE s.customer_id = ?';
            params.push(req.query.customer_id);
        }
        query += ' ORDER BY s.created_at DESC LIMIT 100';
        res.json(db.prepare(query).all(...params));
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/sales/:id', authMiddleware, (req, res) => {
    try {
        const sale = db.prepare(`
            SELECT s.*, c.name as customer_name 
            FROM sales s LEFT JOIN customers c ON s.customer_id = c.id 
            WHERE s.id = ?
        `).get(req.params.id);
        if (!sale) return res.status(404).json({ error: 'Vente non trouvée' });
        const items = db.prepare('SELECT si.*, p.name as product_name FROM sale_items si JOIN products p ON si.product_id = p.id WHERE si.sale_id = ?').all(req.params.id);
        res.json({ ...sale, items });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/sales', authMiddleware, (req, res) => {
    try {
        const { customer_id, payment_method, items, discount } = req.body;
        if (!items || items.length === 0) return res.status(400).json({ error: 'Au moins un produit requis' });

        let total = 0;
        const saleItems = [];

        for (const item of items) {
            const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
            if (!product) return res.status(404).json({ error: `Produit #${item.product_id} non trouvé` });
            if (product.stock < item.quantity) return res.status(400).json({ error: `Stock insuffisant pour ${product.name}` });
            total += product.sale_price * item.quantity;
            saleItems.push({ product_id: item.product_id, quantity: item.quantity, unit_price: product.sale_price });
        }

        const discountAmount = total * ((discount || 0) / 100);
        total -= discountAmount;

        const saleResult = db.prepare('INSERT INTO sales (customer_id, total, payment_method, discount) VALUES (?, ?, ?, ?)').run(customer_id || null, total, payment_method || 'cash', discount || 0);
        const saleId = saleResult.lastInsertRowid;

        const insertItem = db.prepare('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)');
        for (const si of saleItems) {
            insertItem.run(saleId, si.product_id, si.quantity, si.unit_price);
            db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(si.quantity, si.product_id);
            db.prepare('INSERT INTO stock_movements (product_id, type, quantity, reason) VALUES (?, ?, ?, ?)').run(si.product_id, 'exit', si.quantity, `Vente #V-${saleId}`);
        }

        if (customer_id) {
            db.prepare('UPDATE customers SET total_purchases = total_purchases + ? WHERE id = ?').run(total, customer_id);
            if (payment_method === 'credit') {
                db.prepare('INSERT INTO credits (customer_id, sale_id, amount, status) VALUES (?, ?, ?, ?)').run(customer_id, saleId, total, 'unpaid');
                db.prepare('UPDATE customers SET total_credit = total_credit + ? WHERE id = ?').run(total, customer_id);
            }
        }

        res.json({ id: saleId, total, message: 'Vente enregistrée' });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ===================== CUSTOMERS =====================

app.get('/api/customers', authMiddleware, (req, res) => {
    try {
        let query = 'SELECT * FROM customers';
        const params = [];
        if (req.query.search) {
            query += ' WHERE name LIKE ? OR phone LIKE ?';
            params.push(`%${req.query.search}%`, `%${req.query.search}%`);
        }
        query += ' ORDER BY name';
        res.json(db.prepare(query).all(...params));
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/customers/:id', authMiddleware, (req, res) => {
    try {
        const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
        if (!customer) return res.status(404).json({ error: 'Client non trouvé' });
        customer.sales = db.prepare('SELECT * FROM sales WHERE customer_id = ? ORDER BY created_at DESC LIMIT 10').all(req.params.id);
        customer.credits = db.prepare('SELECT * FROM credits WHERE customer_id = ?').all(req.params.id);
        res.json(customer);
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/customers', authMiddleware, (req, res) => {
    try {
        const { name, phone, email, address } = req.body;
        if (!name) return res.status(400).json({ error: 'Nom requis' });
        const result = db.prepare('INSERT INTO customers (name, phone, email, address) VALUES (?, ?, ?, ?)').run(name, phone || '', email || '', address || '');
        res.json({ id: result.lastInsertRowid, message: 'Client ajouté' });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.put('/api/customers/:id', authMiddleware, (req, res) => {
    try {
        const { name, phone, email, address } = req.body;
        if (!name) return res.status(400).json({ error: 'Nom requis' });
        db.prepare('UPDATE customers SET name=?, phone=?, email=?, address=? WHERE id=?').run(name, phone || '', email || '', address || '', req.params.id);
        res.json({ message: 'Client modifié' });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.delete('/api/customers/:id', authMiddleware, (req, res) => {
    try {
        const result = db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
        if (result.changes === 0) return res.status(404).json({ error: 'Client non trouvé' });
        res.json({ message: 'Client supprimé' });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ===================== SUPPLIERS =====================

app.get('/api/suppliers', authMiddleware, (req, res) => {
    res.json(db.prepare('SELECT * FROM suppliers ORDER BY name').all());
});

app.post('/api/suppliers', authMiddleware, (req, res) => {
    try {
        const { name, phone, email, products } = req.body;
        if (!name) return res.status(400).json({ error: 'Nom requis' });
        const result = db.prepare('INSERT INTO suppliers (name, phone, email, products) VALUES (?, ?, ?, ?)').run(name, phone || '', email || '', products || '');
        res.json({ id: result.lastInsertRowid });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.put('/api/suppliers/:id', authMiddleware, (req, res) => {
    try {
        const { name, phone, email, products } = req.body;
        if (!name) return res.status(400).json({ error: 'Nom requis' });
        db.prepare('UPDATE suppliers SET name=?, phone=?, email=?, products=? WHERE id=?').run(name, phone || '', email || '', products || '', req.params.id);
        res.json({ message: 'Fournisseur modifié' });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.delete('/api/suppliers/:id', authMiddleware, (req, res) => {
    try {
        const result = db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id);
        if (result.changes === 0) return res.status(404).json({ error: 'Fournisseur non trouvé' });
        res.json({ message: 'Fournisseur supprimé' });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ===================== CREDITS =====================

app.get('/api/credits', authMiddleware, (req, res) => {
    try {
        let query = `
            SELECT cr.*, c.name as customer_name 
            FROM credits cr 
            JOIN customers c ON cr.customer_id = c.id
        `;
        const params = [];
        if (req.query.customer_id) { query += ' WHERE cr.customer_id = ?'; params.push(req.query.customer_id); }
        if (req.query.status) { query += (params.length ? ' AND' : ' WHERE') + ' cr.status = ?'; params.push(req.query.status); }
        query += ' ORDER BY cr.created_at DESC';
        res.json(db.prepare(query).all(...params));
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/credits/pay', authMiddleware, (req, res) => {
    try {
        const { credit_id, amount } = req.body;
        if (!credit_id || !amount || amount <= 0) return res.status(400).json({ error: 'Montant invalide' });

        const credit = db.prepare('SELECT * FROM credits WHERE id = ?').get(credit_id);
        if (!credit) return res.status(404).json({ error: 'Crédit non trouvé' });

        const newPaid = credit.paid + amount;
        if (newPaid > credit.amount) return res.status(400).json({ error: 'Montant supérieur à la dette' });

        const status = newPaid >= credit.amount ? 'paid' : 'partial';
        db.prepare('UPDATE credits SET paid = ?, status = ? WHERE id = ?').run(newPaid, status, credit_id);
        db.prepare('UPDATE customers SET total_credit = total_credit - ? WHERE id = ?').run(amount, credit.customer_id);

        res.json({ message: 'Paiement enregistré', credit: { ...credit, paid: newPaid, status } });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ===================== SETTINGS =====================

app.get('/api/settings', authMiddleware, (req, res) => {
    try {
        const rows = db.prepare('SELECT key, value FROM settings').all();
        const settings = {};
        rows.forEach(r => settings[r.key] = r.value);
        res.json(settings);
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.put('/api/settings', authMiddleware, (req, res) => {
    try {
        const update = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        Object.entries(req.body).forEach(([key, value]) => update.run(key, value));
        res.json({ message: 'Paramètres sauvegardés' });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ===================== REPORTS =====================

app.get('/api/reports/profit', authMiddleware, (req, res) => {
    try {
        const items = db.prepare(`
            SELECT p.name, p.purchase_price,
                COALESCE(SUM(si.quantity), 0) as qty_sold,
                COALESCE(SUM(si.quantity * si.unit_price), 0) as revenue,
                COALESCE(SUM(si.quantity * p.purchase_price), 0) as cost
            FROM products p
            LEFT JOIN sale_items si ON p.id = si.product_id
            GROUP BY p.id
            HAVING qty_sold > 0
            ORDER BY (revenue - cost) DESC
        `).all();

        const enriched = items.map(i => ({ ...i, profit: i.revenue - i.cost }));
        const totalRevenue = enriched.reduce((s, i) => s + i.revenue, 0);
        const totalCost = enriched.reduce((s, i) => s + i.cost, 0);

        res.json({ items: enriched, totalRevenue, totalCost, totalProfit: totalRevenue - totalCost });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ===================== EXPORT/IMPORT =====================

app.get('/api/export', authMiddleware, (req, res) => {
    try {
        const data = {
            exported_at: new Date().toISOString(),
            products: db.prepare('SELECT * FROM products').all(),
            categories: db.prepare('SELECT * FROM categories').all(),
            customers: db.prepare('SELECT * FROM customers').all(),
            suppliers: db.prepare('SELECT * FROM suppliers').all(),
            sales: db.prepare('SELECT * FROM sales').all(),
            sale_items: db.prepare('SELECT * FROM sale_items').all(),
            credits: db.prepare('SELECT * FROM credits').all(),
            stock_movements: db.prepare('SELECT * FROM stock_movements').all(),
            imeis: db.prepare('SELECT * FROM imeis').all(),
            settings: db.prepare('SELECT * FROM settings').all()
        };
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ===================== HEALTH =====================

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ===================== RESET =====================

app.post('/api/reset', authMiddleware, (req, res) => {
    try {
        db.exec(`
            DELETE FROM sale_items;
            DELETE FROM sales;
            DELETE FROM credits;
            DELETE FROM stock_movements;
            DELETE FROM imeis;
            DELETE FROM products;
            DELETE FROM customers;
            DELETE FROM suppliers;
            DELETE FROM categories;
            DELETE FROM settings;
        `);
        // Re-seed defaults
        const { seedDefaults } = { seed_defaults: null }; // Reuse
        const adminHash = bcrypt.hashSync('admin123', 12);
        db.prepare('INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', adminHash, 'owner');
        const cats = ['Téléphone', 'Accessoire', 'Tablette', 'Ordinateur', 'Carte SIM', 'Forfait'];
        const insertCat = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
        cats.forEach(c => insertCat.run(c));
        const settings = {
            store_name: 'TelecomStock Pro',
            store_address: 'Ouagadougou, Burkina Faso',
            store_phone: '+226 25 XX XX XX',
            currency: 'FCFA',
            vat_rate: '18',
            min_stock_alert: '5'
        };
        const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        Object.entries(settings).forEach(([k, v]) => insertSetting.run(k, v));

        res.json({ message: 'Base réinitialisée' });
    } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ===================== START =====================

if (require.main === module) {
    app.listen(PORT, '127.0.0.1', () => {
        console.log(`✅ Serveur TelecomStock sur http://localhost:${PORT}`);
    });
}

module.exports = app;
