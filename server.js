'use strict';

// Eazerfrost Games : salons + jeux entre potes (Express + Socket.io).
// Le salon (créer / rejoindre / reconnexion / hôte) est ici ; chaque jeu vit dans games/.
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { connectedPlayers } = require('./games/util');

// ---------------------------------------------------------------------------
// Les jeux disponibles. Pour en ajouter un : créer games/monjeu.js et l'ajouter ici.
// ---------------------------------------------------------------------------
const GAMES = {
  anecdotes: require('./games/anecdotes'),
  impostor: require('./games/impostor'),
};
const DEFAULT_MODE = 'anecdotes';

const MAX_PLAYERS = 12;
const GRACE_MS = 15000; // délai avant de considérer qu'un joueur déconnecté est parti

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

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

function cleanName(n) {
  return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

function reply(cb, payload) {
  if (typeof cb === 'function') cb(payload);
}

function createRoom(hostId) {
  const room = {
    code: makeCode(),
    hostId,
    players: new Map(),
    phase: 'lobby', // lobby | playing
    mode: DEFAULT_MODE,
    g: null, // état du jeu en cours (géré par le module du jeu)
    cleanup: null,
  };
  rooms.set(room.code, room);
  return room;
}

function modeList() {
  return Object.values(GAMES).map((g) => ({
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    tagline: g.tagline,
    minPlayers: g.minPlayers,
  }));
}

// Vue envoyée à chaque joueur
function viewFor(room, pid) {
  const v = {
    code: room.code,
    phase: room.phase,
    mode: room.mode,
    hostId: room.hostId,
    me: pid,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      connected: p.connected,
      isHost: p.id === room.hostId,
    })),
  };
  if (room.phase === 'lobby') v.modes = modeList();
  else v.g = GAMES[room.mode].view(room, pid);
  return v;
}

function broadcast(room) {
  for (const p of room.players.values()) {
    if (p.connected && p.socketId) io.to(p.socketId).emit('state', viewFor(room, p.id));
  }
}

function progress(room) {
  if (room.phase === 'playing' && room.g) GAMES[room.mode].progress(room);
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

function scheduleCleanup(room) {
  if (connectedPlayers(room).length === 0) {
    room.cleanup = setTimeout(() => rooms.delete(room.code), 10 * 60 * 1000);
  }
}

function dropOffline(room) {
  for (const p of [...room.players.values()]) if (!p.connected) room.players.delete(p.id);
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

  // L'hôte choisit le jeu depuis le salon
  socket.on('setMode', (data) => {
    const c = ctx();
    if (!c) return;
    const { room, player } = c;
    if (player.id !== room.hostId || room.phase !== 'lobby') return;
    const mode = String((data && data.mode) || '');
    if (!GAMES[mode]) return;
    room.mode = mode;
    broadcast(room);
  });

  socket.on('start', (data, cb) => {
    const c = ctx();
    if (!c) return;
    const { room, player } = c;
    if (player.id !== room.hostId || room.phase !== 'lobby') return;
    dropOffline(room); // on retire ceux qui ont quitté pendant le salon
    const game = GAMES[room.mode];
    if (room.players.size < game.minPlayers) {
      return reply(cb, { ok: false, error: `Il faut au moins ${game.minPlayers} joueurs.` });
    }
    for (const p of room.players.values()) p.score = 0;
    room.phase = 'playing';
    game.start(room, { rounds: data && data.rounds });
    reply(cb, { ok: true });
    broadcast(room);
  });

  // Toutes les actions de jeu passent par ici ; le module du jeu décide quoi en faire.
  socket.on('act', (data, cb) => {
    const c = ctx();
    if (!c) return reply(cb, { ok: false });
    const { room, player } = c;
    if (room.phase !== 'playing' || !room.g) return reply(cb, { ok: false });
    let res;
    try {
      res = GAMES[room.mode].act(room, player, data || {});
    } catch (err) {
      console.error('Erreur dans le jeu', room.mode, err);
      res = { ok: false, error: 'Oups, une erreur est survenue.' };
    }
    broadcast(room);
    reply(cb, res || { ok: false });
  });

  // L'hôte ramène tout le monde au salon (fin de partie, ou arrêt en cours de route)
  socket.on('toLobby', () => {
    const c = ctx();
    if (!c) return;
    const { room, player } = c;
    if (player.id !== room.hostId || room.phase !== 'playing') return;
    dropOffline(room);
    room.phase = 'lobby';
    room.g = null;
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
    progress(room);
    broadcast(room);
    scheduleCleanup(room);
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
      progress(room);
      broadcast(room);
    }, GRACE_MS);

    scheduleCleanup(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Eazerfrost Games prêt sur http://localhost:${PORT}`);
});
