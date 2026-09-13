/**
 * Reproduit le scénario signalé : changement de mot de passe, déconnexion,
 * reconnexion. Puis vérifie la limite de tentatives de connexion.
 *
 * Usage : node tests/scenario-login.js [url]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:3002';

async function appel(methode, chemin, corps, jeton) {
    const entetes = { 'Content-Type': 'application/json' };
    if (jeton) entetes.Authorization = `Bearer ${jeton}`;
    const r = await fetch(BASE + '/api' + chemin, {
        method: methode, headers: entetes,
        body: corps === undefined ? undefined : JSON.stringify(corps)
    });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
}

(async () => {
    console.log(`\nSCÉNARIO SIGNALÉ — ${BASE}\n`);

    // 1. Connexion initiale
    let r = await appel('POST', '/login', { username: 'admin', password: 'admin123' });
    console.log(`1. connexion initiale         → ${r.status} ${r.data.token ? 'OK' : r.data.error}`);
    if (!r.data.token) { console.log('   (base déjà modifiée, test interrompu)'); process.exit(0); }
    let jeton = r.data.token;

    // 2. Changement du nom de la boutique
    r = await appel('PUT', '/settings', { store_name: 'Ma Boutique Telecom' }, jeton);
    console.log(`2. changement nom boutique    → ${r.status} ${r.data.message || r.data.error}`);

    // 3. Changement du mot de passe
    r = await appel('POST', '/auth/password',
        { current_password: 'admin123', new_password: 'MonNouveauMdp2026' }, jeton);
    console.log(`3. changement mot de passe    → ${r.status} ${r.data.message || r.data.error}`);

    // 4. Déconnexion (côté client : le jeton est simplement oublié)
    jeton = null;
    console.log('4. déconnexion               → jeton oublié');

    // 5. Reconnexion avec le NOUVEAU mot de passe
    r = await appel('POST', '/login', { username: 'admin', password: 'MonNouveauMdp2026' });
    console.log(`5. reconnexion nouveau mdp   → ${r.status} ${r.data.token ? 'OK' : r.data.error}`);
    const reconnexionOk = !!r.data.token;

    // 6. La limite de tentatives : combien de connexions avant blocage ?
    console.log('\n6. limite de tentatives de connexion :');
    let bloqueA = null;
    for (let i = 1; i <= 14; i++) {
        const t = await appel('POST', '/login',
            { username: 'admin', password: 'MonNouveauMdp2026' });
        if (t.status === 429) { bloqueA = i; break; }
    }
    if (bloqueA) {
        console.log(`   BLOQUÉ après ${bloqueA} tentatives supplémentaires`);
        const t = await appel('POST', '/login', { username: 'admin', password: 'MonNouveauMdp2026' });
        console.log(`   message affiché : "${t.data.error || t.data.message || '(aucun)'}"`);
        console.log('   → même avec le BON mot de passe, la connexion est refusée');
    } else {
        console.log('   aucune limite atteinte sur 14 tentatives');
    }

    // Remise en état
    const fin = await appel('POST', '/login', { username: 'admin', password: 'MonNouveauMdp2026' });
    if (fin.data.token) {
        await appel('POST', '/auth/password',
            { current_password: 'MonNouveauMdp2026', new_password: 'admin123' }, fin.data.token);
        console.log('\n(mot de passe remis à admin123)');
    }

    console.log(`\nCONCLUSION : reconnexion ${reconnexionOk ? 'fonctionne' : 'ÉCHOUE'}`
        + (bloqueA ? `, mais blocage après ${bloqueA} connexions` : ''));
})();
