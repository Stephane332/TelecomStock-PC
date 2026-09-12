/**
 * TelecomStock Pro — Couche base de données (SQLite)
 *
 * Principes :
 *  - Clés étrangères TOUJOURS actives (aucun seed ne les désactive)
 *  - Le seed insère les ventes puis récupère les vrais IDs générés
 *  - Chemin de la base injectable via TS_DATA_DIR (Electron passe userData)
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.TS_DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'telecom-stock.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initSchema() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'owner',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            description TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reference TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
            purchase_price REAL NOT NULL DEFAULT 0,
            sale_price REAL NOT NULL DEFAULT 0,
            stock INTEGER NOT NULL DEFAULT 0,
            min_stock INTEGER NOT NULL DEFAULT 5,
            has_imei INTEGER NOT NULL DEFAULT 0,
            description TEXT NOT NULL DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT NOT NULL DEFAULT '',
            email TEXT NOT NULL DEFAULT '',
            address TEXT NOT NULL DEFAULT '',
            total_purchases REAL NOT NULL DEFAULT 0,
            total_credit REAL NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS suppliers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT NOT NULL DEFAULT '',
            email TEXT NOT NULL DEFAULT '',
            products TEXT NOT NULL DEFAULT '',
            total_orders INTEGER NOT NULL DEFAULT 0,
            last_order_date TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
            total REAL NOT NULL,
            payment_method TEXT NOT NULL DEFAULT 'cash',
            discount REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'completed',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sale_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
            quantity INTEGER NOT NULL,
            unit_price REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS imeis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            imei TEXT UNIQUE NOT NULL,
            status TEXT NOT NULL DEFAULT 'in_stock',
            sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS credits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
            sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
            amount REAL NOT NULL,
            paid REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'unpaid',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS stock_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            type TEXT NOT NULL CHECK(type IN ('entry','exit','adjustment')),
            quantity INTEGER NOT NULL,
            reason TEXT NOT NULL DEFAULT '',
            supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
            unit_price REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
        CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock);
        CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
        CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(created_at);
        CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
        CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
        CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id);
        CREATE INDEX IF NOT EXISTS idx_credits_customer ON credits(customer_id);
        CREATE INDEX IF NOT EXISTS idx_credits_status ON credits(status);
    `);
}

const DEFAULT_CATEGORIES = ['Téléphone', 'Accessoire', 'Tablette', 'Ordinateur', 'Carte SIM', 'Forfait'];

const DEFAULT_SETTINGS = {
    store_name: 'TelecomStock Pro',
    store_address: 'Ouagadougou, Burkina Faso',
    store_phone: '+226 25 00 00 00',
    currency: 'FCFA',
    vat_rate: '18',
    min_stock_alert: '5',
    ifu: ''
};

/** Secret JWT persistant : généré une fois, conservé en base. */
function getOrCreateJwtSecret() {
    const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get('jwt_secret');
    if (row) return row.value;
    const secret = require('crypto').randomBytes(48).toString('hex');
    db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run('jwt_secret', secret);
    return secret;
}

function seedBaseline() {
    const hasAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
    if (!hasAdmin) {
        db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
            .run('admin', bcrypt.hashSync('admin123', 12), 'owner');
    }
    const insCat = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
    DEFAULT_CATEGORIES.forEach(c => insCat.run(c));

    const insSet = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    Object.entries(DEFAULT_SETTINGS).forEach(([k, v]) => insSet.run(k, v));
}

/**
 * Jeu de démonstration cohérent.
 * Les ventes sont insérées puis leurs IDs RÉELS sont réutilisés pour les lignes,
 * donc aucune ligne orpheline — les FK restent actives en permanence.
 */
const seedDemo = db.transaction(() => {
    if (db.prepare('SELECT COUNT(*) c FROM products').get().c > 0) return false;

    const catId = name => db.prepare('SELECT id FROM categories WHERE name = ?').get(name).id;
    const TEL = catId('Téléphone');
    const ACC = catId('Accessoire');

    const insProd = db.prepare(`INSERT INTO products
        (reference,name,category_id,purchase_price,sale_price,stock,min_stock,has_imei)
        VALUES (?,?,?,?,?,?,?,?)`);
    const P = {};
    [
        ['PRD-001', 'iPhone 15 Pro Max', TEL, 520000, 650000, 3, 5, 1],
        ['PRD-002', 'Samsung Galaxy S24 Ultra', TEL, 440000, 550000, 8, 5, 1],
        ['PRD-003', 'Xiaomi Redmi Note 13', TEL, 95000, 125000, 45, 10, 1],
        ['PRD-004', 'Tecno Spark 20 Pro', TEL, 75000, 95000, 32, 10, 1],
        ['PRD-005', 'Chargeur USB-C 20W', ACC, 3500, 7000, 12, 10, 0],
        ['PRD-006', 'Écouteurs Bluetooth', ACC, 8000, 15000, 25, 10, 0],
        ['PRD-007', 'Coque iPhone 15 Pro', ACC, 2000, 5000, 67, 20, 0],
        ['PRD-008', 'Protecteur écran verre', ACC, 1500, 3000, 120, 30, 0]
    ].forEach(r => { P[r[0]] = insProd.run(...r).lastInsertRowid; });

    const insCust = db.prepare(`INSERT INTO customers
        (name,phone,email,address,total_purchases,total_credit) VALUES (?,?,?,?,?,?)`);
    const C = [
        ['Moussa Konaté', '07 12 34 56', 'moussa@example.bf', 'Ouagadougou', 0, 0],
        ['Aminata Traoré', '06 98 76 54', 'aminata@example.bf', 'Ouagadougou', 0, 0],
        ['Ibrahim Ouédraogo', '07 55 44 33', 'ibrahim@example.bf', 'Bobo-Dioulasso', 0, 0],
        ['Fatima Sanou', '06 22 11 44', 'fatima@example.bf', 'Ouagadougou', 0, 0],
        ['Rashid Belem', '07 88 99 00', 'rashid@example.bf', 'Koudougou', 0, 0]
    ].map(r => insCust.run(...r).lastInsertRowid);

    const insSup = db.prepare(`INSERT INTO suppliers
        (name,phone,email,products,total_orders,last_order_date) VALUES (?,?,?,?,?,?)`);
    const S = [
        ['Samsung Burkina', '+226 25 30 00 00', 'contact@samsung-bf.example', 'Téléphones Samsung', 12, '2026-08-28'],
        ['iPhone Distributor BF', '+226 25 31 00 00', 'info@iphone-bf.example', 'iPhone Apple', 8, '2026-08-30'],
        ['Xiaomi Officiel', '+226 25 32 00 00', 'bf@xiaomi.example', 'Xiaomi, Redmi, POCO', 15, '2026-08-25'],
        ['Tecno Mobile BF', '+226 25 33 00 00', 'contact@tecno-bf.example', 'Tecno, Infinix', 6, '2026-09-01'],
        ['Accessoires Pro', '+226 25 34 00 00', 'accessoires@pro.example', 'Chargeurs, écouteurs', 20, '2026-09-02']
    ].map(r => insSup.run(...r).lastInsertRowid);

    // Ventes : on insère l'en-tête, on récupère l'ID réel, puis les lignes.
    const insSale = db.prepare(`INSERT INTO sales
        (customer_id,total,payment_method,discount,status,created_at) VALUES (?,?,?,?,?,?)`);
    const insItem = db.prepare(`INSERT INTO sale_items
        (sale_id,product_id,quantity,unit_price) VALUES (?,?,?,?)`);
    const insMove = db.prepare(`INSERT INTO stock_movements
        (product_id,type,quantity,reason,supplier_id,unit_price,created_at) VALUES (?,?,?,?,?,?,?)`);
    const insCredit = db.prepare(`INSERT INTO credits
        (customer_id,sale_id,amount,paid,status,created_at) VALUES (?,?,?,?,?,?)`);

    const demoSales = [
        { cust: C[0], pay: 'cash',   date: '2026-09-03 10:30:00', lines: [['PRD-001', 1, 650000]] },
        { cust: C[1], pay: 'cash',   date: '2026-09-03 14:15:00', lines: [['PRD-002', 1, 550000]] },
        { cust: C[2], pay: 'credit', date: '2026-09-02 09:00:00', lines: [['PRD-003', 1, 125000]] },
        { cust: C[3], pay: 'cash',   date: '2026-09-02 16:45:00', lines: [['PRD-006', 1, 15000], ['PRD-007', 1, 5000]] },
        { cust: C[4], pay: 'cash',   date: '2026-09-01 11:20:00', lines: [['PRD-004', 2, 95000]] }
    ];

    for (const s of demoSales) {
        const total = s.lines.reduce((sum, [, qty, price]) => sum + qty * price, 0);
        const saleId = insSale.run(s.cust, total, s.pay, 0, 'completed', s.date).lastInsertRowid;
        for (const [ref, qty, price] of s.lines) {
            insItem.run(saleId, P[ref], qty, price);
            insMove.run(P[ref], 'exit', qty, `Vente #V-${saleId}`, null, null, s.date);
        }
        db.prepare('UPDATE customers SET total_purchases = total_purchases + ? WHERE id = ?').run(total, s.cust);
        if (s.pay === 'credit') {
            insCredit.run(s.cust, saleId, total, 0, 'unpaid', s.date);
            db.prepare('UPDATE customers SET total_credit = total_credit + ? WHERE id = ?').run(total, s.cust);
        }
    }

    insMove.run(P['PRD-002'], 'entry', 10, 'Réception fournisseur', S[0], 440000, '2026-09-03 08:00:00');
    insMove.run(P['PRD-006'], 'entry', 20, 'Réception accessoires', S[4], 8000, '2026-09-02 08:00:00');

    const insImei = db.prepare('INSERT INTO imeis (product_id,imei,status) VALUES (?,?,?)');
    insImei.run(P['PRD-001'], '356789012345679', 'in_stock');
    insImei.run(P['PRD-002'], '354567890123457', 'in_stock');
    insImei.run(P['PRD-003'], '351234567890123', 'in_stock');

    return true;
});

/** Efface toutes les données métier ; conserve users, app_meta et paramètres par défaut. */
const resetBusinessData = db.transaction((withDemo) => {
    db.exec(`
        DELETE FROM sale_items;
        DELETE FROM credits;
        DELETE FROM imeis;
        DELETE FROM stock_movements;
        DELETE FROM sales;
        DELETE FROM products;
        DELETE FROM customers;
        DELETE FROM suppliers;
        DELETE FROM sqlite_sequence WHERE name IN
            ('sales','sale_items','products','customers','suppliers','credits','imeis','stock_movements');
    `);
    if (withDemo) seedDemo();
});

initSchema();
seedBaseline();
const JWT_SECRET = getOrCreateJwtSecret();

// Aucune donnée de démonstration : le commerçant démarre sur une base vierge
// et saisit son propre stock. Le jeu de démo reste exporté pour les tests.

module.exports = { db, JWT_SECRET, seedDemo, resetBusinessData, DB_PATH, DATA_DIR };
