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

module.exports = { shuffle, connectedPlayers, normalize, parseRounds };
