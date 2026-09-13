/**
 * TelecomStock Pro — moteur autonome (mode « sans ordinateur »).
 *
 * Une boutique qui ne possède ni PC de caisse ni téléphone Android doit
 * pouvoir travailler quand même. Ce module réimplémente l'intégralité de
 * l'API du serveur directement dans le navigateur : les données vivent dans
 * le téléphone (localStorage), aucune connexion n'est nécessaire.
 *
 * Contrat : mêmes routes, mêmes charges utiles, mêmes messages d'erreur que
 * le backend Express. L'interface ne fait donc AUCUNE différence entre les
 * deux modes — un seul code d'interface à maintenir.
 */
(function (global) {
    'use strict';

    const CLE = 'telecomstock_local_v1';
    const MDP_PAR_DEFAUT = 'admin123';

    /* ---------- persistance ---------- */

    function baseVierge() {
        return {
            users: [{ id: 1, username: 'admin', password: MDP_PAR_DEFAUT, role: 'owner' }],
            // Mêmes catégories que le serveur, dans le même ordre.
            categories: [
                { id: 1, name: 'Téléphone' }, { id: 2, name: 'Accessoire' },
                { id: 3, name: 'Tablette' }, { id: 4, name: 'Ordinateur' },
                { id: 5, name: 'Carte SIM' }, { id: 6, name: 'Forfait' }
            ],
            products: [], customers: [], suppliers: [],
            sales: [], sale_items: [], credits: [], stock_movements: [],
            // Mêmes clés que le serveur : sinon les paramètres saisis dans
            // l'interface ne seraient pas retrouvés (nom de boutique, devise…).
            settings: {
                store_name: 'TelecomStock Pro',
                store_address: 'Ouagadougou, Burkina Faso',
                store_phone: '+226 25 00 00 00',
                currency: 'FCFA',
                vat_rate: '18',
                min_stock_alert: '5',
                ifu: ''
            },
            // Les catégories par défaut occupent déjà les identifiants 1 à 6.
            seq: { categories: 6 }
        };
    }

    let bd = null;

    function charger() {
        if (bd) return bd;
        try {
            const brut = localStorage.getItem(CLE);
            bd = brut ? JSON.parse(brut) : baseVierge();
        } catch {
            bd = baseVierge();
        }
        return bd;
    }

    function sauver() {
        try {
            localStorage.setItem(CLE, JSON.stringify(bd));
        } catch (e) {
            // Quota dépassé : mieux vaut prévenir franchement que perdre une vente.
            throw err(507, "Mémoire du téléphone pleine. Exportez puis supprimez d'anciennes ventes.");
        }
    }

    /** Identifiant auto-incrémenté, par table, comme le ferait SQLite. */
    function nextId(table) {
        bd.seq[table] = (bd.seq[table] || 0) + 1;
        return bd.seq[table];
    }

    function err(status, message) {
        const e = new Error(message);
        e.status = status;
        return e;
    }

    const nombre = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const entier = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
    const texte = (v, max) => String(v ?? '').trim().slice(0, max);
    const maintenant = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

    /* ---------- produits ---------- */

    function referenceAuto() {
        let max = 0;
        for (const p of bd.products) {
            if (/^PRD-\d+$/.test(p.reference)) {
                const n = parseInt(p.reference.slice(4), 10);
                if (n > max) max = n;
            }
        }
        return 'PRD-' + String(max + 1).padStart(3, '0');
    }

    function lireProduit(body, autoRef) {
        let reference = texte(body?.reference, 40);
        const name = texte(body?.name, 120);
        if (!name) throw err(400, 'Le nom du produit est obligatoire');
        if (!reference) {
            if (!autoRef) throw err(400, 'La référence est obligatoire');
            reference = referenceAuto();
        }
        return {
            reference, name,
            category_id: entier(body?.category_id),
            purchase_price: Math.max(0, nombre(body?.purchase_price)),
            sale_price: Math.max(0, nombre(body?.sale_price)),
            stock: Math.max(0, entier(body?.stock) ?? 0),
            min_stock: Math.max(0, entier(body?.min_stock) ?? 5),
            has_imei: body?.has_imei ? 1 : 0,
            description: texte(body?.description, 500)
        };
    }

    function produitEnrichi(p) {
        const cat = bd.categories.find(c => c.id === p.category_id);
        return Object.assign({}, p, { category_name: cat ? cat.name : null });
    }

    /* ---------- ventes ---------- */

    function creerVente(body) {
        const items = Array.isArray(body?.items) ? body.items : [];
        if (!items.length) throw err(400, 'La vente doit contenir au moins un article');

        const methode = ['cash', 'mobile_money', 'credit', 'card'].includes(body?.payment_method)
            ? body.payment_method : 'cash';
        const customer_id = entier(body?.customer_id);
        if (methode === 'credit' && !customer_id) {
            throw err(400, 'Une vente à crédit exige un client identifié');
        }

        // Vérification complète AVANT toute écriture : une vente est atomique.
        let sousTotal = 0;
        const resolus = [];
        for (const item of items) {
            const produit = bd.products.find(p => p.id === entier(item?.product_id));
            if (!produit) throw err(404, 'Produit introuvable dans la vente');
            const qte = entier(item?.quantity) ?? 0;
            if (qte <= 0) throw err(400, 'Quantité invalide');
            if (produit.stock < qte) {
                throw err(409, `Stock insuffisant pour ${produit.name} (reste ${produit.stock})`);
            }
            const prix = item?.unit_price != null ? Math.max(0, nombre(item.unit_price)) : produit.sale_price;
            sousTotal += prix * qte;
            resolus.push({ produit, qte, prix });
        }

        const remise = Math.min(100, Math.max(0, nombre(body?.discount)));
        const total = Math.round(sousTotal * (1 - remise / 100));

        const saleId = nextId('sales');
        bd.sales.push({
            id: saleId, customer_id, total, payment_method: methode,
            discount: remise, status: 'completed', created_at: maintenant()
        });

        for (const { produit, qte, prix } of resolus) {
            produit.stock -= qte;
            bd.sale_items.push({
                id: nextId('sale_items'), sale_id: saleId, product_id: produit.id,
                quantity: qte, unit_price: prix
            });
            bd.stock_movements.push({
                id: nextId('stock_movements'), product_id: produit.id, type: 'exit',
                quantity: qte, reason: `Vente #V-${saleId}`,
                supplier_id: null, unit_price: prix, created_at: maintenant()
            });
        }

        if (customer_id) {
            const client = bd.customers.find(c => c.id === customer_id);
            if (client) client.total_purchases = (client.total_purchases || 0) + total;
            if (methode === 'credit') {
                const acompte = Math.max(0, Math.min(nombre(body?.amount_paid), total));
                const statut = acompte <= 0 ? 'unpaid' : (acompte >= total - 0.001 ? 'paid' : 'partial');
                bd.credits.push({
                    id: nextId('credits'), customer_id, sale_id: saleId,
                    amount: total, paid: acompte, status: statut, created_at: maintenant()
                });
                if (client) client.total_credit = (client.total_credit || 0) + (total - acompte);
            }
        }

        sauver();
        return { id: saleId, total, message: 'Vente enregistrée' };
    }

    function annulerVente(id) {
        const vente = bd.sales.find(s => s.id === id);
        if (!vente) throw err(404, 'Vente non trouvée');
        if (vente.status === 'cancelled') throw err(409, 'Vente déjà annulée');

        for (const ligne of bd.sale_items.filter(i => i.sale_id === id)) {
            const produit = bd.products.find(p => p.id === ligne.product_id);
            if (produit) produit.stock += ligne.quantity;
            bd.stock_movements.push({
                id: nextId('stock_movements'), product_id: ligne.product_id, type: 'entry',
                quantity: ligne.quantity, reason: `Annulation vente #V-${id}`,
                supplier_id: null, unit_price: null, created_at: maintenant()
            });
        }

        if (vente.customer_id) {
            const client = bd.customers.find(c => c.id === vente.customer_id);
            if (client) {
                client.total_purchases = Math.max(0, (client.total_purchases || 0) - vente.total);
            }
            const credit = bd.credits.find(c => c.sale_id === id);
            if (credit) {
                if (client) {
                    client.total_credit = Math.max(0, (client.total_credit || 0) - (credit.amount - credit.paid));
                }
                bd.credits = bd.credits.filter(c => c.id !== credit.id);
            }
        }

        // Comme le serveur : la vente est conservée et marquée annulée
        // (traçabilité), elle n'est pas effacée de l'historique.
        vente.status = 'cancelled';
        sauver();
        return { message: 'Vente annulée, stock restitué' };
    }

    function venteDetaillee(id) {
        const vente = bd.sales.find(s => s.id === id);
        if (!vente) throw err(404, 'Vente introuvable');
        const client = bd.customers.find(c => c.id === vente.customer_id);
        const items = bd.sale_items.filter(i => i.sale_id === id).map(i => {
            const p = bd.products.find(x => x.id === i.product_id);
            return Object.assign({}, i, { product_name: p ? p.name : 'Produit supprimé' });
        });
        return Object.assign({}, vente, { customer_name: client ? client.name : null, items });
    }

    /* ---------- tableau de bord ---------- */

    function tableauDeBord() {
        const jour = new Date().toISOString().slice(0, 10);
        const mois = jour.slice(0, 7);
        // Une vente annulée ne doit jamais gonfler le chiffre d'affaires.
        const valides = bd.sales.filter(s => s.status !== 'cancelled');
        const duJour = valides.filter(s => String(s.created_at).startsWith(jour));
        const duMois = valides.filter(s => String(s.created_at).startsWith(mois));
        const somme = (liste, champ) => liste.reduce((t, x) => t + nombre(x[champ]), 0);

        const idsValides = new Set(valides.map(s => s.id));
        const ventesParProduit = {};
        for (const item of bd.sale_items) {
            if (!idsValides.has(item.sale_id)) continue;
            ventesParProduit[item.product_id] =
                (ventesParProduit[item.product_id] || 0) + item.quantity;
        }

        return {
            totalProducts: bd.products.length,
            totalStock: bd.products.reduce((t, p) => t + p.stock, 0),
            lowStock: bd.products.filter(p => p.stock > 0 && p.stock <= p.min_stock).length,
            outOfStock: bd.products.filter(p => p.stock === 0).length,
            todaySales: somme(duJour, 'total'),
            todaySalesCount: duJour.length,
            monthSales: somme(duMois, 'total'),
            totalImeis: 0,
            openCredits: bd.credits.filter(c => c.status !== 'paid')
                .reduce((t, c) => t + (c.amount - c.paid), 0),
            lowStockProducts: bd.products.filter(p => p.stock <= p.min_stock)
                .slice(0, 5).map(produitEnrichi),
            recentSales: bd.sales.slice(-5).reverse().map(s => {
                const c = bd.customers.find(x => x.id === s.customer_id);
                return Object.assign({}, s, { customer_name: c ? c.name : null });
            }),
            topProducts: Object.entries(ventesParProduit)
                .sort((a, b) => b[1] - a[1]).slice(0, 5)
                .map(([pid, qte]) => {
                    const p = bd.products.find(x => x.id === Number(pid));
                    return { name: p ? p.name : 'Supprimé', sold: qte };
                })
        };
    }

    /* ---------- routage ---------- */

    const ROUTES = [
        ['GET', /^\/health$/, () => ({
            status: 'ok', version: '1.0.0', mode: 'autonome',
            firstRun: bd.users[0].password === MDP_PAR_DEFAUT,
            timestamp: new Date().toISOString()
        })],

        ['POST', /^\/login$/, body => {
            const u = bd.users.find(x => x.username === texte(body?.username, 60));
            if (!u || u.password !== String(body?.password ?? '')) {
                throw err(401, 'Identifiants incorrects');
            }
            return { token: 'local', user: { id: u.id, username: u.username, role: u.role } };
        }],
        ['GET', /^\/auth\/check$/, () => {
            const u = bd.users[0];
            return { user: { id: u.id, username: u.username, role: u.role } };
        }],
        ['POST', /^\/auth\/reset-password$/, body => {
            // Mot de passe oublié en mode autonome : les données sont dans cet
            // appareil, leur accès ne doit jamais être définitivement perdu.
            if (body?.confirm !== 'RESET-PASSWORD') throw err(400, 'Confirmation requise');
            bd.users[0].password = MDP_PAR_DEFAUT;
            bd.users[0].username = 'admin';
            sauver();
            return { message: 'Mot de passe réinitialisé à admin123' };
        }],

        ['POST', /^\/auth\/password$/, body => {
            const u = bd.users[0];
            const suivant = String(body?.new_password ?? '');
            if (suivant.length < 6) throw err(400, 'Le nouveau mot de passe doit faire au moins 6 caractères');
            if (u.password !== String(body?.current_password ?? '')) {
                throw err(401, 'Mot de passe actuel incorrect');
            }
            u.password = suivant;
            sauver();
            return { message: 'Mot de passe modifié' };
        }],

        ['GET', /^\/categories$/, () => bd.categories],
        ['POST', /^\/categories$/, body => {
            const name = texte(body?.name, 60);
            if (!name) throw err(400, 'Nom requis');
            if (bd.categories.some(c => c.name === name)) {
                throw err(409, 'Catégorie déjà existante');
            }
            const cat = {
                id: nextId('categories'), name,
                description: texte(body?.description, 200)
            };
            bd.categories.push(cat);
            sauver();
            return { id: cat.id };
        }],

        ['GET', /^\/products$/, () => bd.products.map(produitEnrichi)],
        ['GET', /^\/products\/(\d+)$/, (b, [id]) => {
            const p = bd.products.find(x => x.id === Number(id));
            if (!p) throw err(404, 'Produit non trouvé');
            return produitEnrichi(p);
        }],
        ['POST', /^\/products$/, body => {
            const p = lireProduit(body, true);
            if (bd.products.some(x => x.reference === p.reference)) {
                throw err(409, 'Cette référence est déjà utilisée');
            }
            const produit = Object.assign({ id: nextId('products'), created_at: maintenant() }, p);
            bd.products.push(produit);
            if (produit.stock > 0) {
                bd.stock_movements.push({
                    id: nextId('stock_movements'), product_id: produit.id, type: 'entry',
                    quantity: produit.stock, reason: 'Stock initial', created_at: maintenant()
                });
            }
            sauver();
            return { id: produit.id, message: 'Produit ajouté' };
        }],
        ['PUT', /^\/products\/(\d+)$/, (body, [id]) => {
            const produit = bd.products.find(x => x.id === Number(id));
            if (!produit) throw err(404, 'Produit non trouvé');
            // Référence vidée lors d'une modification : on garde l'existante.
            const corps = Object.assign({}, body);
            if (!texte(corps.reference, 40)) corps.reference = produit.reference;
            const p = lireProduit(corps, false);
            if (bd.products.some(x => x.reference === p.reference && x.id !== produit.id)) {
                throw err(409, 'Cette référence est déjà utilisée');
            }
            Object.assign(produit, p);
            sauver();
            return { message: 'Produit modifié' };
        }],
        ['DELETE', /^\/products\/(\d+)$/, (b, [id]) => {
            const pid = Number(id);
            if (bd.sale_items.some(i => i.product_id === pid)) {
                throw err(409, 'Ce produit figure dans des ventes : il ne peut pas être supprimé');
            }
            bd.products = bd.products.filter(p => p.id !== pid);
            bd.stock_movements = bd.stock_movements.filter(m => m.product_id !== pid);
            sauver();
            return { message: 'Produit supprimé' };
        }],

        ['GET', /^\/stock-movements$/, () => bd.stock_movements.slice().reverse().map(m => {
            const p = bd.products.find(x => x.id === m.product_id);
            const f = bd.suppliers.find(x => x.id === m.supplier_id);
            return Object.assign({}, m, {
                product_name: p ? p.name : 'Produit supprimé',
                supplier_name: f ? f.name : null
            });
        })],
        ['POST', /^\/stock-movements$/, body => {
            const produit = bd.products.find(p => p.id === entier(body?.product_id));
            if (!produit) throw err(404, 'Produit non trouvé');
            const qte = entier(body?.quantity) ?? 0;
            if (qte <= 0) throw err(400, 'Quantité invalide');
            const type = ['entry', 'exit', 'adjustment'].includes(body?.type) ? body.type : 'entry';
            if (type === 'exit' && produit.stock < qte) {
                throw err(409, `Stock insuffisant (reste ${produit.stock})`);
            }
            if (type === 'entry') produit.stock += qte;
            else if (type === 'exit') produit.stock -= qte;
            else produit.stock = qte;
            bd.stock_movements.push({
                id: nextId('stock_movements'), product_id: produit.id, type,
                quantity: qte, reason: texte(body?.reason, 200),
                supplier_id: entier(body?.supplier_id),
                unit_price: body?.unit_price != null ? nombre(body.unit_price) : null,
                created_at: maintenant()
            });
            sauver();
            // Même forme que le serveur : l'interface affiche newStock.
            return { message: 'Mouvement enregistré', newStock: produit.stock };
        }],

        ['GET', /^\/customers$/, () => bd.customers],
        ['GET', /^\/customers\/(\d+)$/, (b, [id]) => {
            const c = bd.customers.find(x => x.id === Number(id));
            if (!c) throw err(404, 'Client non trouvé');
            return c;
        }],
        ['POST', /^\/customers$/, body => {
            const name = texte(body?.name, 120);
            if (!name) throw err(400, 'Le nom du client est obligatoire');
            const client = {
                id: nextId('customers'), name,
                phone: texte(body?.phone, 40), email: texte(body?.email, 120),
                address: texte(body?.address, 200), total_purchases: 0, total_credit: 0,
                created_at: maintenant()
            };
            bd.customers.push(client);
            sauver();
            return { id: client.id, message: 'Client ajouté' };
        }],
        ['PUT', /^\/customers\/(\d+)$/, (body, [id]) => {
            const c = bd.customers.find(x => x.id === Number(id));
            if (!c) throw err(404, 'Client non trouvé');
            const name = texte(body?.name, 120);
            if (!name) throw err(400, 'Le nom du client est obligatoire');
            Object.assign(c, {
                name, phone: texte(body?.phone, 40), email: texte(body?.email, 120),
                address: texte(body?.address, 200)
            });
            sauver();
            return { message: 'Client modifié' };
        }],
        ['DELETE', /^\/customers\/(\d+)$/, (b, [id]) => {
            const cid = Number(id);
            if (bd.credits.some(c => c.customer_id === cid && c.status !== 'paid')) {
                throw err(409, 'Ce client a un crédit en cours');
            }
            bd.customers = bd.customers.filter(c => c.id !== cid);
            sauver();
            return { message: 'Client supprimé' };
        }],

        ['GET', /^\/suppliers$/, () => bd.suppliers],
        ['POST', /^\/suppliers$/, body => {
            const name = texte(body?.name, 120);
            if (!name) throw err(400, 'Le nom du fournisseur est obligatoire');
            const f = {
                id: nextId('suppliers'), name,
                phone: texte(body?.phone, 40), email: texte(body?.email, 120),
                address: texte(body?.address, 200), products: texte(body?.products, 300),
                created_at: maintenant()
            };
            bd.suppliers.push(f);
            sauver();
            return { id: f.id, message: 'Fournisseur ajouté' };
        }],
        ['PUT', /^\/suppliers\/(\d+)$/, (body, [id]) => {
            const f = bd.suppliers.find(x => x.id === Number(id));
            if (!f) throw err(404, 'Fournisseur non trouvé');
            Object.assign(f, {
                name: texte(body?.name, 120) || f.name,
                phone: texte(body?.phone, 40), email: texte(body?.email, 120),
                address: texte(body?.address, 200), products: texte(body?.products, 300)
            });
            sauver();
            return { message: 'Fournisseur modifié' };
        }],
        ['DELETE', /^\/suppliers\/(\d+)$/, (b, [id]) => {
            bd.suppliers = bd.suppliers.filter(f => f.id !== Number(id));
            sauver();
            return { message: 'Fournisseur supprimé' };
        }],

        ['GET', /^\/sales$/, () => bd.sales.slice().reverse().map(s => {
            const c = bd.customers.find(x => x.id === s.customer_id);
            const n = bd.sale_items.filter(i => i.sale_id === s.id).length;
            return Object.assign({}, s, { customer_name: c ? c.name : null, items_count: n });
        })],
        ['GET', /^\/sales\/(\d+)$/, (b, [id]) => venteDetaillee(Number(id))],
        ['POST', /^\/sales$/, body => creerVente(body)],
        ['DELETE', /^\/sales\/(\d+)$/, (b, [id]) => annulerVente(Number(id))],

        ['GET', /^\/credits$/, () => bd.credits.map(c => {
            const cl = bd.customers.find(x => x.id === c.customer_id);
            return Object.assign({}, c, { customer_name: cl ? cl.name : 'Client supprimé' });
        })],
        ['POST', /^\/credits\/pay$/, body => {
            const credit = bd.credits.find(c => c.id === entier(body?.credit_id));
            if (!credit) throw err(404, 'Crédit introuvable');
            if (credit.status === 'paid') throw err(409, 'Ce crédit est déjà soldé');
            const montant = nombre(body?.amount);
            const reste = credit.amount - credit.paid;
            if (montant <= 0) throw err(400, 'Montant invalide');
            if (montant > reste + 0.001) throw err(400, `Montant supérieur au reste dû (${reste})`);
            credit.paid += montant;
            credit.status = credit.paid >= credit.amount - 0.001 ? 'paid' : 'partial';
            const client = bd.customers.find(c => c.id === credit.customer_id);
            if (client) client.total_credit = Math.max(0, (client.total_credit || 0) - montant);
            sauver();
            return { message: 'Paiement enregistré', paid: credit.paid, status: credit.status };
        }],

        ['GET', /^\/dashboard$/, () => tableauDeBord()],

        ['GET', /^\/reports\/profit$/, () => {
            // Seules les ventes réellement encaissées comptent : les ventes
            // annulées ne doivent jamais apparaître dans le bénéfice.
            const valides = new Set(
                bd.sales.filter(s => s.status !== 'cancelled').map(s => s.id));
            const parProduit = new Map();
            for (const ligne of bd.sale_items) {
                if (!valides.has(ligne.sale_id)) continue;
                const produit = bd.products.find(p => p.id === ligne.product_id);
                if (!produit) continue;
                const cumul = parProduit.get(produit.id) || {
                    name: produit.name, qty_sold: 0, revenue: 0, cost: 0
                };
                cumul.qty_sold += ligne.quantity;
                cumul.revenue += ligne.quantity * ligne.unit_price;
                cumul.cost += ligne.quantity * produit.purchase_price;
                parProduit.set(produit.id, cumul);
            }
            const items = [...parProduit.values()]
                .map(i => Object.assign({}, i, { profit: i.revenue - i.cost }))
                .sort((a, b) => b.profit - a.profit);
            return {
                items,
                totalRevenue: items.reduce((s, i) => s + i.revenue, 0),
                totalCost: items.reduce((s, i) => s + i.cost, 0),
                totalProfit: items.reduce((s, i) => s + i.profit, 0)
            };
        }],

        ['GET', /^\/settings$/, () => bd.settings],
        ['PUT', /^\/settings$/, body => {
            // Liste blanche identique au serveur : seules les clés connues sont
            // acceptées, on n'enregistre jamais un champ arbitraire.
            for (const cle of Object.keys(bd.settings)) {
                if (body && body[cle] !== undefined) {
                    bd.settings[cle] = texte(body[cle], 200);
                }
            }
            sauver();
            return { message: 'Paramètres enregistrés' };
        }],

        ['GET', /^\/export$/, () => ({
            exported_at: new Date().toISOString(), version: '1.0.0', mode: 'autonome',
            categories: bd.categories,
            products: bd.products, sales: bd.sales, sale_items: bd.sale_items,
            customers: bd.customers, suppliers: bd.suppliers, credits: bd.credits,
            stock_movements: bd.stock_movements, settings: bd.settings
        })],

        ['POST', /^\/import$/, body => {
            // Restauration d'une sauvegarde : en mode autonome, c'est la seule
            // protection du commerçant contre la perte de son appareil.
            if (!body || typeof body !== 'object' || !Array.isArray(body.products)) {
                throw err(400, 'Fichier de sauvegarde invalide');
            }
            if (body.confirm !== 'IMPORT') {
                throw err(400, "Confirmation requise : envoyez { confirm: 'IMPORT' }");
            }
            const liste = t => Array.isArray(body[t]) ? body[t] : [];

            const neuf = baseVierge();
            neuf.users = bd.users;                 // on ne touche pas au compte
            if (liste('categories').length) neuf.categories = liste('categories');
            neuf.products = liste('products');
            neuf.customers = liste('customers');
            neuf.suppliers = liste('suppliers');
            neuf.sales = liste('sales');
            neuf.sale_items = liste('sale_items');
            neuf.credits = liste('credits');
            neuf.stock_movements = liste('stock_movements');

            // Les paramètres peuvent arriver en tableau (export serveur) ou en
            // objet (export autonome) : on accepte les deux formes.
            const params = body.settings;
            if (Array.isArray(params)) {
                for (const s of params) {
                    if (s && s.key in neuf.settings) neuf.settings[s.key] = String(s.value ?? '');
                }
            } else if (params && typeof params === 'object') {
                for (const cle of Object.keys(neuf.settings)) {
                    if (params[cle] !== undefined) neuf.settings[cle] = String(params[cle]);
                }
            }

            // Les compteurs repartent au-dessus du plus grand identifiant reçu,
            // sinon un nouvel enregistrement écraserait une donnée restaurée.
            for (const table of ['products', 'customers', 'suppliers', 'sales',
                                 'sale_items', 'credits', 'stock_movements', 'categories']) {
                const max = (neuf[table] || []).reduce((m, x) => Math.max(m, Number(x.id) || 0), 0);
                neuf.seq[table] = max;
            }

            bd = neuf;
            sauver();
            const total = neuf.products.length + neuf.sales.length
                + neuf.customers.length + neuf.suppliers.length;
            return { message: 'Sauvegarde restaurée', restored: total };
        }],

        ['POST', /^\/maintenance\/reset$/, body => {
            if (body?.confirm !== 'RESET') {
                throw err(400, "Confirmation requise : envoyez { confirm: 'RESET' }");
            }
            // On conserve le compte et les préférences : seules les données
            // métier (stock, ventes, clients…) sont effacées.
            const utilisateurs = bd.users;
            const parametres = bd.settings;
            const categories = bd.categories;
            bd = baseVierge();
            bd.users = utilisateurs;
            bd.settings = parametres;
            bd.categories = categories;
            bd.seq.categories = categories.reduce((m, c) => Math.max(m, c.id), 0);
            sauver();
            return { message: 'Base réinitialisée' };
        }]
    ];

    /**
     * Point d'entrée unique, calqué sur fetch() : l'interface appelle
     * exactement comme si un serveur répondait.
     */
    async function traiter(endpoint, options) {
        charger();
        const methode = (options && options.method ? options.method : 'GET').toUpperCase();
        const chemin = endpoint.split('?')[0];
        let corps = null;
        if (options && options.body) {
            try { corps = JSON.parse(options.body); } catch { corps = null; }
        }

        for (const [m, motif, action] of ROUTES) {
            if (m !== methode) continue;
            const found = motif.exec(chemin);
            if (!found) continue;
            return action(corps, found.slice(1));
        }
        throw err(404, 'Fonction indisponible en mode autonome');
    }

    global.TelecomStockLocal = {
        traiter,
        estActif: () => localStorage.getItem('telecomstock_mode') === 'autonome',
        activer: () => localStorage.setItem('telecomstock_mode', 'autonome'),
        desactiver: () => localStorage.removeItem('telecomstock_mode'),
        effacerTout: () => { localStorage.removeItem(CLE); bd = null; }
    };
})(window);
