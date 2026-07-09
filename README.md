# SwapPoint — Pointage géolocalisé des agents de swap station

Application web (sans backend à coder) permettant à des agents de terrain de
marquer leur présence (entrée/sortie) sur une swap station, validée
automatiquement par géolocalisation. Les données sont stockées dans un projet
Firebase que vous contrôlez, et l'application se déploie gratuitement sur
GitHub Pages.

## Contenu du dépôt

```
index.html          → interface (structure + design)
app.js               → logique de l'application (recherche, pointage, admin)
firebase-config.js   → à personnaliser avec les identifiants de VOTRE projet Firebase
firestore.rules      → règles de sécurité à copier dans la console Firebase
README.md            → ce document
```

Aucune installation, aucun `npm install`, aucune étape de build : ce sont des
fichiers statiques, ils fonctionnent tels quels une fois hébergés.

## 1. Créer le projet Firebase

1. Allez sur [console.firebase.google.com](https://console.firebase.google.com) et cliquez sur **Ajouter un projet**. Donnez-lui un nom (ex. `swappoint`), suivez l'assistant (Google Analytics est optionnel, vous pouvez le désactiver).
2. Une fois le projet créé, dans le menu de gauche : **Build > Firestore Database** → **Créer une base de données** → choisissez une région proche de vos utilisateurs → démarrez en **mode production**.
3. Toujours dans le menu de gauche : **Build > Authentication** → **Commencer** → activez le fournisseur **E-mail/Mot de passe**.
4. Activez aussi le fournisseur **Anonyme** dans le même écran (Authentication > Sign-in method > Anonyme). C'est ce qui permet aux agents de pointer sans créer de compte.

## 2. Créer votre (vos) compte(s) administrateur

1. Dans **Authentication > Users**, cliquez sur **Ajouter un utilisateur**, saisissez un e-mail et un mot de passe : c'est le compte que vous utiliserez pour ouvrir les onglets Historique et Administration.
2. Copiez l'**UID** affiché pour cet utilisateur (une longue chaîne de caractères).
3. Allez dans **Firestore Database > Données** → **Démarrer une collection** → nom de la collection : `admins`.
4. Comme ID de document, collez l'UID copié à l'étape 2. Ajoutez un champ quelconque, par exemple `role` (string) = `admin`, puis enregistrez.
5. Répétez les étapes 1 à 4 pour chaque personne qui doit avoir un accès administrateur (ex. les superviseurs).

## 3. Copier les règles de sécurité

1. Dans **Firestore Database > Règles**, remplacez le contenu par celui du fichier [`firestore.rules`](./firestore.rules) fourni dans ce dépôt.
2. Cliquez sur **Publier**.

Ces règles garantissent que :
- n'importe qui ouvrant l'application peut chercher un agent et pointer (lecture des agents/stations, création de pointages),
- seuls les comptes admin peuvent modifier la liste des agents/stations, consulter l'historique complet, ou le vider,
- un pointage, une fois créé, ne peut jamais être modifié (seulement supprimé par un admin) — cela garantit l'intégrité du registre.

## 4. Récupérer la configuration Web et l'ajouter au projet

1. Dans **Paramètres du projet** (icône ⚙️ en haut à gauche) > onglet **Général**, descendez jusqu'à **Vos applications** → cliquez sur l'icône Web `</>`.
2. Donnez un surnom à l'application (ex. `swappoint-web`), pas besoin de cocher Firebase Hosting. Cliquez sur **Enregistrer l'application**.
3. Firebase affiche un objet `firebaseConfig`. Copiez-le.
4. Ouvrez le fichier `firebase-config.js` de ce dépôt et remplacez les valeurs par celles copiées.

> Cet objet (apiKey, projectId…) n'est pas un secret : il est conçu pour être visible dans le code d'un site public. La sécurité vient des règles Firestore de l'étape 3, pas du fait de le cacher.

## 5. Déployer sur GitHub Pages

1. Créez un dépôt GitHub (public ou privé) et poussez-y les fichiers de ce dossier (`index.html`, `app.js`, `firebase-config.js` avec vos identifiants, `firestore.rules`).
2. Dans le dépôt GitHub : **Settings > Pages**.
3. Sous **Build and deployment**, choisissez **Deploy from a branch**, branche `main`, dossier `/ (root)`. Enregistrez.
4. GitHub Pages fournit une URL du type `https://votre-compte.github.io/votre-depot/`. Elle est active après une à deux minutes.

## 6. Autoriser votre domaine dans Firebase Authentication

Étape importante, sans elle la connexion administrateur échouera depuis GitHub Pages :

1. Dans la console Firebase : **Authentication > Settings > Authorized domains**.
2. Cliquez sur **Ajouter un domaine** et entrez `votre-compte.github.io` (sans `https://`, sans le chemin du dépôt).

## 7. Importer vos données et tester

1. Ouvrez l'URL GitHub Pages sur votre téléphone ou ordinateur.
2. Onglet **Administration** → connectez-vous avec le compte admin créé à l'étape 2.
3. Collez votre liste d'agents (`Nom;Prénom;Code ID;Superviseur`) et vos stations (`Nom;Latitude;Longitude`), ou utilisez le bouton **Utiliser ma position** en étant physiquement sur une station pour capturer ses coordonnées exactes.
4. Retournez sur l'onglet **Pointage**, recherchez un agent, autorisez la géolocalisation dans le navigateur, et testez un pointage.
5. Onglet **Historique** (connexion admin requise) pour vérifier l'enregistrement et essayer les deux exports CSV.

## Fonctionnement hors connexion

L'application utilise le cache local persistant de Firestore : si un agent
pointe sans réseau (fréquent sur certains sites isolés), le pointage est
conservé sur l'appareil et se synchronise automatiquement dès que la
connexion revient. La liste des agents/stations déjà chargée reste
disponible hors ligne.

## Précision de la géolocalisation

La précision GPS d'un smartphone en extérieur est généralement de ±5 à ±20 m.
Avec un rayon de validation à 10 m, des agents réellement présents peuvent
occasionnellement essuyer un échec dû au capteur plutôt qu'à une absence.
L'application affiche la précision GPS mesurée à chaque pointage pour vous
aider à faire la différence ; vous pouvez ajuster le rayon dans l'onglet
Administration (ex. 15-20 m) si les échecs "faux négatifs" sont fréquents.

## Coûts

Firebase Firestore et Authentication ont un palier gratuit (Spark) largement
suffisant pour un nombre limité d'agents et de pointages quotidiens. Si le
volume grandit fortement, consultez la page de tarification Firebase pour
estimer les coûts au-delà du palier gratuit.

## Étendre la sécurité (optionnel)

Le modèle actuel (compte admin = document dans `admins`) convient à une
petite équipe. Pour une organisation plus grande, on peut remplacer cela par
des **custom claims** gérés via une Cloud Function, ce qui nécessite le plan
Firebase Blaze (facturation à l'usage) et la Firebase CLI — une étape
supplémentaire volontairement laissée hors de cette version pour rester
déployable sans aucune commande ni carte bancaire.
