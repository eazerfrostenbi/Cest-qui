'use strict';

// Jeu « C'est qui ?! » : chacun écrit une anecdote anonyme, puis on devine qui a écrit quoi.
const { shuffle, connectedPlayers, parseRounds } = require('./util');
const PROMPTS = require('./anecdotes-prompts');

const id = 'anecdotes';

function start(room, opts) {
  room.g = {
    phase: 'writing', // writing | guessing | reveal | scores
    round: 0,
    totalRounds: parseRounds(opts.rounds),
    usedPrompts: [],
    prompt: '',
    answers: {}, // playerId -> texte
    order: [], // ids des auteurs, dans l'ordre de passage
    index: 0,
    guesses: {}, // guesserId -> targetId
    results: [],
    fooled: 0,
    note: '',
  };
  startRound(room);
}

function startRound(room) {
  const g = room.g;
  g.round += 1;
  const pool = PROMPTS.filter((p) => !g.usedPrompts.includes(p));
  const list = pool.length ? pool : PROMPTS;
  g.prompt = list[Math.floor(Math.random() * list.length)];
  g.usedPrompts.push(g.prompt);
  g.answers = {};
  g.order = [];
  g.index = 0;
  g.guesses = {};
  g.results = [];
  g.fooled = 0;
  g.note = '';
  g.phase = 'writing';
}

function startGuessing(room) {
  const g = room.g;
  const ids = Object.keys(g.answers);
  if (ids.length < 2) {
    g.phase = 'scores';
    g.note = 'Pas assez de réponses sur cette manche, on passe.';
    return;
  }
  g.order = shuffle(ids);
  g.index = 0;
  g.guesses = {};
  g.phase = 'guessing';
}

function reveal(room) {
  const g = room.g;
  const cur = g.order[g.index];
  const results = [];
  let fooled = 0;
  for (const [gid, tid] of Object.entries(g.guesses)) {
    const guesser = room.players.get(gid);
    if (!guesser) continue;
    const correct = tid === cur;
    if (correct) guesser.score += 1; // +1 pour avoir deviné
    else fooled += 1;
    results.push({ guesserId: gid, targetId: tid, correct });
  }
  const author = room.players.get(cur);
  if (author) author.score += fooled; // +1 par personne trompée
  g.results = results;
  g.fooled = fooled;
  g.phase = 'reveal';
}

// Vérifie si tout le monde (parmi les connectés) a fini l'étape en cours
function progress(room) {
  const g = room.g;
  if (g.phase === 'writing') {
    const conn = connectedPlayers(room);
    if (conn.length && conn.every((p) => g.answers[p.id] !== undefined)) startGuessing(room);
  } else if (g.phase === 'guessing') {
    const cur = g.order[g.index];
    const need = connectedPlayers(room).filter((p) => p.id !== cur);
    if (need.every((p) => g.guesses[p.id] !== undefined)) reveal(room);
  }
}

// Vue envoyée à un joueur : on ne révèle jamais l'auteur avant la révélation
function view(room, pid) {
  const g = room.g;
  const nameOf = (i) => (room.players.get(i) || {}).name || '';
  const v = { phase: g.phase, round: g.round, totalRounds: g.totalRounds };

  if (g.phase === 'writing') {
    v.prompt = g.prompt;
    v.submitted = Object.keys(g.answers);
    v.myAnswer = g.answers[pid] !== undefined ? g.answers[pid] : null;
    v.canForce = Object.keys(g.answers).length >= 2;
  }

  if (g.phase === 'guessing' || g.phase === 'reveal') {
    const cur = g.order[g.index];
    v.prompt = g.prompt;
    v.text = g.answers[cur];
    v.index = g.index;
    v.total = g.order.length;
    v.isAuthor = cur === pid;
    // Tri alphabétique : l'ordre de passage ne doit pas trahir l'auteur
    v.candidates = g.order.slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    v.myGuess = g.guesses[pid] || null;
    v.guessedCount = Object.keys(g.guesses).length;
    v.needed = connectedPlayers(room).filter((p) => p.id !== cur).length;
    if (g.phase === 'reveal') {
      v.authorId = cur;
      v.results = g.results;
      v.fooled = g.fooled;
    }
  }

  if (g.phase === 'scores') {
    v.final = g.round >= g.totalRounds;
    v.note = g.note;
  }
  return v;
}

function act(room, player, data) {
  const g = room.g;
  const isHost = player.id === room.hostId;

  switch (data.type) {
    case 'submit': {
      if (g.phase !== 'writing' || g.answers[player.id] !== undefined) return { ok: false };
      const text = String(data.text || '').trim().slice(0, 300);
      if (!text) return { ok: false, error: 'Écris quelque chose !' };
      g.answers[player.id] = text;
      progress(room);
      return { ok: true };
    }

    case 'guess': {
      if (g.phase !== 'guessing') return { ok: false };
      const cur = g.order[g.index];
      const target = String(data.targetId || '');
      if (player.id === cur) return { ok: false }; // l'auteur ne vote pas
      if (g.guesses[player.id] !== undefined) return { ok: false };
      if (target === player.id || !g.order.includes(target)) return { ok: false };
      g.guesses[player.id] = target;
      progress(room);
      return { ok: true };
    }

    // L'hôte débloque l'étape en cours sans attendre les retardataires
    case 'force': {
      if (!isHost) return { ok: false };
      if (g.phase === 'writing' && Object.keys(g.answers).length >= 2) startGuessing(room);
      else if (g.phase === 'guessing') reveal(room);
      else return { ok: false };
      return { ok: true };
    }

    case 'next': {
      if (!isHost || g.phase !== 'reveal') return { ok: false };
      g.index += 1;
      if (g.index < g.order.length) {
        g.guesses = {};
        g.results = [];
        g.fooled = 0;
        g.phase = 'guessing';
        progress(room);
      } else {
        g.phase = 'scores';
        g.note = '';
      }
      return { ok: true };
    }

    case 'nextRound': {
      if (!isHost || g.phase !== 'scores' || g.round >= g.totalRounds) return { ok: false };
      startRound(room);
      return { ok: true };
    }
  }
  return { ok: false };
}

module.exports = {
  id,
  name: "C'est qui ?!",
  emoji: '✍️',
  tagline: "Écris une anecdote anonyme, devine qui l'a vécue.",
  minPlayers: 3,
  start,
  view,
  act,
  progress,
};
