const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

// ---------------------------------------------------------------------------
// Énoncés : modifie / ajoute les tiens ici !
// ---------------------------------------------------------------------------
const PROMPTS = [
  'Ta première fois que tu as menti à tes parents :',
  'Ta première fois que tu as eu la honte de ta vie :',
  'Ta première fois en soirée :',
  'Ta première fois que tu as pleuré devant quelqu\'un :',
  'Ta première fois que tu t\'es fait choper :',
  'Ta première fois que tu as volé quelque chose :',
  'Ta première fois que tu as eu un coup de cœur :',
  'Ta première fois que tu as trop bu :',
  'Ta première fois que tu t\'es planté(e) en public :',
  'Ta première fois que tu as ghosté quelqu\'un :',
  'Ta première fois que tu as stalké quelqu\'un :',
  'Ta première fois que tu as triché :',
  'Ta première fois que tu as eu vraiment peur :',
  'Ta première fois que tu as séché les cours :',
  'Ta première fois que tu as cassé un truc cher :',
  'Ta première fois que tu as pleuré devant un film :',
  'Ta première fois que tu as eu un crush sur un(e) prof :',
  'Ta première fois que tu as fait semblant de comprendre :',
  'Ta première fois que tu t\'es fait larguer :',
  'Ta première fois que tu as fait un truc dont tu es encore fier(e) :',
  'Ta pire honte :',
  'Ton plus gros mensonge :',
  'Un truc bizarre que tu fais quand t\'es seul(e) :',
  'Le truc le plus débile que tu aies acheté :',
  'Ta pire excuse pour ne pas venir à une soirée :',
  'Le message que tu regrettes le plus d\'avoir envoyé :',
];

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
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
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
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
  const pool = PROMPTS.filter((p) => !room.usedPrompts.includes(p));
  const list = pool.length ? pool : PROMPTS;
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
  socket.data = { code: room.code, pid: player.id };
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
    if (!player) return null;
    return { room, player };
  };

  socket.on('create', (data, cb) => {
    const name = cleanName(data && data.name);
    const pid = String((data && data.playerId) || '');
    if (!name) return reply(cb, { ok: false, error: 'Choisis un pseudo.' });
    if (!pid) return reply(cb, { ok: false, error: 'Identifiant manquant.' });
    const room = createRoom(pid);
    const player = { id: pid, name, score: 0, connected: true, socketId: socket.id };
    room.players.set(pid, player);
    attach(socket, room, player);
    reply(cb, { ok: true, code: room.code });
    broadcast(room);
  });

  socket.on('join', (data, cb) => {
    const code = String((data && data.code) || '').toUpperCase().trim();
    const name = cleanName(data && data.name);
    const pid = String((data && data.playerId) || '');
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
      player = { id: pid, name, score: 0, connected: true, socketId: socket.id };
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
    room.totalRounds = r >= 1 && r <= 10 ? r : 3;
    room.round = 0;
    room.usedPrompts = [];
    for (const p of room.players.values()) p.score = 0;
    startRound(room);
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
    socket.data = {};
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
