'use strict';

// Petits outils partagés par tous les jeux.

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function connectedPlayers(room) {
  return [...room.players.values()].filter((p) => p.connected);
}

// "Éléphant " -> "elephant" (pour comparer deux mots sans tenir compte des accents ni de la casse)
function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function parseRounds(v, def = 3) {
  const r = parseInt(v, 10);
  return r >= 1 && r <= 10 ? r : def;
}

// Réglages du salon propres à un jeu : on ne garde que les valeurs prévues, sinon la valeur par défaut
function readSettings(defs, raw) {
  const out = {};
  for (const d of defs || []) {
    const v = Number(raw && raw[d.key]);
    out[d.key] = d.options.includes(v) ? v : d.def;
  }
  return out;
}

module.exports = { shuffle, connectedPlayers, normalize, parseRounds, readSettings };
