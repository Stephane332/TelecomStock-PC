# TelecomStock Pro — Guide d'installation

Logiciel conçu par **SAWADOGO Ange Stephane** — version 1.0.0.

Ce guide s'adresse au commerçant. Aucune connaissance technique n'est requise.

---

## 1. Installer le logiciel sur l'ordinateur de la caisse

1. Copiez le fichier **`TelecomStock-Pro-Installateur-1.0.0.exe`** sur l'ordinateur
   (clé USB, téléchargement, peu importe).
2. Double-cliquez dessus.
3. Windows peut afficher un avertissement bleu « Windows a protégé votre ordinateur ».
   C'est normal : le logiciel n'est pas signé par un certificat payant.
   Cliquez sur **Informations complémentaires**, puis sur **Exécuter quand même**.
4. Suivez l'installation (bouton Suivant). Un raccourci est créé sur le Bureau.
5. Lancez **TelecomStock Pro** depuis le Bureau.

**Première connexion**

Au tout premier démarrage, l'écran de connexion affiche lui-même les identifiants
à utiliser, dans un encadré bleu « Première utilisation » :

| Champ           | Valeur     |
|-----------------|------------|
| Utilisateur     | `admin`    |
| Mot de passe    | `admin123` |

Un bouton **« Remplir automatiquement »** saisit ces deux champs pour vous.

**Changer le mot de passe (à faire tout de suite)**

1. Une fois connecté, allez dans **Paramètres** (menu de gauche).
2. Section *Changer le mot de passe* : saisissez `admin123` comme mot de passe
   actuel, puis votre nouveau mot de passe deux fois (6 caractères minimum).
3. Cliquez sur **Changer le mot de passe**.

Le changement est immédiat et définitif : l'ancien mot de passe ne fonctionne
plus, y compris après extinction de l'ordinateur. L'encadré bleu disparaît
alors de l'écran de connexion — c'est le signe que votre caisse est protégée.

> **Notez votre nouveau mot de passe dans un endroit sûr.** En cas d'oubli,
> il n'existe aucun moyen de le retrouver sans intervention technique.

**Le logiciel démarre vide** : aucun produit, aucun client, aucune vente.
Commencez par saisir votre stock dans le menu **Produits**.

---

## 2. Version sans installation (clé USB)

Si vous ne voulez rien installer, utilisez **`TelecomStock-Pro-Portable-1.0.0.exe`**.

Double-cliquez : le logiciel démarre directement. Rien n'est installé sur le PC.

> Attention : vos données sont enregistrées dans le dossier de l'utilisateur Windows,
> **pas sur la clé USB**. Sur un autre ordinateur, vous repartirez d'une base vide.

---

## 3. Utiliser un téléphone Android dans la boutique

Le téléphone affiche le stock et enregistre les ventes ; **l'ordinateur de la caisse
reste la mémoire du magasin**. Le téléphone ne fonctionne donc que si le PC est allumé
et sur le même Wi-Fi.

### Étape 1 — Relever l'adresse du PC

Sur l'ordinateur, faites un clic droit sur l'icône TelecomStock (en bas à droite,
près de l'horloge) → **Adresse pour les téléphones…**

Une adresse s'affiche, du type :

```
http://192.168.1.12:3002
```

Notez-la.

### Étape 2 — Installer l'application sur le téléphone

1. Copiez **`TelecomStock-Pro-1.0.0.apk`** sur le téléphone.
2. Ouvrez le fichier. Android demandera l'autorisation d'installer des applications
   « de sources inconnues » : acceptez (c'est normal hors Play Store).
3. Ouvrez l'application.

### Étape 3 — Connecter le téléphone à la caisse

Au premier démarrage, l'application demande l'adresse du serveur.
Saisissez celle relevée à l'étape 1, puis validez.

**Le téléphone doit être sur le même Wi-Fi que l'ordinateur.**

---

## 4. Utiliser un téléphone sans installer l'application

Fonctionne sur Android **et iPhone**, sans installation.

1. Ouvrez le navigateur du téléphone (Chrome, Safari).
2. Tapez l'adresse relevée à l'étape 1 (ex. `http://192.168.1.12:3002`).
3. Pour ajouter une icône sur l'écran d'accueil :
   - **Android / Chrome** : menu ⋮ → *Ajouter à l'écran d'accueil*
   - **iPhone / Safari** : bouton Partager → *Sur l'écran d'accueil*

L'application s'ouvre ensuite comme une vraie application, en plein écran.

---

## 5. Problèmes fréquents

**Le téléphone affiche « Impossible de se connecter »**

1. Le PC de la caisse est-il allumé, avec TelecomStock ouvert ?
2. Le téléphone est-il sur le **même Wi-Fi** que le PC (pas en données mobiles) ?
3. L'adresse a-t-elle changé ? Le routeur peut attribuer une nouvelle adresse au PC.
   Relevez-la à nouveau (étape 1) et corrigez-la dans l'application.
4. Si rien n'y fait, le pare-feu Windows bloque peut-être. La version **installée**
   ouvre le port automatiquement ; avec la version **portable**, autorisez-la
   manuellement : Panneau de configuration → Pare-feu Windows →
   Autoriser une application → cochez **TelecomStock Pro** pour les réseaux **privés**.

**Windows bloque l'installation**

Cliquez sur *Informations complémentaires* → *Exécuter quand même*.

**J'ai oublié le mot de passe administrateur**

Contactez votre fournisseur : la réinitialisation demande une intervention
sur le fichier de données.

---

## 6. Sauvegarder vos données

Toutes vos données (stock, ventes, crédits) sont dans **un seul dossier** :

```
C:\Users\<VotreNom>\AppData\Roaming\TelecomStock Pro\data
```

Accès rapide : clic droit sur l'icône TelecomStock → **Dossier des données**.

**Sauvegardez ce dossier chaque semaine** sur une clé USB. En cas de panne de
l'ordinateur, il suffit de le recopier au même endroit pour tout retrouver.

> Fermez le logiciel avant de copier le dossier, sinon la copie peut être incomplète.

---

## 7. Ce qu'il faut retenir

| | |
|---|---|
| L'ordinateur de la caisse | **doit rester allumé** pour que les téléphones fonctionnent |
| Les données | sont **sur le PC**, pas sur les téléphones |
| Le Wi-Fi | doit être **le même** pour le PC et les téléphones |
| La sauvegarde | est **votre responsabilité** — copiez le dossier de données régulièrement |
| Le mot de passe | doit être **changé dès la première utilisation** |
