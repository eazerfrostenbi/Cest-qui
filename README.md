# C'est qui ?!

Un jeu entre potes, à jouer à distance, chacun sur son téléphone ou son ordinateur.

**Le principe** : un énoncé apparaît (« Ta première fois que… »), chacun écrit son anecdote en secret. Ensuite les anecdotes défilent une par une, sans nom, et tout le monde doit deviner qui l'a écrite.

**Les points** : +1 quand tu devines juste, +1 par personne que tu as trompée avec ta propre anecdote.

3 à 12 joueurs. Si quelqu'un coupe sa connexion (téléphone en veille, réseau qui saute), il retrouve sa place en rouvrant la page.

---

## 1. Lancer le jeu sur ton ordinateur

Il faut [Node.js](https://nodejs.org) version 18 ou plus.

```bash
npm install
npm start
```

Puis ouvre http://localhost:3000. Pour tester seul, ouvre 3 onglets (ou 3 fenêtres de navigation privée) : chaque onglet est un joueur.

## 2. Jouer avec tes potes (mise en ligne gratuite sur Render)

Tes amis ne peuvent pas atteindre `localhost` : il faut mettre le jeu sur Internet.

1. Crée un dépôt GitHub et envoie-y ce dossier (le fichier `.gitignore` évite d'envoyer `node_modules`).
2. Sur [render.com](https://render.com), clique sur **New → Web Service** et choisis ton dépôt.
3. Réglages :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance type** : Free
4. Valide. Au bout de quelques minutes tu obtiens une adresse du genre `https://cest-qui-xxxx.onrender.com`.
5. Ouvre l'adresse, crée un salon, puis clique sur **Inviter des potes** : le lien contient déjà le code du salon.

À savoir sur l'offre gratuite :
- Le site s'endort après un moment sans visite. Le premier chargement peut alors prendre une bonne minute : ouvre-le un peu avant de jouer.
- Les salons sont gardés en mémoire. Si le serveur redémarre, les parties en cours sont perdues (sans gravité pour un jeu de soirée).

**Dépannage rapide sans rien héberger** : un outil de tunnel comme `cloudflared` ou `ngrok` peut exposer ton `localhost:3000` temporairement, tant que ton ordinateur reste allumé avec le serveur lancé.

## 3. Personnaliser

- **Les énoncés** : en haut de `server.js`, la liste `PROMPTS`. Ajoute, modifie ou supprime des lignes librement.
- **Joueurs min / max, longueur des réponses** : constantes `MIN_PLAYERS`, `MAX_PLAYERS` dans `server.js`, et `MAX_CHARS` dans `public/app.js`. Pour la longueur côté serveur, la valeur `300` dans l'événement `submit`.
- **Les couleurs** : variables en haut de `public/style.css`.

## Organisation des fichiers

```
server.js          serveur : salons, manches, scores (Express + Socket.io)
public/index.html  page unique
public/app.js      interface et logique côté navigateur
public/style.css   style, pensé pour mobile
```
