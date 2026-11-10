# Eazerfrost Games

Des jeux entre potes, à jouer à distance, chacun sur son téléphone ou son ordinateur. 3 à 12 joueurs. L'hôte crée un salon, partage le lien, puis choisit le jeu.

## Les jeux

**C'est qui ?!** — Un énoncé apparaît (« Ta première fois que… »), chacun écrit son anecdote en secret. Les anecdotes défilent une par une, sans nom, et tout le monde devine qui l'a écrite. +1 point si tu devines juste, +1 par personne que tu as trompée.

**L'imposteur** — Tout le monde reçoit le même mot, sauf un joueur qui reçoit un mot proche (par exemple « Plage » et « Piscine »). L'imposteur ne sait pas qu'il l'est. À tour de rôle (2 tours), chacun donne un indice d'un mot. Puis tout le monde vote pour démasquer celui qui a un mot différent. Si l'imposteur est démasqué (le plus voté, sans égalité), ceux qui ont voté pour lui gagnent 2 points. Sinon, l'imposteur gagne 3 points. Mieux à partir de 4 joueurs.

**Le Téléphone Dessiné** — Chacun écrit une phrase. Elle passe au voisin, qui la dessine. Le suivant voit seulement le dessin et écrit ce qu'il croit que c'est, le suivant dessine cette nouvelle phrase, et ainsi de suite jusqu'à ce que chaque carnet ait fait le tour. À la fin, chaque carnet se dévoile tout seul, page par page : la phrase de départ, puis chaque dessin et chaque devinette, et pour finir le « grand écart » entre la première et la dernière phrase. L'hôte peut mettre en pause, passer une page, et choisit quand ouvrir le carnet suivant. Pas de points, juste des fous rires. Chaque étape est chronométrée (45 s pour écrire, 90 s pour dessiner, 40 s pour deviner) : à zéro, ce qui est fait part automatiquement. Mieux à partir de 4 joueurs.

## 1. Lancer le jeu sur ton ordinateur

Il faut [Node.js](https://nodejs.org) version 18 ou plus.

```bash
npm install
npm start
```

Puis ouvre http://localhost:3000.

**Tester seul :** ouvre `http://localhost:3000/?test=1` dans 3 onglets. Avec `?test=1`, chaque onglet est un joueur différent (sans cette option, tous les onglets d'un même navigateur comptent pour un seul joueur). Les amis qui rejoignent par ton lien d'invitation n'ont pas besoin de ça.

## 2. Mise en ligne (Render, gratuit)

1. Envoie le contenu de ce dossier sur ton dépôt GitHub (`server.js`, `package.json`, `README.md`, et les dossiers `games` et `public`).
2. Sur [render.com](https://render.com), le service se met à jour tout seul à chaque changement du dépôt.
3. Réglages du service : **Build Command** `npm install`, **Start Command** `npm start`, **Instance type** Free.

Sur l'offre gratuite, le site s'endort après un moment sans visite : le premier chargement peut prendre environ une minute. Les salons sont gardés en mémoire : si le serveur redémarre, les parties en cours sont perdues.

## 3. Personnaliser

- **Les énoncés de C'est qui ?!** : `games/anecdotes-prompts.js`. Une ligne par énoncé, entre guillemets, avec une virgule à la fin.
- **Les paires de mots de L'imposteur** : `games/impostor-words.js`. Une ligne `["Mot A", "Mot B"],` par paire. Choisis des mots proches mais pas identiques.
- **Les phrases proposées du Téléphone Dessiné** (bouton « Une idée ») : `games/telephone-prompts.js`. Une ligne par phrase.
- **Les chronos du Téléphone Dessiné** : `WRITE_SECONDS`, `DRAW_SECONDS`, `GUESS_SECONDS` en haut de `games/telephone.js`.
- **Les réglages** : nombre de tours d'indices (`CLUE_ROUNDS`) et points (`POINTS_FOUND`, `POINTS_HIDDEN`) en haut de `games/impostor.js`. Nombre de joueurs min dans chaque jeu (`minPlayers`), max (`MAX_PLAYERS`) dans `server.js`.
- **Les couleurs** : variables en haut de `public/style.css`.

## 4. Ajouter un nouveau jeu

1. Crée `games/monjeu.js` sur le modèle de `games/impostor.js` : il exporte `id`, `name`, `emoji`, `tagline`, `minPlayers`, et les fonctions `start`, `view`, `act`, `progress`.
2. Ajoute-le dans la liste `GAMES` en haut de `server.js`.
3. Crée `public/games/monjeu.js` (l'interface) qui s'enregistre avec `EG.register('monjeu', { render, actions })`, et ajoute la balise `<script>` dans `public/index.html`.

Le salon, la reconnexion, les scores et le classement final sont déjà gérés pour tous les jeux.

## Organisation des fichiers

```
server.js                    salons, joueurs, reconnexion (commun à tous les jeux)
games/anecdotes.js           moteur de « C'est qui ?! »
games/anecdotes-prompts.js   liste des énoncés
games/impostor.js            moteur de « L'imposteur »
games/impostor-words.js      liste des paires de mots
games/telephone.js           moteur du « Téléphone Dessiné »
games/telephone-prompts.js   phrases proposées
games/util.js                petits outils partagés
public/index.html            page unique
public/app.js                accueil, salon, connexion (commun)
public/games/anecdotes.js    écrans de « C'est qui ?! »
public/games/impostor.js     écrans de « L'imposteur »
public/games/telephone.js    écrans du « Téléphone Dessiné » (zone de dessin comprise)
public/style.css             style, pensé pour mobile
```
