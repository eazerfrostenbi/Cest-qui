# C'est qui ?!

Un jeu entre potes, à jouer à distance, chacun sur son téléphone ou son ordinateur.

**Le principe** : un énoncé apparaît (« Ta première fois que… »), chacun écrit son anecdote en secret. Ensuite les anecdotes défilent une par une, sans nom, et tout le monde doit deviner qui l'a écrite.

**Les points** : +1 quand tu devines juste, +1 par personne que tu as trompée avec ta propre anecdote.

3 à 12 joueurs. Si quelqu'un coupe sa connexion (téléphone en veille, réseau qui saute), il retrouve sa place en rouvrant la page.

Chaque joueur crée un compte avec un pseudo et un mot de passe (8 caractères minimum). La photo de profil est facultative et modifiable depuis l'accueil. Les mots de passe sont hachés côté serveur ; les sessions expirent après 30 jours. Aucun email n'est demandé : il n'y a pas de récupération automatique en cas de mot de passe oublié.

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
- Les comptes et photos sont enregistrés dans `data/accounts.json`. Le disque d'un service Render gratuit n'est pas persistant : les comptes peuvent être perdus lors d'un redémarrage ou d'un déploiement. Pour les conserver, configure un disque persistant et la variable `ACCOUNTS_FILE` (par exemple `/var/data/accounts.json`).

**Dépannage rapide sans rien héberger** : un outil de tunnel comme `cloudflared` ou `ngrok` peut exposer ton `localhost:3000` temporairement, tant que ton ordinateur reste allumé avec le serveur lancé.

## 3. Personnaliser

- **Les questions et catégories** : en haut de `server.js`, dans `PROMPT_CATEGORIES`. Il y a 405 questions dans 27 thèmes, plus l'option « Tous les thèmes » qui les mélange. Les questions ne se répètent pas avant d'avoir parcouru le thème. L'hôte peut lancer jusqu'à 100 manches.
- **Joueurs min / max, manches et longueur des réponses** : constantes `MIN_PLAYERS`, `MAX_PLAYERS`, `MAX_ROUNDS` et la limite de réponse dans l'événement `submit` de `server.js`, ainsi que `MAX_CHARS` dans `public/app.js`.
- **Les couleurs** : variables en haut de `public/style.css`.

## Organisation des fichiers

```
server.js          serveur : salons, manches, scores (Express + Socket.io)
public/index.html  page unique
public/app.js      interface et logique côté navigateur
public/style.css   style, pensé pour mobile
```
