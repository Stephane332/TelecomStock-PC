# Vérifier avant de livrer — 3 minutes

Tout se vérifie avec **une seule commande**, sans moi.

```bash
cd C:/Users/steph/TelecomStock-PC
npm run verify
```

Dernière ligne attendue :

```
VERDICT : prêt pour la livraison
```

Si cette ligne s'affiche avec `0 échecs`, le logiciel, le PWA et l'APK sont
cohérents et livrables. Toute autre réponse = **ne pas livrer**, la sortie
indique précisément ce qui a échoué.

---

## Ce que `npm run verify` contrôle (230 points)

| Suite | Points | Ce qu'elle prouve |
|---|---|---|
| `test:api` | 49 | Le serveur : ventes, stock, crédits, connexion, sauvegarde |
| `test:local` | 36 | Le mode autonome (téléphone sans ordinateur) |
| `test:front` | 35 | L'interface : aucun identifiant en clair, aucun script inline |
| `test:pwa` | 28 | Le PWA fonctionne **sans serveur** |
| `test:apk` | 28 | L'APK réel : signature, interface embarquée |
| `audit` | 54 | Versions, paternité, parité serveur/autonome, sécurité |

---

## Tester le parcours de connexion sur un vrai serveur

Lancez le logiciel, puis :

```bash
node tests/scenario-login.js http://127.0.0.1:3002
```

Rejoue exactement le scénario : changer le nom, changer le mot de passe, se
déconnecter, se reconnecter, puis 14 connexions d'affilée.

Attendu : `CONCLUSION : reconnexion fonctionne` sans mention de blocage.

## Tester le parcours complet du commerçant

```bash
node tests/e2e-live.js http://127.0.0.1:3002     # depuis la caisse
node tests/e2e-live.js http://192.168.X.X:3002   # depuis un téléphone
```

29 étapes : connexion, produit, vente, crédit, remboursement, rapport.
L'adresse du téléphone s'obtient par clic droit sur l'icône →
**Adresse pour les téléphones…**

---

## Reconstruire après une modification

```bash
npm run build:exe    # installateur + portable (~4 min)
npm run build:apk    # APK Android (~2 min)
npm run verify       # revérifier
```

**Important : l'APK et le PWA embarquent une copie de `public/`.** Après toute
modification de l'interface, il faut reconstruire l'APK et relancer
`node scripts/build-web.js`, sinon seul le logiciel Windows est à jour.

> Le disque C: est presque plein. Il faut ~3 Go libres pour un build.
> En cas d'échec : `rm -rf dist` puis relancer.

---

## Publier une mise à jour

```bash
git add -A
git commit -m "description"
git push origin main

gh release upload v1.0.0 dist/TelecomStock-Pro-Installateur-1.0.0.exe \
  dist/TelecomStock-Pro-Portable-1.0.0.exe dist/TelecomStock-Pro-1.0.0.apk \
  --repo Stephane332/TelecomStock-PC --clobber
```

Le `--repo` est obligatoire : sans lui, `gh` cible le dépôt d'origine et échoue
avec une erreur 404. Le PWA se met à jour seul via `git push` (GitHub Pages,
1 à 2 minutes).

---

## Si le commerçant est bloqué dehors

Clic droit sur l'icône TelecomStock → **Mot de passe oublié…**

Remet `admin` / `admin123`. **Les données ne sont pas touchées.** Impossible
depuis un téléphone : uniquement sur l'ordinateur de la caisse.
