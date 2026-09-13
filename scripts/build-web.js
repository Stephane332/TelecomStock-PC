#!/usr/bin/env node
/**
 * Prépare la version web (PWA) pour un hébergement statique.
 *
 * Pourquoi : un commerçant sans ordinateur ne peut pas atteindre le PWA s'il
 * n'est servi que par le poste de caisse. Publié sur GitHub Pages, il devient
 * accessible depuis n'importe quel téléphone, puis installable sur l'écran
 * d'accueil et utilisable hors connexion en mode autonome.
 *
 * Sortie : docs/ (dossier servi par GitHub Pages), copie fidèle de public/.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'public');
const CIBLE = path.join(ROOT, 'docs');

function copier(de, vers) {
    fs.mkdirSync(vers, { recursive: true });
    let n = 0;
    for (const entree of fs.readdirSync(de, { withFileTypes: true })) {
        const src = path.join(de, entree.name);
        const dst = path.join(vers, entree.name);
        if (entree.isDirectory()) n += copier(src, dst);
        else { fs.copyFileSync(src, dst); n++; }
    }
    return n;
}

fs.rmSync(CIBLE, { recursive: true, force: true });
const total = copier(SOURCE, CIBLE);

// Sans ce fichier, GitHub Pages ignore les dossiers commençant par « _ »
// et applique son moteur Jekyll, qui peut altérer les fichiers.
fs.writeFileSync(path.join(CIBLE, '.nojekyll'), '');

// Garde-fou : un chemin absolu casserait le site hébergé dans un sous-dossier.
const index = fs.readFileSync(path.join(CIBLE, 'index.html'), 'utf8');
const fautifs = [...index.matchAll(/(?:src|href)="\/[^"]*"/g)].map(m => m[0]);
if (fautifs.length) {
    console.error('Chemins absolus détectés (le site ne fonctionnerait pas) :');
    fautifs.forEach(f => console.error('  ' + f));
    process.exit(1);
}

console.log(`Version web prête : docs/ (${total} fichiers)`);
console.log('Publication : Settings → Pages → Source: main /docs');
