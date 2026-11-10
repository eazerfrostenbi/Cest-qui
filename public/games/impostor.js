// Jeu « L'imposteur » (interface)
(() => {
  'use strict';
  const EG = window.EG;
  const { esc, avatar, nameOf, amHost, topbar, mount, act } = EG;

  let clueDraft = '';

  // Bandeau rappelant le mot du joueur (visible pendant toute la manche)
  function wordBar(g) {
    if (!g.myWord) return '';
    return `<div class="wordbar"><small>Ton mot</small><strong>${esc(g.myWord)}</strong></div>`;
  }

  // Tableau des indices : une ligne par joueur, dans l'ordre de passage
  function clueTable(st) {
    const g = st.g;
    const rows = g.order
      .map((id) => {
        const mine = g.clues.filter((c) => c.playerId === id);
        const cur = g.phase === 'clues' && g.currentId === id;
        const pl = EG.playerById(id);
        let cells = '';
        for (let r = 1; r <= g.clueRounds; r++) {
          const c = mine.find((x) => x.round === r);
          if (c) cells += `<span class="cl">${esc(c.text)}</span>`;
          else if (cur && r === g.clueRound) cells += '<span class="cl wait">…</span>';
          else cells += '<span class="cl none">·</span>';
        }
        const cls = (cur ? 'cur' : '') + (pl && !pl.connected ? ' off' : '');
        return `<li class="${cls}">${avatar(id, nameOf(id))}
          <span class="pname">${esc(nameOf(id))}${id === st.me ? ' <em>(toi)</em>' : ''}</span>
          <span class="cls">${cells}</span></li>`;
      })
      .join('');
    return `<ul class="cluetable">${rows}</ul>`;
  }

  function renderWord(st) {
    const g = st.g;
    const ready = new Set(g.ready);
    const iAmReady = ready.has(st.me);
    const live = g.participants.filter((id) => {
      const p = EG.playerById(id);
      return p && p.connected;
    });
    const allReady = live.every((id) => ready.has(id));
    const chips = g.participants
      .map((id) => {
        const done = ready.has(id);
        return `<li class="${done ? 'done' : ''}">${avatar(id, nameOf(id))}${esc(nameOf(id))} ${done ? '✓' : '…'}</li>`;
      })
      .join('');

    mount(
      `<section class="screen word">
        ${topbar()}
        <div class="roundtag">Manche ${g.round}/${g.totalRounds}</div>
        <div class="card center secret">
          <p class="label">Ton mot secret</p>
          <div class="bigword">${esc(g.myWord || '—')}</div>
          <p class="hint">Un seul joueur a un mot légèrement différent.<br>Ce n'est peut-être pas toi… ou si.</p>
        </div>
        <div class="card">
          <p class="label">Comment jouer</p>
          <p class="rules">À tour de rôle, chacun donne <b>un indice d'un mot</b> sur son mot : assez clair pour que les autres te reconnaissent, assez flou pour ne pas trahir ton mot. Puis on vote pour démasquer celui qui a un mot différent.</p>
        </div>
        ${
          iAmReady
            ? '<p class="waiting">Mot mémorisé ! On attend les autres…</p>'
            : '<button class="btn primary big" data-action="ready">J\'ai vu mon mot</button>'
        }
        <div class="card">
          <p class="label">${g.ready.length}/${g.participants.length} prêts</p>
          <ul class="chips">${chips}</ul>
        </div>
        ${
          amHost() && !allReady
            ? '<button class="btn ghost" data-action="force">Lancer sans attendre les retardataires</button>'
            : ''
        }
      </section>`,
      'imp-word:' + g.round
    );
  }

  function renderClues(st) {
    const g = st.g;
    const mine = g.currentId === st.me;
    const curName = nameOf(g.currentId);

    mount(
      `<section class="screen clues">
        ${topbar()}
        <div class="roundtag">Manche ${g.round}/${g.totalRounds} · indices, tour ${g.clueRound}/${g.clueRounds}</div>
        ${wordBar(g)}
        ${clueTable(st)}
        ${
          mine
            ? `<div class="card">
                <p class="question">À toi ! Donne un indice</p>
                <input id="clue" type="text" maxlength="30" autocomplete="off" autocapitalize="none" placeholder="Un mot (pas ton mot !)" value="${esc(clueDraft)}">
                <button class="btn primary big" data-action="clue">Envoyer l'indice</button>
              </div>`
            : `<p class="notice strong">C'est à ${esc(curName)} de donner un indice…</p>`
        }
        ${
          amHost() && !mine
            ? `<button class="btn ghost" data-action="force">Passer ${esc(curName)}</button>`
            : ''
        }
      </section>`,
      'imp-clues:' + g.round + ':' + g.clueRound + ':' + g.currentId
    );
  }

  function renderVote(st) {
    const g = st.g;
    const voted = g.myVote !== null;
    const cands = g.participants.filter((id) => id !== st.me);
    const pct = g.needed ? Math.min(100, Math.round((g.voted.length / g.needed) * 100)) : 100;

    const body = g.isParticipant
      ? `<p class="question">${voted ? 'Ton vote est fait' : "Qui a un mot différent ?"}</p>
         <div class="cands">
           ${cands
             .map(
               (id) => `<button class="cand ${g.myVote === id ? 'picked' : ''}" data-action="vote" data-id="${esc(id)}" ${voted ? 'disabled' : ''}>
                 ${avatar(id, nameOf(id))}<span class="n">${esc(nameOf(id))}</span>
               </button>`
             )
             .join('')}
         </div>`
      : '<p class="notice">Les autres votent…</p>';

    mount(
      `<section class="screen vote">
        ${topbar()}
        <div class="roundtag">Manche ${g.round}/${g.totalRounds} · le vote</div>
        ${wordBar(g)}
        ${clueTable(st)}
        ${body}
        <div>
          <div class="progress"><i style="width:${pct}%"></i></div>
          <p class="hint" style="margin-top:8px">${Math.min(g.voted.length, g.needed)}/${g.needed} ont voté</p>
        </div>
        ${
          amHost() && g.voted.length < g.needed
            ? '<button class="btn ghost" data-action="force">Révéler sans attendre</button>'
            : ''
        }
      </section>`,
      'imp-vote:' + g.round
    );
  }

  function renderResult(st) {
    const g = st.g;
    const host = amHost();
    const res = g.result;
    const impName = nameOf(g.impostorId);
    const iAmImp = g.impostorId === st.me;
    const isLast = g.round >= g.totalRounds;

    const maxVotes = Math.max(1, ...res.tally.map((t) => t.count));
    const tallyRows = res.tally
      .slice()
      .sort((a, b) => b.count - a.count)
      .map((t) => {
        const isImp = t.id === g.impostorId;
        const gain = res.gains[t.id];
        return `<li class="${isImp ? 'imp' : ''}">
          ${avatar(t.id, nameOf(t.id))}
          <span class="pname">${esc(nameOf(t.id))}${isImp ? ' 🕵️' : ''}</span>
          <span class="bar"><i style="width:${Math.round((t.count / maxVotes) * 100)}%"></i></span>
          <span class="n">${t.count}</span>
          ${gain ? `<span class="gain">+${gain}</span>` : ''}
        </li>`;
      })
      .join('');

    const who = res.votes
      .map((v) => `${esc(nameOf(v.voterId))} → ${esc(nameOf(v.targetId))}`)
      .join(' · ');

    const verdict = res.caught
      ? `🎯 Démasqué ! Ceux qui ont voté pour ${esc(impName)} gagnent 2 points.`
      : res.votes.length
        ? `😈 ${esc(impName)} s'en sort et gagne 3 points.`
        : "Personne n'a voté.";

    const board = EG.ranked()
      .map(
        (p) => `<li>${avatar(p.id, p.name)}<span class="pname">${esc(p.name)}</span><span class="pts">${p.score}</span></li>`
      )
      .join('');

    mount(
      `<section class="screen result">
        ${topbar()}
        <div class="roundtag">Manche ${g.round}/${g.totalRounds} · résultat</div>
        <div class="author">
          ${avatar(g.impostorId, impName, 'lg')}
          <div>
            <small>${iAmImp ? "L'imposteur, c'était toi !" : "L'imposteur était"}</small>
            <strong>${esc(impName)}</strong>
          </div>
        </div>
        <div class="card center">
          <p class="notice strong">${verdict}</p>
          <div class="words2">
            <div><small>Mot du groupe</small><b>${esc(g.civilWord)}</b></div>
            <div class="imp"><small>Mot de l'imposteur</small><b>${esc(g.impostorWord)}</b></div>
          </div>
        </div>
        ${clueTable(st)}
        <div class="card">
          <p class="label">Votes</p>
          <ul class="tally">${tallyRows}</ul>
          ${who ? `<p class="who">${who}</p>` : ''}
        </div>
        <div class="card">
          <p class="label">Scores</p>
          <ul class="board compact">${board}</ul>
        </div>
        ${
          host
            ? `<button class="btn primary big" data-action="next">${isLast ? 'Voir le classement final' : 'Manche suivante'}</button>`
            : `<p class="waiting">${esc(nameOf(st.hostId))} lance la suite…</p>`
        }
      </section>`,
      'imp-result:' + g.round
    );
  }

  EG.register('impostor', {
    render(st) {
      const g = st.g;
      switch (g.phase) {
        case 'word':
          return renderWord(st);
        case 'clues':
          return renderClues(st);
        case 'vote':
          return renderVote(st);
        case 'result':
          return renderResult(st);
        case 'scores':
          return EG.scoresScreen({ final: true });
      }
    },

    actions: {
      ready() {
        act({ type: 'ready' });
      },
      clue() {
        const node = document.getElementById('clue');
        const text = (node ? node.value : clueDraft).trim();
        if (!text) return EG.toast('Écris un indice !');
        act({ type: 'clue', text }, (res) => {
          if (res && res.ok) clueDraft = '';
        });
      },
      vote(btn) {
        act({ type: 'vote', targetId: btn.dataset.id });
      },
      force() {
        act({ type: 'force' });
      },
      next() {
        act({ type: 'next' });
      },
    },

    onInput(t) {
      if (t.id === 'clue') clueDraft = t.value;
    },

    onKeydown(e) {
      if (e.target.id === 'clue') {
        e.preventDefault();
        this.actions.clue();
      }
    },
  });
})();
