const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'telecom-stock.db');
const db = new Database(dbPath);

// Activer les clés étrangères
db.pragma('foreign_keys = ON');

// Créer les tables
function initDatabase() {
    db.exec(`
        -- Table des utilisateurs
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'owner',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Table des catégories
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            description TEXT
        );

        -- Table des produits
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reference TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            category_id INTEGER,
            purchase_price REAL DEFAULT 0,
            sale_price REAL DEFAULT 0,
            stock INTEGER DEFAULT 0,
            min_stock INTEGER DEFAULT 5,
            has_imei INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (category_id) REFERENCES categories(id)
        );

        -- Table des IMEI
        CREATE TABLE IF NOT EXISTS imeis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            imei TEXT UNIQUE NOT NULL,
            status TEXT DEFAULT 'in_stock',
            sale_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(id)
        );

        -- Table des clients
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            email TEXT,
            address TEXT,
            total_purchases REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Table des fournisseurs
        CREATE TABLE IF NOT EXISTS suppliers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            email TEXT,
            products TEXT,
            total_orders INTEGER DEFAULT 0,
            last_order_date DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Table des ventes
        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER,
            total REAL NOT NULL,
            payment_method TEXT DEFAULT 'cash',
            status TEXT DEFAULT 'completed',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (customer_id) REFERENCES customers(id)
        );

        -- Table des détails de vente
        CREATE TABLE IF NOT EXISTS sale_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            unit_price REAL NOT NULL,
            imei_id INTEGER,
            FOREIGN KEY (sale_id) REFERENCES sales(id),
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (imei_id) REFERENCES imeis(id)
        );

        -- Table des mouvements de stock
        CREATE TABLE IF NOT EXISTS stock_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            reason TEXT,
            supplier_id INTEGER,
            unit_price REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
        );

        -- Table des paramètres
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);

    // Insérer les données par défaut
    const insertUser = db.prepare('INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)');
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    insertUser.run('admin', hashedPassword, 'owner');

    // Catégories par défaut
    const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name, description) VALUES (?, ?)');
    insertCategory.run('Téléphone', 'Téléphones mobiles et smartphones');
    insertCategory.run('Accessoire', 'Chargeurs, écouteurs, coques, etc.');
    insertCategory.run('Forfait', 'Forfaits et cartes de recharge');
    insertCategory.run('Carte SIM', 'Cartes SIM et accessoires réseau');

    // Paramètres par défaut
    const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    insertSetting.run('store_name', 'TelecomStock Ouaga');
    insertSetting.run('store_address', 'Ouagadougou, Burkina Faso');
    insertSetting.run('store_phone', '+226 25 XX XX XX');
    insertSetting.run('currency', 'FCFA');
    insertSetting.run('vat_rate', '18');
    insertSetting.run('min_stock_alert', '5');
    insertSetting.run('ifu', '0000000000000');

    // Produits de démonstration
    const insertProduct = db.prepare(`
        INSERT OR IGNORE INTO products (reference, name, category_id, purchase_price, sale_price, stock, min_stock, has_imei) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const categories = db.prepare('SELECT * FROM categories').all();
    const getCatId = (name) => categories.find(c => c.name === name)?.id;

    insertProduct.run('PRD-001', 'iPhone 15 Pro Max 256Go', getCatId('Téléphone'), 520000, 650000, 2, 5, 1);
    insertProduct.run('PRD-002', 'Samsung Galaxy S24 Ultra', getCatId('Téléphone'), 440000, 550000, 8, 5, 1);
    insertProduct.run('PRD-003', 'Xiaomi Redmi Note 13', getCatId('Téléphone'), 95000, 125000, 45, 10, 1);
    insertProduct.run('PRD-004', 'Tecno Spark 20 Pro', getCatId('Téléphone'), 75000, 95000, 32, 10, 1);
    insertProduct.run('PRD-005', 'Chargeur USB-C 20W', getCatId('Accessoire'), 3500, 7000, 5, 10, 0);
    insertProduct.run('PRD-006', 'Écouteurs Bluetooth', getCatId('Accessoire'), 8000, 15000, 28, 10, 0);
    insertProduct.run('PRD-007', 'Coque iPhone 15 Pro', getCatId('Accessoire'), 2000, 5000, 67, 20, 0);
    insertProduct.run('PRD-008', 'Protecteur écran verre', getCatId('Accessoire'), 1500, 3000, 120, 30, 0);

    // Clients de démonstration
    const insertCustomer = db.prepare(`
        INSERT OR IGNORE INTO customers (name, phone, email, address, total_purchases) 
        VALUES (?, ?, ?, ?, ?)
    `);
    insertCustomer.run('Moussa Konaté', '07 12 34 56', 'moussa@email.com', 'Ouagadougou', 1850000);
    insertCustomer.run('Aminata Traoré', '06 98 76 54', 'aminata@email.com', 'Ouagadougou', 1200000);
    insertCustomer.run('Ibrahim Ouédraogo', '07 55 44 33', 'ibrahim@email.com', 'Bobo-Dioulasso', 2340000);
    insertCustomer.run('Fatima Sanou', '06 22 11 44', 'fatima@email.com', 'Ouagadougou', 185000);
    insertCustomer.run('Rashid Belem', '07 88 99 00', 'rashid@email.com', 'Koudougou', 565000);

    // Fournisseurs de démonstration
    const insertSupplier = db.prepare(`
        INSERT OR IGNORE INTO suppliers (name, phone, email, products, total_orders, last_order_date) 
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertSupplier.run('Samsung Burkina', '+226 25 30 00 00', 'contact@sn-telecom.com', 'Téléphones Samsung', 12, '2026-08-28');
    insertSupplier.run('iPhone Distributor BF', '+226 25 31 00 00', 'info@iphone-bf.com', 'iPhone Apple', 8, '2026-08-30');
    insertSupplier.run('Xiaomi Officiel', '+226 25 32 00 00', 'bf@xiaomi-distri.com', 'Xiaomi, Redmi, POCO', 15, '2026-08-25');
    insertSupplier.run('Tecno Mobile BF', '+226 25 33 00 00', 'contact@tecno-bf.com', 'Tecno, Infinix', 6, '2026-09-01');
    insertSupplier.run('Accessoires Pro', '+226 25 34 00 00', 'accessoires@pro.com', 'Chargeurs, écouteurs, coques', 20, '2026-09-02');

    // Ventes de démonstration
    const insertSale = db.prepare(`
        INSERT OR IGNORE INTO sales (id, customer_id, total, payment_method, status, created_at) 
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertSale.run(1042, 1, 650000, 'cash', 'completed', '2026-09-03 10:30:00');
    insertSale.run(1041, 2, 550000, 'cash', 'completed', '2026-09-03 14:15:00');
    insertSale.run(1040, 3, 125000, 'credit', 'completed', '2026-09-02 09:00:00');
    insertSale.run(1039, 4, 35000, 'cash', 'completed', '2026-09-02 16:45:00');
    insertSale.run(1038, 5, 190000, 'cash', 'completed', '2026-09-01 11:20:00');

    // Détails des ventes
    const insertSaleItem = db.prepare(`
        INSERT OR IGNORE INTO sale_items (sale_id, product_id, quantity, unit_price) 
        VALUES (?, ?, ?, ?)
    `);
    insertSaleItem.run(1042, 1, 1, 650000);
    insertSaleItem.run(1041, 2, 1, 550000);
    insertSaleItem.run(1040, 3, 1, 125000);
    insertSaleItem.run(1039, 6, 1, 15000);
    insertSaleItem.run(1039, 7, 1, 5000);
    insertSaleItem.run(1038, 4, 2, 95000);

    // Mouvements de stock de démonstration
    const insertMovement = db.prepare(`
        INSERT OR IGNORE INTO stock_movements (product_id, type, quantity, reason, supplier_id, unit_price, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertMovement.run(2, 'entry', 10, 'Réception fournisseur', 1, 440000, '2026-09-03 08:00:00');
    insertMovement.run(1, 'exit', 1, 'Vente #V-1042', null, null, '2026-09-03 10:30:00');
    insertMovement.run(6, 'entry', 20, 'Réception fournisseur', 5, 8000, '2026-09-02 08:00:00');
    insertMovement.run(3, 'exit', 1, 'Vente #V-1040', null, null, '2026-09-02 09:00:00');
    insertMovement.run(5, 'adjustment', 2, 'Casse/Perte', null, null, '2026-09-01 15:00:00');

    console.log('✅ Base de données initialisée avec succès');
}

initDatabase();

module.exports = db;
