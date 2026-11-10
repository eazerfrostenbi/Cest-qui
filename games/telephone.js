'use strict';

// Jeu « Le Téléphone Dessiné » : chacun écrit une phrase, le suivant la dessine,
// le suivant devine le dessin, et ainsi de suite. À la fin, on déroule chaque carnet.
// Il n'y a pas de points : le but, c'est de rigoler en voyant ce que la phrase est devenue.
const { shuffle, connectedPlayers } = require('./util');
const PROMPTS = require('./telephone-prompts');

const id = 'telephone';
const WRITE_SECONDS = 45;
const DRAW_SECONDS = 90;
const GUESS_SECONDS = 40;
const MAX_TEXT_LEN = 100;
const MAX_IMG_LEN = 400000; // un dessin compressé fait en général 20 à 60 Ko
const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

// Étape 0 : on écrit. Puis on alterne dessin / devinette.
const kindOf = (step) => (step === 0 ? 'write' : step % 2 === 1 ? 'draw' : 'guess');
const secondsOf = (kind) => (kind === 'write' ? WRITE_SECONDS : kind === 'draw' ? DRAW_SECONDS : GUESS_SECONDS);
const randomPrompt = () => PROMPTS[Math.floor(Math.random() * PROMPTS.length)];

const isConnected = (room, pid) => {
  const p = room.players.get(pid);
  return !!p && p.connected;
};

// À l'étape s, le joueur n°j de l'ordre travaille sur le carnet n°(j - s) :
// chaque carnet passe par tout le monde, et personne ne retombe sur le sien.
function albumIndexOf(g, pid) {
  const j = g.order.indexOf(pid);
  if (j < 0) return -1;
  const n = g.order.length;
  return (((j - g.step) % n) + n) % n;
}
const assignee = (g, k) => g.order[(k + g.step) % g.order.length];

// Dernière phrase (ou dernier dessin) valable du carnet, en sautant les tours ratés
function lastText(album) {
  const e = album.entries.filter((x) => !x.skipped && x.kind !== 'draw').pop();
  return e ? e.text : '';
}
function lastImg(album) {
  const e = album.entries.filter((x) => !x.skipped && x.kind === 'draw').pop();
  return e ? e.img : null;
}

function start(room) {
  room.g = {
    phase: 'play', // play | reveal | end
    round: 0,
    order: [],
    albums: [], // { owner, entries: [{ by, kind, text | img, skipped, auto }] }
    step: 0,
    stepStart: 0,
    revealAlbum: 0,
    revealStep: 0,
    revealPaused: false,
  };
  startRound(room);
}

function startRound(room) {
  const g = room.g;
  g.round += 1;
  g.order = shuffle(connectedPlayers(room).map((p) => p.id));
  g.albums = g.order.map((owner) => ({ owner, entries: [] }));
  g.step = 0;
  g.stepStart = Date.now();
  g.revealAlbum = 0;
  g.revealStep = 0;
  g.revealPaused = false;
  g.phase = 'play';
}

// Passe à l'étape suivante ; ceux qui n'ont rien envoyé sont sautés
function advance(room) {
  const g = room.g;
  const kind = kindOf(g.step);
  g.albums.forEach((album, k) => {
    if (album.entries[g.step] !== undefined) return;
    const by = assignee(g, k);
    album.entries[g.step] =
      kind === 'write' ? { by, kind, text: randomPrompt(), auto: true } : { by, kind, skipped: true };
  });
  g.step += 1;
  if (g.step >= g.order.length) g.phase = 'reveal';
  else g.stepStart = Date.now();
}

function progress(room) {
  const g = room.g;
  if (g.phase !== 'play') return;
  const live = g.order.filter((pid) => isConnected(room, pid));
  if (live.length && live.every((pid) => g.albums[albumIndexOf(g, pid)].entries[g.step] !== undefined)) {
    advance(room);
  }
}

// Vue envoyée à un joueur : pendant la partie, il ne voit que l'étape juste avant la sienne
function view(room, pid) {
  const g = room.g;
  const v = { phase: g.phase, round: g.round, players: g.order };

  if (g.phase === 'play') {
    const kind = kindOf(g.step);
    v.step = g.step;
    v.totalSteps = g.order.length;
    v.kind = kind;
    v.seconds = secondsOf(kind);
    v.remaining = Math.max(0, g.stepStart + v.seconds * 1000 - Date.now());
    v.done = g.order.filter((p) => g.albums[albumIndexOf(g, p)].entries[g.step] !== undefined);
    v.isParticipant = g.order.includes(pid);
    if (v.isParticipant) {
      const album = g.albums[albumIndexOf(g, pid)];
      v.submitted = album.entries[g.step] !== undefined;
      if (kind === 'draw') v.prompt = lastText(album);
      if (kind === 'guess') v.image = lastImg(album);
    }
  }

  if (g.phase === 'reveal') {
    const album = g.albums[g.revealAlbum];
    v.albumIndex = g.revealAlbum;
    v.albumCount = g.albums.length;
    v.owner = album.owner;
    v.entries = album.entries.slice(0, g.revealStep + 1);
    v.entryCount = album.entries.length;
    v.paused = g.revealPaused;
  }
  return v;
}

function act(room, player, data) {
  const g = room.g;
  const pid = player.id;
  const isHost = pid === room.hostId;

  switch (data.type) {
    case 'submit': {
      if (g.phase !== 'play' || !g.order.includes(pid)) return { ok: false };
      const album = g.albums[albumIndexOf(g, pid)];
      if (album.entries[g.step] !== undefined) return { ok: false };
      const kind = kindOf(g.step);

      if (kind === 'draw') {
        const img = String(data.img || '');
        if (img.length > MAX_IMG_LEN || !IMG_RE.test(img)) {
          return { ok: false, error: "Le dessin n'a pas pu être envoyé." };
        }
        album.entries[g.step] = { by: pid, kind, img };
      } else {
        const text = String(data.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LEN);
        if (text) album.entries[g.step] = { by: pid, kind, text };
        else if (!data.auto) return { ok: false, error: 'Écris quelque chose !' };
        // Temps écoulé sans rien écrire
        else if (kind === 'write') album.entries[g.step] = { by: pid, kind, text: randomPrompt(), auto: true };
        else album.entries[g.step] = { by: pid, kind, skipped: true };
      }
      progress(room);
      return { ok: true };
    }

    // Une phrase au hasard pour ceux qui manquent d'inspiration
    case 'idea': {
      if (g.phase !== 'play' || kindOf(g.step) !== 'write') return { ok: false };
      return { ok: true, text: randomPrompt() };
    }

    // L'hôte passe à l'étape suivante sans attendre les retardataires
    case 'force': {
      if (!isHost || g.phase !== 'play') return { ok: false };
      advance(room);
      return { ok: true };
    }

    // L'hôte dévoile le carnet étape par étape (son écran avance tout seul, ou il clique).
    // « at » = la page qu'il voyait : évite de sauter deux pages si le clic et le défilement auto se croisent.
    case 'next': {
      if (!isHost || g.phase !== 'reveal') return { ok: false };
      if (data.at !== undefined && data.at !== g.revealAlbum + ':' + g.revealStep) return { ok: false };
      const album = g.albums[g.revealAlbum];
      if (g.revealStep + 1 < album.entries.length) g.revealStep += 1;
      else if (g.revealAlbum + 1 < g.albums.length) {
        g.revealAlbum += 1;
        g.revealStep = 0;
      } else g.phase = 'end';
      return { ok: true };
    }

    case 'pause': {
      if (!isHost || g.phase !== 'reveal') return { ok: false };
      g.revealPaused = !g.revealPaused;
      return { ok: true };
    }

    case 'again': {
      if (!isHost || g.phase !== 'end') return { ok: false };
      if (connectedPlayers(room).length < module.exports.minPlayers) {
        return { ok: false, error: `Il faut au moins ${module.exports.minPlayers} joueurs.` };
      }
      startRound(room);
      return { ok: true };
    }
  }
  return { ok: false };
}

module.exports = {
  id,
  name: 'Le Téléphone Dessiné',
  emoji: '🎨',
  tagline: 'Écris, dessine, devine… et regarde ta phrase partir en vrille.',
  minPlayers: 3,
  rounds: false, // pas de « nombre de manches » : on rejoue à la fin si on veut
  start,
  view,
  act,
  progress,
};
