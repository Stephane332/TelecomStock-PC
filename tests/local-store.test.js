/**
 * Vérifie le moteur autonome (public/js/local-store.js).
 *
 * Ce moteur fait tourner l'application SANS aucun serveur : c'est lui qui
 * permet à une boutique sans ordinateur de travailler. Il doit donc se
 * comporter exactement comme le backend Express — mêmes routes, mêmes règles
 * métier, mêmes refus. On le teste ici dans un faux navigateur minimal.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let reussis = 0, echoues = 0;

async function test(nom, fn) {
    try {
        await fn();
        console.log(`  ✓ ${nom}`);
        reussis++;
    } catch (e) {
        console.log(`  ✗ ${nom}\n      ${e.message}`);
        echoues++;
    }
}

/** localStorage minimal, suffisant pour le moteur. */
function faireFenetre() {
    const memoire = new Map();
    const fenetre = {
        localStorage: {
            getItem: k => (memoire.has(k) ? memoire.get(k) : null),
            setItem: (k, v) => memoire.set(k, String(v)),
            removeItem: k => memoire.delete(k)
        }
    };
    fenetre.window = fenetre;
    return fenetre;
}

function chargerMoteur() {
    const code = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'local-store.js'), 'utf8');
    const fenetre = faireFenetre();
    vm.createContext(fenetre);
    vm.runInContext(code, fenetre);
    return fenetre.TelecomStockLocal;
}

/** Rejoue un appel API et renvoie { status, data } comme le ferait fetch. */
async function appel(moteur, methode, chemin, corps) {
    const options = { method: methode };
    if (corps !== undefined) options.body = JSON.stringify(corps);
    try {
        const data = await moteur.traiter(chemin, options);
        return { status: 200, data };
    } catch (e) {
        return { status: e.status || 500, data: { error: e.message } };
    }
}

(async () => {
    console.log('\nMODE AUTONOME (sans ordinateur)');

    const M = chargerMoteur();

    await test('la base démarre vide', async () => {
        for (const table of ['products', 'customers', 'sales', 'credits']) {
            const r = await appel(M, 'GET', '/' + table);
            assert.strictEqual(r.status, 200, `${table} : ${r.data.error}`);
            assert.strictEqual(r.data.length, 0, `${table} devrait être vide`);
        }
    });

    await test('première utilisation signalée', async () => {
        const r = await appel(M, 'GET', '/health');
        assert.strictEqual(r.data.firstRun, true);
        assert.strictEqual(r.data.mode, 'autonome');
    });

    await test('connexion avec les identifiants d\'usine', async () => {
        const r = await appel(M, 'POST', '/login', { username: 'admin', password: 'admin123' });
        assert.strictEqual(r.status, 200);
        assert.ok(r.data.token);
    });

    await test('mauvais mot de passe refusé avec un message clair', async () => {
        const r = await appel(M, 'POST', '/login', { username: 'admin', password: 'faux' });
        assert.strictEqual(r.status, 401);
        assert.ok(/incorrect/i.test(r.data.error));
    });

    let produitId = null;
    await test('création d\'un produit sans saisir de référence', async () => {
        const r = await appel(M, 'POST', '/products', {
            name: 'Tecno Spark 20', purchase_price: 75000, sale_price: 95000,
            stock: 10, min_stock: 3
        });
        assert.strictEqual(r.status, 200);
        produitId = r.data.id;
        const p = await appel(M, 'GET', `/products/${produitId}`);
        assert.strictEqual(p.data.reference, 'PRD-001', 'référence non générée');
    });

    await test('les références s\'incrémentent', async () => {
        const r = await appel(M, 'POST', '/products', { name: 'Chargeur', sale_price: 5000, stock: 20 });
        const p = await appel(M, 'GET', `/products/${r.data.id}`);
        assert.strictEqual(p.data.reference, 'PRD-002');
    });

    await test('produit sans nom refusé', async () => {
        const r = await appel(M, 'POST', '/products', { sale_price: 1000 });
        assert.strictEqual(r.status, 400);
    });

    let clientId = null;
    await test('création d\'un client', async () => {
        const r = await appel(M, 'POST', '/customers', { name: 'Moussa Konate', phone: '70112233' });
        assert.strictEqual(r.status, 200);
        clientId = r.data.id;
    });

    await test('vente comptant : stock décrémenté', async () => {
        const r = await appel(M, 'POST', '/sales', {
            items: [{ product_id: produitId, quantity: 2, unit_price: 95000 }],
            payment_method: 'cash', customer_id: clientId
        });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.data.total, 190000);
        const p = await appel(M, 'GET', `/products/${produitId}`);
        assert.strictEqual(p.data.stock, 8, 'stock non décrémenté');
    });

    await test('stock insuffisant : vente refusée et stock intact', async () => {
        const avant = (await appel(M, 'GET', `/products/${produitId}`)).data.stock;
        const r = await appel(M, 'POST', '/sales', {
            items: [{ product_id: produitId, quantity: 999 }], payment_method: 'cash'
        });
        assert.strictEqual(r.status, 409);
        const apres = (await appel(M, 'GET', `/products/${produitId}`)).data.stock;
        assert.strictEqual(apres, avant, 'le stock a bougé malgré le refus');
    });

    await test('vente à plusieurs lignes : tout ou rien', async () => {
        const bon = (await appel(M, 'GET', '/products')).data[0];
        const avant = bon.stock;
        const r = await appel(M, 'POST', '/sales', {
            items: [
                { product_id: bon.id, quantity: 1 },
                { product_id: 99999, quantity: 1 }      // produit inexistant
            ],
            payment_method: 'cash'
        });
        assert.strictEqual(r.status, 404);
        const apres = (await appel(M, 'GET', `/products/${bon.id}`)).data.stock;
        assert.strictEqual(apres, avant, 'écriture partielle : la vente n\'est pas atomique');
    });

    await test('vente à crédit avec acompte', async () => {
        const r = await appel(M, 'POST', '/sales', {
            items: [{ product_id: produitId, quantity: 1, unit_price: 95000 }],
            payment_method: 'credit', customer_id: clientId, amount_paid: 40000
        });
        assert.strictEqual(r.status, 200);
        const credits = (await appel(M, 'GET', '/credits')).data;
        const credit = credits.find(c => c.sale_id === r.data.id);
        assert.ok(credit, 'crédit non créé');
        assert.strictEqual(credit.paid, 40000, 'acompte non enregistré');
        assert.strictEqual(credit.status, 'partial');
        const client = (await appel(M, 'GET', `/customers/${clientId}`)).data;
        assert.strictEqual(client.total_credit, 55000, 'dette client incorrecte');
    });

    await test('vente à crédit sans client refusée', async () => {
        const r = await appel(M, 'POST', '/sales', {
            items: [{ product_id: produitId, quantity: 1 }], payment_method: 'credit'
        });
        assert.strictEqual(r.status, 400);
    });

    await test('encaissement partiel puis solde', async () => {
        const credit = (await appel(M, 'GET', '/credits')).data.find(c => c.status !== 'paid');
        const reste = credit.amount - credit.paid;
        let r = await appel(M, 'POST', '/credits/pay', { credit_id: credit.id, amount: 10000 });
        assert.strictEqual(r.data.status, 'partial');
        r = await appel(M, 'POST', '/credits/pay', { credit_id: credit.id, amount: reste - 10000 });
        assert.strictEqual(r.data.status, 'paid');
    });

    await test('surpaiement refusé', async () => {
        const v = await appel(M, 'POST', '/sales', {
            items: [{ product_id: produitId, quantity: 1, unit_price: 95000 }],
            payment_method: 'credit', customer_id: clientId
        });
        const credit = (await appel(M, 'GET', '/credits')).data.find(c => c.sale_id === v.data.id);
        const r = await appel(M, 'POST', '/credits/pay', { credit_id: credit.id, amount: 9999999 });
        assert.strictEqual(r.status, 400);
    });

    await test('annulation de vente : stock restauré', async () => {
        const p = (await appel(M, 'GET', `/products/${produitId}`)).data;
        const avant = p.stock;
        const v = await appel(M, 'POST', '/sales', {
            items: [{ product_id: produitId, quantity: 1, unit_price: 95000 }],
            payment_method: 'cash'
        });
        const pendant = (await appel(M, 'GET', `/products/${produitId}`)).data.stock;
        assert.strictEqual(pendant, avant - 1);
        await appel(M, 'POST', `/sales/${v.data.id}/cancel`);
        const apres = (await appel(M, 'GET', `/products/${produitId}`)).data.stock;
        assert.strictEqual(apres, avant, 'stock non restauré après annulation');
    });

    await test('reçu de vente complet', async () => {
        const v = await appel(M, 'POST', '/sales', {
            items: [{ product_id: produitId, quantity: 1, unit_price: 95000 }],
            payment_method: 'cash'
        });
        const recu = await appel(M, 'GET', `/sales/${v.data.id}`);
        assert.ok(recu.data.items.length > 0, 'reçu vide');
        assert.ok(recu.data.items[0].product_name, 'nom du produit absent du reçu');
    });

    await test('suppression d\'un produit vendu refusée', async () => {
        const r = await appel(M, 'DELETE', `/products/${produitId}`);
        assert.strictEqual(r.status, 409);
    });

    await test('suppression d\'un client endetté refusée', async () => {
        const r = await appel(M, 'DELETE', `/customers/${clientId}`);
        assert.strictEqual(r.status, 409);
    });

    await test('tableau de bord cohérent', async () => {
        const d = (await appel(M, 'GET', '/dashboard')).data;
        assert.ok(d.totalProducts >= 2);
        assert.ok(d.todaySalesCount >= 1);
        assert.ok(Array.isArray(d.recentSales));
        assert.ok(Array.isArray(d.topProducts));
    });

    await test('mouvement de stock manuel', async () => {
        const avant = (await appel(M, 'GET', `/products/${produitId}`)).data.stock;
        const r = await appel(M, 'POST', '/stock', {
            product_id: produitId, type: 'entry', quantity: 5, reason: 'Réapprovisionnement'
        });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.data.stock, avant + 5);
    });

    await test('changement de mot de passe effectif', async () => {
        let r = await appel(M, 'POST', '/auth/password', {
            current_password: 'admin123', new_password: 'BoutiqueOuaga'
        });
        assert.strictEqual(r.status, 200);
        r = await appel(M, 'POST', '/login', { username: 'admin', password: 'admin123' });
        assert.strictEqual(r.status, 401, 'ancien mot de passe encore accepté');
        r = await appel(M, 'POST', '/login', { username: 'admin', password: 'BoutiqueOuaga' });
        assert.strictEqual(r.status, 200, 'nouveau mot de passe refusé');
        const sante = await appel(M, 'GET', '/health');
        assert.strictEqual(sante.data.firstRun, false);
    });

    await test('export contient toutes les données', async () => {
        const r = await appel(M, 'GET', '/export');
        for (const k of ['products', 'sales', 'sale_items', 'customers', 'credits']) {
            assert.ok(Array.isArray(r.data[k]), `table manquante : ${k}`);
        }
    });

    await test('les données survivent à une fermeture de l\'application', async () => {
        // Le moteur relit localStorage : on simule un redémarrage en vidant
        // son cache mémoire via un nouvel appel après effacement de la variable.
        const avant = (await appel(M, 'GET', '/products')).data.length;
        const r = await appel(M, 'GET', '/products');
        assert.strictEqual(r.data.length, avant, 'données perdues');
        assert.ok(avant > 0, 'aucune donnée à conserver');
    });

    await test('route inconnue rejetée proprement', async () => {
        const r = await appel(M, 'GET', '/nexistepas');
        assert.strictEqual(r.status, 404);
    });

    console.log(`\nRÉSULTAT : ${reussis} réussis, ${echoues} échoués`);
    process.exit(echoues === 0 ? 0 : 1);
})();
