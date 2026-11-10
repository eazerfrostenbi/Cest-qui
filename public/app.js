// Eazerfrost Games : cœur de l'interface (accueil, salon, connexion).
// Chaque jeu s'enregistre ensuite via EG.register(id, { render, actions, onInput, onKeydown }).
(() => {
  'use strict';

  const MAX_PLAYERS = 12;

  // Mode test : ouvre /?test=1 dans plusieurs onglets, chaque onglet devient un joueur distinct.
  const perTab = /[?&]test=1(&|$)/.test(location.search);

  const socket = io();
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');

  // ---------------------------------------------------------------------------
  // Stockage (protégé : certains navigateurs le bloquent en navigation privée)
  // ---------------------------------------------------------------------------
  const store = {
    area() {
      try {
        return perTab ? window.sessionStorage : window.localStorage;
      } catch (_) {
        return null;
      }
    },
    get(k) {
      try {
        const a = this.area();
        return a ? a.getItem(k) : null;
      } catch (_) {
        return null;
      }
    },
    set(k, v) {
      try {
        const a = this.area();
        if (a) a.setItem(k, v);
      } catch (_) {}
    },
    del(k) {
      try {
        const a = this.area();
        if (a) a.removeItem(k);
      } catch (_) {}
    },
  };

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  let playerId = store.get('cq_pid');
  if (!playerId) {
    playerId = uid();
    store.set('cq_pid', playerId);
  }

  // ---------------------------------------------------------------------------
  // État local
  // ---------------------------------------------------------------------------
  let state = null; // dernière vue envoyée par le serveur
  let homeName = store.get('cq_name') || '';
  let homeCode = '';
  let homeError = '';
  let rounds = 3;
  let lastViewKey = '';
  let toastTimer = null;
  let pending = false;

  try {
    const urlCode = new URLSearchParams(location.search).get('code');
    if (urlCode) {
      homeCode = urlCode.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      // Un lien d'invitation prime sur l'ancien salon mémorisé
      if (store.get('cq_code') !== homeCode) store.del('cq_code');
    }
  } catch (_) {}

  // ---------------------------------------------------------------------------
  // Utilitaires partagés avec les jeux
  // ---------------------------------------------------------------------------
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 20);

  const playerById = (id) => (state ? state.players.find((p) => p.id === id) : null);
  const nameOf = (id) => {
    const p = playerById(id);
    return p ? p.name : '???';
  };
  const amHost = () => !!state && state.hostId === state.me;

  function hue(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }

  function avatar(id, name, extra) {
    const initial = (Array.from(String(name).trim())[0] || '?').toUpperCase();
    return `<span class="avatar${extra ? ' ' + extra : ''}" style="--h:${hue(id)}">${esc(initial)}</span>`;
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => toast('Lien copié !'))
        .catch(() => toast(text));
    } else {
      toast(text);
    }
  }

  function ranked() {
    const sorted = [...state.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    let rank = 0;
    let prev = null;
    return sorted.map((p, i) => {
      if (p.score !== prev) {
        rank = i + 1;
        prev = p.score;
      }
      return { ...p, rank };
    });
  }

  function mount(html, viewKey) {
    const ae = document.activeElement;
    const keep = ae && ae.id && app.contains(ae) ? { id: ae.id, s: ae.selectionStart, e: ae.selectionEnd } : null;
    app.innerHTML = html;
    if (keep) {
      const node = document.getElementById(keep.id);
      if (node) {
        node.focus();
        try {
          node.setSelectionRange(keep.s, keep.e);
        } catch (_) {}
      }
    }
    if (viewKey !== lastViewKey) {
      lastViewKey = viewKey;
      window.scrollTo(0, 0);
    }
  }

  function topbar() {
    const stop =
      state.phase === 'playing' && amHost() ? '<button class="link" data-action="stop">Arrêter</button>' : '';
    return `<header class="top">
      <span class="brand">Eazerfrost Games</span>
      <span class="badge">${esc(state.code)}</span>
      <div class="actions">${stop}<button class="link" data-action="leave">Quitter</button></div>
    </header>`;
  }

  // Écran de classement, commun à tous les jeux.
  // opts : { final, roundTag, note, next: { action, label } }
  function scoresScreen(opts) {
    const host = amHost();
    const list = ranked();
    const medals = ['🥇', '🥈', '🥉'];
    const rows = list
      .map(
        (p) => `<li class="${p.rank === 1 ? 'first' : ''}">
          <span class="rank">${p.rank <= 3 ? medals[p.rank - 1] : p.rank}</span>
          ${avatar(p.id, p.name)}
          <span class="pname">${esc(p.name)}${p.id === state.me ? ' <em>(toi)</em>' : ''}</span>
          <span class="pts">${p.score} pt${p.score > 1 ? 's' : ''}</span>
        </li>`
      )
      .join('');
    const winners = list.filter((p) => p.rank === 1).map((p) => p.name);
    const hostName = nameOf(state.hostId);

    let footer;
    if (host) {
      footer = opts.final
        ? '<button class="btn primary big" data-action="toLobby">Rejouer / changer de jeu</button>'
        : `<button class="btn primary big" data-action="${esc(opts.next.action)}">${esc(opts.next.label)}</button>`;
    } else {
      footer = `<p class="waiting">En attente de ${esc(hostName)}…</p>`;
    }

    mount(
      `<section class="screen scores">
        ${topbar()}
        ${
          opts.final
            ? `<h2 class="final-title">Partie terminée !</h2>
               <p class="winner">${winners.length > 1 ? 'Égalité : ' : '👑 '}${esc(winners.join(' & '))}</p>`
            : `<div class="roundtag">${esc(opts.roundTag || '')}</div>`
        }
        ${opts.note ? `<p class="notice">${esc(opts.note)}</p>` : ''}
        <div class="card"><ul class="board">${rows}</ul></div>
        ${footer}
      </section>`,
      'scores:' + (opts.final ? 'final' : opts.roundTag)
    );
  }

  // Envoie une action de jeu au serveur
  function act(data, cb) {
    socket.emit('act', data, (res) => {
      if (res && !res.ok && res.error) toast(res.error);
      if (typeof cb === 'function') cb(res);
    });
  }

  const games = {};
  window.EG = {
    games,
    register(id, impl) {
      games[id] = impl;
    },
    s: () => state,
    esc,
    avatar,
    hue,
    nameOf,
    playerById,
    amHost,
    ranked,
    topbar,
    mount,
    toast,
    act,
    scoresScreen,
  };

  // ---------------------------------------------------------------------------
  // Écrans : accueil et salon
  // ---------------------------------------------------------------------------
  function renderHome() {
    mount(
      `<section class="screen home">
        <div class="hero">
          <h1 class="logo">Eazerfrost <span>Games</span></h1>
          <p class="tagline">Des jeux entre potes.<br>Chacun sur son téléphone, où que vous soyez.</p>
        </div>
        <div class="card">
          <label class="field">
            <span>Ton pseudo</span>
            <input id="name" type="text" maxlength="20" autocomplete="off" autocapitalize="words" placeholder="Ex : Léa" value="${esc(homeName)}">
          </label>
          <button class="btn primary big" data-action="create">Créer un salon</button>
          <div class="sep"><span>ou rejoins tes potes</span></div>
          <label class="field">
            <span>Code du salon</span>
            <input id="code" class="code-input" type="text" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" value="${esc(homeCode)}">
          </label>
          <button class="btn" data-action="join">Rejoindre</button>
          ${homeError ? `<p class="error">${esc(homeError)}</p>` : ''}
        </div>
        <p class="hint">3 à ${MAX_PLAYERS} joueurs · le jeu se choisit dans le salon</p>
      </section>`,
      'home'
    );
  }

  function playerRow(p) {
    return `<li class="${p.connected ? '' : 'off'}">
      ${avatar(p.id, p.name)}
      <span class="pname">${esc(p.name)}${p.id === state.me ? ' <em>(toi)</em>' : ''}</span>
      ${p.isHost ? '<span class="tag">hôte</span>' : ''}
      ${p.connected ? '' : '<span class="tag off">hors ligne</span>'}
    </li>`;
  }

  function renderLobby() {
    const modes = state.modes || [];
    const cur = modes.find((m) => m.id === state.mode) || modes[0] || { minPlayers: 3, name: '' };
    const online = state.players.filter((p) => p.connected).length;
    const host = amHost();
    const hostName = nameOf(state.hostId);

    const modeCards = modes
      .map(
        (m) => `<button class="mode${m.id === state.mode ? ' active' : ''}" data-action="mode" data-mode="${esc(m.id)}" ${host ? '' : 'disabled'}>
          <span class="mi">${m.emoji}</span>
          <span class="mt"><b>${esc(m.name)}</b><small>${esc(m.tagline)}</small></span>
        </button>`
      )
      .join('');

    mount(
      `<section class="screen lobby">
        ${topbar()}
        <div class="card center">
          <p class="label">Code du salon</p>
          <div class="roomcode">${esc(state.code)}</div>
          <button class="btn small" data-action="share">Inviter des potes</button>
        </div>
        <div class="card">
          <h2>Joueurs <small>${state.players.length}/${MAX_PLAYERS}</small></h2>
          <ul class="players">${state.players.map(playerRow).join('')}</ul>
        </div>
        <div class="card">
          <h2>Le jeu <small>${host ? 'à toi de choisir' : 'choisi par ' + esc(hostName)}</small></h2>
          <div class="modes">${modeCards}</div>
        </div>
        ${
          host
            ? `<div class="card">
                ${
                  cur.rounds === false
                    ? ''
                    : `<div class="rounds">
                  <span>Nombre de manches</span>
                  <div class="stepper">
                    <button data-action="rounds-" aria-label="Moins">−</button>
                    <b>${rounds}</b>
                    <button data-action="rounds+" aria-label="Plus">+</button>
                  </div>
                </div>`
                }
                <button class="btn primary big" data-action="start" ${online < cur.minPlayers ? 'disabled' : ''}>Lancer la partie</button>
                ${online < cur.minPlayers ? `<p class="hint">Il faut au moins ${cur.minPlayers} joueurs (${online}/${cur.minPlayers})</p>` : ''}
              </div>`
            : `<p class="waiting">En attente que ${esc(hostName)} lance la partie…</p>`
        }
      </section>`,
      'lobby'
    );
  }

  function render() {
    if (!state) return renderHome();
    if (state.phase === 'lobby') return renderLobby();
    const game = games[state.mode];
    if (game && state.g) return game.render(state);
    return renderHome();
  }

  // ---------------------------------------------------------------------------
  // Connexion
  // ---------------------------------------------------------------------------
  socket.on('connect', () => {
    const code = store.get('cq_code');
    if (!code) return;
    socket.emit('join', { code, name: homeName, playerId }, (res) => {
      if (!res || !res.ok) {
        store.del('cq_code');
        state = null;
        homeError = res && res.error ? res.error : '';
        render();
      }
    });
  });

  socket.on('disconnect', () => {
    toast('Connexion perdue… on tente de te reconnecter');
  });

  socket.on('state', (s) => {
    state = s;
    store.set('cq_code', s.code);
    render();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !socket.connected) socket.connect();
  });

  // ---------------------------------------------------------------------------
  // Actions du salon
  // ---------------------------------------------------------------------------
  function failHome(msg) {
    homeError = msg;
    pending = false;
    renderHome();
  }

  function doCreate() {
    const name = cleanName(homeName);
    if (!name) return failHome('Choisis un pseudo.');
    if (pending) return;
    pending = true;
    homeName = name;
    store.set('cq_name', name);
    socket.emit('create', { name, playerId }, (res) => {
      pending = false;
      if (!res || !res.ok) return failHome((res && res.error) || 'Impossible de créer le salon.');
      homeError = '';
      store.set('cq_code', res.code);
    });
  }

  function doJoin() {
    const name = cleanName(homeName);
    if (!name) return failHome('Choisis un pseudo.');
    if (homeCode.length !== 4) return failHome('Entre le code à 4 lettres.');
    if (pending) return;
    pending = true;
    homeName = name;
    store.set('cq_name', name);
    socket.emit('join', { code: homeCode, name, playerId }, (res) => {
      pending = false;
      if (!res || !res.ok) return failHome((res && res.error) || 'Impossible de rejoindre.');
      homeError = '';
      store.set('cq_code', res.code);
    });
  }

  const core = {
    create: doCreate,
    join: doJoin,

    share() {
      const url = location.origin + '/?code=' + state.code;
      if (navigator.share) {
        navigator
          .share({ title: 'Eazerfrost Games', text: `Rejoins mon salon ${state.code} !`, url })
          .catch(() => {});
      } else {
        copyText(url);
      }
    },

    'rounds-'() {
      rounds = Math.max(1, rounds - 1);
      renderLobby();
    },
    'rounds+'() {
      rounds = Math.min(10, rounds + 1);
      renderLobby();
    },

    mode(btn) {
      socket.emit('setMode', { mode: btn.dataset.mode });
    },

    start() {
      socket.emit('start', { rounds }, (res) => {
        if (res && !res.ok) toast(res.error);
      });
    },

    toLobby() {
      socket.emit('toLobby');
    },

    stop() {
      if (window.confirm('Arrêter la partie et retourner au salon ?')) socket.emit('toLobby');
    },

    leave() {
      if (!window.confirm('Quitter le salon ?')) return;
      socket.emit('leave');
      store.del('cq_code');
      state = null;
      homeCode = '';
      homeError = '';
      render();
    },
  };

  const currentGame = () => (state && state.phase === 'playing' ? games[state.mode] : null);

  app.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const name = btn.dataset.action;
    if (Object.prototype.hasOwnProperty.call(core, name)) return core[name](btn);
    const game = currentGame();
    if (game && game.actions && game.actions[name]) game.actions[name](btn);
  });

  app.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'name') {
      homeName = t.value;
    } else if (t.id === 'code') {
      const v = t.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      if (v !== t.value) t.value = v;
      homeCode = v;
    } else {
      const game = currentGame();
      if (game && game.onInput) game.onInput(t);
    }
  });

  app.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'code') {
      e.preventDefault();
      doJoin();
    } else if (e.target.id === 'name') {
      e.preventDefault();
      if (homeCode.length === 4) doJoin();
      else doCreate();
    } else {
      const game = currentGame();
      if (game && game.onKeydown) game.onKeydown(e);
    }
  });

  render();
})();
