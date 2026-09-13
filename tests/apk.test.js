#!/usr/bin/env node
/**
 * Audit de l'APK livré.
 *
 * Un APK peut être « construit avec succès » et rester inutilisable. On inspecte
 * donc l'artefact réel : signature, identité, permissions, et surtout présence
 * de l'interface embarquée qui permet le fonctionnement sans ordinateur.
 *
 * Usage : node tests/apk.test.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const APK = path.join(ROOT, 'dist', `TelecomStock-Pro-${VERSION}.apk`);

const SDK = process.env.ANDROID_HOME
    || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');

let reussis = 0, echoues = 0;

function verifie(nom, condition, detail = '') {
    if (condition) { console.log(`  ✓ ${nom}`); reussis++; }
    else { console.log(`  ✗ ${nom}${detail ? '\n      ' + detail : ''}`); echoues++; }
}

/** Localise un outil du SDK, quelle que soit la version de build-tools. */
function outil(nom) {
    const base = path.join(SDK, 'build-tools');
    if (!fs.existsSync(base)) return null;
    // Tri numérique décroissant : la build-tools la plus récente d'abord.
    const versions = fs.readdirSync(base).sort((a, b) =>
        b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) {
        for (const ext of ['.bat', '.exe', '']) {
            const p = path.join(base, v, nom + ext);
            if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
        }
    }
    return null;
}

console.log('\nAPK LIVRÉ');

if (!fs.existsSync(APK)) {
    console.log(`  ✗ APK introuvable : ${APK}`);
    process.exit(1);
}

const taille = fs.statSync(APK).size / 1048576;
verifie(`fichier présent (${taille.toFixed(1)} Mo)`, taille > 1);

/* ---------- signature ---------- */
const apksigner = outil('apksigner');
if (apksigner) {
    let sortie = '';
    try {
        // shell:true est requis sous Windows : apksigner est un .bat, que
        // execFileSync ne sait pas lancer directement.
        sortie = execFileSync(`"${apksigner}" verify --verbose "${APK}"`,
            { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { sortie = (e.stdout || '') + (e.stderr || ''); }
    verifie('signature valide', /Verifies/.test(sortie), sortie.slice(0, 200));
    verifie('signature moderne (schéma v2)', /v2 scheme[^:]*:\s*true/i.test(sortie));
} else {
    console.log('  — apksigner introuvable : signature non vérifiée');
}

/* ---------- identité et permissions ---------- */
const aapt = outil('aapt2');
if (aapt) {
    const badging = execFileSync(aapt, ['dump', 'badging', APK], { encoding: 'utf8' });
    verifie('identifiant correct', /name='bf\.avenix\.telecomstock'/.test(badging));
    verifie(`version ${VERSION}`, badging.includes(`versionName='${VERSION}'`));
    verifie('activité de lancement déclarée',
        /launchable-activity: name='bf\.avenix\.telecomstock\.MainActivity'/.test(badging));
    verifie('nom visible correct', /application-label:'TelecomStock Pro'/.test(badging));
    verifie('accès réseau demandé', /android\.permission\.INTERNET/.test(badging));
    verifie('état du réseau consultable',
        /android\.permission\.ACCESS_NETWORK_STATE/.test(badging));
    verifie('compatible Android 7 et plus récent', /minSdkVersion:'24'/.test(badging));

    const manifeste = execFileSync(aapt,
        ['dump', 'xmltree', '--file', 'AndroidManifest.xml', APK], { encoding: 'utf8' });
    verifie('trafic local en clair autorisé (caisse en HTTP)',
        /usesCleartextTraffic[^=]*=true/.test(manifeste));
    verifie('configuration réseau dédiée déclarée',
        /networkSecurityConfig/.test(manifeste));
} else {
    console.log('  — aapt2 introuvable : identité non vérifiée');
}

/* ---------- interface embarquée (mode autonome) ---------- */
const contenu = execFileSync('unzip', ['-l', APK], { encoding: 'utf8' });
const embarques = contenu.split('\n').filter(l => l.includes('assets/www/'));

verifie('interface embarquée présente', embarques.length > 0,
    'sans elle, l\'APK ne fonctionne pas sans ordinateur');

for (const attendu of ['assets/www/index.html', 'assets/www/js/app.js',
                       'assets/www/js/local-store.js', 'assets/www/css/styles.css',
                       'assets/www/manifest.json']) {
    verifie(`embarqué : ${attendu.replace('assets/www/', '')}`,
        embarques.some(l => l.includes(attendu)));
}

verifie('icônes de l\'application présentes',
    /res\/[^\s]*\.png/.test(contenu) || /mipmap/.test(contenu));
verifie('code compilé présent (classes.dex)', /classes\.dex/.test(contenu));

// Le service worker n'a aucun sens sur file:// : il ne doit pas être embarqué.
verifie('service worker exclu de l\'APK',
    !embarques.some(l => /assets\/www\/sw\.js/.test(l)));

/* ---------- cohérence avec les sources ---------- */
const activite = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main',
    'java', 'bf', 'avenix', 'telecomstock', 'MainActivity.java'), 'utf8');
verifie('charge l\'interface embarquée', /android_asset\/www\/index\.html/.test(activite));
verifie('propose le choix du mode au démarrage', /askMode\(\)/.test(activite));
verifie('force le mode autonome côté web', /telecomstock_mode','autonome'/.test(activite));
verifie('stockage local activé dans la WebView', /setDomStorageEnabled\(true\)/.test(activite));
verifie('accès aux fichiers embarqués autorisé', /setAllowFileAccess\(true\)/.test(activite));
verifie('pas d\'erreur réseau en mode autonome', /!isAutonome\(\)/.test(activite));
verifie('repli possible vers le mode autonome',
    /Travailler sans ordinateur|Utiliser sans ordinateur/.test(activite));

console.log(`\nRÉSULTAT : ${reussis} réussis, ${echoues} échoués`);
process.exit(echoues === 0 ? 0 : 1);
