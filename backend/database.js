/**
 * TelecomStock Pro — Backend SQLite unique
 * Architecture : Express + better-sqlite3 + JWT
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.TS_DB_PATH || path.join(__dirname, '..', 'data', 'telecom-stock.db');

// Créer le dossier data si nécessaire
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialiser le schéma
function initSchema() {
    db.exec(`
        -- Utilisateurs
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'owner',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Catégories
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            description TEXT DEFAULT ''
        );

        -- Produits
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reference TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            category_id INTEGER REFERENCES categories(id),
            purchase_price REAL DEFAULT 0,
            sale_price REAL DEFAULT 0,
            stock INTEGER DEFAULT 0,
            min_stock INTEGER DEFAULT 5,
            has_imei INTEGER DEFAULT 0,
            description TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- IMEI
        CREATE TABLE IF NOT EXISTS imeis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products(id),
            imei TEXT UNIQUE NOT NULL,
            status TEXT DEFAULT 'in_stock',
            sale_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Clients
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT DEFAULT '',
            email TEXT DEFAULT '',
            address TEXT DEFAULT '',
            total_purchases REAL DEFAULT 0,
            total_credit REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Fournisseurs
        CREATE TABLE IF NOT EXISTS suppliers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT DEFAULT '',
            email TEXT DEFAULT '',
            products TEXT DEFAULT '',
            total_orders INTEGER DEFAULT 0,
            last_order_date TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Ventes
        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER REFERENCES customers(id),
            total REAL NOT NULL,
            payment_method TEXT DEFAULT 'cash',
            discount REAL DEFAULT 0,
            status TEXT DEFAULT 'completed',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Détails vente
        CREATE TABLE IF NOT EXISTS sale_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
            product_id INTEGER NOT NULL REFERENCES products(id),
            quantity INTEGER NOT NULL,
            unit_price REAL NOT NULL,
            imei_id INTEGER REFERENCES imeis(id)
        );

        -- Crédits
        CREATE TABLE IF NOT EXISTS credits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL REFERENCES customers(id),
            sale_id INTEGER REFERENCES sales(id),
            amount REAL NOT NULL,
            paid REAL DEFAULT 0,
            status TEXT DEFAULT 'unpaid',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Mouvements stock
        CREATE TABLE IF NOT EXISTS stock_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products(id),
            type TEXT NOT NULL CHECK(type IN ('entry', 'exit', 'adjustment')),
            quantity INTEGER NOT NULL,
            reason TEXT DEFAULT '',
            supplier_id INTEGER REFERENCES suppliers(id),
            unit_price REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Paramètres
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT DEFAULT ''
        );

        -- Index pour performance
        CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
        CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock);
        CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
        CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(created_at);
        CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
        CREATE INDEX IF NOT EXISTS idx_imeis_product ON imeis(product_id);
        CREATE INDEX IF NOT EXISTS idx_credits_customer ON credits(customer_id);
    `);
}

// Insérer les données par défaut
function seedDefaults() {
    // Admin user
    const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
    if (!adminExists) {
        const hash = bcrypt.hashSync('admin123', 12);
        db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', hash, 'owner');
    }

    // Catégories
    const cats = ['Téléphone', 'Accessoire', 'Tablette', 'Ordinateur', 'Carte SIM', 'Forfait'];
    const insertCat = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
    cats.forEach(c => insertCat.run(c));

    // Paramètres par défaut
    const settings = {
        store_name: 'TelecomStock Pro',
        store_address: 'Ouagadougou, Burkina Faso',
        store_phone: '+226 25 XX XX XX',
        currency: 'FCFA',
        vat_rate: '18',
        min_stock_alert: '5',
        ifu: '',
        company_slogan: 'Votre partenaire télécom'
    };
    const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    Object.entries(settings).forEach(([k, v]) => insertSetting.run(k, v));
}

// Produits de démonstration
function seedDemoData() {
    db.pragma('foreign_keys = OFF');
    const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
    if (productCount > 0) { db.pragma('foreign_keys = ON'); return; }

    const products = [
        ['PRD-001', 'iPhone 15 Pro Max', 1, 520000, 650000, 3, 5, 1],
        ['PRD-002', 'Samsung Galaxy S24 Ultra', 1, 440000, 550000, 8, 5, 1],
        ['PRD-003', 'Xiaomi Redmi Note 13', 1, 95000, 125000, 45, 10, 1],
        ['PRD-004', 'Tecno Spark 20 Pro', 1, 75000, 95000, 32, 10, 1],
        ['PRD-005', 'Chargeur USB-C 20W', 2, 3500, 7000, 12, 10, 0],
        ['PRD-006', 'Écouteurs Bluetooth', 2, 8000, 15000, 25, 10, 0],
        ['PRD-007', 'Coque iPhone 15 Pro', 2, 2000, 5000, 67, 20, 0],
        ['PRD-008', 'Protecteur écran verre', 2, 1500, 3000, 120, 30, 0]
    ];
    const insertProd = db.prepare('INSERT INTO products (reference, name, category_id, purchase_price, sale_price, stock, min_stock, has_imei) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    products.forEach(p => insertProd.run(...p));

    const customers = [
        ['Moussa Konaté', '07 12 34 56', 'moussa@email.com', 'Ouagadougou', 1850000, 0],
        ['Aminata Traoré', '06 98 76 54', 'aminata@email.com', 'Ouagadougou', 1200000, 0],
        ['Ibrahim Ouédraogo', '07 55 44 33', 'ibrahim@email.com', 'Bobo-Dioulasso', 2340000, 125000],
        ['Fatima Sanou', '06 22 11 44', 'fatima@email.com', 'Ouagadougou', 185000, 0],
        ['Rashid Belem', '07 88 99 00', 'rashid@email.com', 'Koudougou', 565000, 0]
    ];
    const insertCust = db.prepare('INSERT INTO customers (name, phone, email, address, total_purchases, total_credit) VALUES (?, ?, ?, ?, ?, ?)');
    customers.forEach(c => insertCust.run(...c));

    const suppliers = [
        ['Samsung Burkina', '+226 25 30 00 00', 'contact@samsung-bf.com', 'Téléphones Samsung', 12, '2026-08-28'],
        ['iPhone Distributor BF', '+226 25 31 00 00', 'info@iphone-bf.com', 'iPhone Apple', 8, '2026-08-30'],
        ['Xiaomi Officiel', '+226 25 32 00 00', 'bf@xiaomi.com', 'Xiaomi, Redmi, POCO', 15, '2026-08-25'],
        ['Tecno Mobile BF', '+226 25 33 00 00', 'contact@tecno-bf.com', 'Tecno, Infinix', 6, '2026-09-01'],
        ['Accessoires Pro', '+226 25 34 00 00', 'accessoires@pro.com', 'Chargeurs, écouteurs, coques', 20, '2026-09-02']
    ];
    const insertSupp = db.prepare('INSERT INTO suppliers (name, phone, email, products, total_orders, last_order_date) VALUES (?, ?, ?, ?, ?, ?)');
    suppliers.forEach(s => insertSupp.run(...s));

    // Ventes de démonstration
    const sales = [
        [1, 650000, 'cash', 0, 'completed', '2026-09-03 10:30:00'],
        [2, 550000, 'cash', 0, 'completed', '2026-09-03 14:15:00'],
        [3, 125000, 'credit', 0, 'completed', '2026-09-02 09:00:00'],
        [4, 35000, 'cash', 0, 'completed', '2026-09-02 16:45:00'],
        [5, 190000, 'cash', 0, 'completed', '2026-09-01 11:20:00']
    ];
    const insertSale = db.prepare('INSERT INTO sales (customer_id, total, payment_method, discount, status, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    sales.forEach(s => insertSale.run(...s));

    // Détails vente
    const items = [
        [1042, 1, 1, 650000],
        [1041, 2, 1, 550000],
        [1040, 3, 1, 125000],
        [1039, 6, 1, 15000],
        [1039, 7, 1, 5000],
        [1038, 4, 2, 95000]
    ];
    const insertItem = db.prepare('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)');
    items.forEach(i => insertItem.run(...i));

    // Mouvements de stock
    const movements = [
        [2, 'entry', 10, 'Réception fournisseur', 1, 440000, '2026-09-03 08:00:00'],
        [1, 'exit', 1, 'Vente #V-1042', null, null, '2026-09-03 10:30:00'],
        [6, 'entry', 20, 'Réception fournisseur', 5, 8000, '2026-09-02 08:00:00']
    ];
    const insertMov = db.prepare('INSERT INTO stock_movements (product_id, type, quantity, reason, supplier_id, unit_price, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    movements.forEach(m => insertMov.run(...m));

    // Crédit de démo
    db.prepare('INSERT INTO credits (customer_id, sale_id, amount, paid, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(3, 1040, 125000, 0, 'unpaid', '2026-09-02 09:00:00');
}

initSchema();
seedDefaults();
seedDemoData();

module.exports = db;
