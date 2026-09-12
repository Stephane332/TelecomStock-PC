#!/usr/bin/env node
/**
 * Aligne le binaire natif de better-sqlite3 sur le moteur voulu.
 *
 * Contexte : `npm run build:exe` recompile better-sqlite3 pour l'ABI d'Electron,
 * ce qui rend ensuite `npm start` et les tests inutilisables sous Node — et
 * inversement. Ce script rétablit la bonne variante à la demande, et ne fait
 * rien si elle est déjà en place (donc sans coût quand ce n'est pas nécessaire).
 *
 * Usage : node scripts/rebuild-native.js [node|electron]
 */
const { spawnSync } = require('child_process');
const path = require('path');

const target = (process.argv[2] || 'node').toLowerCase();
if (!['node', 'electron'].includes(target)) {
    console.error("Cible invalide. Utilisez 'node' ou 'electron'.");
    process.exit(1);
}

const ROOT = path.join(__dirname, '..');

/**
 * Le module natif se charge-t-il sous le Node courant ?
 * On sollicite le chemin réel (ouverture d'une base en mémoire), pas un simple
 * require : c'est le chargement du .node qui révèle une incompatibilité d'ABI.
 */
function loadsUnderNode() {
    const probe = spawnSync(
        process.execPath,
        ['-e', "const D=require('better-sqlite3'); new D(':memory:').close();"],
        { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }
    );
    return probe.status === 0;
}

const ok = loadsUnderNode();

if (target === 'node') {
    if (ok) process.exit(0); // déjà correct, rien à faire
    console.log('Recompilation de better-sqlite3 pour Node.js…');
    const r = spawnSync('npm', ['rebuild', 'better-sqlite3'], {
        cwd: ROOT, stdio: 'inherit', shell: true
    });
    process.exit(r.status === 0 ? 0 : 1);
}

// target === 'electron'
if (!ok) process.exit(0); // déjà compilé pour Electron
console.log('Recompilation de better-sqlite3 pour Electron…');
const r = spawnSync('npx', ['electron-builder', 'install-app-deps'], {
    cwd: ROOT, stdio: 'inherit', shell: true
});
process.exit(r.status === 0 ? 0 : 1);
