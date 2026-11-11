'use strict';

// Dictionnaire de « La Bombe » : ~336 000 mots français (conjugaisons et pluriels compris),
// fournis par le paquet npm « an-array-of-french-words ».
// On compare les mots sans accents ni majuscules : « Éléphant », « elephant » et « ÉLÉPHANT » sont le même mot.
const WORDS = require('an-array-of-french-words');

const MIN_WORDS_PER_SYLLABLE = 1000; // une syllabe doit se trouver dans au moins ce nombre de mots
const SINGLE_LETTER_CHANCE = 0.1; // de temps en temps, une seule lettre sur la bombe

// "Cœur-Brisé" -> "coeurbrise"
function key(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

const DICT = new Set();
for (const w of WORDS) {
  const k = key(w);
  if (k) DICT.add(k);
}

// Les syllabes possibles : on ne garde que celles qui apparaissent dans assez de mots
const counts = {};
for (const k of DICT) {
  const seen = new Set(k);
  for (let i = 0; i < k.length - 1; i++) seen.add(k.slice(i, i + 2));
  for (const s of seen) counts[s] = (counts[s] || 0) + 1;
}
const common = Object.keys(counts).filter((s) => counts[s] >= MIN_WORDS_PER_SYLLABLE);
const ONE = common.filter((s) => s.length === 1);
const TWO = common.filter((s) => s.length === 2);

function randomSyllable(previous) {
  const pool = Math.random() < SINGLE_LETTER_CHANCE ? ONE : TWO;
  let s;
  do s = pool[Math.floor(Math.random() * pool.length)];
  while (s === previous);
  return s;
}

// Un mot qui aurait marché (montré quand la bombe explose)
function example(syllable, used) {
  const start = Math.floor(Math.random() * WORDS.length);
  let fallback = null;
  for (let i = 0; i < WORDS.length; i++) {
    const w = WORDS[(start + i) % WORDS.length];
    const k = key(w);
    if (!k.includes(syllable) || used[k] || w.includes('-')) continue;
    if (w.length >= 4 && w.length <= 10) return w;
    if (!fallback) fallback = w;
  }
  return fallback;
}

module.exports = {
  key,
  has: (k) => DICT.has(k),
  randomSyllable,
  example,
};
