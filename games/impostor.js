'use strict';

// Jeu « L'imposteur » : tout le monde a le même mot, sauf un joueur qui a un mot proche.
// Chacun donne des indices à tour de rôle, puis on vote pour démasquer l'imposteur.
// L'imposteur ne sait pas qu'il est l'imposteur : il croit avoir le même mot que les autres.
const { shuffle, connectedPlayers, normalize, parseRounds } = require('./util');
const WORDS = require('./impostor-words');

const id = 'impostor';
const CLUE_ROUNDS = 2; // nombre de tours d'indices avant le vote
const MAX_CLUE_LEN = 30;
const POINTS_FOUND = 2; // pour chaque joueur qui a voté pour l'imposteur démasqué
const POINTS_HIDDEN = 3; // pour l'imposteur qui n'est pas démasqué

const isConnected = (room, pid) => {
  const p = room.players.get(pid);
  return !!p && p.connected;
};
const liveParticipants = (room) => room.g.participants.filter((pid) => isConnected(room, pid));
const totalTurns = (g) => g.order.length * CLUE_ROUNDS;
const currentId = (g) => (g.turn < totalTurns(g) ? g.order[g.turn % g.order.length] : null);

function start(room, opts) {
  room.g = {
    phase: 'word', // word | clues | vote | result | scores
    round: 0,
    totalRounds: parseRounds(opts.rounds),
    usedPairs: [],
    pastImpostors: [],
    participants: [],
    wordOf: {}, // playerId -> mot (privé : ne jamais envoyer aux autres)
    civilWord: '',
    impostorWord: '',
    impostorId: null,
    order: [],
    turn: 0,
    clues: [],
    ready: {},
    votes: {}, // voterId -> targetId
    result: null,
  };
  startRound(room);
}

function startRound(room) {
  const g = room.g;
  g.round += 1;
  const ids = connectedPlayers(room).map((p) => p.id);
  g.participants = ids;

  const keyOf = (pair) => pair.join('|');
  let pool = WORDS.filter((pair) => !g.usedPairs.includes(keyOf(pair)));
  if (!pool.length) pool = WORDS;
  const pair = pool[Math.floor(Math.random() * pool.length)];
  g.usedPairs.push(keyOf(pair));
  const swap = Math.random() < 0.5;
  g.civilWord = swap ? pair[1] : pair[0];
  g.impostorWord = swap ? pair[0] : pair[1];

  // Chacun son tour d'être imposteur avant qu'un joueur le soit deux fois
  let candidates = ids.filter((i) => !g.pastImpostors.includes(i));
  if (!candidates.length) {
    g.pastImpostors = [];
    candidates = ids;
  }
  g.impostorId = candidates[Math.floor(Math.random() * candidates.length)];
  g.pastImpostors.push(g.impostorId);

  g.wordOf = {};
  for (const i of ids) g.wordOf[i] = i === g.impostorId ? g.impostorWord : g.civilWord;

  g.order = shuffle(ids);
  g.turn = 0;
  g.clues = [];
  g.ready = {};
  g.votes = {};
  g.result = null;
  g.phase = 'word';
}

// Saute les joueurs déconnectés ; passe au vote quand tous les indices sont donnés
function skipOffline(room) {
  const g = room.g;
  while (g.turn < totalTurns(g) && !isConnected(room, currentId(g))) g.turn += 1;
  if (g.turn >= totalTurns(g)) g.phase = 'vote';
}

function startClues(room) {
  const g = room.g;
  g.phase = 'clues';
  g.turn = 0;
  skipOffline(room);
}

function finishVote(room) {
  const g = room.g;
  const tally = {};
  for (const i of g.participants) tally[i] = 0;
  const votes = [];
  for (const [voterId, targetId] of Object.entries(g.votes)) {
    if (tally[targetId] !== undefined) tally[targetId] += 1;
    votes.push({ voterId, targetId });
  }
  const max = Math.max(0, ...Object.values(tally));
  const top = Object.keys(tally).filter((i) => tally[i] === max);
  // Démasqué = le plus voté, sans égalité
  const caught = max > 0 && top.length === 1 && top[0] === g.impostorId;

  const gains = {};
  if (caught) {
    for (const v of votes) if (v.targetId === g.impostorId) gains[v.voterId] = POINTS_FOUND;
  } else if (votes.length > 0) {
    gains[g.impostorId] = POINTS_HIDDEN;
  }
  for (const [pid, pts] of Object.entries(gains)) {
    const p = room.players.get(pid);
    if (p) p.score += pts;
  }

  g.result = {
    caught,
    tally: g.participants.map((i) => ({ id: i, count: tally[i] })),
    votes,
    gains,
  };
  g.phase = 'result';
}

function progress(room) {
  const g = room.g;
  if (g.phase === 'word') {
    const live = liveParticipants(room);
    if (live.length && live.every((i) => g.ready[i])) startClues(room);
  } else if (g.phase === 'clues') {
    skipOffline(room);
  } else if (g.phase === 'vote') {
    const live = liveParticipants(room);
    if (live.length && live.every((i) => g.votes[i] !== undefined)) finishVote(room);
  }
}

// Vue envoyée à un joueur. Le mot des autres et l'identité de l'imposteur
// ne sont JAMAIS envoyés avant la phase "result".
function view(room, pid) {
  const g = room.g;
  const isParticipant = g.participants.includes(pid);
  const v = {
    phase: g.phase,
    round: g.round,
    totalRounds: g.totalRounds,
    clueRounds: CLUE_ROUNDS,
  };

  if (g.phase === 'scores') {
    v.final = true;
    return v;
  }

  v.participants = g.participants;
  v.isParticipant = isParticipant;
  v.myWord = isParticipant ? g.wordOf[pid] : null;

  if (g.phase === 'word') {
    v.ready = Object.keys(g.ready);
    v.canForce = true;
  }

  if (g.phase === 'clues') {
    v.order = g.order;
    v.clues = g.clues;
    v.currentId = currentId(g);
    v.clueRound = Math.floor(g.turn / g.order.length) + 1;
  }

  if (g.phase === 'vote') {
    v.order = g.order;
    v.clues = g.clues;
    v.myVote = g.votes[pid] || null;
    v.voted = Object.keys(g.votes);
    v.needed = liveParticipants(room).length;
  }

  if (g.phase === 'result') {
    v.order = g.order;
    v.clues = g.clues;
    v.impostorId = g.impostorId;
    v.civilWord = g.civilWord;
    v.impostorWord = g.impostorWord;
    v.result = g.result;
  }
  return v;
}

function act(room, player, data) {
  const g = room.g;
  const pid = player.id;
  const isHost = pid === room.hostId;
  const isParticipant = g.participants.includes(pid);

  switch (data.type) {
    case 'ready': {
      if (g.phase !== 'word' || !isParticipant) return { ok: false };
      g.ready[pid] = true;
      progress(room);
      return { ok: true };
    }

    case 'clue': {
      if (g.phase !== 'clues' || currentId(g) !== pid) {
        return { ok: false, error: "Ce n'est pas ton tour." };
      }
      const text = String(data.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CLUE_LEN);
      if (!text) return { ok: false, error: 'Écris un indice !' };
      if (text.split(' ').length > 2) return { ok: false, error: 'Un seul mot (deux maximum) !' };
      if (normalize(text) === normalize(g.wordOf[pid])) {
        return { ok: false, error: 'Tu ne peux pas dire ton propre mot !' };
      }
      g.clues.push({ playerId: pid, text, round: Math.floor(g.turn / g.order.length) + 1 });
      g.turn += 1;
      skipOffline(room);
      return { ok: true };
    }

    case 'vote': {
      if (g.phase !== 'vote' || !isParticipant) return { ok: false };
      const target = String(data.targetId || '');
      if (target === pid || !g.participants.includes(target)) return { ok: false };
      if (g.votes[pid] !== undefined) return { ok: false };
      g.votes[pid] = target;
      progress(room);
      return { ok: true };
    }

    // L'hôte débloque l'étape en cours
    case 'force': {
      if (!isHost) return { ok: false };
      if (g.phase === 'word') startClues(room);
      else if (g.phase === 'clues') {
        g.turn += 1; // passe le joueur dont c'est le tour
        skipOffline(room);
      } else if (g.phase === 'vote') finishVote(room);
      else return { ok: false };
      return { ok: true };
    }

    case 'next': {
      if (!isHost || g.phase !== 'result') return { ok: false };
      if (g.round >= g.totalRounds) g.phase = 'scores';
      else startRound(room);
      return { ok: true };
    }
  }
  return { ok: false };
}

module.exports = {
  id,
  name: "L'imposteur",
  emoji: '🕵️',
  tagline: 'Tout le monde a le même mot… sauf un. Trouve qui a un mot différent !',
  minPlayers: 3,
  start,
  view,
  act,
  progress,
};
