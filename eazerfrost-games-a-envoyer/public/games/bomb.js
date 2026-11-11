// Jeu « La Bombe » (interface)
// L'écran de jeu est construit une seule fois par partie, puis mis à jour par morceaux :
// on ne remplace jamais le champ de saisie, sinon le clavier du téléphone se fermerait à chaque lettre.
(() => {
  'use strict';
  const EG = window.EG;
  const { esc, avatar, nameOf, amHost, topbar, mount, act } = EG;

  let shownGame = 0; // partie actuellement affichée
  let shownCanPlay = null;
  let lastTurnId = 0;
  let deadline = 0;
  let sending = false;

  const $ = (id) => document.getElementById(id);
  const vibrate = (ms) => {
    try {
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch (_) {}
  };

  const hearts = (n, max) => '❤️'.repeat(Math.max(0, n)) + '🖤'.repeat(Math.max(0, max - n));
  const canPlay = (st) => st.g.isParticipant && st.g.livesOf[st.me] > 0;
  const myTurn = (st) => st.g.step === 'turn' && st.g.currentId === st.me;

  // Met en valeur les lettres de la bombe dans le mot (« parAPluie »)
  function highlight(word, syl) {
    const chars = Array.from(word);
    const plain = chars.map((c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
    const i = plain.every((c) => c.length === 1) ? plain.join('').indexOf(syl) : -1;
    if (i < 0 || !syl) return esc(word);
    const a = chars.slice(0, i).join('');
    const b = chars.slice(i, i + syl.length).join('');
    const c = chars.slice(i + syl.length).join('');
    return `${esc(a)}<mark>${esc(b)}</mark>${esc(c)}`;
  }

  // ---------------------------------------------------------------------------
  // Pendant la partie
  // ---------------------------------------------------------------------------
  function inputRow(st) {
    if (!canPlay(st)) {
      return st.g.isParticipant
        ? '<p class="notice">💀 Tu es hors jeu… regarde qui va survivre !</p>'
        : '<p class="notice">Tu regardes la partie.</p>';
    }
    return `<div class="bp-input">
      <input id="bp-word" type="text" maxlength="30" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="send">
      <button class="btn primary" data-action="word">OK</button>
    </div>`;
  }

  function mountPlay(st) {
    const g = st.g;
    shownGame = g.game;
    shownCanPlay = canPlay(st);
    lastTurnId = 0;
    mount(
      `<section class="screen bomb" id="bp-root">
        ${topbar()}
        <div class="roundtag">💣 La Bombe · ${g.lives} vie${g.lives > 1 ? 's' : ''} · ${g.seconds} s</div>
        <div class="bp-stage" id="bp-stage"></div>
        <div class="bp-typing" id="bp-typing"></div>
        <p class="bp-last" id="bp-last"></p>
        <div id="bp-inrow">${inputRow(st)}</div>
        <ul class="bp-players" id="bp-players"></ul>
        <div class="card" id="bp-hist"></div>
      </section>`,
      'bomb-play:' + g.game
    );
  }

  function patchPlay(st) {
    const g = st.g;
    const holder = g.currentId;
    const mine = myTurn(st);

    // La barre du haut (l'hôte peut changer en cours de partie)
    const top = document.querySelector('#bp-root > .top');
    if (top) top.outerHTML = topbar();

    // La bombe
    let stage;
    if (g.step === 'boom') {
      const b = g.boom;
      const who = b.pid === st.me ? 'Tu' : esc(nameOf(b.pid));
      const lost = b.dead
        ? `${who} ${b.pid === st.me ? 'es' : 'est'} hors jeu !`
        : `${who} ${b.pid === st.me ? 'perds' : 'perd'} une vie !`;
      stage = `<div class="bp-bomb boom"><span class="bp-fx">💥</span></div>
        <p class="bp-holder">BOUM ! ${lost}</p>
        ${b.example ? `<p class="hint">Il y avait par exemple : <b>${highlight(b.example, b.syllable)}</b></p>` : ''}`;
    } else {
      stage = `<div class="bp-bomb${mine ? ' mine' : ''}" id="bp-bomb">
          <span class="bp-syl">${esc(g.syllable.toUpperCase())}</span>
        </div>
        <div class="bp-fuse"><i id="bp-fuse"></i></div>
        <p class="bp-holder">${mine ? '🔥 À toi ! Vite, un mot avec ces lettres' : `C'est à <b>${esc(nameOf(holder))}</b>…`}</p>`;
    }
    $('bp-stage').innerHTML = stage;

    // Ce que tape le joueur qui a la bombe
    $('bp-typing').innerHTML =
      g.step === 'turn' && !mine && g.typing ? highlight(g.typing, g.syllable) : '&nbsp;';

    // Dernière tentative
    const l = g.last;
    const lastEl = $('bp-last');
    if (l && g.step === 'turn') {
      lastEl.className = 'bp-last ' + (l.ok ? 'ok' : 'ko');
      lastEl.innerHTML = l.ok
        ? `✓ ${esc(nameOf(l.pid))} : <b>${highlight(l.word, '')}</b>`
        : `✗ ${esc(nameOf(l.pid))} : « ${esc(l.word)} », ${esc(l.reason)}`;
    } else {
      lastEl.className = 'bp-last';
      lastEl.innerHTML = '&nbsp;';
    }

    // Champ de saisie : seulement reconstruit si on vient d'être éliminé
    if (canPlay(st) !== shownCanPlay) {
      shownCanPlay = canPlay(st);
      $('bp-inrow').innerHTML = inputRow(st);
    }
    const input = $('bp-word');
    if (g.turnId !== lastTurnId) {
      lastTurnId = g.turnId;
      sending = false;
      if (mine) {
        if (input) {
          input.value = '';
          input.focus();
        }
        vibrate(40);
      }
      if (g.step === 'boom' && g.boom.pid === st.me) vibrate([120, 60, 220]);
    }
    if (input) {
      input.placeholder = mine ? `Un mot avec « ${g.syllable.toUpperCase()} »` : 'Attends ton tour…';
      input.classList.toggle('mine', mine);
    }

    // Joueurs
    $('bp-players').innerHTML = g.order
      .map((id) => {
        const p = EG.playerById(id);
        const out = g.livesOf[id] <= 0;
        const cls = [id === holder && g.step === 'turn' ? 'cur' : '', out ? 'out' : '', p && !p.connected ? 'off' : '']
          .join(' ')
          .trim();
        return `<li class="${cls}">
          ${avatar(id, nameOf(id))}
          <span class="pname">${esc(nameOf(id))}${id === st.me ? ' <em>(toi)</em>' : ''}</span>
          <span class="bp-hearts">${out ? '💀' : hearts(g.livesOf[id], g.lives)}</span>
          <span class="bp-n">${g.wordsOf[id]} mot${g.wordsOf[id] > 1 ? 's' : ''}</span>
        </li>`;
      })
      .join('');

    // Mots déjà joués
    $('bp-hist').innerHTML = g.history.length
      ? `<p class="label">Déjà joués (${g.usedCount}) · interdit de les redire</p>
         <ul class="chips">${g.history.map((h) => `<li>${esc(h.word)}</li>`).join('')}</ul>`
      : '<p class="label">Aucun mot joué pour l\'instant</p><p class="hint left">Un même mot ne peut servir qu\'une fois par partie.</p>';

    deadline = Date.now() + g.remaining;
    tick();
  }

  // Mèche qui raccourcit
  function tick() {
    const st = EG.s();
    if (!st || st.phase !== 'playing' || st.mode !== 'bomb' || !st.g || st.g.phase !== 'play') return;
    if (st.g.step !== 'turn') return;
    const left = Math.max(0, deadline - Date.now());
    const fuse = $('bp-fuse');
    if (fuse) fuse.style.width = Math.min(100, (left / (st.g.seconds * 1000)) * 100) + '%';
    const bomb = $('bp-bomb');
    if (bomb) bomb.classList.toggle('hurry', left <= 3000);
  }
  setInterval(tick, 100);

  // Appuyer sur « OK » ne doit pas fermer le clavier du téléphone
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest && e.target.closest('.bp-input .btn')) e.preventDefault();
  });

  // ---------------------------------------------------------------------------
  // Fin de partie
  // ---------------------------------------------------------------------------
  function renderEnd(st) {
    const g = st.g;
    shownGame = 0;
    const medals = ['🥇', '🥈', '🥉'];
    const rows = g.ranking
      .map((id, i) => {
        const p = EG.playerById(id);
        const wins = p ? p.score : 0;
        return `<li class="${i === 0 && g.winner ? 'first' : ''}">
          <span class="rank">${i < 3 ? medals[i] : i + 1}</span>
          ${avatar(id, nameOf(id))}
          <span class="bp-endname">
            <span class="pname">${esc(nameOf(id))}${id === st.me ? ' <em>(toi)</em>' : ''}</span>
            <small>${g.wordsOf[id]} mot${g.wordsOf[id] > 1 ? 's' : ''}${g.bestOf[id] ? ` · le plus long : ${esc(g.bestOf[id])}` : ''}</small>
          </span>
          ${wins ? `<span class="pts">🏆 ${wins}</span>` : ''}
        </li>`;
      })
      .join('');

    const winnerBox = g.winner
      ? `<div class="author">
          ${avatar(g.winner, nameOf(g.winner), 'lg')}
          <div>
            <small>${g.winner === st.me ? 'Tu as survécu à la bombe !' : 'Dernier survivant'}</small>
            <strong>${esc(nameOf(g.winner))}</strong>
          </div>
        </div>`
      : '<h2 class="final-title">Tout le monde a sauté !</h2>';

    mount(
      `<section class="screen bomb">
        ${topbar()}
        <div class="roundtag">💣 La Bombe · partie terminée</div>
        ${winnerBox}
        <p class="notice">${g.usedCount} mot${g.usedCount > 1 ? 's' : ''} trouvé${g.usedCount > 1 ? 's' : ''} pendant la partie</p>
        <div class="card"><ul class="board">${rows}</ul></div>
        ${
          amHost()
            ? `<button class="btn primary big" data-action="again">Rejouer</button>
               <button class="btn" data-action="toLobby">Changer de jeu / réglages</button>`
            : `<p class="waiting">En attente de ${esc(nameOf(st.hostId))}…</p>`
        }
      </section>`,
      'bomb-end:' + g.game
    );
  }

  function submit() {
    const st = EG.s();
    const input = $('bp-word');
    if (!st || !input) return;
    if (!myTurn(st)) return EG.toast("Ce n'est pas ton tour !");
    const word = input.value.trim();
    if (!word || sending) return;
    sending = true;
    act({ type: 'word', word }, (res) => {
      sending = false;
      if (res && res.ok) return;
      const node = $('bp-word');
      if (!node) return;
      node.classList.remove('shake');
      void node.offsetWidth; // relance l'animation
      node.classList.add('shake');
      node.select();
    });
  }

  EG.register('bomb', {
    render(st) {
      if (st.g.phase === 'end') return renderEnd(st);
      if (shownGame !== st.g.game || !$('bp-root')) mountPlay(st);
      patchPlay(st);
    },

    actions: {
      word: submit,
      again() {
        act({ type: 'again' });
      },
    },

    onInput(t) {
      if (t.id !== 'bp-word') return;
      const st = EG.s();
      if (st && myTurn(st)) act({ type: 'type', text: t.value });
    },

    onKeydown(e) {
      if (e.target.id === 'bp-word') {
        e.preventDefault();
        submit();
      }
    },
  });
})();
