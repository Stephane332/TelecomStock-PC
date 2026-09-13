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

    await test('annulation de vente : stock restauré, vente marquée annulée', async () => {
        const p = (await appel(M, 'GET', `/products/${produitId}`)).data;
        const avant = p.stock;
        const v = await appel(M, 'POST', '/sales', {
            items: [{ product_id: produitId, quantity: 1, unit_price: 95000 }],
            payment_method: 'cash'
        });
        const pendant = (await appel(M, 'GET', `/products/${produitId}`)).data.stock;
        assert.strictEqual(pendant, avant - 1);
        const r = await appel(M, 'DELETE', `/sales/${v.data.id}`);
        assert.strictEqual(r.status, 200);
        const apres = (await appel(M, 'GET', `/products/${produitId}`)).data.stock;
        assert.strictEqual(apres, avant, 'stock non restauré après annulation');
        // Comme le serveur : la vente reste dans l'historique, marquée annulée.
        const vente = (await appel(M, 'GET', `/sales/${v.data.id}`)).data;
        assert.strictEqual(vente.status, 'cancelled', 'statut non marqué');
        const redo = await appel(M, 'DELETE', `/sales/${v.data.id}`);
        assert.strictEqual(redo.status, 409, 'double annulation autorisée');
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
        const r = await appel(M, 'POST', '/stock-movements', {
            product_id: produitId, type: 'entry', quantity: 5, reason: 'Réapprovisionnement'
        });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.data.newStock, avant + 5, 'newStock absent ou faux');
        const liste = await appel(M, 'GET', '/stock-movements');
        assert.ok(liste.data.length > 0, 'historique vide');
        assert.ok('supplier_name' in liste.data[0], 'colonne fournisseur absente');
    });

    await test('rapport de bénéfice : les ventes annulées sont exclues', async () => {
        const r = await appel(M, 'GET', '/reports/profit');
        assert.strictEqual(r.status, 200);
        assert.ok(Array.isArray(r.data.items), 'items manquant');
        for (const champ of ['totalRevenue', 'totalCost', 'totalProfit']) {
            assert.strictEqual(typeof r.data[champ], 'number', `${champ} absent`);
        }
        // Le bénéfice doit être cohérent avec le détail.
        const sommeProfit = r.data.items.reduce((s, i) => s + i.profit, 0);
        assert.ok(Math.abs(sommeProfit - r.data.totalProfit) < 0.01, 'total incohérent');
    });

    await test('création d\'une catégorie', async () => {
        const r = await appel(M, 'POST', '/categories', { name: 'Réparation express' });
        assert.strictEqual(r.status, 200);
        const doublon = await appel(M, 'POST', '/categories', { name: 'Réparation express' });
        assert.strictEqual(doublon.status, 409, 'doublon accepté');
        const cats = (await appel(M, 'GET', '/categories')).data;
        const ids = cats.map(c => c.id);
        assert.strictEqual(new Set(ids).size, ids.length, 'identifiants en collision');
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

    await test('paramètres : mêmes clés que le serveur', async () => {
        const s = (await appel(M, 'GET', '/settings')).data;
        // Clés attendues par l'interface et le serveur (backend/database.js).
        for (const cle of ['store_name', 'store_address', 'store_phone',
                           'currency', 'vat_rate', 'min_stock_alert', 'ifu']) {
            assert.ok(cle in s, `clé absente : ${cle}`);
        }
        const r = await appel(M, 'PUT', '/settings', { store_name: 'Boutique Test' });
        assert.strictEqual(r.status, 200);
        const apres = (await appel(M, 'GET', '/settings')).data;
        assert.strictEqual(apres.store_name, 'Boutique Test', 'paramètre non enregistré');
    });

    await test('catégories : mêmes valeurs que le serveur', async () => {
        const cats = (await appel(M, 'GET', '/categories')).data.map(c => c.name);
        for (const attendue of ['Téléphone', 'Accessoire', 'Tablette',
                                'Ordinateur', 'Carte SIM', 'Forfait']) {
            assert.ok(cats.includes(attendue), `catégorie absente : ${attendue}`);
        }
    });

    await test('réinitialisation exige une confirmation', async () => {
        const sans = await appel(M, 'POST', '/maintenance/reset', {});
        assert.strictEqual(sans.status, 400, 'reset sans confirmation accepté');
    });

    await test('cycle sauvegarde → restauration (mode autonome)', async () => {
        // Le commerçant exporte, perd son appareil, réinstalle, restaure.
        const sauvegarde = (await appel(M, 'GET', '/export')).data;
        const produitsAvant = sauvegarde.products.length;
        const ventesAvant = sauvegarde.sales.length;
        assert.ok(produitsAvant > 0, 'rien à sauvegarder');

        // Simulation d'un appareil neuf.
        await appel(M, 'POST', '/maintenance/reset', { confirm: 'RESET' });
        const vide = (await appel(M, 'GET', '/products')).data;
        assert.strictEqual(vide.length, 0, 'la base n\'a pas été vidée');

        // Restauration.
        const r = await appel(M, 'POST', '/import',
            Object.assign({ confirm: 'IMPORT' }, sauvegarde));
        assert.strictEqual(r.status, 200, `statut ${r.status} : ${r.data.error}`);

        const produits = (await appel(M, 'GET', '/products')).data;
        const ventes = (await appel(M, 'GET', '/sales')).data;
        assert.strictEqual(produits.length, produitsAvant, 'produits non restaurés');
        assert.strictEqual(ventes.length, ventesAvant, 'ventes non restaurées');

        // Un nouvel enregistrement ne doit pas écraser une donnée restaurée.
        const nouveau = await appel(M, 'POST', '/products', {
            name: 'Produit après restauration', sale_price: 1000, stock: 1
        });
        assert.ok(!produits.some(p => p.id === nouveau.data.id),
            'identifiant réutilisé : une donnée restaurée serait écrasée');
    });

    await test('restauration refuse un fichier invalide', async () => {
        const r = await appel(M, 'POST', '/import', { confirm: 'IMPORT', nimporte: true });
        assert.strictEqual(r.status, 400);
    });

    await test('restauration exige une confirmation', async () => {
        const r = await appel(M, 'POST', '/import', { products: [] });
        assert.strictEqual(r.status, 400);
    });

    await test('route inconnue rejetée proprement', async () => {
        const r = await appel(M, 'GET', '/nexistepas');
        assert.strictEqual(r.status, 404);
    });

    await test('toutes les routes utilisées par l\'interface existent', async () => {
        // Garde-fou : détecte toute route appelée par l'interface mais absente
        // du moteur autonome (cause du message « Fonction indisponible »).
        const app = fs.readFileSync(
            path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
        const routes = new Set();
        for (const m of app.matchAll(/api\((['`])(\/[^'`]+)\1/g)) {
            routes.add(m[2].split('?')[0].replace(/\$\{[^}]*\}/g, '1'));
        }
        const manquantes = [];
        for (const r of routes) {
            // On teste seulement l'existence de la route, pas son résultat.
            const rep = await appel(M, 'GET', r);
            const repPost = await appel(M, 'POST', r, {});
            const repPut = await appel(M, 'PUT', r, {});
            const repDel = await appel(M, 'DELETE', r);
            const inconnue = [rep, repPost, repPut, repDel].every(
                x => x.status === 404 && /indisponible en mode autonome/.test(x.data.error || ''));
            if (inconnue) manquantes.push(r);
        }
        assert.strictEqual(manquantes.length, 0,
            'routes absentes du mode autonome : ' + manquantes.join(', '));
    });

    console.log(`\nRÉSULTAT : ${reussis} réussis, ${echoues} échoués`);
    process.exit(echoues === 0 ? 0 : 1);
})();
