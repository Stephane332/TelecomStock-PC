const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

// Détection de l'environnement
const isDev = !app.isPackaged;

// Chemins - détection automatique du dossier public
let basePath;
if (isDev) {
    basePath = __dirname;
} else {
    // En mode packagé, les fichiers sont dans resources/app
    basePath = path.join(process.resourcesPath, 'app');
    if (!fs.existsSync(basePath)) {
        basePath = path.join(path.dirname(app.getAppPath()), 'public');
    }
    if (!fs.existsSync(basePath)) {
        basePath = __dirname;
    }
}

const publicPath = path.join(basePath, 'public');
const dataPath = isDev ? path.join(__dirname, 'data') : path.join(app.getPath('userData'), 'data');

// Créer le dossier data si nécessaire
if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
}

// Base de données JSON
const dbFile = path.join(dataPath, 'database.json');
let db = null;

function getDefaultDb() {
    const bcrypt = require('bcryptjs');
    return {
        users: [
            { id: 1, username: 'admin', password: bcrypt.hashSync('admin123', 10), role: 'owner', created_at: new Date().toISOString() }
        ],
        categories: [
            { id: 1, name: 'Téléphone', description: 'Téléphones mobiles et smartphones' },
            { id: 2, name: 'Accessoire', description: 'Chargeurs, écouteurs, coques' },
            { id: 3, name: 'Tablette', description: 'Tablettes et iPad' },
            { id: 4, name: 'Ordinateur', description: 'Ordinateurs portables et accessoires' }
        ],
        products: [
            { id: 1, reference: 'PRD-001', name: 'iPhone 15 Pro Max', category_id: 1, purchase_price: 520000, sale_price: 650000, stock: 3, min_stock: 5, has_imei: 1, created_at: '2026-09-01' },
            { id: 2, reference: 'PRD-002', name: 'Samsung S24 Ultra', category_id: 1, purchase_price: 440000, sale_price: 550000, stock: 8, min_stock: 5, has_imei: 1, created_at: '2026-09-01' },
            { id: 3, reference: 'PRD-003', name: 'Xiaomi Redmi Note 13', category_id: 1, purchase_price: 95000, sale_price: 125000, stock: 45, min_stock: 10, has_imei: 1, created_at: '2026-09-01' },
            { id: 4, reference: 'PRD-004', name: 'Tecno Spark 20 Pro', category_id: 1, purchase_price: 75000, sale_price: 95000, stock: 32, min_stock: 10, has_imei: 1, created_at: '2026-09-01' },
            { id: 5, reference: 'PRD-005', name: 'Chargeur USB-C 20W', category_id: 2, purchase_price: 3500, sale_price: 7000, stock: 12, min_stock: 10, has_imei: 0, created_at: '2026-09-01' },
            { id: 6, reference: 'PRD-006', name: 'Écouteurs Bluetooth', category_id: 2, purchase_price: 8000, sale_price: 15000, stock: 25, min_stock: 10, has_imei: 0, created_at: '2026-09-01' },
            { id: 7, reference: 'PRD-007', name: 'Coque iPhone 15 Pro', category_id: 2, purchase_price: 2000, sale_price: 5000, stock: 67, min_stock: 20, has_imei: 0, created_at: '2026-09-01' },
            { id: 8, reference: 'PRD-008', name: 'Protecteur écran', category_id: 2, purchase_price: 1500, sale_price: 3000, stock: 120, min_stock: 30, has_imei: 0, created_at: '2026-09-01' }
        ],
        customers: [
            { id: 1, name: 'Moussa Konaté', phone: '07 12 34 56', total_purchases: 1850000, total_credit: 0, created_at: '2026-01-15' },
            { id: 2, name: 'Aminata Traoré', phone: '06 98 76 54', total_purchases: 1200000, total_credit: 0, created_at: '2026-02-22' },
            { id: 3, name: 'Ibrahim Ouédraogo', phone: '07 55 44 33', total_purchases: 2340000, total_credit: 125000, created_at: '2026-01-10' },
            { id: 4, name: 'Fatima Sanou', phone: '06 22 11 44', total_purchases: 185000, total_credit: 0, created_at: '2026-03-05' },
            { id: 5, name: 'Rashid Belem', phone: '07 88 99 00', total_purchases: 565000, total_credit: 0, created_at: '2026-02-18' }
        ],
        suppliers: [
            { id: 1, name: 'Samsung Burkina', phone: '+226 25 30 00 00', email: 'contact@samsung-bf.com', products: 'Téléphones Samsung', total_orders: 12, last_order_date: '2026-08-28' },
            { id: 2, name: 'iPhone Distributor BF', phone: '+226 25 31 00 00', email: 'info@iphone-bf.com', products: 'iPhone Apple', total_orders: 8, last_order_date: '2026-08-30' },
            { id: 3, name: 'Xiaomi Officiel', phone: '+226 25 32 00 00', email: 'bf@xiaomi.com', products: 'Xiaomi, Redmi, POCO', total_orders: 15, last_order_date: '2026-08-25' },
            { id: 4, name: 'Tecno Mobile BF', phone: '+226 25 33 00 00', email: 'contact@tecno-bf.com', products: 'Tecno, Infinix', total_orders: 6, last_order_date: '2026-09-01' },
            { id: 5, name: 'Accessoires Pro', phone: '+226 25 34 00 00', email: 'accessoires@pro.com', products: 'Chargeurs, écouteurs, coques', total_orders: 20, last_order_date: '2026-09-02' }
        ],
        sales: [
            { id: 1042, customer_id: 1, total: 650000, payment_method: 'cash', status: 'completed', created_at: '2026-09-03 10:30:00', items: [{ product_id: 1, quantity: 1, unit_price: 650000 }] },
            { id: 1041, customer_id: 2, total: 550000, payment_method: 'cash', status: 'completed', created_at: '2026-09-03 14:15:00', items: [{ product_id: 2, quantity: 1, unit_price: 550000 }] },
            { id: 1040, customer_id: 3, total: 125000, payment_method: 'credit', status: 'completed', created_at: '2026-09-02 09:00:00', items: [{ product_id: 3, quantity: 1, unit_price: 125000 }] },
            { id: 1039, customer_id: 4, total: 35000, payment_method: 'cash', status: 'completed', created_at: '2026-09-02 16:45:00', items: [{ product_id: 6, quantity: 1, unit_price: 15000 }, { product_id: 7, quantity: 1, unit_price: 5000 }] },
            { id: 1038, customer_id: 5, total: 190000, payment_method: 'cash', status: 'completed', created_at: '2026-09-01 11:20:00', items: [{ product_id: 4, quantity: 2, unit_price: 95000 }] }
        ],
        stock_movements: [
            { id: 1, product_id: 2, type: 'entry', quantity: 10, reason: 'Réception fournisseur', supplier_id: 1, created_at: '2026-09-03 08:00:00' },
            { id: 2, product_id: 1, type: 'exit', quantity: 1, reason: 'Vente #V-1042', created_at: '2026-09-03 10:30:00' },
            { id: 3, product_id: 6, type: 'entry', quantity: 20, reason: 'Réception accessoires', supplier_id: 5, created_at: '2026-09-02 08:00:00' }
        ],
        credits: [
            { id: 1, customer_id: 3, sale_id: 1040, amount: 125000, paid: 0, status: 'unpaid', created_at: '2026-09-02 09:00:00' }
        ],
        imeis: [
            { id: 1, product_id: 1, imei: '356789012345678', status: 'sold', sale_id: 1042, created_at: '2026-09-01' },
            { id: 2, product_id: 1, imei: '356789012345679', status: 'in_stock', created_at: '2026-09-01' },
            { id: 3, product_id: 2, imei: '354567890123456', status: 'sold', sale_id: 1041, created_at: '2026-09-01' }
        ],
        settings: {
            store_name: 'TelecomStock Ouaga',
            store_address: 'Ouagadougou, Burkina Faso',
            store_phone: '+226 25 XX XX XX',
            currency: 'FCFA',
            vat_rate: '18',
            min_stock_alert: '5',
            ifu: '0000000000000'
        }
    };
}

function loadDb() {
    try {
        if (fs.existsSync(dbFile)) {
            db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
        } else {
            db = getDefaultDb();
            saveDb();
        }
    } catch (e) {
        db = getDefaultDb();
        saveDb();
    }
}

function saveDb() {
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

function getNextId(collection) {
    if (!db[collection] || db[collection].length === 0) return 1;
    const max = Math.max(...db[collection].map(item => item.id || 0));
    return max + 1;
}

function findById(collection, id) {
    return db[collection].find(item => item.id === parseInt(id));
}

// Initialiser la base de données
loadDb();

// Variables globales
let mainWindow = null;
let tray = null;
let isQuitting = false;

// Créer la fenêtre principale
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        title: 'TelecomStock Pro',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        show: false,
        backgroundColor: '#1a1a2e'
    });

    // Charger l'interface
    mainWindow.loadFile(path.join(publicPath, 'index.html'));

    // Afficher la fenêtre quand elle est prête
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    // Gérer la fermeture
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            return false;
        }
    });

    // Gérer la minimisation
    mainWindow.on('minimize', (event) => {
        event.preventDefault();
        mainWindow.hide();
    });

    // Ouvrir les liens externes dans le navigateur
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

// Créer le tray (icône dans la barre des tâches)
function createTray() {
    const { nativeImage } = require('electron');
    const iconPath = path.join(publicPath, 'icon.png');
    
    let trayIcon;
    if (fs.existsSync(iconPath)) {
        trayIcon = nativeImage.createFromPath(iconPath);
    } else {
        trayIcon = nativeImage.createEmpty();
    }

    tray = new Tray(trayIcon);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '📱 Ouvrir TelecomStock',
            click: () => {
                mainWindow.show();
                mainWindow.focus();
            }
        },
        { type: 'separator' },
        {
            label: '📊 Tableau de bord',
            click: () => {
                mainWindow.show();
                mainWindow.focus();
                mainWindow.webContents.send('navigate', 'dashboard');
            }
        },
        {
            label: '📦 Produits',
            click: () => {
                mainWindow.show();
                mainWindow.focus();
                mainWindow.webContents.send('navigate', 'products');
            }
        },
        {
            label: '💰 Ventes',
            click: () => {
                mainWindow.show();
                mainWindow.focus();
                mainWindow.webContents.send('navigate', 'sales');
            }
        },
        { type: 'separator' },
        {
            label: '🚪 Quitter',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip('TelecomStock Pro - Gestion de stock');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
        mainWindow.show();
        mainWindow.focus();
    });
}

// Démarrer le serveur HTTP interne
function startServer() {
    const express = require('express');
    const cors = require('cors');
    const helmet = require('helmet');
    const bcrypt = require('bcryptjs');
    
    const app = express();
    const PORT = 3002;

    // Middleware
    app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));
    app.use(express.static(publicPath));

    // ==================== AUTH ====================
    app.post('/api/login', (req, res) => {
        try {
            const { username, password } = req.body;
            if (!username || !password) return res.status(400).json({ error: 'Identifiants requis' });
            
            const user = db.users.find(u => u.username === username);
            if (!user || !bcrypt.compareSync(password, user.password)) {
                return res.status(401).json({ error: 'Identifiants incorrects' });
            }
            res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==================== DASHBOARD ====================
    app.get('/api/dashboard', (req, res) => {
        try {
            const totalProducts = db.products.length;
            const totalStock = db.products.reduce((sum, p) => sum + p.stock, 0);
            const lowStock = db.products.filter(p => p.stock <= p.min_stock && p.stock > 0).length;
            const outOfStock = db.products.filter(p => p.stock === 0).length;
            
            const today = new Date().toISOString().split('T')[0];
            const todaySales = db.sales.filter(s => s.created_at.startsWith(today)).reduce((sum, s) => sum + s.total, 0);
            const todaySalesCount = db.sales.filter(s => s.created_at.startsWith(today)).length;
            
            const monthStart = today.substring(0, 7);
            const monthSales = db.sales.filter(s => s.created_at.startsWith(monthStart)).reduce((sum, s) => sum + s.total, 0);
            const totalImeis = db.imeis.filter(i => i.status === 'in_stock').length;
            
            const lowStockProducts = db.products.filter(p => p.stock <= p.min_stock).sort((a, b) => a.stock - b.stock).slice(0, 5).map(p => ({ name: p.name, stock: p.stock }));
            
            const recentSales = db.sales.slice(-5).reverse().map(s => {
                const customer = s.customer_id ? findById('customers', s.customer_id) : null;
                return { ...s, customer_name: customer?.name || 'Anonyme' };
            });
            
            const salesByProduct = {};
            db.sales.forEach(s => {
                if (s.items) {
                    s.items.forEach(item => {
                        salesByProduct[item.product_id] = (salesByProduct[item.product_id] || 0) + item.quantity;
                    });
                }
            });
            const topProducts = Object.entries(salesByProduct)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([productId, sold]) => ({ name: findById('products', parseInt(productId))?.name || 'Inconnu', sold }));
            
            res.json({ totalProducts, totalStock, lowStock, outOfStock, todaySales, todaySalesCount, monthSales, totalImeis, lowStockProducts, recentSales, topProducts });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==================== PRODUCTS ====================
    app.get('/api/products', (req, res) => {
        try {
            let products = db.products.map(p => {
                const category = findById('categories', p.category_id);
                return { ...p, category_name: category?.name || '' };
            });
            
            if (req.query.search) {
                const search = req.query.search.toLowerCase();
                products = products.filter(p => p.name.toLowerCase().includes(search) || p.reference.toLowerCase().includes(search));
            }
            if (req.query.category_id) {
                products = products.filter(p => p.category_id === parseInt(req.query.category_id));
            }
            if (req.query.low_stock === 'true') {
                products = products.filter(p => p.stock <= p.min_stock);
            }
            
            res.json(products);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/products/:id', (req, res) => {
        try {
            const product = findById('products', req.params.id);
            if (!product) return res.status(404).json({ error: 'Produit non trouvé' });
            const category = findById('categories', product.category_id);
            res.json({ ...product, category_name: category?.name || '' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/products', (req, res) => {
        try {
            const { reference, name, category_id, purchase_price, sale_price, stock, min_stock, has_imei, description } = req.body;
            if (!reference || !name) return res.status(400).json({ error: 'Référence et nom requis' });
            
            const existing = db.products.find(p => p.reference === reference);
            if (existing) return res.status(400).json({ error: 'Référence déjà utilisée' });
            
            const newProduct = {
                id: getNextId('products'),
                reference, name,
                category_id: category_id || null,
                purchase_price: purchase_price || 0,
                sale_price: sale_price || 0,
                stock: stock || 0,
                min_stock: min_stock || 5,
                has_imei: has_imei ? 1 : 0,
                description: description || '',
                created_at: new Date().toISOString()
            };
            
            db.products.push(newProduct);
            saveDb();
            res.json({ id: newProduct.id, message: 'Produit ajouté' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.put('/api/products/:id', (req, res) => {
        try {
            const index = db.products.findIndex(p => p.id === parseInt(req.params.id));
            if (index === -1) return res.status(404).json({ error: 'Produit non trouvé' });
            
            const { reference, name, category_id, purchase_price, sale_price, stock, min_stock, has_imei, description } = req.body;
            if (!reference || !name) return res.status(400).json({ error: 'Référence et nom requis' });
            
            const existing = db.products.find(p => p.reference === reference && p.id !== parseInt(req.params.id));
            if (existing) return res.status(400).json({ error: 'Référence déjà utilisée' });
            
            db.products[index] = {
                ...db.products[index],
                reference, name,
                category_id: category_id || null,
                purchase_price: purchase_price || 0,
                sale_price: sale_price || 0,
                stock: stock || 0,
                min_stock: min_stock || 5,
                has_imei: has_imei ? 1 : 0,
                description: description || '',
                updated_at: new Date().toISOString()
            };
            saveDb();
            res.json({ message: 'Produit modifié' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/products/:id', (req, res) => {
        try {
            const index = db.products.findIndex(p => p.id === parseInt(req.params.id));
            if (index === -1) return res.status(404).json({ error: 'Produit non trouvé' });
            
            db.products.splice(index, 1);
            saveDb();
            res.json({ message: 'Produit supprimé' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==================== CATEGORIES ====================
    app.get('/api/categories', (req, res) => {
        try {
            res.json(db.categories);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/categories', (req, res) => {
        try {
            const { name, description } = req.body;
            if (!name) return res.status(400).json({ error: 'Nom requis' });
            
            const newCategory = { id: getNextId('categories'), name, description: description || '' };
            db.categories.push(newCategory);
            saveDb();
            res.json({ id: newCategory.id });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==================== STOCK MOVEMENTS ====================
    app.get('/api/stock-movements', (req, res) => {
        try {
            let movements = db.stock_movements.map(m => {
                const product = findById('products', m.product_id);
                const supplier = m.supplier_id ? findById('suppliers', m.supplier_id) : null;
                return { ...m, product_name: product?.name || '', supplier_name: supplier?.name || '' };
            });
            
            if (req.query.product_id) {
                movements = movements.filter(m => m.product_id === parseInt(req.query.product_id));
            }
            if (req.query.type) {
                movements = movements.filter(m => m.type === req.query.type);
            }
            
            res.json(movements.slice(0, 50));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/stock-movements', (req, res) => {
        try {
            const { product_id, type, quantity, reason, supplier_id, unit_price } = req.body;
            if (!product_id || !type || !quantity) return res.status(400).json({ error: 'Champs requis' });
            
            const product = findById('products', product_id);
            if (!product) return res.status(404).json({ error: 'Produit non trouvé' });
            
            let newStock = product.stock;
            if (type === 'entry') newStock += quantity;
            else if (type === 'exit') newStock -= quantity;
            else if (type === 'adjustment') newStock -= quantity;
            
            if (newStock < 0) return res.status(400).json({ error: 'Stock insuffisant' });
            
            product.stock = newStock;
            product.updated_at = new Date().toISOString();
            
            const newMovement = {
                id: getNextId('stock_movements'),
                product_id, type, quantity,
                reason: reason || '',
                supplier_id: supplier_id || null,
                unit_price: unit_price || null,
                created_at: new Date().toISOString()
            };
            db.stock_movements.push(newMovement);
            saveDb();
            res.json({ message: 'Mouvement enregistré', newStock });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==================== SALES ====================
    app.get('/api/sales', (req, res) => {
        try {
            let sales = db.sales.map(s => {
                const customer = s.customer_id ? findById('customers', s.customer_id) : null;
                return { ...s, customer_name: customer?.name || 'Anonyme' };
            });
            
            if (req.query.customer_id) {
                sales = sales.filter(s => s.customer_id === parseInt(req.query.customer_id));
            }
            
            res.json(sales.slice(-50).reverse());
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/sales/:id', (req, res) => {
        try {
            const sale = findById('sales', req.params.id);
            if (!sale) return res.status(404).json({ error: 'Vente non trouvée' });
            
            const customer = sale.customer_id ? findById('customers', sale.customer_id) : null;
            const items = (sale.items || []).map(item => {
                const product = findById('products', item.product_id);
                return { ...item, product_name: product?.name || '' };
            });
            
            res.json({ ...sale, customer_name: customer?.name || 'Anonyme', items });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/sales', (req, res) => {
        try {
            const { customer_id, payment_method, items } = req.body;
            if (!items || items.length === 0) return res.status(400).json({ error: 'Au moins un produit requis' });
            
            let total = 0;
            const saleItems = [];
            
            for (const item of items) {
                const product = findById('products', item.product_id);
                if (!product) return res.status(404).json({ error: 'Produit non trouvé' });
                if (product.stock < item.quantity) return res.status(400).json({ error: `Stock insuffisant pour ${product.name}` });
                
                product.stock -= item.quantity;
                product.updated_at = new Date().toISOString();
                total += product.sale_price * item.quantity;
                saleItems.push({ product_id: item.product_id, quantity: item.quantity, unit_price: product.sale_price });
            }
            
            const newSale = {
                id: getNextId('sales'),
                customer_id: customer_id || null,
                total,
                payment_method: payment_method || 'cash',
                status: 'completed',
                items: saleItems,
                created_at: new Date().toISOString()
            };
            db.sales.push(newSale);
            
            if (customer_id) {
                const customer = findById('customers', customer_id);
                if (customer) customer.total_purchases += total;
            }
            
            saveDb();
            // Créer un crédit si le paiement est à crédit
            if (payment_method === 'credit' && customer_id) {
                const newCredit = {
                    id: getNextId('credits'),
                    customer_id: customer_id,
                    sale_id: newSale.id,
                    amount: total,
                    paid: 0,
                    status: 'unpaid',
                    created_at: new Date().toISOString()
                };
                db.credits.push(newCredit);
                
                // Mettre à jour la dette du client
                if (customer) {
                    customer.total_credit = (customer.total_credit || 0) + total;
                }
            }
            
            saveDb();
            res.json({ id: newSale.id, total, message: 'Vente enregistrée' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==================== CUSTOMERS ====================
    app.get('/api/customers', (req, res) => {
        try {
            let customers = db.customers.map(c => ({
                ...c,
                purchase_count: db.sales.filter(s => s.customer_id === c.id).length
            }));
            
            if (req.query.search) {
                const search = req.query.search.toLowerCase();
                customers = customers.filter(c => c.name.toLowerCase().includes(search) || (c.phone && c.phone.includes(search)));
            }
            
            res.json(customers);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/customers/:id', (req, res) => {
        try {
            const customer = findById('customers', req.params.id);
            if (!customer) return res.status(404).json({ error: 'Client non trouvé' });
            customer.sales = db.sales.filter(s => s.customer_id === customer.id).slice(-10);
            res.json(customer);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/customers', (req, res) => {
        try {
            const { name, phone, email, address } = req.body;
            if (!name) return res.status(400).json({ error: 'Nom requis' });
            
            const newCustomer = {
                id: getNextId('customers'),
                name, phone: phone || '', email: email || '', address: address || '',
                total_purchases: 0,
                created_at: new Date().toISOString()
            };
            db.customers.push(newCustomer);
            saveDb();
            res.json({ id: newCustomer.id, message: 'Client ajouté' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.put('/api/customers/:id', (req, res) => {
        try {
            const index = db.customers.findIndex(c => c.id === parseInt(req.params.id));
            if (index === -1) return res.status(404).json({ error: 'Client non trouvé' });
            
            const { name, phone, email, address } = req.body;
            if (!name) return res.status(400).json({ error: 'Nom requis' });
            
            db.customers[index] = { ...db.customers[index], name, phone: phone || '', email: email || '', address: address || '' };
            saveDb();
            res.json({ message: 'Client modifié' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/customers/:id', (req, res) => {
        try {
            const index = db.customers.findIndex(c => c.id === parseInt(req.params.id));
            if (index === -1) return res.status(404).json({ error: 'Client non trouvé' });
            
            db.customers.splice(index, 1);
            saveDb();
            res.json({ message: 'Client supprimé' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==================== SUPPLIERS ====================
    app.get('/api/suppliers', (req, res) => {
        try {
            res.json(db.suppliers);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/suppliers', (req, res) => {
        try {
            const { name, phone, email, products } = req.body;
            if (!name) return res.status(400).json({ error: 'Nom requis' });
            
            const newSupplier = {
                id: getNextId('suppliers'),
                name, phone: phone || '', email: email || '', products: products || '',
                total_orders: 0,
                created_at: new Date().toISOString()
            };
            db.suppliers.push(newSupplier);
            saveDb();
            res.json({ id: newSupplier.id });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.put('/api/suppliers/:id', (req, res) => {
        try {
            const index = db.suppliers.findIndex(s => s.id === parseInt(req.params.id));
            if (index === -1) return res.status(404).json({ error: 'Fournisseur non trouvé' });
            
            const { name, phone, email, products } = req.body;
            if (!name) return res.status(400).json({ error: 'Nom requis' });
            
            db.suppliers[index] = { ...db.suppliers[index], name, phone: phone || '', email: email || '', products: products || '' };
            saveDb();
            res.json({ message: 'Fournisseur modifié' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/suppliers/:id', (req, res) => {
        try {
            const index = db.suppliers.findIndex(s => s.id === parseInt(req.params.id));
            if (index === -1) return res.status(404).json({ error: 'Fournisseur non trouvé' });
            
            db.suppliers.splice(index, 1);
            saveDb();
            res.json({ message: 'Fournisseur supprimé' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==================== SETTINGS ====================
    app.get('/api/settings', (req, res) => {
        try {
            res.json(db.settings);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.put('/api/settings', (req, res) => {
        try {
            db.settings = { ...db.settings, ...req.body };
            saveDb();
            res.json({ message: 'Paramètres sauvegardés' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==================== REPORTS ====================
    app.get('/api/reports/profit', (req, res) => {
        try {
            const items = db.products.map(p => {
                const saleItems = db.sales.flatMap(s => s.items || []).filter(i => i.product_id === p.id);
                const qty_sold = saleItems.reduce((sum, i) => sum + i.quantity, 0);
                const revenue = saleItems.reduce((sum, i) => sum + (i.quantity * i.unit_price), 0);
                const cost = qty_sold * p.purchase_price;
                return {
                    name: p.name,
                    qty_sold,
                    revenue,
                    cost,
                    profit: revenue - cost
                };
            }).filter(i => i.qty_sold > 0).sort((a, b) => b.profit - a.profit);
            
            const totalRevenue = items.reduce((sum, i) => sum + i.revenue, 0);
            const totalCost = items.reduce((sum, i) => sum + i.cost, 0);
            const totalProfit = items.reduce((sum, i) => sum + i.profit, 0);
            
            res.json({ items, totalRevenue, totalCost, totalProfit });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==================== CREDITS ====================
    app.get('/api/credits', (req, res) => {
        try {
            let credits = db.credits.map(c => {
                const customer = findById('customers', c.customer_id);
                const sale = findById('sales', c.sale_id);
                return { ...c, customer_name: customer?.name || '', sale_ref: sale ? `#V-${sale.id}` : '' };
            });
            
            if (req.query.customer_id) {
                credits = credits.filter(c => c.customer_id === parseInt(req.query.customer_id));
            }
            if (req.query.status) {
                credits = credits.filter(c => c.status === req.query.status);
            }
            
            res.json(credits);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/credits/:id', (req, res) => {
        try {
            const credit = findById('credits', req.params.id);
            if (!credit) return res.status(404).json({ error: 'Crédit non trouvé' });
            
            const customer = findById('customers', credit.customer_id);
            const sale = findById('sales', credit.sale_id);
            
            res.json({ ...credit, customer_name: customer?.name || '', sale_ref: sale ? `#V-${sale.id}` : '' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/credits/pay', (req, res) => {
        try {
            const { credit_id, amount } = req.body;
            if (!credit_id || !amount) return res.status(400).json({ error: 'Champs requis' });
            
            const creditIndex = db.credits.findIndex(c => c.id === parseInt(credit_id));
            if (creditIndex === -1) return res.status(404).json({ error: 'Crédit non trouvé' });
            
            const credit = db.credits[creditIndex];
            const newPaid = credit.paid + amount;
            
            if (newPaid > credit.amount) {
                return res.status(400).json({ error: 'Montant supérieur à la dette' });
            }
            
            credit.paid = newPaid;
            credit.status = newPaid >= credit.amount ? 'paid' : 'partial';
            credit.updated_at = new Date().toISOString();
            
            // Mettre à jour la dette du client
            const customer = findById('customers', credit.customer_id);
            if (customer) {
                customer.total_credit = (customer.total_credit || 0) - amount;
            }
            
            saveDb();
            res.json({ message: 'Paiement enregistré', credit });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==================== EXPORT/IMPORT ====================
    app.get('/api/export', (req, res) => {
        try {
            res.json(db);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/import', (req, res) => {
        try {
            const data = req.body;
            if (!data || !data.products) return res.status(400).json({ error: 'Données invalides' });
            
            db = { ...db, ...data };
            saveDb();
            res.json({ message: 'Données importées' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==================== HEALTH ====================
    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // 404
    app.use((req, res) => {
        res.status(404).json({ error: 'Route non trouvée' });
    });

    // Démarrer le serveur
    app.listen(PORT, '127.0.0.1', () => {
        console.log(`✅ Serveur démarré sur http://localhost:${PORT}`);
    });
}

// Gestion de l'application
app.whenReady().then(() => {
    createWindow();
    createTray();
    startServer();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        } else {
            mainWindow.show();
            mainWindow.focus();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    isQuitting = true;
});

// IPC handlers
ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.handle('show-notification', (event, { title, body }) => {
    new Notification({ title, body }).show();
});

ipcMain.handle('open-external', (event, url) => {
    shell.openExternal(url);
});

ipcMain.handle('save-dialog', async (event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, options);
    return result;
});

ipcMain.handle('open-dialog', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
});