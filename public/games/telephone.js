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

  let revealSeen = '';

  function resetStep(key, g) {
    stepKey = key;
    draft = '';
    deadline = Date.now() + g.remaining;
    sending = false;
    autoSent = false;
    canvas = null;
    strokes = [];
    current = null;
  }

  // ---------------------------------------------------------------------------
  // Dessin
  // ---------------------------------------------------------------------------
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return current.pts[current.pts.length - 1];
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
      current = { id: e.pointerId, color: eraser ? '#fff' : color, size: eraser ? SIZES[2] : size, pts: [] };
      current.pts.push(pos(e));
      strokes.push(current);
      drawStroke(current);
    });
  }

  window.addEventListener('pointermove', (e) => {
    if (!current || !canvas || e.pointerId !== current.id) return;
    const last = current.pts[current.pts.length - 1];
    const p = pos(e);
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

  function updateTools() {
    document.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('on', !eraser && b.dataset.c === color));
    document.querySelectorAll('.sizebtn').forEach((b) => b.classList.toggle('on', !eraser && +b.dataset.s === size));
    const er = document.querySelector('[data-action="eraser"]');
    if (er) er.classList.toggle('on', eraser);
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
    const el = document.getElementById('timer');
    if (el) {
      el.textContent = fmt(left);
      el.classList.toggle('hurry', left <= 10);
    }
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
    act(data, () => {
      sending = false;
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
      body = `<div class="card prompt"><p class="label">À dessiner</p><p>${esc(g.prompt || '…')}</p></div>
        <div id="padSlot" class="padslot"></div>
        <div class="tools">
          <div class="swatches">${swatches}</div>
          <div class="toolrow">
            ${sizes}
            <button class="toolbtn${eraser ? ' on' : ''}" data-action="eraser" aria-label="Gomme">🧽</button>
            <button class="toolbtn" data-action="undo" aria-label="Annuler">↩️</button>
            <button class="toolbtn" data-action="clear" aria-label="Tout effacer">🗑️</button>
          </div>
        </div>
        <button class="btn primary big" data-action="send">J'ai fini !</button>`;
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
      slot.appendChild(canvas);
    }
  }

  function entryHtml(e) {
    const verb = { write: 'a écrit', draw: 'a dessiné', guess: 'a deviné' }[e.kind];
    let body;
    if (e.skipped) body = '<p class="anec muted">😴 Rien envoyé à temps</p>';
    else if (e.kind === 'draw') body = `<img class="drawing" src="${esc(e.img)}" alt="Dessin de ${esc(nameOf(e.by))}">`;
    else body = `<p class="anec">${esc(e.text)}</p>`;
    return `<li class="entry ${e.kind}">
      <div class="by">${avatar(e.by, nameOf(e.by))}<span class="pname">${esc(nameOf(e.by))}</span><small>${verb}${e.auto ? ' (au hasard)' : ''}</small></div>
      ${body}
    </li>`;
  }

  function renderReveal(st) {
    const g = st.g;
    const host = amHost();
    const lastEntry = g.entries.length >= g.entryCount;
    const lastAlbum = g.albumIndex + 1 >= g.albumCount;
    const label = !lastEntry ? 'Suivant ▶' : !lastAlbum ? 'Carnet suivant' : 'Terminer';

    mount(
      `<section class="screen tp-reveal">
        ${topbar()}
        <div class="roundtag">Carnet ${g.albumIndex + 1}/${g.albumCount}</div>
        <div class="author">
          ${avatar(g.owner, nameOf(g.owner), 'lg')}
          <div>
            <small>Le carnet de</small>
            <strong>${esc(nameOf(g.owner))}</strong>
          </div>
        </div>
        <ul class="album">${g.entries.map(entryHtml).join('')}</ul>
        ${
          host
            ? `<button class="btn primary big" data-action="next">${label}</button>`
            : `<p class="waiting">${esc(nameOf(st.hostId))} tourne les pages…</p>`
        }
      </section>`,
      'tp-reveal:' + g.round + ':' + g.albumIndex
    );

    // Fait défiler jusqu'à la nouvelle page du carnet
    const seen = g.round + ':' + g.albumIndex + ':' + g.entries.length;
    if (seen !== revealSeen) {
      revealSeen = seen;
      const items = document.querySelectorAll('.album .entry');
      if (g.entries.length > 1 && items.length) items[items.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
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
        updateTools();
      },
      size(btn) {
        size = +btn.dataset.s;
        eraser = false;
        updateTools();
      },
      eraser() {
        eraser = !eraser;
        updateTools();
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
      next() {
        act({ type: 'next' });
      },
      again() {
        act({ type: 'again' });
      },
    },

    onInput(t) {
      if (t.id === 'draft') {
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
