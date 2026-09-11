# 📱 TelecomStock Pro v1.0

Logiciel de gestion de stock pour les télécoms vendant téléphones et accessoires numériques.

## 🚀 Démarrage rapide

### Option 1 : Double-cliquer sur `Lancer-TelecomStock.bat`
Le serveur démarre automatiquement et le navigateur s'ouvre sur http://localhost:3002

### Option 2 : Ligne de commande
```bash
cd C:\Users\winds\telecom-stock
npm install
node server.js
```

## 🔐 Identifiants par défaut
- **Utilisateur** : `admin`
- **Mot de passe** : `admin123`

## 📋 Fonctionnalités

| Module | Fonctionnalités |
|--------|-----------------|
| **📊 Dashboard** | KPIs temps réel, alertes stock bas, dernières ventes |
| **📦 Produits** | CRUD complet, suivi IMEI, catégories, alertes stock |
| **🏪 Stock** | Entrées/sorties, historique mouvements, ajustements |
| **💰 Ventes** | Nouvelle vente, historique, impression ticket, annulation |
| **👥 Clients** | Fiche client, historique achats, recherche |
| **🚚 Fournisseurs** | Liste, produits fournis, historique commandes |
| **📈 Rapports** | Bénéfices par produit, état du stock, ventes par période |
| **⚙️ Paramètres** | Infos magasin, devise, TVA, seuils d'alerte, backup |

## 🛠️ Stack technique
- **Backend** : Node.js + Express
- **Base de données** : SQLite (fichier local)
- **Frontend** : HTML/CSS/JS vanilla
- **Sécurité** : bcrypt, helmet, rate limiting

## 📁 Structure du projet
```
telecom-stock/
├── server.js          → Serveur Express + API
├── public/
│   └── index.html     → Interface utilisateur
├── db/
│   ├── setup.js       → Configuration base de données
│   └── telecom-stock.db → Données
├── Lance-TelecomStock.bat → Lanceur Windows
├── Installer.bat      → Installeur (copie + npm install)
└── package.json
```

## 🔄 Sauvegarde
- Export JSON via Paramètres → Exporter les données
- La base de données est dans `db/telecom-stock.db`

## 📝 Licence
© 2026 TelecomStock Pro — Tous droits réservés
