'use strict';

// Jeu « La Bombe » : une bombe passe de joueur en joueur, avec une ou deux lettres dessus.
// Celui qui l'a en main doit écrire un mot français qui contient ces lettres avant qu'elle explose.
// Bon mot : la bombe passe au suivant avec de nouvelles lettres. Explosion : une vie en moins.
// Un mot ne peut servir qu'une fois par partie. Le dernier joueur en vie gagne.
const { shuffle, connectedPlayers, readSettings } = require('./util');
const dico = require('./bomb-words');

const id = 'bomb';
// Réglables par l'hôte dans le salon
const SETTINGS = [
  { key: 'lives', label: 'Vies par joueur', options: [1, 2, 3, 4, 5], def: 3 },
  { key: 'seconds', label: 'Temps avant explosion', options: [5, 7, 10, 12, 15, 20, 25, 30], def: 10, unit: ' s' },
];
const BOOM_MS = 2500; // petite pause après une explosion, le temps de voir qui a sauté
const MAX_WORD_LEN = 30;
const HISTORY = 12; // nombre de mots récents affichés

const isConnected = (room, pid) => {
  const p = room.players.get(pid);
  return !!p && p.connected;
};
const currentId = (g) => g.order[g.turn];
const alive = (g) => g.order.filter((pid) => g.livesOf[pid] > 0);

function start(room, opts) {
  room.g = { phase: 'play', game: 0, timer: null, ...readSettings(SETTINGS, opts.settings) };
  setup(room);
}

// Nouvelle partie (aussi utilisée par « Rejouer »)
function setup(room) {
  const g = room.g;
  g.game += 1;
  g.phase = 'play';
  g.order = shuffle(connectedPlayers(room).map((p) => p.id));
  g.livesOf = {};
  g.wordsOf = {};
  g.bestOf = {}; // mot le plus long de chaque joueur
  for (const pid of g.order) {
    g.livesOf[pid] = g.lives;
    g.wordsOf[pid] = 0;
    g.bestOf[pid] = '';
  }
  g.used = {}; // mots déjà joués (sans accents)
  g.history = [];
  g.out = []; // joueurs éliminés, dans l'ordre
  g.winner = null;
  g.last = null; // dernière tentative : { pid, word, ok, reason }
  g.boom = null;
  g.turnId = 0;
  g.syllable = dico.randomSyllable();
  startTurn(room, 0);
}

// Donne la bombe au prochain joueur en vie à partir de la place « from ».
// Les joueurs déconnectés sont sautés, sauf s'il ne reste qu'eux.
function startTurn(room, from) {
  const g = room.g;
  const n = g.order.length;
  let firstAlive = -1;
  let firstOnline = -1;
  for (let i = 0; i < n && firstOnline < 0; i++) {
    const j = (from + i) % n;
    const pid = g.order[j];
    if (g.livesOf[pid] <= 0) continue;
    if (firstAlive < 0) firstAlive = j;
    if (isConnected(room, pid)) firstOnline = j;
  }
  g.turn = firstOnline >= 0 ? firstOnline : firstAlive;
  g.step = 'turn';
  g.turnId += 1;
  g.typing = '';
  g.boom = null;
  arm(room, g.seconds * 1000, () => explode(room));
}

// Minuteur côté serveur : c'est lui qui décide quand la bombe explose
function arm(room, ms, fn) {
  const g = room.g;
  clearTimeout(g.timer);
  g.deadline = Date.now() + ms;
  g.timer = setTimeout(() => {
    if (room.g !== g || g.phase !== 'play') return; // partie arrêtée entre-temps
    fn();
    room.notify();
  }, ms);
}

function explode(room) {
  const g = room.g;
  const pid = currentId(g);
  g.livesOf[pid] -= 1;
  const dead = g.livesOf[pid] <= 0;
  if (dead) g.out.push(pid);
  g.boom = { pid, syllable: g.syllable, example: dico.example(g.syllable, g.used), dead };
  g.step = 'boom';
  g.turnId += 1;
  g.typing = '';
  arm(room, BOOM_MS, () => {
    if (alive(g).length <= 1) return finish(room, alive(g)[0] || null);
    g.syllable = dico.randomSyllable(g.syllable);
    startTurn(room, g.turn + 1);
  });
}

function finish(room, winnerId) {
  const g = room.g;
  clearTimeout(g.timer);
  g.phase = 'end';
  g.winner = winnerId;
  const p = winnerId && room.players.get(winnerId);
  if (p) p.score += 1; // le score compte les victoires quand on rejoue
}

// Appelé quand un joueur quitte (ou reste déconnecté trop longtemps)
function progress(room) {
  const g = room.g;
  if (g.phase !== 'play') return;
  const online = alive(g).filter((pid) => isConnected(room, pid));
  if (online.length === 1) return finish(room, online[0]);
  if (online.length && g.step === 'turn' && !isConnected(room, currentId(g))) startTurn(room, g.turn + 1);
}

function view(room, pid) {
  const g = room.g;
  const v = {
    phase: g.phase,
    game: g.game,
    lives: g.lives,
    seconds: g.seconds,
    order: g.order,
    livesOf: g.livesOf,
    wordsOf: g.wordsOf,
    isParticipant: g.order.includes(pid),
  };

  if (g.phase === 'play') {
    v.step = g.step;
    v.turnId = g.turnId;
    v.currentId = currentId(g);
    v.syllable = g.syllable;
    v.typing = g.typing;
    v.last = g.last;
    v.boom = g.boom;
    v.remaining = Math.max(0, g.deadline - Date.now());
    v.history = g.history.slice(-HISTORY).reverse();
    v.usedCount = g.history.length;
  }

  if (g.phase === 'end') {
    v.winner = g.winner;
    const survivors = alive(g).sort((a, b) => (a === g.winner ? -1 : b === g.winner ? 1 : 0));
    v.ranking = [...survivors, ...g.out.slice().reverse()];
    v.bestOf = g.bestOf;
    v.usedCount = g.history.length;
  }
  return v;
}

function act(room, player, data) {
  const g = room.g;
  const pid = player.id;
  const myTurn = g.phase === 'play' && g.step === 'turn' && currentId(g) === pid;

  switch (data.type) {
    // Ce que le joueur est en train d'écrire, visible par tout le monde
    case 'type': {
      if (!myTurn) return { ok: false };
      g.typing = String(data.text || '').slice(0, MAX_WORD_LEN);
      return { ok: true };
    }

    case 'word': {
      if (!myTurn) return { ok: false, error: "Ce n'est pas ton tour." };
      const word = String(data.word || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, MAX_WORD_LEN);
      const k = dico.key(word);
      if (!k) return { ok: false, error: 'Écris un mot !' };

      let reason = null;
      let error = null;
      if (!k.includes(g.syllable)) {
        reason = 'pas les bonnes lettres';
        error = `Il faut « ${g.syllable.toUpperCase()} » dans le mot !`;
      } else if (!dico.has(k)) {
        reason = 'pas dans le dico';
        error = "Ce mot n'est pas dans le dictionnaire.";
      } else if (g.used[k]) {
        reason = 'déjà utilisé';
        error = 'Ce mot a déjà été utilisé !';
      }
      g.last = { pid, word, ok: !reason, reason };
      if (reason) return { ok: false, error };

      g.used[k] = true;
      g.history.push({ pid, word });
      g.wordsOf[pid] += 1;
      if (k.length > dico.key(g.bestOf[pid]).length) g.bestOf[pid] = word;
      g.syllable = dico.randomSyllable(g.syllable);
      startTurn(room, g.turn + 1);
      return { ok: true };
    }

    case 'again': {
      if (pid !== room.hostId || g.phase !== 'end') return { ok: false };
      if (connectedPlayers(room).length < module.exports.minPlayers) {
        return { ok: false, error: `Il faut au moins ${module.exports.minPlayers} joueurs.` };
      }
      setup(room);
      return { ok: true };
    }
  }
  return { ok: false };
}

module.exports = {
  id,
  name: 'La Bombe',
  emoji: '💣',
  tagline: "Écris un mot avec les lettres de la bombe avant qu'elle t'explose dans les mains !",
  minPlayers: 2,
  rounds: false,
  settings: SETTINGS,
  start,
  view,
  act,
  progress,
};
