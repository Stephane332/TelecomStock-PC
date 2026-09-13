#!/usr/bin/env node
/**
 * Vérifie le PWA tel qu'il est réellement publié (docs/), servi en statique.
 *
 * Un commerçant sans ordinateur ouvre cette version dans son navigateur : elle
 * doit se charger entièrement, sans backend, et basculer en mode autonome.
 * On sert docs/ sur un port local et on contrôle chaque ressource.
 *
 * Usage : node tests/pwa.test.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
const PORT = 3095;
const TYPES = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png'
};

let reussis = 0, echoues = 0;

function verifie(nom, condition, detail = '') {
    if (condition) { console.log(`  ✓ ${nom}`); reussis++; }
    else { console.log(`  ✗ ${nom}${detail ? '\n      ' + detail : ''}`); echoues++; }
}

const serveur = http.createServer((q, r) => {
    let f = q.url.split('?')[0];
    if (f === '/') f = '/index.html';
    const p = path.join(DOCS, f);
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        r.writeHead(404); return r.end('404');
    }
    r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(r);
});

async function code(chemin) {
    const r = await fetch(`http://127.0.0.1:${PORT}${chemin}`);
    return r.status;
}
async function texte(chemin) {
    const r = await fetch(`http://127.0.0.1:${PORT}${chemin}`);
    return r.text();
}

serveur.listen(PORT, async () => {
    console.log('\nPWA PUBLIÉ (docs/) — servi sans backend');

    // Toutes les ressources nécessaires au premier chargement.
    for (const f of ['/', '/index.html', '/css/styles.css', '/js/app.js',
                     '/js/local-store.js', '/manifest.json', '/sw.js',
                     '/offline.html', '/assets/icon-192.png', '/assets/icon-512.png']) {
        verifie(`ressource servie : ${f}`, await code(f) === 200);
    }

    // Aucune API : c'est la situation réelle d'un commerçant sans ordinateur.
    verifie('aucune API disponible (mode autonome obligatoire)',
        await code('/api/health') === 404);

    const html = await texte('/index.html');
    verifie('le moteur autonome est chargé avant l\'application',
        html.indexOf('local-store.js') < html.indexOf('js/app.js'));
    verifie('aucun chemin absolu (hébergement en sous-dossier)',
        !/(?:src|href)="\//.test(html));
    verifie('choix du mode présent', html.includes('id="modeChoice"'));
    verifie('aide de première connexion présente', html.includes('id="firstRunHint"'));
    verifie('aucun mot de passe pré-rempli', !html.includes('value="admin123"'));
    verifie('paternité affichée', html.includes('SAWADOGO Ange Stephane'));
    verifie('version 1.0.0 affichée', html.includes('Pro v1.0.0'));

    const manifest = JSON.parse(await texte('/manifest.json'));
    verifie('manifest : installable en plein écran', manifest.display === 'standalone');
    verifie('manifest : portée relative', manifest.start_url === './' && manifest.scope === './');
    verifie('manifest : icônes déclarées et servies', manifest.icons.length >= 2);
    verifie('manifest : nom lisible', /TelecomStock/.test(manifest.name));

    const sw = await texte('/sw.js');
    verifie('service worker : met en cache le moteur autonome',
        sw.includes('local-store.js'));
    verifie('service worker : chemins relatifs', !/'\/[a-z]/.test(sw.split('SHELL_ASSETS')[1] || ''));

    const local = await texte('/js/local-store.js');
    verifie('moteur autonome : complet', local.length > 15000);
    verifie('moteur autonome : expose son point d\'entrée',
        local.includes('TelecomStockLocal'));

    const app = await texte('/js/app.js');
    verifie('application : bascule en autonome sans serveur',
        app.includes('TelecomStockLocal.activer'));
    verifie('application : mêmes fichiers que la source',
        app === fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8'));

    console.log(`\nRÉSULTAT : ${reussis} réussis, ${echoues} échoués`);
    serveur.close();
    process.exit(echoues === 0 ? 0 : 1);
});
