(() => {
  'use strict';

  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 12;
  const MAX_CHARS = 300;

  const socket = io();
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');

  // ---------------------------------------------------------------------------
  // Stockage (protégé : certains navigateurs le bloquent en navigation privée)
  // ---------------------------------------------------------------------------
  const store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch (_) {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (_) {}
    },
    del(k) {
      try {
        localStorage.removeItem(k);
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
  let draft = '';
  let lastRoundKey = '';
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
  // Utilitaires
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
    return `<header class="top">
      <span class="brand">C'est qui ?!</span>
      <span class="badge">${esc(state.code)}</span>
      <button class="link" data-action="leave">Quitter</button>
    </header>`;
  }

  // ---------------------------------------------------------------------------
  // Écrans
  // ---------------------------------------------------------------------------
  function renderHome() {
    mount(
      `<section class="screen home">
        <div class="hero">
          <h1 class="logo">C'est <span>qui</span> ?!</h1>
          <p class="tagline">Écris une anecdote anonyme.<br>Devine qui l'a vécue.</p>
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
        <p class="hint">${MIN_PLAYERS} à ${MAX_PLAYERS} joueurs · chacun sur son téléphone</p>
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
    const online = state.players.filter((p) => p.connected).length;
    const host = amHost();
    const hostName = nameOf(state.hostId);
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
        ${
          host
            ? `<div class="card">
                <div class="rounds">
                  <span>Nombre de manches</span>
                  <div class="stepper">
                    <button data-action="rounds-" aria-label="Moins">−</button>
                    <b>${rounds}</b>
                    <button data-action="rounds+" aria-label="Plus">+</button>
                  </div>
                </div>
                <button class="btn primary big" data-action="start" ${online < MIN_PLAYERS ? 'disabled' : ''}>Lancer la partie</button>
                ${online < MIN_PLAYERS ? `<p class="hint">Il faut au moins ${MIN_PLAYERS} joueurs (${online}/${MIN_PLAYERS})</p>` : ''}
              </div>`
            : `<p class="waiting">En attente que ${esc(hostName)} lance la partie…</p>`
        }
      </section>`,
      'lobby'
    );
  }

  function renderWriting() {
    const submitted = new Set(state.submitted);
    const mine = state.myAnswer !== null;
    const online = state.players.filter((p) => p.connected);
    const allDone = online.every((p) => submitted.has(p.id));
    const chips = state.players
      .filter((p) => p.connected)
      .map((p) => {
        const done = submitted.has(p.id);
        return `<li class="${done ? 'done' : ''}">${avatar(p.id, p.name)}${esc(p.name)} ${done ? '✓' : '…'}</li>`;
      })
      .join('');

    mount(
      `<section class="screen writing">
        ${topbar()}
        <div class="roundtag">Manche ${state.round}/${state.totalRounds}</div>
        <div class="card prompt"><p>${esc(state.prompt)}</p></div>
        ${
          mine
            ? `<div class="card quote">
                <p class="label">Ta réponse (envoyée)</p>
                <p class="anec">${esc(state.myAnswer)}</p>
              </div>`
            : `<div class="card">
                <textarea id="draft" maxlength="${MAX_CHARS}" rows="5" placeholder="Raconte… personne ne saura que c'est toi (pour l'instant)">${esc(draft)}</textarea>
                <div class="row">
                  <span class="count" id="count">${draft.length}/${MAX_CHARS}</span>
                  <button class="btn primary" data-action="submit">Envoyer</button>
                </div>
              </div>`
        }
        <div class="card">
          <p class="label">${submitted.size}/${online.length} ont répondu</p>
          <ul class="chips">${chips}</ul>
        </div>
        ${
          amHost() && state.canForce && !allDone
            ? '<button class="btn ghost" data-action="force">Passer sans attendre les retardataires</button>'
            : ''
        }
      </section>`,
      'writing:' + state.round
    );
  }

  function renderGuessing() {
    const host = amHost();
    const pct = state.needed ? Math.min(100, Math.round((state.guessedCount / state.needed) * 100)) : 100;
    const voted = state.myGuess !== null;
    const cands = state.candidates.filter((id) => id !== state.me);

    let body;
    if (state.isAuthor) {
      body = `<p class="notice strong">🤫 Cette anecdote, c'est la tienne.<br>Garde ton plus beau poker face !</p>`;
    } else {
      body = `<p class="question">${voted ? 'Ton choix est fait' : 'Qui a écrit ça ?'}</p>
        <div class="cands">
          ${cands
            .map(
              (id) => `<button class="cand ${state.myGuess === id ? 'picked' : ''}" data-action="guess" data-id="${esc(id)}" ${voted ? 'disabled' : ''}>
                ${avatar(id, nameOf(id))}<span class="n">${esc(nameOf(id))}</span>
              </button>`
            )
            .join('')}
        </div>`;
    }

    mount(
      `<section class="screen guessing">
        ${topbar()}
        <div class="roundtag">Manche ${state.round}/${state.totalRounds} · anecdote ${state.index + 1}/${state.total}</div>
        <div class="card quote">
          <p class="label">${esc(state.prompt)}</p>
          <p class="anec">${esc(state.text)}</p>
        </div>
        ${body}
        <div>
          <div class="progress"><i style="width:${pct}%"></i></div>
          <p class="hint" style="margin-top:8px">${Math.min(state.guessedCount, state.needed)}/${state.needed} ont voté</p>
        </div>
        ${
          host && state.guessedCount < state.needed
            ? '<button class="btn ghost" data-action="force">Révéler sans attendre</button>'
            : ''
        }
      </section>`,
      'guess:' + state.round + ':' + state.index
    );
  }

  function renderReveal() {
    const host = amHost();
    const authorName = nameOf(state.authorId);
    const isLast = state.index + 1 >= state.total;
    const rows = state.results
      .map(
        (r) => `<li class="${r.correct ? 'ok' : 'ko'}">
          ${avatar(r.guesserId, nameOf(r.guesserId))}
          <span><b>${esc(nameOf(r.guesserId))}</b> pensait à <b>${esc(nameOf(r.targetId))}</b></span>
          <span class="mark">${r.correct ? '+1 ✓' : '✗'}</span>
        </li>`
      )
      .join('');

    let verdict = '';
    if (!state.results.length) verdict = 'Personne n\'a eu le temps de voter.';
    else if (state.fooled > 0)
      verdict = `${esc(authorName)} a trompé ${state.fooled} personne${state.fooled > 1 ? 's' : ''} (+${state.fooled} pt${state.fooled > 1 ? 's' : ''}).`;
    else verdict = 'Tout le monde a trouvé, trop facile !';

    const board = ranked()
      .map(
        (p) => `<li>${avatar(p.id, p.name)}<span class="pname">${esc(p.name)}</span><span class="pts">${p.score}</span></li>`
      )
      .join('');

    mount(
      `<section class="screen reveal">
        ${topbar()}
        <div class="roundtag">Manche ${state.round}/${state.totalRounds} · anecdote ${state.index + 1}/${state.total}</div>
        <div class="card quote">
          <p class="label">${esc(state.prompt)}</p>
          <p class="anec">${esc(state.text)}</p>
        </div>
        <div class="author">
          ${avatar(state.authorId, authorName, 'lg')}
          <div>
            <small>${state.isAuthor ? 'C\'était toi !' : 'Écrit par'}</small>
            <strong>${esc(authorName)}</strong>
          </div>
        </div>
        <div class="card">
          <p class="notice">${verdict}</p>
          ${rows ? `<ul class="results">${rows}</ul>` : ''}
        </div>
        <div class="card">
          <p class="label">Scores</p>
          <ul class="board compact">${board}</ul>
        </div>
        ${
          host
            ? `<button class="btn primary big" data-action="next">${isLast ? 'Voir les scores' : 'Anecdote suivante'}</button>`
            : `<p class="waiting">${esc(nameOf(state.hostId))} lance la suite…</p>`
        }
      </section>`,
      'reveal:' + state.round + ':' + state.index
    );
  }

  function renderScores() {
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

    mount(
      `<section class="screen scores">
        ${topbar()}
        ${
          state.final
            ? `<h2 class="final-title">Partie terminée !</h2>
               <p class="winner">${winners.length > 1 ? 'Égalité : ' : '👑 '}${esc(winners.join(' & '))}</p>`
            : `<div class="roundtag">Fin de la manche ${state.round}/${state.totalRounds}</div>`
        }
        ${state.note ? `<p class="notice">${esc(state.note)}</p>` : ''}
        <div class="card"><ul class="board">${rows}</ul></div>
        ${
          host
            ? state.final
              ? '<button class="btn primary big" data-action="toLobby">Rejouer (retour au salon)</button>'
              : '<button class="btn primary big" data-action="nextRound">Manche suivante</button>'
            : `<p class="waiting">En attente de ${esc(nameOf(state.hostId))}…</p>`
        }
      </section>`,
      'scores:' + state.round
    );
  }

  function render() {
    if (!state) {
      lastRoundKey = '';
      return renderHome();
    }
    const key = state.phase + ':' + state.round;
    if (key !== lastRoundKey) {
      lastRoundKey = key;
      if (state.phase === 'writing') draft = '';
    }
    switch (state.phase) {
      case 'lobby':
        return renderLobby();
      case 'writing':
        return renderWriting();
      case 'guessing':
        return renderGuessing();
      case 'reveal':
        return renderReveal();
      case 'scores':
        return renderScores();
      default:
        return renderHome();
    }
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
  // Actions
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

  app.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;

    switch (btn.dataset.action) {
      case 'create':
        return doCreate();
      case 'join':
        return doJoin();

      case 'share': {
        const url = location.origin + '/?code=' + state.code;
        if (navigator.share) {
          navigator
            .share({ title: "C'est qui ?!", text: `Rejoins mon salon ${state.code} !`, url })
            .catch(() => {});
        } else {
          copyText(url);
        }
        return;
      }

      case 'rounds-':
        rounds = Math.max(1, rounds - 1);
        return renderLobby();
      case 'rounds+':
        rounds = Math.min(10, rounds + 1);
        return renderLobby();

      case 'start':
        return socket.emit('start', { rounds }, (res) => {
          if (res && !res.ok) toast(res.error);
        });

      case 'submit': {
        const node = document.getElementById('draft');
        const text = (node ? node.value : draft).trim();
        if (!text) return toast('Écris quelque chose !');
        return socket.emit('submit', { text });
      }

      case 'guess':
        return socket.emit('guess', { targetId: btn.dataset.id });

      case 'force':
      case 'next':
      case 'nextRound':
      case 'toLobby':
        return socket.emit(btn.dataset.action);

      case 'leave':
        if (!window.confirm('Quitter le salon ?')) return;
        socket.emit('leave');
        store.del('cq_code');
        state = null;
        homeCode = '';
        homeError = '';
        return render();
    }
  });

  app.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'name') {
      homeName = t.value;
    } else if (t.id === 'code') {
      const v = t.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      if (v !== t.value) t.value = v;
      homeCode = v;
    } else if (t.id === 'draft') {
      draft = t.value;
      const c = document.getElementById('count');
      if (c) c.textContent = draft.length + '/' + MAX_CHARS;
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
    }
  });

  render();
})();
