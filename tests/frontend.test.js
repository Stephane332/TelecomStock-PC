/**
 * Vérifie la cohérence HTML ↔ JS sans navigateur.
 * Attrape la classe de bug de la v2.0 (fonction appelée mais inexistante,
 * identifiant manipulé mais absent du DOM).
 *
 * Usage : node tests/frontend.test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'styles.css'), 'utf8');

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
    if (ok) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); failed++; }
};

const all = (re, src) => [...src.matchAll(re)].map(m => m[1]);
const uniq = a => [...new Set(a)];

/* 1. Identifiants manipulés par le JS ------------------------------------ */
console.log('\nIDENTIFIANTS DOM');

const htmlIds = new Set(all(/\bid="([^"]+)"/g, html));
const jsIds = uniq(all(/\$\('([^']+)'\)/g, js));
const missingIds = jsIds.filter(id => !htmlIds.has(id));
check(`${jsIds.length} identifiants utilisés par le JS existent dans le HTML`,
    missingIds.length === 0, `absents : ${missingIds.join(', ')}`);

/* 2. Actions déclaratives ------------------------------------------------ */
console.log('\nACTIONS ET HANDLERS');

const htmlActions = uniq(all(/data-action="([^"]+)"/g, html));
const actionsBlock = js.match(/const ACTIONS = \{([\s\S]*?)\n\};/);
check('table ACTIONS présente dans app.js', !!actionsBlock);

if (actionsBlock) {
    const declared = new Set(all(/([A-Za-z_]\w*)\s*[:,}]/g, actionsBlock[1] + '}'));
    const orphans = htmlActions.filter(a => !declared.has(a));
    check(`${htmlActions.length} data-action ont un handler`,
        orphans.length === 0, `sans handler : ${orphans.join(', ')}`);
}

const htmlModals = uniq(all(/data-modal="([^"]+)"/g, html));
const openersBlock = js.match(/const MODAL_OPENERS = \{([\s\S]*?)\n\};/);
if (openersBlock) {
    const declared = new Set(all(/([A-Za-z_]\w*)\s*:/g, openersBlock[1]));
    const orphans = htmlModals.filter(m => !declared.has(m));
    check(`${htmlModals.length} data-modal ont un ouvreur`,
        orphans.length === 0, `sans ouvreur : ${orphans.join(', ')}`);
}

/* 3. Cibles de fermeture / navigation ------------------------------------ */
console.log('\nCIBLES DE NAVIGATION');

const closeTargets = uniq(all(/data-close="([^"]+)"/g, html));
const badClose = closeTargets.filter(id => !htmlIds.has(id));
check(`${closeTargets.length} boutons de fermeture ciblent une modale réelle`,
    badClose.length === 0, `cibles inconnues : ${badClose.join(', ')}`);

const navPages = uniq(all(/data-page="([^"]+)"/g, html));
const gotoPages = uniq(all(/data-goto="([^"]+)"/g, html));
const badPages = [...navPages, ...gotoPages].filter(p => !htmlIds.has(p));
check(`${navPages.length + gotoPages.length} liens de navigation pointent vers une section`,
    badPages.length === 0, `sections manquantes : ${badPages.join(', ')}`);

const loadersBlock = js.match(/const LOADERS = \{([\s\S]*?)\n\};/);
if (loadersBlock) {
    const declared = new Set(all(/([A-Za-z_]\w*)\s*:/g, loadersBlock[1]));
    const noLoader = navPages.filter(p => !declared.has(p));
    check('chaque page a une fonction de chargement',
        noLoader.length === 0, `sans loader : ${noLoader.join(', ')}`);
}

/* 4. Sécurité : compatibilité avec la CSP stricte ------------------------ */
console.log('\nSÉCURITÉ (CSP stricte : ni inline, ni eval)');

check('aucun gestionnaire inline (onclick=, oninput=…) dans le HTML',
    !/\son(click|input|change|submit|load)\s*=/i.test(html));
check('aucun <script> inline dans le HTML',
    !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html));
check('aucun appel à eval() ou new Function()',
    !/\beval\s*\(|new\s+Function\s*\(/.test(js));

/* 5. Sécurité : absence d'injection HTML sur données serveur ------------- */
console.log('\nSÉCURITÉ (XSS)');

const innerHTMLUses = [...js.matchAll(/\.innerHTML\s*=/g)].length;
check('aucune affectation directe de .innerHTML', innerHTMLUses === 0,
    `${innerHTMLUses} affectation(s) trouvée(s)`);

const htmlProp = [...js.matchAll(/css:\s*`/g)].length;
check(`propriété css: utilisée pour du style constant (${htmlProp} usage(s))`, true);

/* 6. Ressources référencées --------------------------------------------- */
console.log('\nRESSOURCES');

for (const rel of uniq(all(/(?:href|src)="(\/[^"]+)"/g, html))) {
    const file = path.join(ROOT, 'public', rel);
    check(`${rel} existe`, fs.existsSync(file));
}

/* 7. PWA ----------------------------------------------------------------- */
console.log('\nPWA');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'manifest.json'), 'utf8'));
check('manifest : nom, start_url, display', !!(manifest.name && manifest.start_url && manifest.display));
check('manifest : icônes 192 et 512 présentes',
    [192, 512].every(s => manifest.icons.some(i => i.sizes === `${s}x${s}`)));
for (const icon of manifest.icons) {
    check(`icône ${icon.sizes} présente sur disque`,
        fs.existsSync(path.join(ROOT, 'public', icon.src)));
}
check('service worker enregistré depuis le JS', js.includes("serviceWorker"));
check('balise theme-color présente', /name="theme-color"/.test(html));
check('lien vers le manifest présent', /rel="manifest"/.test(html));

/* Première utilisation : le commerçant doit savoir comment se connecter ----- */
console.log('\nPREMIÈRE UTILISATION');
check('encadré de première connexion présent', /id="firstRunHint"/.test(html));
check('identifiants par défaut indiqués',
    /admin<\/b>/.test(html) && /admin123<\/b>/.test(html));
check('encadré masqué par défaut (affiché seulement si firstRun)',
    /id="firstRunHint"[^>]*\shidden/.test(html));
check('le JS interroge /health pour décider de l\'affichage',
    js.includes('checkFirstRun') && js.includes("api('/health')"));
check('aucun mot de passe pré-rempli dans le HTML livré',
    !/value="admin123"/.test(html) && !/value="admin"/.test(html));
check('un échec de connexion n\'est pas présenté comme « session expirée »',
    js.includes("!endpoint.startsWith('/login')"));

/* 8. Classes CSS utilisées par le JS ------------------------------------- */
console.log('\nSTYLES');

for (const cls of ['badge-success', 'badge-warning', 'badge-danger', 'badge-info',
                   'empty-row', 'alert-item', 'sale-item', 'toast', 'visible']) {
    check(`classe .${cls} définie`, css.includes(`.${cls}`));
}

/* Bilan ------------------------------------------------------------------ */
console.log(`\n${'─'.repeat(46)}`);
console.log(`RÉSULTAT : ${passed} réussis, ${failed} échoués`);
console.log('─'.repeat(46));
process.exit(failed === 0 ? 0 : 1);
