#!/usr/bin/env node
/**
 * Test de bout en bout contre un serveur RÉEL déjà lancé (EXE ou npm start).
 *
 * Simule le parcours complet d'un commerçant le jour de la mise en service :
 * connexion, saisie du stock, ventes, crédits, encaissement, rapports.
 * Chaque étape vérifie le résultat côté serveur, pas seulement le code HTTP.
 *
 * Usage : node tests/e2e-live.js [http://127.0.0.1:3002]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:3002';

let token = null;
let reussis = 0, echoues = 0;

async function appel(methode, chemin, corps) {
    const entetes = { 'Content-Type': 'application/json' };
    if (token) entetes.Authorization = `Bearer ${token}`;
    const r = await fetch(BASE + '/api' + chemin, {
        method: methode, headers: entetes,
        body: corps === undefined ? undefined : JSON.stringify(corps)
    });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
}

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

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

(async () => {
    console.log(`\nPARCOURS COMMERÇANT — serveur réel ${BASE}`);

    await test('le serveur répond et annonce la version 1.0.0', async () => {
        const r = await appel('GET', '/health');
        assert(r.status === 200, `statut ${r.status}`);
        assert(r.data.version === '1.0.0', `version ${r.data.version}`);
    });

    await test('un mauvais mot de passe est refusé clairement', async () => {
        const r = await appel('POST', '/login', { username: 'admin', password: 'xxx' });
        assert(r.status === 401, `statut ${r.status}`);
        assert(/incorrect/i.test(r.data.error || ''), `message : ${r.data.error}`);
    });

    await test('connexion avec les identifiants affichés à l\'écran', async () => {
        const r = await appel('POST', '/login', { username: 'admin', password: 'admin123' });
        assert(r.status === 200, `statut ${r.status}`);
        assert(r.data.token, 'aucun jeton reçu');
        token = r.data.token;
    });

    await test('la boutique démarre sans aucune donnée', async () => {
        for (const t of ['products', 'customers', 'sales', 'credits', 'suppliers']) {
            const r = await appel('GET', '/' + t);
            assert(Array.isArray(r.data), `${t} : réponse inattendue`);
            assert(r.data.length === 0, `${t} contient ${r.data.length} éléments`);
        }
    });

    let refAuto = null, idTelephone = null;
    await test('saisie d\'un produit SANS référence (générée)', async () => {
        const r = await appel('POST', '/products', {
            name: 'Tecno Spark 20', purchase_price: 75000, sale_price: 95000,
            stock: 10, min_stock: 3
        });
        assert(r.status === 201, `statut ${r.status} : ${r.data.error}`);
        idTelephone = r.data.id;
        const p = await appel('GET', `/products/${idTelephone}`);
        refAuto = p.data.reference;
        assert(refAuto === 'PRD-001', `référence générée : ${refAuto}`);
    });

    await test('deuxième produit : la référence s\'incrémente', async () => {
        const r = await appel('POST', '/products', {
            name: 'Chargeur USB-C', purchase_price: 3000, sale_price: 6000, stock: 40
        });
        assert(r.status === 201, `statut ${r.status}`);
        const p = await appel('GET', `/products/${r.data.id}`);
        assert(p.data.reference === 'PRD-002', `référence : ${p.data.reference}`);
    });

    await test('un produit sans nom est refusé', async () => {
        const r = await appel('POST', '/products', { sale_price: 1000 });
        assert(r.status === 400, `statut ${r.status}`);
    });

    await test('modification sans toucher à la référence', async () => {
        const r = await appel('PUT', `/products/${idTelephone}`, {
            name: 'Tecno Spark 20 Pro', sale_price: 99000, stock: 10, min_stock: 3
        });
        assert(r.status === 200, `statut ${r.status} : ${r.data.error}`);
        const p = await appel('GET', `/products/${idTelephone}`);
        assert(p.data.reference === refAuto, 'référence perdue à la modification');
        assert(p.data.name === 'Tecno Spark 20 Pro', 'nom non enregistré');
    });

    let idClient = null;
    await test('enregistrement d\'un client', async () => {
        const r = await appel('POST', '/customers', {
            name: 'Moussa Konaté', phone: '70 11 22 33'
        });
        assert(r.status === 201, `statut ${r.status}`);
        idClient = r.data.id;
    });

    await test('réapprovisionnement du stock', async () => {
        const avant = (await appel('GET', `/products/${idTelephone}`)).data.stock;
        const r = await appel('POST', '/stock-movements', {
            product_id: idTelephone, type: 'entry', quantity: 5, reason: 'Achat fournisseur'
        });
        assert(r.status === 201, `statut ${r.status} : ${r.data.error}`);
        assert(r.data.newStock === avant + 5, `stock ${r.data.newStock} au lieu de ${avant + 5}`);
    });

    await test('l\'historique des mouvements est lisible', async () => {
        const r = await appel('GET', '/stock-movements');
        assert(r.status === 200, `statut ${r.status}`);
        assert(r.data.length > 0, 'historique vide');
        assert(r.data[0].product_name, 'nom du produit absent');
    });

    await test('vente comptant : le stock diminue', async () => {
        const avant = (await appel('GET', `/products/${idTelephone}`)).data.stock;
        const r = await appel('POST', '/sales', {
            items: [{ product_id: idTelephone, quantity: 2, unit_price: 99000 }],
            payment_method: 'cash', customer_id: idClient
        });
        assert(r.status === 201, `statut ${r.status} : ${r.data.error}`);
        assert(r.data.total === 198000, `total ${r.data.total}`);
        const apres = (await appel('GET', `/products/${idTelephone}`)).data.stock;
        assert(apres === avant - 2, `stock ${apres} au lieu de ${avant - 2}`);
    });

    await test('vente avec remise', async () => {
        const r = await appel('POST', '/sales', {
            items: [{ product_id: idTelephone, quantity: 1, unit_price: 100000 }],
            payment_method: 'cash', discount: 10
        });
        assert(r.status === 201, `statut ${r.status}`);
        assert(r.data.total === 90000, `total remisé ${r.data.total} au lieu de 90000`);
    });

    await test('stock insuffisant : vente refusée, stock intact', async () => {
        const avant = (await appel('GET', `/products/${idTelephone}`)).data.stock;
        const r = await appel('POST', '/sales', {
            items: [{ product_id: idTelephone, quantity: 9999 }], payment_method: 'cash'
        });
        assert(r.status === 409, `statut ${r.status}`);
        const apres = (await appel('GET', `/products/${idTelephone}`)).data.stock;
        assert(apres === avant, 'le stock a bougé malgré le refus');
    });

    let idCredit = null;
    await test('vente à crédit avec acompte', async () => {
        const r = await appel('POST', '/sales', {
            items: [{ product_id: idTelephone, quantity: 1, unit_price: 99000 }],
            payment_method: 'credit', customer_id: idClient, amount_paid: 40000
        });
        assert(r.status === 201, `statut ${r.status} : ${r.data.error}`);
        const credits = await appel('GET', '/credits');
        const c = credits.data.find(x => x.sale_id === r.data.id);
        assert(c, 'crédit non créé');
        assert(c.paid === 40000, `acompte enregistré : ${c.paid}`);
        assert(c.status === 'partial', `statut : ${c.status}`);
        idCredit = c.id;
    });

    await test('vente à crédit sans client : refusée', async () => {
        const r = await appel('POST', '/sales', {
            items: [{ product_id: idTelephone, quantity: 1 }], payment_method: 'credit'
        });
        assert(r.status === 400, `statut ${r.status}`);
    });

    await test('encaissement d\'un versement', async () => {
        const r = await appel('POST', '/credits/pay', { credit_id: idCredit, amount: 20000 });
        assert(r.status === 200, `statut ${r.status} : ${r.data.error}`);
        assert(r.data.paid === 60000, `cumul payé : ${r.data.paid}`);
        assert(r.data.status === 'partial', `statut : ${r.data.status}`);
    });

    await test('encaissement supérieur au reste dû : refusé', async () => {
        const r = await appel('POST', '/credits/pay', { credit_id: idCredit, amount: 9999999 });
        assert(r.status === 400, `statut ${r.status}`);
    });

    await test('solde du crédit', async () => {
        const c = (await appel('GET', '/credits')).data.find(x => x.id === idCredit);
        const reste = c.amount - c.paid;
        const r = await appel('POST', '/credits/pay', { credit_id: idCredit, amount: reste });
        assert(r.data.status === 'paid', `statut : ${r.data.status}`);
    });

    await test('reçu de vente complet et imprimable', async () => {
        const ventes = (await appel('GET', '/sales')).data;
        assert(ventes.length > 0, 'aucune vente');
        const recu = await appel('GET', `/sales/${ventes[0].id}`);
        assert(recu.data.items.length > 0, 'reçu sans ligne');
        assert(recu.data.items[0].product_name, 'nom du produit absent du reçu');
    });

    await test('annulation d\'une vente : stock restitué', async () => {
        const v = await appel('POST', '/sales', {
            items: [{ product_id: idTelephone, quantity: 1, unit_price: 99000 }],
            payment_method: 'cash'
        });
        const avant = (await appel('GET', `/products/${idTelephone}`)).data.stock;
        const r = await appel('DELETE', `/sales/${v.data.id}`);
        assert(r.status === 200, `statut ${r.status} : ${r.data.error}`);
        const apres = (await appel('GET', `/products/${idTelephone}`)).data.stock;
        assert(apres === avant + 1, `stock ${apres} au lieu de ${avant + 1}`);
        const redo = await appel('DELETE', `/sales/${v.data.id}`);
        assert(redo.status === 409, 'double annulation acceptée');
    });

    await test('tableau de bord cohérent', async () => {
        const d = (await appel('GET', '/dashboard')).data;
        assert(d.totalProducts === 2, `produits : ${d.totalProducts}`);
        assert(d.todaySalesCount >= 3, `ventes du jour : ${d.todaySalesCount}`);
        assert(typeof d.todaySales === 'number', 'chiffre du jour absent');
        assert(Array.isArray(d.recentSales), 'ventes récentes absentes');
    });

    await test('rapport de bénéfice cohérent', async () => {
        const r = await appel('GET', '/reports/profit');
        assert(r.status === 200, `statut ${r.status}`);
        const somme = r.data.items.reduce((s, i) => s + i.profit, 0);
        assert(Math.abs(somme - r.data.totalProfit) < 0.01, 'total incohérent avec le détail');
        assert(r.data.totalProfit > 0, `bénéfice ${r.data.totalProfit}`);
    });

    await test('export de sauvegarde complet', async () => {
        const r = await appel('GET', '/export');
        for (const t of ['products', 'sales', 'sale_items', 'customers', 'settings']) {
            assert(Array.isArray(r.data[t]), `table absente : ${t}`);
        }
    });

    await test('suppression d\'un produit vendu : refusée', async () => {
        const r = await appel('DELETE', `/products/${idTelephone}`);
        assert(r.status === 409, `statut ${r.status}`);
    });

    await test('enregistrement des paramètres de la boutique', async () => {
        const r = await appel('PUT', '/settings', {
            store_name: 'Boutique Konaté', store_phone: '70 11 22 33', currency: 'FCFA'
        });
        assert(r.status === 200, `statut ${r.status}`);
        const s = (await appel('GET', '/settings')).data;
        assert(s.store_name === 'Boutique Konaté', `nom : ${s.store_name}`);
        assert(s.store_phone === '70 11 22 33', `téléphone : ${s.store_phone}`);
    });

    await test('changement de mot de passe effectif', async () => {
        let r = await appel('POST', '/auth/password', {
            current_password: 'admin123', new_password: 'BoutiqueOuaga2026'
        });
        assert(r.status === 200, `statut ${r.status} : ${r.data.error}`);
        r = await appel('POST', '/login', { username: 'admin', password: 'admin123' });
        assert(r.status === 401, 'ancien mot de passe encore accepté');
        r = await appel('POST', '/login', { username: 'admin', password: 'BoutiqueOuaga2026' });
        assert(r.status === 200, 'nouveau mot de passe refusé');
        token = r.data.token;
        const sante = await appel('GET', '/health');
        assert(sante.data.firstRun === false, 'l\'aide de première connexion reste affichée');
        // On restaure pour laisser la base dans un état connu.
        await appel('POST', '/auth/password', {
            current_password: 'BoutiqueOuaga2026', new_password: 'admin123'
        });
    });

    await test('accès sans jeton refusé', async () => {
        const sauve = token;
        token = null;
        const r = await appel('GET', '/products');
        token = sauve;
        assert(r.status === 401, `statut ${r.status}`);
    });

    await test('jeton falsifié refusé', async () => {
        const sauve = token;
        token = 'faux.jeton.invalide';
        const r = await appel('GET', '/products');
        token = sauve;
        assert(r.status === 401, `statut ${r.status}`);
    });

    console.log(`\nRÉSULTAT : ${reussis} réussis, ${echoues} échoués`);
    process.exit(echoues === 0 ? 0 : 1);
})();
