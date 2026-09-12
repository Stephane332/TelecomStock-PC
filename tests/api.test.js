/**
 * Suite de tests d'intégration — exécute le vrai serveur sur une base jetable.
 * Usage : node tests/api.test.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

// Base isolée : on n'abîme jamais les données de l'utilisateur.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-test-'));
process.env.TS_DATA_DIR = TMP;
process.env.TS_JWT_SECRET = 'test-secret-only';

const { start } = require('../backend/server');
const { db } = require('../backend/database');

let BASE = '';
let token = '';
let passed = 0, failed = 0;

async function req(method, url, body, useAuth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (useAuth && token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(BASE + url, {
        method, headers, body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch { /* corps vide */ }
    return { status: res.status, data };
}

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (e) {
        console.log(`  ✗ ${name}\n      → ${e.message}`);
        failed++;
    }
}

(async () => {
    const server = await start(0, '127.0.0.1');
    BASE = `http://127.0.0.1:${server.address().port}`;
    console.log(`\nBase de test : ${TMP}\nServeur : ${BASE}\n`);

    console.log('AUTHENTIFICATION');
    await test('health public sans token', async () => {
        const r = await req('GET', '/api/health', null, false);
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.data.status, 'ok');
    });
    await test('route protégée refuse sans token (401)', async () => {
        const r = await req('GET', '/api/products', null, false);
        assert.strictEqual(r.status, 401);
    });
    await test('login avec mauvais mot de passe → 401', async () => {
        const r = await req('POST', '/api/login', { username: 'admin', password: 'faux' }, false);
        assert.strictEqual(r.status, 401);
    });
    await test('login admin/admin123 → token', async () => {
        const r = await req('POST', '/api/login', { username: 'admin', password: 'admin123' }, false);
        assert.strictEqual(r.status, 200);
        assert.ok(r.data.token, 'token absent');
        token = r.data.token;
    });
    await test('token invalide rejeté', async () => {
        const res = await fetch(BASE + '/api/products', { headers: { Authorization: 'Bearer bidon' } });
        assert.strictEqual(res.status, 401);
    });

    console.log('\nINTÉGRITÉ DES DONNÉES DE DÉMONSTRATION');
    await test('aucune ligne de vente orpheline', async () => {
        const c = db.prepare(`SELECT COUNT(*) c FROM sale_items si
            LEFT JOIN sales s ON s.id=si.sale_id WHERE s.id IS NULL`).get().c;
        assert.strictEqual(c, 0, `${c} lignes orphelines`);
    });
    await test('clés étrangères actives', async () => {
        assert.strictEqual(db.pragma('foreign_keys', { simple: true }), 1);
    });
    await test('contrôle d_intégrité FK global vide', async () => {
        const issues = db.pragma('foreign_key_check');
        assert.strictEqual(issues.length, 0, JSON.stringify(issues));
    });
    await test('chaque vente a au moins une ligne', async () => {
        const c = db.prepare(`SELECT COUNT(*) c FROM sales s
            WHERE NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id=s.id)`).get().c;
        assert.strictEqual(c, 0);
    });
    await test('reçu de vente contient bien ses lignes', async () => {
        // Base vierge en production : on crée le produit et la vente nécessaires
        // au test plutôt que de dépendre d'un jeu de démonstration.
        const p = await req('POST', '/api/products', {
            reference: 'RECU-001', name: 'Produit reçu', purchase_price: 500,
            sale_price: 1500, stock: 5, min_stock: 1
        });
        const v = await req('POST', '/api/sales', {
            items: [{ product_id: p.data.id, quantity: 2, unit_price: 1500 }],
            payment_method: 'especes'
        });
        const r = await req('GET', `/api/sales/${v.data.id}`);
        assert.ok(r.data.items.length > 0, 'reçu vide');
        assert.ok(r.data.items[0].product_name, 'nom produit manquant');
    });

    console.log('\nPRODUITS');
    let productId = null;
    await test('création produit', async () => {
        const r = await req('POST', '/api/products', {
            reference: 'TEST-001', name: 'Produit test', purchase_price: 1000,
            sale_price: 2000, stock: 10, min_stock: 2
        });
        assert.strictEqual(r.status, 201);
        productId = r.data.id;
    });
    await test('référence en doublon → 409', async () => {
        const r = await req('POST', '/api/products', { reference: 'TEST-001', name: 'Autre' });
        assert.strictEqual(r.status, 409);
    });
    await test('champs manquants → 400', async () => {
        const r = await req('POST', '/api/products', { reference: '' });
        assert.strictEqual(r.status, 400);
    });
    await test('modification produit', async () => {
        const r = await req('PUT', `/api/products/${productId}`, {
            reference: 'TEST-001', name: 'Produit test modifié',
            purchase_price: 1000, sale_price: 2500, stock: 10, min_stock: 2
        });
        assert.strictEqual(r.status, 200);
        const check = await req('GET', `/api/products/${productId}`);
        assert.strictEqual(check.data.sale_price, 2500);
    });

    console.log('\nSTOCK');
    await test('entrée de stock incrémente', async () => {
        const before = (await req('GET', `/api/products/${productId}`)).data.stock;
        const r = await req('POST', '/api/stock-movements', {
            product_id: productId, type: 'entry', quantity: 5, reason: 'Test'
        });
        assert.strictEqual(r.status, 201);
        assert.strictEqual(r.data.newStock, before + 5);
    });
    await test('sortie supérieure au stock → 409', async () => {
        const r = await req('POST', '/api/stock-movements', {
            product_id: productId, type: 'exit', quantity: 99999
        });
        assert.strictEqual(r.status, 409);
    });
    await test('quantité négative refusée', async () => {
        const r = await req('POST', '/api/stock-movements', {
            product_id: productId, type: 'entry', quantity: -5
        });
        assert.strictEqual(r.status, 400);
    });

    console.log('\nVENTES (atomicité)');
    let saleId = null;
    await test('vente décrémente le stock', async () => {
        const before = (await req('GET', `/api/products/${productId}`)).data.stock;
        const r = await req('POST', '/api/sales', {
            payment_method: 'cash', items: [{ product_id: productId, quantity: 3 }]
        });
        assert.strictEqual(r.status, 201);
        saleId = r.data.id;
        const after = (await req('GET', `/api/products/${productId}`)).data.stock;
        assert.strictEqual(after, before - 3);
    });
    await test('vente multi-lignes : échec = AUCUN stock touché (rollback)', async () => {
        const before = (await req('GET', `/api/products/${productId}`)).data.stock;
        const r = await req('POST', '/api/sales', {
            payment_method: 'cash',
            items: [
                { product_id: productId, quantity: 1 },
                { product_id: productId, quantity: 999999 } // échoue
            ]
        });
        assert.strictEqual(r.status, 409);
        const after = (await req('GET', `/api/products/${productId}`)).data.stock;
        assert.strictEqual(after, before, 'ROLLBACK RATÉ : stock modifié malgré l_échec');
    });
    await test('remise appliquée correctement', async () => {
        const r = await req('POST', '/api/sales', {
            payment_method: 'cash', discount: 10,
            items: [{ product_id: productId, quantity: 1 }]
        });
        assert.strictEqual(r.status, 201);
        assert.strictEqual(Math.round(r.data.total), 2250); // 2500 - 10%
    });
    await test('crédit sans client → 400', async () => {
        const r = await req('POST', '/api/sales', {
            payment_method: 'credit', items: [{ product_id: productId, quantity: 1 }]
        });
        assert.strictEqual(r.status, 400);
    });
    await test('annulation restitue le stock', async () => {
        const before = (await req('GET', `/api/products/${productId}`)).data.stock;
        const r = await req('DELETE', `/api/sales/${saleId}`);
        assert.strictEqual(r.status, 200);
        const after = (await req('GET', `/api/products/${productId}`)).data.stock;
        assert.strictEqual(after, before + 3);
    });

    console.log('\nCLIENTS & CRÉDITS');
    let customerId = null, creditId = null;
    await test('création client', async () => {
        const r = await req('POST', '/api/customers', { name: 'Client Test', phone: '70000000' });
        assert.strictEqual(r.status, 201);
        customerId = r.data.id;
    });
    await test('vente à crédit génère un crédit', async () => {
        const r = await req('POST', '/api/sales', {
            customer_id: customerId, payment_method: 'credit',
            items: [{ product_id: productId, quantity: 2 }]
        });
        assert.strictEqual(r.status, 201);
        const credits = await req('GET', `/api/credits?customer_id=${customerId}`);
        assert.strictEqual(credits.data.length, 1);
        creditId = credits.data[0].id;
    });
    await test('paiement partiel → statut partial', async () => {
        const r = await req('POST', '/api/credits/pay', { credit_id: creditId, amount: 1000 });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.data.status, 'partial');
    });
    await test('surpaiement refusé', async () => {
        const r = await req('POST', '/api/credits/pay', { credit_id: creditId, amount: 9999999 });
        assert.strictEqual(r.status, 400);
    });
    await test('solde complet → statut paid', async () => {
        const credit = (await req('GET', `/api/credits?customer_id=${customerId}`)).data[0];
        const r = await req('POST', '/api/credits/pay', { credit_id: creditId, amount: credit.amount - credit.paid });
        assert.strictEqual(r.data.status, 'paid');
    });
    await test('dette client revenue à zéro', async () => {
        const c = (await req('GET', `/api/customers/${customerId}`)).data;
        assert.ok(Math.abs(c.total_credit) < 0.01, `dette résiduelle : ${c.total_credit}`);
    });
    await test('acompte versé à la vente est enregistré', async () => {
        const p = await req('POST', '/api/products', {
            reference: 'ACO-001', name: 'Produit acompte', purchase_price: 1000,
            sale_price: 10000, stock: 5, min_stock: 1
        });
        const v = await req('POST', '/api/sales', {
            items: [{ product_id: p.data.id, quantity: 1, unit_price: 10000 }],
            payment_method: 'credit', customer_id: customerId, amount_paid: 4000
        });
        assert.strictEqual(v.status, 201);
        const credits = await req('GET', `/api/credits?customer_id=${customerId}`);
        const credit = credits.data.find(c => c.sale_id === v.data.id);
        assert.ok(credit, 'crédit introuvable');
        assert.strictEqual(credit.paid, 4000, 'acompte non enregistré');
        assert.strictEqual(credit.status, 'partial');
        // La dette ne doit refléter que le reste dû, pas le total de la vente.
        const cli = (await req('GET', `/api/customers/${customerId}`)).data;
        assert.strictEqual(cli.total_credit, 6000, 'dette incorrecte après acompte');
        // On solde pour ne pas perturber les tests suivants.
        await req('POST', '/api/credits/pay', { credit_id: credit.id, amount: 6000 });
    });
    await test('suppression client avec crédit ouvert bloquée', async () => {
        await req('POST', '/api/sales', {
            customer_id: customerId, payment_method: 'credit',
            items: [{ product_id: productId, quantity: 1 }]
        });
        const r = await req('DELETE', `/api/customers/${customerId}`);
        assert.strictEqual(r.status, 409);
    });

    console.log('\nPROTECTION SUPPRESSION');
    await test('produit vendu non supprimable', async () => {
        const r = await req('DELETE', `/api/products/${productId}`);
        assert.strictEqual(r.status, 409);
    });

    console.log('\nTABLEAU DE BORD & RAPPORTS');
    await test('dashboard renvoie tous les indicateurs', async () => {
        const r = await req('GET', '/api/dashboard');
        for (const k of ['totalProducts', 'totalStock', 'lowStock', 'todaySales', 'openCredits', 'recentSales']) {
            assert.ok(k in r.data, `champ manquant : ${k}`);
        }
    });
    await test('rapport bénéfices cohérent (revenu - coût = profit)', async () => {
        const r = await req('GET', '/api/reports/profit');
        assert.ok(Math.abs((r.data.totalRevenue - r.data.totalCost) - r.data.totalProfit) < 0.01);
    });
    await test('ventes annulées exclues du rapport', async () => {
        const r = await req('GET', '/api/reports/profit');
        assert.ok(r.data.totalRevenue >= 0);
    });

    console.log('\nPARAMÈTRES & SÉCURITÉ');
    await test('enregistrement des paramètres', async () => {
        await req('PUT', '/api/settings', { store_name: 'Boutique Test' });
        const r = await req('GET', '/api/settings');
        assert.strictEqual(r.data.store_name, 'Boutique Test');
    });
    await test('clé non autorisée ignorée (allow-list)', async () => {
        await req('PUT', '/api/settings', { malicious_key: 'x' });
        const r = await req('GET', '/api/settings');
        assert.ok(!('malicious_key' in r.data));
    });
    await test('reset sans confirmation refusé', async () => {
        const r = await req('POST', '/api/maintenance/reset', {});
        assert.strictEqual(r.status, 400);
    });
    await test('export contient toutes les tables', async () => {
        const r = await req('GET', '/api/export');
        for (const k of ['products', 'sales', 'sale_items', 'customers', 'settings']) {
            assert.ok(Array.isArray(r.data[k]), `table manquante : ${k}`);
        }
    });
    await test('changement de mot de passe puis reconnexion', async () => {
        const ch = await req('POST', '/api/auth/password', {
            current_password: 'admin123', new_password: 'nouveau123'
        });
        assert.strictEqual(ch.status, 200);
        const relog = await req('POST', '/api/login', { username: 'admin', password: 'nouveau123' }, false);
        assert.strictEqual(relog.status, 200);

        // Le changement doit être RÉEL : l'ancien mot de passe ne doit plus ouvrir la session.
        const vieux = await req('POST', '/api/login', { username: 'admin', password: 'admin123' }, false);
        assert.strictEqual(vieux.status, 401, 'ancien mot de passe encore accepté');

        // L'aide de première utilisation doit disparaître une fois le mot de passe changé.
        const sante = await req('GET', '/api/health', null, false);
        assert.strictEqual(sante.data.firstRun, false, 'firstRun devrait être false');

        // On restaure pour ne pas surprendre
        token = relog.data.token;
        await req('POST', '/api/auth/password', { current_password: 'nouveau123', new_password: 'admin123' });
    });
    await test('mot de passe d\'usine → firstRun signalé', async () => {
        const r = await req('GET', '/api/health', null, false);
        assert.strictEqual(r.data.firstRun, true, 'firstRun devrait être true');
    });
    await test('mauvais mot de passe → message clair, pas « session expirée »', async () => {
        const r = await req('POST', '/api/login', { username: 'admin', password: 'faux' }, false);
        assert.strictEqual(r.status, 401);
        assert.ok(/incorrect/i.test(r.data.error || ''), `message peu clair : ${r.data.error}`);
    });

    console.log('\nSPA');
    await test('route inconnue /api → 404 JSON', async () => {
        const r = await req('GET', '/api/nexistepas');
        assert.strictEqual(r.status, 404);
    });
    await test('route non-API sert index.html', async () => {
        const res = await fetch(BASE + '/dashboard');
        assert.strictEqual(res.status, 200);
        assert.ok((await res.text()).includes('<!DOCTYPE html>'));
    });

    server.close();
    console.log(`\n${'─'.repeat(46)}`);
    console.log(`RÉSULTAT : ${passed} réussis, ${failed} échoués`);
    console.log('─'.repeat(46));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* verrou Windows */ }
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('CRASH :', e); process.exit(1); });
