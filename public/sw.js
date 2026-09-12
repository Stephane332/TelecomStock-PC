/**
 * TelecomStock Pro — service worker.
 *
 * Stratégie :
 *   • coquille applicative (HTML/CSS/JS/icônes) → cache d'abord, rafraîchi en arrière-plan
 *   • appels /api/                              → réseau uniquement (jamais de données périmées
 *                                                  affichées comme si elles étaient à jour)
 *   • navigation hors ligne                     → page d'attente explicite
 */
const VERSION = 'v2.1.0';
const SHELL_CACHE = `telecomstock-shell-${VERSION}`;

const SHELL_ASSETS = [
    '/',
    '/index.html',
    '/css/styles.css',
    '/js/app.js',
    '/manifest.json',
    '/offline.html',
    '/assets/icon-192.png',
    '/assets/icon-512.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(SHELL_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== SHELL_CACHE).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // Les données métier ne sont jamais servies depuis le cache :
    // mieux vaut une erreur franche qu'un stock faux.
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(request).catch(() => new Response(
                JSON.stringify({ error: 'Hors ligne — connexion au serveur requise' }),
                { status: 503, headers: { 'Content-Type': 'application/json' } }
            ))
        );
        return;
    }

    // Navigation : réseau d'abord, page hors ligne en dernier recours.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(res => {
                    const copy = res.clone();
                    caches.open(SHELL_CACHE).then(c => c.put('/index.html', copy));
                    return res;
                })
                .catch(() => caches.match('/index.html')
                    .then(r => r || caches.match('/offline.html')))
        );
        return;
    }

    // Ressources statiques : cache immédiat + mise à jour silencieuse.
    event.respondWith(
        caches.match(request).then(cached => {
            const network = fetch(request).then(res => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(SHELL_CACHE).then(c => c.put(request, copy));
                }
                return res;
            }).catch(() => cached);
            return cached || network;
        })
    );
});
