const express = require('express');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { promisify } = require('util');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const scrypt = promisify(crypto.scrypt);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

const ACCOUNTS_FILE = process.env.ACCOUNTS_FILE || path.join(__dirname, 'data', 'accounts.json');
const AVATAR_MAX_LENGTH = 250000;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_FAILURES = 10;
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DUMMY_SALT = 'cest-qui-invalid-account-salt';
const DUMMY_PASSWORD_HASH = crypto.scryptSync('invalid-password', DUMMY_SALT, 64);
const authFailures = new Map();

function loadAccounts() {
  try {
    const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    if (!Array.isArray(accounts)) throw new Error('Le fichier des comptes doit contenir une liste.');
    return accounts;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

let accounts = loadAccounts();

function saveAccounts() {
  fs.mkdirSync(path.dirname(ACCOUNTS_FILE), { recursive: true });
  const temporaryFile = `${ACCOUNTS_FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(accounts), { mode: 0o600 });
    fs.renameSync(temporaryFile, ACCOUNTS_FILE);
  } catch (error) {
    fs.rmSync(temporaryFile, { force: true });
    throw error;
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function accountFor(socket) {
  return accounts.find((account) => account.id === socket.data.accountId) || null;
}

function cleanAvatar(value) {
  if (value === null || value === undefined || value === '') return '';
  const avatar = String(value);
  if (
    avatar.length > AVATAR_MAX_LENGTH ||
    !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar)
  ) {
    return null;
  }
  return avatar;
}

function authBlocked(socket) {
  const now = Date.now();
  const ip = socket.handshake.address;
  const attempts = (authFailures.get(ip) || []).filter((time) => now - time < AUTH_WINDOW_MS);
  authFailures.set(ip, attempts);
  return attempts.length >= AUTH_MAX_FAILURES;
}

function recordAuthFailure(socket) {
  const ip = socket.handshake.address;
  const attempts = authFailures.get(ip) || [];
  attempts.push(Date.now());
  authFailures.set(ip, attempts);
}

function issueSession(account) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  account.sessions = (account.sessions || []).filter(
    (session) => now - session.createdAt < SESSION_MAX_AGE_MS
  );
  account.sessions.push({ tokenHash: hashToken(token), createdAt: now });
  account.sessions = account.sessions.slice(-10);
  return token;
}

function publicAccount(account) {
  return { id: account.id, name: account.name, avatar: account.avatar || '' };
}

async function passwordHash(password, salt) {
  return scrypt(password, salt, 64);
}

// ---------------------------------------------------------------------------
// Questions classées par thème : ajoute ou modifie les tiennes ici.
// ---------------------------------------------------------------------------
const PROMPT_CATEGORIES = {
  all: { name: 'Tous les thèmes', prompts: [] },
  parties: {
    name: 'Soirées & fêtes',
    prompts: [
      'Ta première fois en soirée :',
      'La soirée qui ne s\'est pas du tout passée comme prévu :',
      'La pire excuse que tu as inventée pour partir d\'une soirée :',
      'Le morceau sur lequel tu te mets toujours à danser :',
      'Le truc le plus drôle que tu aies fait après minuit :',
      'La personne improbable que tu as rencontrée en soirée :',
      'Ton meilleur souvenir de fête :',
      'Le moment où tu as perdu tes amis en soirée :',
      'La fois où tu as confondu deux personnes pendant une fête :',
      'Le déguisement le plus raté que tu aies porté :',
      'La chose la plus inattendue que tu aies trouvée dans ton sac en rentrant :',
      'La chanson que tu connais par cœur sans vouloir l\'avouer :',
      'La fois où tu as lancé une soirée alors que tu ne connaissais presque personne :',
      'La pire playlist que tu aies entendue à une fête :',
      'Ton talent inutile qui ressort en soirée :',
    ],
  },
  love: {
    name: 'Amour & crushs',
    prompts: [
      'Ta première fois que tu as eu un coup de cœur :',
      'La chose la plus gênante que tu aies faite devant un crush :',
      'Le message que tu regrettes le plus d\'avoir envoyé :',
      'La pire technique de drague qu\'on ait essayée sur toi :',
      'La fois où tu as envoyé un message à la mauvaise personne :',
      'Le crush le plus inattendu que tu aies eu :',
      'La plus belle déclaration que tu aies reçue ou faite :',
      'La fois où tu as fait semblant de ne pas voir quelqu\'un qui te plaisait :',
      'Le rendez-vous qui ne s\'est pas passé comme prévu :',
      'La chanson qui te rappelle quelqu\'un :',
      'La pire excuse que tu aies trouvée pour revoir quelqu\'un :',
      'La fois où tu as compris trop tard que quelqu\'un te draguait :',
      'Le détail qui te fait craquer chez quelqu\'un :',
      'La rencontre la plus improbable que tu aies faite :',
      'La fois où tu as changé de tenue plusieurs fois avant un rendez-vous :',
    ],
  },
  friends: {
    name: 'Amitié',
    prompts: [
      'La première impression complètement fausse que tu as eue sur un ami :',
      'Le meilleur fou rire que tu aies partagé avec tes amis :',
      'La fois où un ami t\'a sorti d\'une situation compliquée :',
      'La chose la plus folle que tu aies faite sur un pari entre amis :',
      'Le surnom le plus drôle qu\'on t\'ait donné :',
      'La pire blague qu\'un ami t\'ait faite :',
      'La fois où tu as gardé un secret important pour un ami :',
      'Le voyage ou la sortie dont tu reparles encore avec tes amis :',
      'La fois où tu as oublié un anniversaire important :',
      'Le cadeau le plus inattendu que tu aies reçu d\'un ami :',
      'La dispute la plus bête que tu aies eue avec un ami :',
      'La fois où tu as aidé quelqu\'un sans lui dire que c\'était toi :',
      'Le défi le plus absurde que tu aies relevé avec des amis :',
      'La personne que tu appelles en premier quand tu as une bonne nouvelle :',
      'Le meilleur conseil qu\'un ami t\'ait donné :',
    ],
  },
  school: {
    name: 'École & boulot',
    prompts: [
      'Ta première fois que tu as séché les cours :',
      'La fois où tu as fait semblant de comprendre :',
      'La pire note que tu aies reçue alors que tu pensais avoir réussi :',
      'La fois où tu as oublié un devoir ou une réunion importante :',
      'Le prétexte le plus improbable que tu aies donné pour un retard :',
      'La chose la plus drôle qui soit arrivée pendant un cours ou une réunion :',
      'La fois où tu as triché à un jeu ou à un contrôle :',
      'Le projet de groupe où tu as tout fini à la dernière minute :',
      'La fois où tu as appelé un prof ou un collègue par le mauvais prénom :',
      'Le fou rire que tu as eu au pire moment en classe ou au travail :',
      'La matière ou la tâche que tu as mis le plus longtemps à apprécier :',
      'La fois où tu as rendu un travail dont tu étais particulièrement fier(e) :',
      'Le truc que tu as appris en cours et que tu utilises vraiment :',
      'La fois où tu as oublié que ton micro était allumé :',
      'La pire présentation que tu aies faite devant un groupe :',
    ],
  },
  embarrassing: {
    name: 'Hontes & galères',
    prompts: [
      'Ta première fois que tu as eu la honte de ta vie :',
      'La fois où tu t\'es planté(e) en public :',
      'La fois où tu as trébuché sans qu\'il y ait quoi que ce soit par terre :',
      'La fois où tu as salué quelqu\'un qui ne te saluait pas :',
      'La chose la plus drôle que tu aies dite en croyant être sérieux(se) :',
      'La fois où tu as ri alors qu\'il ne fallait vraiment pas :',
      'Le moment où tu as raconté une histoire et oublié la fin :',
      'La fois où tu as pris la porte pour une sortie qui n\'en était pas une :',
      'La pire faute de frappe que tu aies envoyée dans un message :',
      'La fois où tu as renversé quelque chose au pire moment :',
      'La fois où tu as appelé quelqu\'un par le mauvais prénom :',
      'La situation dans laquelle tu as voulu disparaître sur place :',
      'La fois où tu as fait un signe à quelqu\'un qui ne te regardait pas :',
      'La chose la plus bizarre que tu aies faite par nervosité :',
      'La fois où tu as découvert après coup que tu avais un détail de tenue de travers :',
    ],
  },
  everyday: {
    name: 'Vie quotidienne',
    prompts: [
      'Un truc bizarre que tu fais quand tu es seul(e) :',
      'Le truc le plus débile que tu aies acheté :',
      'La fois où tu as menti à tes parents :',
      'La chose que tu perds tout le temps :',
      'La fois où tu as oublié pourquoi tu étais entré(e) dans une pièce :',
      'Le plat le plus étrange que tu aies essayé de cuisiner :',
      'La fois où tu as cassé quelque chose et essayé de le cacher :',
      'La tâche ménagère que tu repousses toujours :',
      'La recherche Internet la plus bizarre que tu aies faite :',
      'La fois où tu as passé beaucoup trop de temps à choisir quoi regarder :',
      'La chose que tu collectionnes ou gardes sans raison :',
      'La pire excuse que tu aies donnée pour ne pas répondre à un message :',
      'La fois où tu as oublié quelque chose d\'important en sortant :',
      'Le petit plaisir que tu assumes complètement :',
      'La chose que tu fais toujours au dernier moment :',
    ],
  },
  adventures: {
    name: 'Aventures & voyages',
    prompts: [
      'La fois où tu t\'es perdu(e) dans un endroit que tu connaissais :',
      'Le voyage qui t\'a le plus surpris(e) :',
      'La fois où tu as pris le mauvais bus, train ou métro :',
      'La rencontre la plus mémorable faite en voyage :',
      'La chose que tu as oubliée en partant en vacances :',
      'La fois où tu as dû improviser un plan de dernière minute :',
      'Le lieu où tu aimerais retourner juste pour une journée :',
      'La découverte culinaire la plus étonnante que tu aies faite :',
      'La fois où tu as osé faire quelque chose qui te faisait peur :',
      'Le détour qui a finalement rendu une sortie encore meilleure :',
      'La chose la plus inattendue que tu aies vue en te promenant :',
      'La fois où la météo a complètement changé tes plans :',
      'Le meilleur souvenir d\'une sortie improvisée :',
      'La fois où tu as dû demander ton chemin à un inconnu :',
      'L\'objet que tu emportes toujours en voyage, même s\'il ne sert jamais :',
    ],
  },
  confessions: {
    name: 'Secrets & confessions',
    prompts: [
      'Ton plus gros mensonge :',
      'La fois où tu as été pris(e) en flagrant délit :',
      'La chose dont tu es encore fier(e) aujourd\'hui :',
      'La fois où tu as gardé ton calme alors que tu paniquais :',
      'La peur un peu irrationnelle que tu as depuis longtemps :',
      'La chose que tu as longtemps fait semblant d\'aimer :',
      'La fois où tu as changé d\'avis après avoir défendu une idée avec conviction :',
      'Le talent caché que peu de gens connaissent chez toi :',
      'La petite règle que tu t\'es inventée et que tu suis toujours :',
      'La chose que tu aimerais apprendre si tu avais tout ton temps :',
      'La fois où tu as été surpris(e) par ta propre réaction :',
      'Le compliment que tu n\'as jamais oublié :',
      'La chose que tu pensais impossible et que tu as finalement faite :',
      'La fois où tu as avoué quelque chose après l\'avoir gardé pour toi :',
      'Le détail sur toi que les gens devinent rarement :',
    ],
  },
  family: {
    name: 'Famille',
    prompts: [
      'La tradition familiale la plus étrange chez toi :',
      'La phrase que quelqu’un de ta famille répète tout le temps :',
      'Le repas de famille dont tu te souviens encore :',
      'La bêtise que tu as faite enfant et que ta famille raconte toujours :',
      'Le talent inattendu d’un membre de ta famille :',
      'La fois où ta famille t’a surpris(e) en plein milieu de quelque chose :',
      'Le surnom que ta famille te donnait quand tu étais petit(e) :',
      'La recette que tu voudrais absolument apprendre dans ta famille :',
      'La sortie en famille qui a tourné à l’aventure :',
      'La chose la plus drôle que tu aies entendue à un repas de famille :',
      'La fois où tu as confondu une histoire familiale avec la réalité :',
      'Le meilleur conseil reçu d’un membre de ta famille :',
      'La personne de ta famille qui te fait rire à tous les coups :',
      'Le cadeau familial le plus surprenant que tu aies reçu :',
      'La chose que tu fais exactement comme quelqu’un de ta famille :',
    ],
  },
  food: {
    name: 'Cuisine & nourriture',
    prompts: [
      'Le mélange alimentaire bizarre que tu aimes vraiment :',
      'La chose que tu as goûtée en pensant ne jamais aimer ça :',
      'Ton plus gros raté en cuisine :',
      'Le plat que tu pourrais manger plusieurs jours de suite :',
      'La nourriture que tu refuses de partager :',
      'La fois où tu as commandé le plat le plus épicé sans réfléchir :',
      'Le dessert que tu réussis le mieux :',
      'La chose la plus étonnante que tu aies mangée en voyage :',
      'Le plat que tu as essayé de refaire après l’avoir vu en vidéo :',
      'La fois où tu as brûlé ou oublié quelque chose dans le four :',
      'Le goût que tu détestais et que tu apprécies maintenant :',
      'La nourriture que tu caches pour ne pas avoir à la partager :',
      'Le repas improvisé qui s’est révélé délicieux :',
      'La boisson que tu choisis toujours au restaurant :',
      'La plus grosse quantité de nourriture que tu aies mangée en une fois :',
    ],
  },
  music: {
    name: 'Musique',
    prompts: [
      'La chanson que tu écoutes en boucle en ce moment :',
      'Le concert qui t’a le plus marqué(e) :',
      'La chanson que tu connais par cœur depuis l’enfance :',
      'L’artiste que tu as découvert grâce à quelqu’un d’autre :',
      'La chanson qui te donne instantanément la pêche :',
      'La fois où tu as chanté beaucoup trop fort sans t’en rendre compte :',
      'Le morceau que tu n’assumes pas mais que tu adores :',
      'La musique que tu mets pour te concentrer :',
      'Le premier concert ou spectacle musical auquel tu as assisté :',
      'La chanson que tu choisirais pour le générique de ta vie :',
      'Le style musical que tu as appris à aimer avec le temps :',
      'La fois où tu as inventé de fausses paroles en chantant :',
      'L’instrument que tu aimerais savoir jouer :',
      'La chanson qui te rappelle immédiatement un endroit :',
      'La musique que tu écoutes quand tu veux être seul(e) :',
    ],
  },
  cinema: {
    name: 'Films & séries',
    prompts: [
      'Le film que tu as déjà regardé beaucoup trop de fois :',
      'La série que tu as terminée beaucoup trop vite :',
      'Le personnage de fiction auquel tu ressembles le plus :',
      'Le film qui t’a fait pleurer alors que tu ne t’y attendais pas :',
      'La scène de film que tu peux réciter par cœur :',
      'Le film que tout le monde aime mais que tu n’as jamais vu :',
      'La série que tu recommandes à tout le monde :',
      'Le personnage que tu ne supportes pas dans une série que tu adores :',
      'La fois où tu t’es endormi(e) pendant un film au cinéma :',
      'Le film que tu as vu uniquement parce que quelqu’un insistait :',
      'La fin de série qui t’a le plus surpris(e) :',
      'Le dessin animé que tu regardais en boucle enfant :',
      'Le film que tu n’as pas compris du premier coup :',
      'La séance de cinéma la plus mémorable que tu aies vécue :',
      'Le genre de film que tu choisis quand tu ne sais pas quoi regarder :',
    ],
  },
  sports: {
    name: 'Sport & défis',
    prompts: [
      'Le sport que tu as essayé une fois et jamais repris :',
      'La victoire dont tu es le plus fier ou la plus fière :',
      'La fois où tu as abandonné un défi beaucoup trop tôt :',
      'Le mouvement sportif que tu ne réussis jamais :',
      'La compétition ou le match dont tu te souviens le mieux :',
      'Le sport que tu aimerais apprendre si tu avais le temps :',
      'La fois où tu as encouragé la mauvaise équipe :',
      'Le défi sportif le plus drôle que tu aies tenté :',
      'L’activité qui te fait oublier que tu es en train de faire du sport :',
      'La fois où tu as triché pendant un jeu de société ou un match :',
      'Le jeu de cour auquel tu jouais le plus enfant :',
      'La chose la plus sportive que tu aies faite par hasard :',
      'Le sport que tu regardes même si tu n’y comprends pas grand-chose :',
      'La fois où tu as eu mal partout après une séance trop ambitieuse :',
      'Le meilleur encouragement que tu aies reçu pendant un effort :',
    ],
  },
  gaming: {
    name: 'Jeux vidéo & jeux',
    prompts: [
      'Le jeu auquel tu as passé le plus d’heures :',
      'La partie que tu as gagnée contre toute attente :',
      'Le jeu qui t’a rendu(e) beaucoup trop compétitif(ve) :',
      'La fois où tu as cassé une manette ou failli le faire :',
      'Le personnage de jeu vidéo que tu choisis toujours :',
      'Le jeu que tu aimerais pouvoir découvrir une deuxième fois :',
      'La pire défaite que tu aies subie à un jeu :',
      'Le jeu de société qui provoque toujours une dispute chez vous :',
      'La stratégie improbable qui t’a fait gagner une partie :',
      'La fois où tu as joué bien plus longtemps que prévu :',
      'Le jeu auquel tu jouais le plus quand tu étais enfant :',
      'La règle de jeu que tu as déjà inventée en plein milieu d’une partie :',
      'Le jeu que tu es incapable d’expliquer clairement :',
      'La meilleure équipe ou le meilleur duo avec qui tu as joué :',
      'Le jeu que tu installes pour passer cinq minutes et gardes deux heures :',
    ],
  },
  internet: {
    name: 'Internet & réseaux',
    prompts: [
      'La vidéo Internet que tu as regardée beaucoup trop de fois :',
      'Le premier réseau social que tu as utilisé :',
      'La publication que tu as postée puis supprimée presque aussitôt :',
      'La recherche la plus inutile que tu aies faite en ligne :',
      'La fois où tu as répondu à voix haute à une vidéo :',
      'Le mème qui te fait rire à chaque fois :',
      'La chose la plus bizarre que l’algorithme t’ait recommandée :',
      'La fois où tu as passé une heure à lire les commentaires :',
      'Le compte ou la chaîne que tu regardes dès qu’une nouvelle vidéo sort :',
      'La capture d’écran que tu as gardée beaucoup trop longtemps :',
      'La fois où tu as envoyé un lien à la mauvaise conversation :',
      'La tendance Internet que tu as essayée puis regrettée :',
      'Le mot ou l’expression Internet que tu utilises trop souvent :',
      'La chose la plus surprenante apprise dans un fil de discussion :',
      'La fois où tu as oublié que tu partageais ton écran :',
    ],
  },
  childhood: {
    name: 'Enfance & souvenirs',
    prompts: [
      'Le métier que tu voulais faire quand tu étais petit(e) :',
      'La bêtise d’enfance que tu n’as jamais avouée :',
      'Ton jeu préféré quand tu étais enfant :',
      'La peur que tu avais et qui te paraît drôle aujourd’hui :',
      'Le jouet que tu as gardé le plus longtemps :',
      'La mode ou la coupe de cheveux que tu aimerais oublier :',
      'Le dessin animé que tu regardais avant d’aller à l’école :',
      'La règle inventée que tu croyais vraie quand tu étais petit(e) :',
      'La sortie scolaire dont tu parles encore aujourd’hui :',
      'Le souvenir de vacances qui te fait toujours sourire :',
      'La première chose que tu as apprise à faire tout(e) seul(e) :',
      'Le cadeau d’enfance que tu attendais avec impatience :',
      'La fois où tu as essayé de faire comme les grands :',
      'Le goûter que tu adorais après l’école :',
      'Le souvenir d’enfance que tu raconteras toujours :',
    ],
  },
  fashion: {
    name: 'Style & apparence',
    prompts: [
      'La tenue que tu as portée et que tu ne remettrais plus jamais :',
      'Le vêtement que tu portes dès qu’il est propre :',
      'La couleur que tu portes le plus sans t’en rendre compte :',
      'La tendance que tu as suivie puis regrettée :',
      'La fois où tu as mis tes vêtements à l’envers ou de travers :',
      'Le compliment sur ton style dont tu te souviens encore :',
      'La paire de chaussures que tu as gardée beaucoup trop longtemps :',
      'Le vêtement que tu empruntes régulièrement à quelqu’un :',
      'La fois où tu t’es préparé(e) en un temps record :',
      'La tenue que tu choisirais pour te sentir invincible :',
      'L’accessoire que tu perds tout le temps :',
      'La coiffure que tu as essayée une seule fois :',
      'La fois où tu as porté la même tenue qu’une autre personne :',
      'La chose que tu achètes même si tu en as déjà assez :',
      'Le style vestimentaire que tu aimerais oser essayer :',
    ],
  },
  pets: {
    name: 'Animaux',
    prompts: [
      'La rencontre la plus drôle que tu aies faite avec un animal :',
      'L’animal que tu aimerais adopter si tu avais tout l’espace nécessaire :',
      'La fois où un animal t’a fait vraiment peur :',
      'Le nom le plus improbable que tu donnerais à un animal :',
      'La chose la plus mignonne que tu aies vue faire par un animal :',
      'L’animal qui te ressemble le plus niveau caractère :',
      'La fois où tu as parlé à un animal comme à une personne :',
      'L’animal que tu aurais voulu avoir quand tu étais enfant :',
      'Le bruit d’animal que tu sais imiter :',
      'La rencontre inattendue avec un animal en pleine ville :',
      'La chose étrange que tu as vue un animal essayer de manger :',
      'L’animal que tu trouves injustement sous-estimé :',
      'La fois où tu as dû garder ou promener un animal :',
      'Le documentaire animalier que tu pourrais regarder pendant des heures :',
      'L’animal que tu choisirais pour t’accompagner dans une aventure :',
    ],
  },
  nature: {
    name: 'Nature & saisons',
    prompts: [
      'La plus belle chose que tu aies vue dans la nature :',
      'La fois où tu as été surpris(e) par un orage :',
      'La saison que tu choisirais si tu ne pouvais en garder qu’une :',
      'Le paysage qui t’a coupé le souffle :',
      'La balade qui s’est transformée en randonnée interminable :',
      'La fois où tu as confondu une plante ou un insecte :',
      'Le bruit de la nature qui te calme le plus :',
      'La météo qui te met instantanément de bonne humeur :',
      'La chose la plus inattendue que tu aies trouvée en forêt :',
      'La fois où tu as essayé de faire pousser quelque chose :',
      'Le lieu naturel où tu aimerais passer une journée :',
      'La rencontre avec un insecte dont tu te souviens bien :',
      'Le phénomène météo que tu aimerais observer de près :',
      'La fois où tu as oublié la crème solaire ou ton parapluie :',
      'Le meilleur endroit pour regarder un coucher de soleil :',
    ],
  },
  money: {
    name: 'Argent & achats',
    prompts: [
      'L’achat le plus inutile que tu aies fait sur un coup de tête :',
      'La chose pour laquelle tu économises depuis longtemps :',
      'La fois où tu as oublié un abonnement payant :',
      'Le meilleur achat que tu aies fait pour moins de dix euros :',
      'La chose que tu achètes toujours en trop grande quantité :',
      'La fois où tu as dépensé beaucoup trop pour te faire plaisir :',
      'L’objet que tu as acheté puis jamais utilisé :',
      'Le cadeau le plus cher que tu aies choisi pour quelqu’un :',
      'La bonne affaire dont tu es encore très fier ou fière :',
      'La fois où tu as payé pour quelque chose que tu avais déjà :',
      'L’objet que tu as réparé au lieu de le remplacer :',
      'La chose sur laquelle tu refuses de faire des économies :',
      'Le service ou l’application que tu paies et utilises vraiment :',
      'La fois où tu as prêté quelque chose et oublié à qui :',
      'Le meilleur cadeau reçu sans dépenser un centime :',
    ],
  },
  home: {
    name: 'Maison & coloc',
    prompts: [
      'Le coin de chez toi où tu passes le plus de temps :',
      'La chose la plus étrange que tu aies trouvée dans un tiroir :',
      'La tâche ménagère que tu fais en musique pour te motiver :',
      'La fois où tu as monté un meuble sans regarder les instructions :',
      'L’objet chez toi que tu ne pourrais pas remplacer :',
      'La chose que tu caches quand quelqu’un sonne à la porte :',
      'La panne ou le petit dégât le plus mémorable chez toi :',
      'Le repas improvisé que tu prépares quand le frigo est presque vide :',
      'La fois où tu as perdu tes clés chez toi :',
      'L’objet que tu as gardé alors qu’il ne fonctionne plus :',
      'La règle de vie commune la plus surprenante que tu aies connue :',
      'La pièce que tu aimerais réaménager complètement :',
      'La chose que tu as réparée avec une solution temporaire :',
      'Le voisin que tu as rencontré dans une situation improbable :',
      'L’odeur qui te fait immédiatement penser à chez toi :',
    ],
  },
  dreams: {
    name: 'Rêves & imagination',
    prompts: [
      'Le rêve le plus étrange dont tu te souviennes :',
      'La chose que tu ferais si tu pouvais arrêter le temps une heure :',
      'Le lieu imaginaire où tu aimerais passer une journée :',
      'La capacité extraordinaire que tu aimerais avoir pendant 24 heures :',
      'La première chose que tu ferais si tu gagnais un voyage surprise :',
      'Le personnage fictif que tu inviterais à dîner :',
      'La chose que tu construirais si tu avais un atelier géant :',
      'Le superpouvoir qui te serait le plus utile au quotidien :',
      'La période de l’histoire que tu aimerais visiter pour une journée :',
      'La règle que tu changerais si tu dirigeais le monde pendant un jour :',
      'Le rêve que tu aimerais réaliser dans les prochaines années :',
      'La chose que tu inventerais pour rendre la vie plus simple :',
      'Le talent que tu aimerais recevoir instantanément :',
      'L’aventure complètement irréaliste que tu accepterais de vivre :',
      'La question que tu poserais à ton toi du futur :',
    ],
  },
  tech: {
    name: 'Technologie & gadgets',
    prompts: [
      'La panne technologique qui t’a le plus énervé(e) :',
      'L’appareil que tu utilises tous les jours sans y penser :',
      'La fonction de téléphone que tu as découverte par hasard :',
      'La fois où tu as réparé un appareil en l’éteignant puis le rallumant :',
      'Le gadget dont tu rêves mais dont tu n’as pas besoin :',
      'Le mot de passe que tu as oublié au pire moment :',
      'La photo prise par accident que tu as finalement gardée :',
      'Le groupe de discussion que tu as mis en silencieux pour toujours :',
      'La chose que tu fais encore avec un appareil vieux de plusieurs années :',
      'Le fichier que tu as cru avoir perdu pour toujours :',
      'La fois où tu as demandé de l’aide pour un problème tout simple :',
      'L’objet connecté que tu aimerais voir inventé :',
      'Le réglage de ton téléphone que tu as changé sans le vouloir :',
      'La notification que tu vérifies beaucoup trop souvent :',
      'La technologie qui t’impressionne le plus aujourd’hui :',
    ],
  },
  talents: {
    name: 'Talents & passions',
    prompts: [
      'Le talent que tu as appris juste pour t’amuser :',
      'La chose que tu pourrais expliquer pendant des heures :',
      'La passion que tu as découverte grâce à un ami :',
      'Le savoir-faire dont tu aimerais être encore meilleur(e) :',
      'La chose créative que tu as fabriquée de tes mains :',
      'Le projet que tu as commencé avec beaucoup d’enthousiasme :',
      'Le talent que les gens ne soupçonnent pas chez toi :',
      'La chose que tu fais mieux que la plupart de tes amis :',
      'La compétence que tu aimerais enseigner à quelqu’un :',
      'La collection ou le passe-temps le plus inattendu que tu aies eu :',
      'La fois où tu as appris quelque chose en regardant quelqu’un faire :',
      'L’activité qui te fait perdre la notion du temps :',
      'Le petit progrès récent dont tu es fier ou fière :',
      'La chose que tu aimerais créer si tu avais tout un week-end :',
      'La passion que tu pourrais reprendre dès demain :',
    ],
  },
  opinions: {
    name: 'Goûts & opinions',
    prompts: [
      'L’opinion sans importance sur laquelle tu ne changes jamais d’avis :',
      'La chose populaire que tu n’as jamais vraiment aimée :',
      'Le petit détail qui peut améliorer toute ta journée :',
      'La question sur laquelle tu pourrais débattre pendant des heures :',
      'Le goût que tu défendras toujours même si personne n’est d’accord :',
      'La chose que tout le monde adore mais que tu trouves surestimée :',
      'Le son du quotidien que tu trouves étonnamment agréable :',
      'La petite habitude des autres qui te fait toujours sourire :',
      'Le choix entre deux choses où tu hésites à chaque fois :',
      'La règle de politesse que tu trouves la plus importante :',
      'La tendance que tu ne comprends toujours pas :',
      'La chose banale qui mérite selon toi beaucoup plus d’attention :',
      'Le meilleur moment de la journée selon toi :',
      'La petite chose qui te met immédiatement de bonne humeur :',
      'Le débat absurde auquel tu prends toujours part :',
    ],
  },
  future: {
    name: 'Projets & avenir',
    prompts: [
      'La chose que tu aimerais avoir accomplie dans cinq ans :',
      'Le prochain endroit que tu aimerais découvrir :',
      'La nouvelle habitude que tu voudrais prendre :',
      'Le projet que tu aimerais lancer avec tes amis :',
      'La chose que tu veux essayer au moins une fois dans ta vie :',
      'Le prochain petit défi que tu aimerais relever :',
      'La personne que tu aimerais revoir bientôt :',
      'La compétence utile que tu aimerais apprendre cette année :',
      'Le changement que tu espères faire dans ta routine :',
      'La journée parfaite que tu aimerais organiser bientôt :',
      'La chose que tu aimerais célébrer à la fin de l’année :',
      'La décision que tu repousses mais que tu aimerais prendre :',
      'Le souvenir que tu aimerais créer avec tes proches :',
      'La chose que tu aimerais faire plus souvent :',
      'Le conseil que tu donnerais à ton toi de l’année prochaine :',
    ],
  },
  memories: {
    name: 'Souvenirs & moments',
    prompts: [
      'Le jour où tu as ri au point d’en avoir mal au ventre :',
      'Le moment où quelqu’un t’a fait une très belle surprise :',
      'La journée qui a fini bien mieux que prévu :',
      'La rencontre qui t’a laissé un bon souvenir :',
      'Le petit geste de quelqu’un que tu n’as jamais oublié :',
      'Le moment où tu t’es senti(e) particulièrement chanceux ou chanceuse :',
      'La photo qui te rappelle une histoire à chaque fois que tu la vois :',
      'Le souvenir que tu aimerais pouvoir revivre une fois :',
      'La journée où tu as beaucoup improvisé :',
      'La fois où tu as reçu une nouvelle que tu attendais depuis longtemps :',
      'Le meilleur compliment que tu aies fait à quelqu’un :',
      'Le moment où tu as changé d’avis sur une personne :',
      'La petite victoire qui t’a fait très plaisir :',
      'Le moment où tu t’es senti(e) vraiment à ta place :',
      'Le souvenir qui te met toujours de bonne humeur :',
    ],
  },
};

PROMPT_CATEGORIES.all.prompts = Object.entries(PROMPT_CATEGORIES)
  .filter(([id]) => id !== 'all')
  .flatMap(([, category]) => category.prompts);

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const MAX_ROUNDS = 100;
const GRACE_MS = 15000; // délai avant de considérer qu'un joueur déconnecté est parti

const rooms = new Map();

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  } while (rooms.has(code));
  return code;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cleanName(n) {
  return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

function reply(cb, payload) {
  if (typeof cb === 'function') cb(payload);
}

function connectedPlayers(room) {
  return [...room.players.values()].filter((p) => p.connected);
}

function createRoom(hostId) {
  const room = {
    code: makeCode(),
    hostId,
    players: new Map(),
    phase: 'lobby', // lobby | writing | guessing | reveal | scores
    round: 0,
    totalRounds: 3,
    categoryId: 'all',
    usedPrompts: [],
    prompt: '',
    answers: {}, // playerId -> texte
    order: [], // ids des auteurs, dans l'ordre de passage
    index: 0,
    guesses: {}, // guesserId -> targetId
    results: [],
    fooled: 0,
    note: '',
    cleanup: null,
  };
  rooms.set(room.code, room);
  return room;
}

// ---------------------------------------------------------------------------
// Vue envoyée à chaque joueur (on ne révèle jamais l'auteur avant la révélation)
// ---------------------------------------------------------------------------
function viewFor(room, pid) {
  const nameOf = (id) => (room.players.get(id) || {}).name || '';
  const v = {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    me: pid,
    round: room.round,
    totalRounds: room.totalRounds,
    categoryId: room.categoryId,
    categoryName: PROMPT_CATEGORIES[room.categoryId].name,
    categories: Object.entries(PROMPT_CATEGORIES).map(([id, category]) => ({
      id,
      name: category.name,
      questionCount: category.prompts.length,
    })),
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      connected: p.connected,
      isHost: p.id === room.hostId,
    })),
  };

  if (room.phase === 'writing') {
    v.prompt = room.prompt;
    v.submitted = Object.keys(room.answers);
    v.myAnswer = room.answers[pid] !== undefined ? room.answers[pid] : null;
    v.canForce = Object.keys(room.answers).length >= 2;
  }

  if (room.phase === 'guessing' || room.phase === 'reveal') {
    const cur = room.order[room.index];
    v.prompt = room.prompt;
    v.text = room.answers[cur];
    v.index = room.index;
    v.total = room.order.length;
    v.isAuthor = cur === pid;
    // Tri alphabétique : l'ordre de passage ne doit pas trahir l'auteur
    v.candidates = room.order.slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    v.myGuess = room.guesses[pid] || null;
    v.guessedCount = Object.keys(room.guesses).length;
    v.needed = connectedPlayers(room).filter((p) => p.id !== cur).length;
    if (room.phase === 'reveal') {
      v.authorId = cur;
      v.results = room.results;
      v.fooled = room.fooled;
    }
  }

  if (room.phase === 'scores') {
    v.final = room.round >= room.totalRounds;
    v.note = room.note;
  }

  return v;
}

function broadcast(room) {
  for (const p of room.players.values()) {
    if (p.connected && p.socketId) io.to(p.socketId).emit('state', viewFor(room, p.id));
  }
}

// ---------------------------------------------------------------------------
// Logique de partie
// ---------------------------------------------------------------------------
function startRound(room) {
  room.round += 1;
  const prompts = PROMPT_CATEGORIES[room.categoryId].prompts;
  const pool = prompts.filter((p) => !room.usedPrompts.includes(p));
  const list = pool.length ? pool : prompts;
  room.prompt = list[Math.floor(Math.random() * list.length)];
  room.usedPrompts.push(room.prompt);
  room.answers = {};
  room.order = [];
  room.index = 0;
  room.guesses = {};
  room.results = [];
  room.fooled = 0;
  room.note = '';
  room.phase = 'writing';
}

function startGuessing(room) {
  const ids = Object.keys(room.answers);
  if (ids.length < 2) {
    room.phase = 'scores';
    room.note = 'Pas assez de réponses sur cette manche, on passe.';
    return;
  }
  room.order = shuffle(ids);
  room.index = 0;
  room.guesses = {};
  room.phase = 'guessing';
}

function reveal(room) {
  const cur = room.order[room.index];
  const results = [];
  let fooled = 0;
  for (const [gid, tid] of Object.entries(room.guesses)) {
    const guesser = room.players.get(gid);
    if (!guesser) continue;
    const correct = tid === cur;
    if (correct) guesser.score += 1; // +1 pour avoir deviné
    else fooled += 1;
    results.push({ guesserId: gid, targetId: tid, correct });
  }
  const author = room.players.get(cur);
  if (author) author.score += fooled; // +1 par personne trompée
  room.results = results;
  room.fooled = fooled;
  room.phase = 'reveal';
}

// Vérifie si tout le monde (parmi les connectés) a fini l'étape en cours
function checkProgress(room) {
  if (room.phase === 'writing') {
    const conn = connectedPlayers(room);
    if (conn.length && conn.every((p) => room.answers[p.id] !== undefined)) startGuessing(room);
  } else if (room.phase === 'guessing') {
    const cur = room.order[room.index];
    const need = connectedPlayers(room).filter((p) => p.id !== cur);
    if (need.every((p) => room.guesses[p.id] !== undefined)) reveal(room);
  }
}

function attach(socket, room, player) {
  player.socketId = socket.id;
  player.connected = true;
  socket.data = { ...socket.data, code: room.code, pid: player.id };
  socket.join(room.code);
  if (room.cleanup) {
    clearTimeout(room.cleanup);
    room.cleanup = null;
  }
}

function transferHostIfNeeded(room) {
  const host = room.players.get(room.hostId);
  if (host && host.connected) return;
  const next = connectedPlayers(room)[0];
  if (next) room.hostId = next.id;
}

// ---------------------------------------------------------------------------
// Sockets
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  const ctx = () => {
    const { code, pid } = socket.data || {};
    const room = rooms.get(code);
    if (!room) return null;
    const player = room.players.get(pid);
    if (!player || player.id !== socket.data.accountId) return null;
    return { room, player };
  };

  socket.on('register', async (data, cb) => {
    if (authBlocked(socket)) return reply(cb, { ok: false, error: 'Trop de tentatives. Réessaie dans 15 minutes.' });
    const name = cleanName(data && data.name);
    const password = String((data && data.password) || '');
    const avatar = cleanAvatar(data && data.avatar);
    if (name.length < 3) return reply(cb, { ok: false, error: 'Le pseudo doit contenir au moins 3 caractères.' });
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      return reply(cb, { ok: false, error: `Le mot de passe doit contenir ${PASSWORD_MIN_LENGTH} à ${PASSWORD_MAX_LENGTH} caractères.` });
    }
    if (avatar === null) return reply(cb, { ok: false, error: 'Photo invalide ou trop volumineuse (choisis une image de moins de 200 Ko).' });
    const normalizedName = name.toLocaleLowerCase('fr');
    if (accounts.some((account) => account.name.toLocaleLowerCase('fr') === normalizedName)) {
      return reply(cb, { ok: false, error: 'Ce pseudo est déjà utilisé.' });
    }
    try {
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordDigest = (await passwordHash(password, salt)).toString('hex');
      if (accounts.some((account) => account.name.toLocaleLowerCase('fr') === normalizedName)) {
        return reply(cb, { ok: false, error: 'Ce pseudo est déjà utilisé.' });
      }
      const account = {
        id: crypto.randomUUID(),
        name,
        avatar: avatar || '',
        salt,
        passwordHash: passwordDigest,
        sessions: [],
      };
      const token = issueSession(account);
      accounts.push(account);
      try {
        saveAccounts();
      } catch (error) {
        accounts.pop();
        throw error;
      }
      socket.data.accountId = account.id;
      reply(cb, { ok: true, token, user: publicAccount(account) });
    } catch (error) {
      console.error('Impossible de créer le compte :', error);
      reply(cb, { ok: false, error: 'Impossible de créer le compte pour le moment.' });
    }
  });

  socket.on('login', async (data, cb) => {
    if (authBlocked(socket)) return reply(cb, { ok: false, error: 'Trop de tentatives. Réessaie dans 15 minutes.' });
    const name = cleanName(data && data.name);
    const password = String((data && data.password) || '');
    if (password.length > PASSWORD_MAX_LENGTH) {
      recordAuthFailure(socket);
      return reply(cb, { ok: false, error: 'Pseudo ou mot de passe incorrect.' });
    }
    const account = accounts.find(
      (candidate) => candidate.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr')
    );
    try {
      const salt = account ? account.salt : DUMMY_SALT;
      const expected = account ? Buffer.from(account.passwordHash, 'hex') : DUMMY_PASSWORD_HASH;
      const actual = await passwordHash(password, salt);
      if (!account || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        recordAuthFailure(socket);
        return reply(cb, { ok: false, error: 'Pseudo ou mot de passe incorrect.' });
      }
      const oldSessions = account.sessions || [];
      const token = issueSession(account);
      try {
        saveAccounts();
      } catch (error) {
        account.sessions = oldSessions;
        throw error;
      }
      socket.data.accountId = account.id;
      reply(cb, { ok: true, token, user: publicAccount(account) });
    } catch (error) {
      console.error('Impossible de connecter le compte :', error);
      reply(cb, { ok: false, error: 'Impossible de se connecter pour le moment.' });
    }
  });

  socket.on('authenticate', (data, cb) => {
    const token = String((data && data.token) || '');
    const tokenHash = hashToken(token);
    const account = accounts.find((candidate) =>
      (candidate.sessions || []).some(
        (session) =>
          session.createdAt + SESSION_MAX_AGE_MS > Date.now() &&
          session.tokenHash === tokenHash
      )
    );
    if (!account) return reply(cb, { ok: false, error: 'Ta session a expiré, reconnecte-toi.' });
    socket.data.accountId = account.id;
    reply(cb, { ok: true, user: publicAccount(account) });
  });

  socket.on('updateAvatar', (data, cb) => {
    const account = accountFor(socket);
    if (!account) return reply(cb, { ok: false, error: 'Reconnecte-toi pour modifier ton profil.' });
    const avatar = cleanAvatar(data && data.avatar);
    if (avatar === null) return reply(cb, { ok: false, error: 'Photo invalide ou trop volumineuse (choisis une image de moins de 200 Ko).' });
    try {
      const previousAvatar = account.avatar;
      account.avatar = avatar || '';
      try {
        saveAccounts();
      } catch (error) {
        account.avatar = previousAvatar;
        throw error;
      }
      for (const room of rooms.values()) {
        const player = room.players.get(account.id);
        if (player) player.avatar = account.avatar;
      }
      for (const room of rooms.values()) broadcast(room);
      reply(cb, { ok: true, user: publicAccount(account) });
    } catch (error) {
      console.error('Impossible de mettre à jour la photo :', error);
      reply(cb, { ok: false, error: 'Impossible d’enregistrer la photo pour le moment.' });
    }
  });

  socket.on('logout', (data, cb) => {
    const account = accountFor(socket);
    const tokenHash = hashToken(String((data && data.token) || ''));
    if (account) {
      const previousSessions = account.sessions || [];
      if (!previousSessions.some((session) => session.tokenHash === tokenHash)) {
        return reply(cb, { ok: false, error: 'Ta session est déjà fermée.' });
      }
      account.sessions = previousSessions.filter((session) => session.tokenHash !== tokenHash);
      try {
        saveAccounts();
      } catch (error) {
        account.sessions = previousSessions;
        console.error('Impossible de fermer la session :', error);
        return reply(cb, { ok: false, error: 'Impossible de fermer la session pour le moment.' });
      }
    }
    const c = ctx();
    if (c) {
      const { room, player } = c;
      player.connected = false;
      if (room.phase === 'lobby') room.players.delete(player.id);
      socket.leave(room.code);
      socket.data = {};
      transferHostIfNeeded(room);
      checkProgress(room);
      broadcast(room);
      if (connectedPlayers(room).length === 0) {
        room.cleanup = setTimeout(() => rooms.delete(room.code), 10 * 60 * 1000);
      }
    }
    socket.data = {};
    reply(cb, { ok: true });
  });

  socket.on('create', (data, cb) => {
    const account = accountFor(socket);
    if (!account) return reply(cb, { ok: false, error: 'Connecte-toi pour créer un salon.' });
    const name = account.name;
    const pid = account.id;
    const room = createRoom(pid);
    const player = { id: pid, name, avatar: account.avatar || '', score: 0, connected: true, socketId: socket.id };
    room.players.set(pid, player);
    attach(socket, room, player);
    reply(cb, { ok: true, code: room.code });
    broadcast(room);
  });

  socket.on('join', (data, cb) => {
    const code = String((data && data.code) || '').toUpperCase().trim();
    const account = accountFor(socket);
    if (!account) return reply(cb, { ok: false, error: 'Connecte-toi pour rejoindre un salon.' });
    const name = account.name;
    const pid = account.id;
    const room = rooms.get(code);
    if (!room) return reply(cb, { ok: false, error: 'Salon introuvable. Vérifie le code.' });
    if (!pid) return reply(cb, { ok: false, error: 'Identifiant manquant.' });

    let player = room.players.get(pid);
    if (player) {
      // Reconnexion (rafraîchissement de page, perte de réseau…)
      attach(socket, room, player);
    } else {
      if (!name) return reply(cb, { ok: false, error: 'Choisis un pseudo.' });
      if (room.phase !== 'lobby') {
        return reply(cb, { ok: false, error: 'La partie a déjà commencé.' });
      }
      if (room.players.size >= MAX_PLAYERS) {
        return reply(cb, { ok: false, error: 'Le salon est plein.' });
      }
      const taken = [...room.players.values()].some(
        (p) => p.name.toLowerCase() === name.toLowerCase()
      );
      if (taken) return reply(cb, { ok: false, error: 'Ce pseudo est déjà pris dans le salon.' });
      player = { id: pid, name, avatar: account.avatar || '', score: 0, connected: true, socketId: socket.id };
      room.players.set(pid, player);
      attach(socket, room, player);
    }
    reply(cb, { ok: true, code: room.code });
    broadcast(room);
  });

  socket.on('start', (data, cb) => {
    const c = ctx();
    if (!c) return;
    const { room, player } = c;
    if (player.id !== room.hostId || room.phase !== 'lobby') return;
    // On retire ceux qui ont quitté pendant le lobby
    for (const p of [...room.players.values()]) if (!p.connected) room.players.delete(p.id);
    if (room.players.size < MIN_PLAYERS) {
      return reply(cb, { ok: false, error: `Il faut au moins ${MIN_PLAYERS} joueurs.` });
    }
    const r = parseInt(data && data.rounds, 10);
    room.totalRounds = r >= 1 && r <= MAX_ROUNDS ? r : 3;
    room.round = 0;
    room.usedPrompts = [];
    for (const p of room.players.values()) p.score = 0;
    startRound(room);
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('setCategory', (data, cb) => {
    const c = ctx();
    if (!c) return;
    const { room, player } = c;
    const categoryId = String((data && data.categoryId) || '');
    if (player.id !== room.hostId || room.phase !== 'lobby') {
      return reply(cb, { ok: false, error: 'Seul l’hôte peut choisir la catégorie dans le salon.' });
    }
    if (!Object.hasOwn(PROMPT_CATEGORIES, categoryId)) {
      return reply(cb, { ok: false, error: 'Cette catégorie n’existe pas.' });
    }
    room.categoryId = categoryId;
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('submit', (data) => {
    const c = ctx();
    if (!c) return;
    const { room, player } = c;
    if (room.phase !== 'writing' || room.answers[player.id] !== undefined) return;
    const text = String((data && data.text) || '').trim().slice(0, 300);
    if (!text) return;
    room.answers[player.id] = text;
    checkProgress(room);
    broadcast(room);
  });

  socket.on('guess', (data) => {
    const c = ctx();
    if (!c) return;
    const { room, player } = c;
    if (room.phase !== 'guessing') return;
    const cur = room.order[room.index];
    const target = String((data && data.targetId) || '');
    if (player.id === cur) return; // l'auteur ne vote pas
    if (room.guesses[player.id] !== undefined) return;
    if (target === player.id || !room.order.includes(target)) return;
    room.guesses[player.id] = target;
    checkProgress(room);
    broadcast(room);
  });

  // L'hôte débloque l'étape en cours sans attendre les retardataires
  socket.on('force', () => {
    const c = ctx();
    if (!c) return;
    const { room, player } = c;
    if (player.id !== room.hostId) return;
    if (room.phase === 'writing' && Object.keys(room.answers).length >= 2) {
      startGuessing(room);
      broadcast(room);
    } else if (room.phase === 'guessing') {
      reveal(room);
      broadcast(room);
    }
  });

  socket.on('next', () => {
    const c = ctx();
    if (!c) return;
    const { room, player } = c;
    if (player.id !== room.hostId || room.phase !== 'reveal') return;
    room.index += 1;
    if (room.index < room.order.length) {
      room.guesses = {};
      room.results = [];
      room.fooled = 0;
      room.phase = 'guessing';
      checkProgress(room);
    } else {
      room.phase = 'scores';
      room.note = '';
    }
    broadcast(room);
  });

  socket.on('nextRound', () => {
    const c = ctx();
    if (!c) return;
    const { room, player } = c;
    if (player.id !== room.hostId || room.phase !== 'scores') return;
    if (room.round >= room.totalRounds) return;
    startRound(room);
    broadcast(room);
  });

  socket.on('toLobby', () => {
    const c = ctx();
    if (!c) return;
    const { room, player } = c;
    if (player.id !== room.hostId || room.phase !== 'scores') return;
    for (const p of [...room.players.values()]) if (!p.connected) room.players.delete(p.id);
    room.phase = 'lobby';
    room.round = 0;
    room.note = '';
    broadcast(room);
  });

  socket.on('leave', () => {
    const c = ctx();
    if (!c) return;
    const { room, player } = c;
    player.connected = false;
    if (room.phase === 'lobby') room.players.delete(player.id);
    socket.leave(room.code);
    socket.data = { accountId: socket.data.accountId };
    transferHostIfNeeded(room);
    checkProgress(room);
    broadcast(room);
    if (connectedPlayers(room).length === 0) {
      room.cleanup = setTimeout(() => rooms.delete(room.code), 10 * 60 * 1000);
    }
  });

  socket.on('disconnect', () => {
    const c = ctx();
    if (!c) return;
    const { room, player } = c;
    if (player.socketId !== socket.id) return; // déjà remplacé par une nouvelle connexion
    player.connected = false;
    broadcast(room);

    // Petit délai de grâce : un téléphone qui se met en veille se reconnecte vite
    setTimeout(() => {
      if (!rooms.has(room.code)) return;
      if (player.connected) return;
      transferHostIfNeeded(room);
      checkProgress(room);
      broadcast(room);
    }, GRACE_MS);

    if (connectedPlayers(room).length === 0) {
      room.cleanup = setTimeout(() => rooms.delete(room.code), 10 * 60 * 1000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`C'est qui ?! prêt sur http://localhost:${PORT}`);
});
