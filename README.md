# TelecomStock Pro

Logiciel de gestion de stock, ventes et crédits pour boutiques télécoms.

**Conçu et développé par SAWADOGO Ange Stephane** — Burkina Faso.
Version 1.0.0.

**Essayer immédiatement, sans rien installer :**
https://stephane332.github.io/TelecomStock-PC/

Trois façons de l'utiliser, **une seule base de code et une seule base de données** :

| Version | Pour qui | Ce que c'est |
|---------|----------|--------------|
| **Application Windows** | Le poste de caisse | Un `.exe` autonome — aucune installation technique requise |
| **Application web (PWA)** | Tablette, second poste | S'ouvre dans le navigateur, installable sur l'écran d'accueil |
| **Application Android** | Le téléphone du gérant | `.apk` qui se connecte au poste de caisse via le Wi-Fi |

---

## 1. Application Windows

**Installation**

Lancez `TelecomStock-Pro-Installateur-1.0.0.exe`, puis suivez l'assistant.
Un raccourci est créé sur le Bureau et dans le menu Démarrer.

Une version **portable** (`TelecomStock-Pro-Portable-1.0.0.exe`) fonctionne
sans installation, depuis une clé USB par exemple.

**Ce qu'il faut savoir**

- Aucun logiciel supplémentaire à installer : tout est inclus dans l'exécutable.
- Les données sont enregistrées dans
  `C:\Users\<vous>\AppData\Roaming\TelecomStock Pro\data\`
  (accessible via l'icône près de l'horloge → « Dossier des données »).
- La croix de fermeture réduit l'application près de l'horloge ;
  pour quitter réellement : clic droit sur l'icône → **Quitter**.

**Identifiants au premier démarrage**

```
Utilisateur : admin
Mot de passe : admin123
```

> Changez ce mot de passe dès la première utilisation :
> **Paramètres → Sécurité**.

---

## 2. Application web (PWA)

Utile pour travailler depuis une tablette ou un second ordinateur.

**Démarrer le serveur**

```bash
npm install
npm start          # accessible depuis ce poste uniquement
HOST=0.0.0.0 npm start   # accessible depuis tout le réseau de la boutique
```

Avec `HOST=0.0.0.0`, le serveur affiche l'adresse à saisir sur les autres
appareils, par exemple :

```
TelecomStock API → http://0.0.0.0:3002
  Accessible depuis le réseau → http://192.168.1.10:3002
```

**Installer sur l'appareil**

Ouvrez cette adresse dans Chrome ou Edge, puis :
- Android : menu ⋮ → *Ajouter à l'écran d'accueil*
- Bureau : icône d'installation dans la barre d'adresse

L'application s'ouvre alors en plein écran, comme une application native.

> Hors connexion, l'interface reste disponible mais les données ne sont pas
> accessibles : c'est volontaire — mieux vaut un message clair qu'un stock faux.

---

## 3. Application Android

L'application affiche l'interface servie par le poste de caisse.
Le PC de la boutique doit donc être allumé, avec TelecomStock lancé en mode réseau.

**Installation**

1. Copiez `TelecomStock-Pro-1.0.0.apk` sur le téléphone.
2. Ouvrez le fichier et autorisez l'installation depuis cette source.
3. Au premier lancement, saisissez l'adresse du poste de caisse
   (celle affichée par le serveur, ex. `http://192.168.1.10:3002`).

L'adresse est mémorisée ; elle reste modifiable depuis l'écran d'erreur
si le réseau de la boutique change.

---

## Fonctionnalités

- **Tableau de bord** — stock, chiffre du jour, alertes, crédits en cours
- **Produits** — catalogue, catégories, seuils d'alerte, suivi IMEI
- **Stock** — entrées, sorties, ajustements, historique complet
- **Ventes** — panier, remise, plusieurs moyens de paiement, reçu imprimable
- **Annulation de vente** — le stock est automatiquement restitué
- **Clients** — fiches, historique d'achats, encours
- **Crédits** — suivi des créances, encaissements partiels
- **Fournisseurs** — carnet d'adresses et produits fournis
- **Rapports** — rentabilité par produit, marges
- **Sauvegarde** — export complet au format JSON

---

## Développement

```bash
npm install          # dépendances
npm test             # suite complète (72 vérifications)
npm start            # serveur seul
npm run electron     # application de bureau en développement

npm run build:exe    # génère l'installateur et la version portable
npm run build:apk    # génère l'APK Android
```

### Organisation

```
backend/      API REST et accès base (SQLite)
  database.js   schéma, migrations, données de démonstration
  server.js     routes, validation, transactions
  auth.js       jetons de session
public/       interface web (servie telle quelle, sans build)
electron/     enveloppe Windows — le serveur tourne dans le même processus
android/      projet Android natif (WebView)
tests/        tests d'intégration API et vérification HTML/JS
scripts/      génération des icônes, construction de l'APK
```

### Choix techniques

- **Une seule base, un seul serveur.** L'application Windows n'embarque pas de
  copie du code : elle charge le même `backend/` que la version web.
- **Serveur dans le processus Electron.** Aucun `node.exe` externe n'est lancé,
  donc rien à installer sur le poste client.
- **Écritures transactionnelles.** Une vente interrompue ne laisse jamais un
  stock décrémenté sans vente correspondante.
- **Rendu sans `innerHTML`.** L'interface construit ses éléments par le DOM :
  un nom de client contenant du HTML ne peut pas être interprété.
- **Politique de sécurité stricte (CSP).** Aucun script en ligne, aucun `eval`.

### Prérequis pour construire l'APK

- JDK 17 ou supérieur
- SDK Android (platform 34, build-tools 34+)
- `ANDROID_HOME` défini, ou Android Studio installé à l'emplacement par défaut

Le script crée automatiquement un keystore de signature au premier build.
Pour une publication sur le Play Store, utilisez votre propre keystore via
les variables `TS_KEYSTORE`, `TS_KEYSTORE_PASSWORD`, `TS_KEY_ALIAS`, `TS_KEY_PASSWORD`.

---

## Sauvegardes

Exportez régulièrement vos données : bouton 📤 dans l'en-tête, ou
**Paramètres → Sauvegarde**. Le fichier JSON contient l'intégralité du stock,
des ventes, des clients et des crédits.

La base elle-même est un fichier unique, copiable à chaud :

```
Windows  : %APPDATA%\TelecomStock Pro\data\telecom-stock.db
Serveur  : ./data/telecom-stock.db
```

---

© 2026 TelecomStock Pro — Ouagadougou, Burkina Faso
