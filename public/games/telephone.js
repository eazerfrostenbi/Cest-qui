// Jeu « Le Téléphone Dessiné » (interface)
(() => {
  'use strict';
  const EG = window.EG;
  const { esc, avatar, nameOf, amHost, topbar, mount, act } = EG;

  const MAX_CHARS = 100;
  const W = 560; // taille du dessin en pixels (affiché à la largeur de l'écran)
  const H = 420;
  const COLORS = ['#1a1238', '#ff4f5e', '#ff9f1c', '#ffd23f', '#37d99a', '#2ec4f1', '#4361ee', '#9b5de5', '#ff6ab0', '#8d5524', '#9e9e9e'];
  const SIZES = [4, 10, 22];

  const svg = (d) =>
    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICON_EXPAND = svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>');
  const ICON_SHRINK = svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>');
  const ICON_PIPETTE = svg(
    '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>'
  );

  // État de l'étape en cours (remis à zéro à chaque nouvelle étape)
  let stepKey = '';
  let draft = '';
  let deadline = 0;
  let sending = false;
  let autoSent = false;

  // Le dessin : le <canvas> est gardé entre deux rafraîchissements de l'écran
  let canvas = null;
  let ctx = null;
  let strokes = [];
  let current = null;
  let color = COLORS[0];
  let size = SIZES[1];
  let eraser = false;
  let custom = '#ff7f50'; // couleur choisie avec le sélecteur ou la pipette
  let picking = false; // pipette active : le prochain appui sur le dessin prend sa couleur
  let full = false; // dessin en plein écran

  // Révélation : l'écran de l'hôte fait défiler les pages tout seul
  const TEXT_DELAY = 3500;
  const DRAW_DELAY = 5500;
  let revealSeen = '';
  let autoTimer = null;
  let autoKey = '';

  function clearAuto() {
    clearTimeout(autoTimer);
    autoTimer = null;
    autoKey = '';
  }

  function scheduleAuto(key, at, delay) {
    if (autoKey === key) return;
    clearAuto();
    autoKey = key;
    autoTimer = setTimeout(() => {
      autoTimer = null;
      act({ type: 'next', at });
    }, delay);
  }

  function resetStep(key, g) {
    stepKey = key;
    draft = '';
    deadline = Date.now() + g.remaining;
    sending = false;
    autoSent = false;
    canvas = null;
    strokes = [];
    current = null;
    picking = false;
    if (full) setFull(false);
  }

  function rerender() {
    const st = EG.s();
    if (st && st.g && st.g.phase === 'play') renderPlay(st);
  }

  // Plein écran : la zone de dessin recouvre la page. Quand le navigateur le permet
  // (ordinateur, Android), on masque aussi ses barres ; sur iPhone, seule la page s'adapte.
  function setFull(on) {
    full = on;
    try {
      const de = document.documentElement;
      if (on && de.requestFullscreen && !document.fullscreenElement) de.requestFullscreen().catch(() => {});
      if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    } catch (_) {}
  }

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && full) {
      full = false;
      rerender();
    }
  });

  // ---------------------------------------------------------------------------
  // Dessin
  // ---------------------------------------------------------------------------
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return null;
    return {
      x: Math.round(((e.clientX - r.left) * W) / r.width),
      y: Math.round(((e.clientY - r.top) * H) / r.height),
    };
  }

  function drawStroke(s) {
    ctx.strokeStyle = ctx.fillStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.lineCap = ctx.lineJoin = 'round';
    const [first, ...rest] = s.pts;
    ctx.beginPath();
    if (!rest.length) {
      ctx.arc(first.x, first.y, s.size / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.moveTo(first.x, first.y);
    for (const p of rest) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function redraw() {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    strokes.forEach(drawStroke);
  }

  function makeCanvas() {
    canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.className = 'pad';
    ctx = canvas.getContext('2d');
    redraw();
    canvas.addEventListener('pointerdown', (e) => {
      if (current) return; // un seul doigt à la fois
      e.preventDefault();
      const p = pos(e);
      if (!p) return;
      if (picking) {
        const [r, g, b] = ctx.getImageData(Math.min(W - 1, p.x), Math.min(H - 1, p.y), 1, 1).data;
        color = custom = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
        picking = false;
        eraser = false;
        updateTools();
        return;
      }
      current = { id: e.pointerId, color: eraser ? '#fff' : color, size: eraser ? SIZES[2] : size, pts: [p] };
      strokes.push(current);
      drawStroke(current);
    });
  }

  window.addEventListener('pointermove', (e) => {
    if (!current || !canvas || e.pointerId !== current.id) return;
    const last = current.pts[current.pts.length - 1];
    const p = pos(e);
    if (!p) return;
    current.pts.push(p);
    ctx.strokeStyle = current.color;
    ctx.lineWidth = current.size;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });

  const endStroke = (e) => {
    if (current && e.pointerId === current.id) current = null;
  };
  window.addEventListener('pointerup', endStroke);
  window.addEventListener('pointercancel', endStroke);

  const isCustom = () => !eraser && !COLORS.includes(color);

  function updateTools() {
    document.querySelectorAll('.swatch[data-c]').forEach((b) => b.classList.toggle('on', !eraser && b.dataset.c === color));
    document.querySelectorAll('.sizebtn').forEach((b) => b.classList.toggle('on', !eraser && +b.dataset.s === size));
    const er = document.querySelector('[data-action="eraser"]');
    if (er) er.classList.toggle('on', eraser);
    const pip = document.querySelector('[data-action="pipette"]');
    if (pip) pip.classList.toggle('on', picking);
    const pk = document.getElementById('picker');
    if (pk) {
      pk.value = custom;
      pk.parentNode.style.setProperty('--c', custom);
      pk.parentNode.classList.toggle('on', isCustom());
    }
    if (canvas) canvas.classList.toggle('picking', picking);
  }

  // ---------------------------------------------------------------------------
  // Minuteur : à zéro, on envoie automatiquement ce qu'on a
  // ---------------------------------------------------------------------------
  const fmt = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const secondsLeft = () => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

  setInterval(() => {
    const st = EG.s();
    if (!st || st.phase !== 'playing' || st.mode !== 'telephone' || !st.g || st.g.phase !== 'play') return;
    const left = secondsLeft();
    document.querySelectorAll('.timer').forEach((el) => {
      el.textContent = fmt(left);
      el.classList.toggle('hurry', left <= 10);
    });
    if (left === 0 && st.g.isParticipant && !st.g.submitted && !autoSent) {
      autoSent = true;
      submit(true);
    }
  }, 250);

  function submit(auto) {
    const g = EG.s().g;
    if (sending || g.submitted) return;
    let data;
    if (g.kind === 'draw') {
      if (!canvas) return;
      if (!strokes.length && !auto) return EG.toast('Dessine quelque chose !');
      data = { type: 'submit', img: canvas.toDataURL('image/jpeg', 0.7) };
    } else {
      const node = document.getElementById('draft');
      const text = (node ? node.value : draft).trim();
      if (!text && !auto) return EG.toast('Écris quelque chose !');
      data = { type: 'submit', text, auto: !!auto };
    }
    sending = true;
    act(data, (res) => {
      sending = false;
      if (res && res.ok && full) setFull(false);
    });
  }

  // ---------------------------------------------------------------------------
  // Écrans
  // ---------------------------------------------------------------------------
  function renderPlay(st) {
    const g = st.g;
    const key = g.round + ':' + g.step;
    if (key !== stepKey) resetStep(key, g);

    const done = new Set(g.done);
    const online = g.players.filter((id) => {
      const p = EG.playerById(id);
      return p && p.connected;
    });
    const allDone = online.every((id) => done.has(id));
    const chips = g.players
      .map((id) => {
        const ok = done.has(id);
        return `<li class="${ok ? 'done' : ''}">${avatar(id, nameOf(id))}${esc(nameOf(id))} ${ok ? '✓' : '…'}</li>`;
      })
      .join('');

    const titles = { write: '✍️ Écris une phrase', draw: '🎨 Dessine', guess: '🤔 Devine' };
    let body;
    if (!g.isParticipant) {
      body = '<p class="notice">Les autres jouent…</p>';
    } else if (g.submitted) {
      body = '<p class="notice strong">✅ Envoyé ! On attend les autres…</p>';
    } else if (g.kind === 'write') {
      body = `<div class="card prompt">
          <p>Écris une phrase à faire dessiner au suivant</p>
          <p class="hint left">Plus c'est absurde, plus c'est drôle.</p>
        </div>
        <div class="card">
          <textarea id="draft" maxlength="${MAX_CHARS}" rows="3" placeholder="Ex : un chat qui fait du ski">${esc(draft)}</textarea>
          <div class="row">
            <button class="btn small" data-action="idea">🎲 Une idée</button>
            <span class="count" id="count">${draft.length}/${MAX_CHARS}</span>
          </div>
          <button class="btn primary big" data-action="send">Envoyer</button>
        </div>`;
    } else if (g.kind === 'draw') {
      const swatches = COLORS.map(
        (c) => `<button class="swatch${!eraser && c === color ? ' on' : ''}" style="--c:${c}" data-action="color" data-c="${c}" aria-label="Couleur"></button>`
      ).join('');
      const sizes = SIZES.map(
        (s) => `<button class="toolbtn sizebtn${!eraser && s === size ? ' on' : ''}" data-action="size" data-s="${s}" aria-label="Taille ${s}"><i style="--s:${Math.max(4, s * 0.8)}px"></i></button>`
      ).join('');
      body = `<div class="drawzone${full ? ' full' : ''}">
        <div class="card prompt dz-prompt">
          <div><p class="label">À dessiner</p><p>${esc(g.prompt || '…')}</p></div>
          <div class="timer dz-timer">${fmt(secondsLeft())}</div>
        </div>
        <div id="padSlot" class="padslot">
          <button class="fsbtn" data-action="fullscreen" aria-label="${full ? 'Quitter le plein écran' : 'Plein écran'}">${full ? ICON_SHRINK : ICON_EXPAND}</button>
        </div>
        <div class="tools">
          <div class="swatches">
            ${swatches}
            <label class="swatch picker${isCustom() ? ' on' : ''}" style="--c:${custom}" aria-label="Couleur au choix">
              <input type="color" id="picker" value="${custom}">
            </label>
          </div>
          <div class="toolrow">
            ${sizes}
            <button class="toolbtn${picking ? ' on' : ''}" data-action="pipette" aria-label="Pipette">${ICON_PIPETTE}</button>
            <button class="toolbtn${eraser ? ' on' : ''}" data-action="eraser" aria-label="Gomme">🧽</button>
            <button class="toolbtn" data-action="undo" aria-label="Annuler">↩️</button>
            <button class="toolbtn" data-action="clear" aria-label="Tout effacer">🗑️</button>
          </div>
        </div>
        <button class="btn primary big" data-action="send">J'ai fini !</button>
      </div>`;
    } else {
      body = `${
        g.image
          ? `<img class="drawing" src="${esc(g.image)}" alt="Dessin à deviner">`
          : '<p class="notice strong">Pas de dessin cette fois… invente une phrase !</p>'
      }
        <div class="card">
          <p class="question">C'est quoi, ce dessin ?</p>
          <textarea id="draft" maxlength="${MAX_CHARS}" rows="2" placeholder="Décris ce que tu vois">${esc(draft)}</textarea>
          <button class="btn primary big" data-action="send">Envoyer</button>
        </div>`;
    }

    mount(
      `<section class="screen tp-play">
        ${topbar()}
        <div class="tp-head">
          <div class="roundtag">${titles[g.kind]} · ${g.step + 1}/${g.totalSteps}</div>
          <div class="timer${secondsLeft() <= 10 ? ' hurry' : ''}" id="timer">${fmt(secondsLeft())}</div>
        </div>
        ${body}
        <div class="card">
          <p class="label">${done.size}/${g.players.length} ont fini</p>
          <ul class="chips">${chips}</ul>
        </div>
        ${
          amHost() && !allDone
            ? '<button class="btn ghost" data-action="force">Passer sans attendre les retardataires</button>'
            : ''
        }
      </section>`,
      'tp-play:' + key + ':' + !!g.submitted
    );

    const slot = document.getElementById('padSlot');
    if (slot) {
      if (!canvas) makeCanvas();
      canvas.classList.toggle('picking', picking);
      slot.appendChild(canvas);
    }
  }

  function entryHtml(e, i, isNew) {
    const verb = i === 0 ? 'phrase de départ' : { write: 'a écrit', draw: 'a dessiné', guess: 'a deviné' }[e.kind];
    let body;
    if (e.skipped) body = '<p class="anec muted">😴 Rien envoyé à temps</p>';
    else if (e.kind === 'draw') body = `<img class="drawing" src="${esc(e.img)}" alt="Dessin de ${esc(nameOf(e.by))}">`;
    else body = `<p class="anec">${esc(e.text)}</p>`;
    return `<li class="entry ${e.kind}${i === 0 ? ' first' : ''}${isNew ? ' new' : ''}">
      <div class="by">${avatar(e.by, nameOf(e.by))}<span class="pname">${esc(nameOf(e.by))}</span><small>${verb}${e.auto ? ' (au hasard)' : ''}</small></div>
      ${body}
    </li>`;
  }

  // Fin du carnet : la phrase de départ face à la dernière phrase devinée
  function summaryHtml(entries) {
    const texts = entries.filter((e) => !e.skipped && e.kind !== 'draw');
    if (texts.length < 2) return '';
    return `<div class="card center tp-summary">
      <p class="label">Le grand écart</p>
      <p class="anec">« ${esc(texts[0].text)} »</p>
      <p class="arrow">⬇️</p>
      <p class="anec">« ${esc(texts[texts.length - 1].text)} »</p>
    </div>`;
  }

  function renderReveal(st) {
    const g = st.g;
    const host = amHost();
    const lastEntry = g.entries.length >= g.entryCount;
    const lastAlbum = g.albumIndex + 1 >= g.albumCount;
    const at = g.albumIndex + ':' + (g.entries.length - 1);
    const seen = g.round + ':' + at;
    const isNew = seen !== revealSeen;

    let controls;
    if (host && !lastEntry) {
      controls = `<div class="tp-controls">
          <button class="btn" data-action="pause">${g.paused ? '▶ Reprendre' : '⏸ Pause'}</button>
          <button class="btn primary" data-action="next" data-at="${at}">Suivant ⏭</button>
        </div>`;
    } else if (host) {
      controls = `<button class="btn primary big" data-action="next" data-at="${at}">${lastAlbum ? 'Terminer' : 'Carnet suivant'}</button>`;
    } else if (lastEntry) {
      controls = `<p class="waiting">${esc(nameOf(st.hostId))} va ouvrir le carnet suivant…</p>`;
    } else {
      controls = g.paused ? '<p class="waiting">⏸ En pause</p>' : '';
    }

    mount(
      `<section class="screen tp-reveal">
        ${topbar()}
        <div class="roundtag">Carnet ${g.albumIndex + 1}/${g.albumCount} · page ${g.entries.length}/${g.entryCount}</div>
        <div class="author">
          ${avatar(g.owner, nameOf(g.owner), 'lg')}
          <div>
            <small>Le carnet de</small>
            <strong>${esc(nameOf(g.owner))}</strong>
          </div>
        </div>
        <ul class="album">${g.entries.map((e, i) => entryHtml(e, i, isNew && i === g.entries.length - 1)).join('')}</ul>
        ${lastEntry ? summaryHtml(g.entries) : ''}
        ${controls}
      </section>`,
      'tp-reveal:' + g.round + ':' + g.albumIndex
    );

    // Fait défiler jusqu'à la nouvelle page du carnet
    if (isNew) {
      revealSeen = seen;
      const target = lastEntry ? document.querySelector('.tp-summary') || document.querySelector('.album .entry:last-child') : document.querySelector('.album .entry:last-child');
      if (g.entries.length > 1 && target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Page suivante automatique (on laisse plus de temps pour regarder un dessin)
    if (host && !g.paused && !lastEntry) {
      const last = g.entries[g.entries.length - 1];
      scheduleAuto(seen, at, last.kind === 'draw' && !last.skipped ? DRAW_DELAY : TEXT_DELAY);
    } else clearAuto();
  }

  function renderEnd(st) {
    mount(
      `<section class="screen tp-end">
        ${topbar()}
        <h2 class="final-title">C'est fini ! 🎨</h2>
        <p class="notice">Tous les carnets ont été dévoilés. On en refait une ?</p>
        ${
          amHost()
            ? `<button class="btn primary big" data-action="again">Rejouer une manche</button>
               <button class="btn" data-action="toLobby">Changer de jeu</button>`
            : `<p class="waiting">En attente de ${esc(nameOf(st.hostId))}…</p>`
        }
      </section>`,
      'tp-end:' + st.g.round
    );
  }

  EG.register('telephone', {
    render(st) {
      if (st.g.phase !== 'reveal') clearAuto();
      switch (st.g.phase) {
        case 'play':
          return renderPlay(st);
        case 'reveal':
          return renderReveal(st);
        case 'end':
          return renderEnd(st);
      }
    },

    actions: {
      send() {
        submit(false);
      },
      idea() {
        act({ type: 'idea' }, (res) => {
          if (!res || !res.ok) return;
          draft = res.text;
          const node = document.getElementById('draft');
          if (node) node.value = draft;
          const c = document.getElementById('count');
          if (c) c.textContent = draft.length + '/' + MAX_CHARS;
        });
      },
      color(btn) {
        color = btn.dataset.c;
        eraser = false;
        picking = false;
        updateTools();
      },
      size(btn) {
        size = +btn.dataset.s;
        eraser = false;
        updateTools();
      },
      eraser() {
        eraser = !eraser;
        picking = false;
        updateTools();
      },
      pipette() {
        picking = !picking;
        if (picking) EG.toast('Touche le dessin pour prendre une couleur');
        updateTools();
      },
      fullscreen() {
        setFull(!full);
        rerender();
      },
      undo() {
        if (!canvas) return;
        strokes.pop();
        redraw();
      },
      clear() {
        if (!canvas || !strokes.length || !window.confirm('Tout effacer ?')) return;
        strokes = [];
        redraw();
      },
      force() {
        act({ type: 'force' });
      },
      next(btn) {
        clearAuto();
        act({ type: 'next', at: btn.dataset.at });
      },
      pause() {
        act({ type: 'pause' });
      },
      again() {
        act({ type: 'again' });
      },
    },

    onInput(t) {
      if (t.id === 'picker') {
        color = custom = t.value;
        eraser = false;
        picking = false;
        updateTools();
      } else if (t.id === 'draft') {
        draft = t.value;
        const c = document.getElementById('count');
        if (c) c.textContent = draft.length + '/' + MAX_CHARS;
      }
    },

    onKeydown(e) {
      if (e.target.id === 'draft' && !e.shiftKey) {
        e.preventDefault();
        submit(false);
      }
    },
  });
})();
