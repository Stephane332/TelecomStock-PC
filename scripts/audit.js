#!/usr/bin/env node
/**
 * Audit de pré-livraison.
 *
 * Vérifie, sur les fichiers réellement livrés, tout ce qui doit être vrai
 * avant qu'un commerçant utilise le logiciel en production. Chaque contrôle
 * est factuel : il lit le code ou les artefacts, il ne suppose rien.
 *
 * Sortie : liste des contrôles, puis un verdict. Code de sortie 1 si un
 * contrôle bloquant échoue.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const lire = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const existe = p => fs.existsSync(path.join(ROOT, p));

let ok = 0, ko = 0, avert = 0;

function verifie(nom, condition, detail = '') {
    if (condition) { console.log(`  OK   ${nom}`); ok++; }
    else { console.log(`  ÉCHEC ${nom}${detail ? ' — ' + detail : ''}`); ko++; }
}
function avertit(nom, condition, detail = '') {
    if (condition) { console.log(`  OK   ${nom}`); ok++; }
    else { console.log(`  NOTE ${nom}${detail ? ' — ' + detail : ''}`); avert++; }
}
const titre = t => console.log(`\n${t}`);

const html = lire('public/index.html');
const app = lire('public/js/app.js');
const local = lire('public/js/local-store.js');
const css = lire('public/css/styles.css');
const serveur = lire('backend/server.js');
const auth = lire('backend/auth.js');
const pkg = JSON.parse(lire('package.json'));

/* ---------- versions ---------- */
titre('VERSIONS');
const V = pkg.version;
verifie(`package.json = ${V}`, V === '1.0.0');
verifie('API annonce la même version', serveur.includes(`version: '${V}'`));
verifie('Android annonce la même version',
    lire('android/app/build.gradle').includes(`versionName "${V}"`));
verifie('interface affiche la même version', html.includes(`Pro v${V}`));
verifie('service worker sur la même version', lire('public/sw.js').includes(`'v${V}'`));
verifie('aucune trace de version 2.x',
    !/2\.1\.0|v2\.1/.test(html + app + css + serveur));

/* ---------- sécurité ---------- */
titre('SÉCURITÉ');
verifie('aucun mot de passe pré-rempli dans le HTML livré',
    !html.includes('value="admin123"'));
verifie('aucun identifiant pré-rempli dans le HTML livré',
    !/id="loginUser"[^>]*value="/.test(html));
verifie('aucun gestionnaire inline (CSP stricte)',
    !/\son(?:click|change|input|submit|load)\s*=/i.test(html));
verifie('aucun eval ni Function dynamique',
    !/\beval\s*\(|new\s+Function\s*\(/.test(app + local));
verifie('secret JWT non codé en dur',
    /process\.env\.TS_JWT_SECRET/.test(auth) && !/SECRET\s*=\s*['"][A-Za-z0-9]{8}/.test(auth));
verifie('mots de passe hachés (bcrypt)', /bcrypt/.test(serveur));
verifie('clés étrangères actives en permanence',
    !/foreign_keys\s*=\s*OFF/i.test(lire('backend/database.js')));
verifie('en-têtes de sécurité posés (helmet)', /helmet\(/.test(serveur));
verifie('HTTPS non imposé (réseau local en clair)',
    /hsts:\s*false/.test(serveur));
verifie('limitation du débit sur la connexion',
    /rateLimit|express-rate-limit/.test(serveur));

/* ---------- intégrité des données ---------- */
titre('INTÉGRITÉ DES DONNÉES');
const bdd = lire('backend/database.js');
verifie('aucune donnée de démonstration au démarrage',
    !/^\s*seedDemo\(\);\s*$/m.test(bdd));
verifie('ventes en transaction (tout ou rien)', /db\.transaction/.test(serveur));
verifie('ventes annulées conservées, non supprimées',
    /status='cancelled'/.test(serveur));
verifie('le mode autonome marque aussi les annulations',
    /status = 'cancelled'/.test(local));
verifie('bénéfice calculé hors ventes annulées',
    /status='completed'/.test(serveur) && /cancelled/.test(local));

/* ---------- parité serveur / mode autonome ---------- */
titre('PARITÉ SERVEUR ↔ MODE AUTONOME');
const routesInterface = new Set();
for (const m of app.matchAll(/api\((['`])(\/[^'`]+)\1/g)) {
    routesInterface.add(m[2].split('?')[0].replace(/\$\{[^}]*\}/g, ':id'));
}
// Les routes du moteur sont déclarées en littéraux d'expression régulière.
// On les extrait telles quelles, puis on les évalue pour tester chaque chemin :
// aucune supposition sur l'échappement, on utilise les vraies expressions.
const motifsLocaux = [...local.matchAll(/\['(?:GET|POST|PUT|DELETE)',\s*(\/\^[^,]+?\$\/)/g)]
    .map(m => {
        try { return eval(m[1]); } catch { return null; }
    })
    .filter(Boolean);

const manquantes = [];
for (const r of routesInterface) {
    const chemin = r.replace(/:id/g, '1');
    if (!motifsLocaux.some(re => re.test(chemin))) manquantes.push(r);
}
verifie(`les ${routesInterface.size} routes de l'interface existent en mode autonome`,
    manquantes.length === 0, manquantes.join(', '));

/* ---------- ergonomie ---------- */
titre('ERGONOMIE COMMERÇANT');
verifie('identifiants affichés à la première utilisation',
    html.includes('firstRunHint') && /firstRun/.test(serveur));
verifie('encadré masqué par défaut', /id="firstRunHint"[^>]*\shidden/.test(html));
verifie('référence produit facultative côté interface',
    !app.includes('Référence et nom sont obligatoires'));
verifie('référence générée par le serveur', /nextReference/.test(serveur));
verifie('référence générée aussi en mode autonome', /referenceAuto/.test(local));
verifie('champs du formulaire expliqués', (html.match(/field-help/g) || []).length >= 8);
verifie('les modales défilent (accessibles au clavier mobile)',
    /\.modal-overlay\s*\{[^}]*overflow-y:\s*auto/s.test(css));
verifie('un défilement au doigt ne ferme pas la modale',
    /pointerdown/.test(app));
verifie('montant d\'encaissement pré-rempli', /champ\.value = reste/.test(app));
verifie('choix du mode proposé au commerçant',
    html.includes('modeChoice') && /modeAutonome/.test(app));
verifie('un mauvais mot de passe ne dit pas « session expirée »',
    app.includes("!endpoint.startsWith('/login')"));

/* ---------- réseau ---------- */
titre('RÉSEAU (téléphones ↔ caisse)');
const main = lire('electron/main.js');
verifie('port fixe et prévisible', /LAN_PORT/.test(main) && /3002/.test(main));
verifie('écoute sur le réseau, pas seulement en local', /'0\.0\.0\.0'/.test(main));
verifie('adresse LAN montrée au commerçant', /showLanInfo/.test(main));
verifie('pare-feu ouvert par l\'installateur',
    existe('build/installer.nsh') && /localport=3002/.test(lire('build/installer.nsh')));
verifie('trafic local en clair autorisé sur Android',
    /cleartextTrafficPermitted="true"/.test(lire('android/app/src/main/res/xml/network_security_config.xml')));

/* ---------- mode autonome (APK + PWA) ---------- */
titre('MODE AUTONOME');
const activite = lire('android/app/src/main/java/bf/avenix/telecomstock/MainActivity.java');
verifie('APK : interface embarquée', /android_asset\/www\/index\.html/.test(activite));
verifie('APK : choix du mode au démarrage', /askMode/.test(activite));
verifie('APK : aucune erreur réseau en mode autonome', /!isAutonome\(\)/.test(activite));
verifie('build APK copie l\'interface', /copierInterface/.test(lire('scripts/build-apk.js')));
verifie('interface forcée en autonome sur file://',
    /location\.protocol === 'file:'/.test(app));
verifie('service worker ignoré sur file://',
    /protocol !== 'file:'/.test(app));
verifie('aucun chemin absolu dans le HTML (hébergement en sous-dossier)',
    !/(?:src|href)="\//.test(html));

/* ---------- PWA ---------- */
titre('PWA');
const manifest = JSON.parse(lire('public/manifest.json'));
verifie('manifest installable (standalone)', manifest.display === 'standalone');
verifie('portée relative', manifest.start_url === './' && manifest.scope === './');
verifie('icônes présentes sur le disque',
    manifest.icons.every(i => existe(path.join('public', i.src))));
verifie('service worker met en cache le moteur autonome',
    lire('public/sw.js').includes('local-store.js'));
verifie('version web générée (docs/)', existe('docs/index.html'));
avertit('docs/ à jour avec public/',
    existe('docs/js/local-store.js') &&
    lire('docs/js/local-store.js') === local,
    'lancez npm run build:web');

/* ---------- artefacts ---------- */
titre('ARTEFACTS LIVRABLES');
for (const f of [
    `dist/TelecomStock-Pro-Installateur-${V}.exe`,
    `dist/TelecomStock-Pro-Portable-${V}.exe`,
    `dist/TelecomStock-Pro-${V}.apk`
]) {
    const present = existe(f);
    const taille = present ? (fs.statSync(path.join(ROOT, f)).size / 1048576).toFixed(1) : 0;
    verifie(`${path.basename(f)} (${taille} Mo)`, present && taille > 1);
}

/* ---------- verdict ---------- */
console.log('\n' + '─'.repeat(52));
console.log(`  ${ok} contrôles OK, ${ko} échecs, ${avert} notes`);
console.log(ko === 0
    ? '  VERDICT : prêt pour la livraison'
    : '  VERDICT : NE PAS LIVRER — corriger les échecs ci-dessus');
console.log('─'.repeat(52));
process.exit(ko === 0 ? 0 : 1);
