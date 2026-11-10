// Jeu « C'est qui ?! » (interface)
(() => {
  'use strict';
  const EG = window.EG;
  const { esc, avatar, nameOf, amHost, topbar, mount, act } = EG;

  const MAX_CHARS = 300;
  let draft = '';
  let draftKey = '';

  function renderWriting(st) {
    const g = st.g;
    const key = 'w:' + g.round;
    if (key !== draftKey) {
      draftKey = key;
      draft = '';
    }
    const submitted = new Set(g.submitted);
    const mine = g.myAnswer !== null;
    const online = st.players.filter((p) => p.connected);
    const allDone = online.every((p) => submitted.has(p.id));
    const chips = online
      .map((p) => {
        const done = submitted.has(p.id);
        return `<li class="${done ? 'done' : ''}">${avatar(p.id, p.name)}${esc(p.name)} ${done ? '✓' : '…'}</li>`;
      })
      .join('');

    mount(
      `<section class="screen writing">
        ${topbar()}
        <div class="roundtag">Manche ${g.round}/${g.totalRounds}</div>
        <div class="card prompt"><p>${esc(g.prompt)}</p></div>
        ${
          mine
            ? `<div class="card quote">
                <p class="label">Ta réponse (envoyée)</p>
                <p class="anec">${esc(g.myAnswer)}</p>
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
          amHost() && g.canForce && !allDone
            ? '<button class="btn ghost" data-action="force">Passer sans attendre les retardataires</button>'
            : ''
        }
      </section>`,
      'writing:' + g.round
    );
  }

  function renderGuessing(st) {
    const g = st.g;
    const host = amHost();
    const pct = g.needed ? Math.min(100, Math.round((g.guessedCount / g.needed) * 100)) : 100;
    const voted = g.myGuess !== null;
    const cands = g.candidates.filter((id) => id !== st.me);

    let body;
    if (g.isAuthor) {
      body = `<p class="notice strong">🤫 Cette anecdote, c'est la tienne.<br>Garde ton plus beau poker face !</p>`;
    } else {
      body = `<p class="question">${voted ? 'Ton choix est fait' : 'Qui a écrit ça ?'}</p>
        <div class="cands">
          ${cands
            .map(
              (id) => `<button class="cand ${g.myGuess === id ? 'picked' : ''}" data-action="guess" data-id="${esc(id)}" ${voted ? 'disabled' : ''}>
                ${avatar(id, nameOf(id))}<span class="n">${esc(nameOf(id))}</span>
              </button>`
            )
            .join('')}
        </div>`;
    }

    mount(
      `<section class="screen guessing">
        ${topbar()}
        <div class="roundtag">Manche ${g.round}/${g.totalRounds} · anecdote ${g.index + 1}/${g.total}</div>
        <div class="card quote">
          <p class="label">${esc(g.prompt)}</p>
          <p class="anec">${esc(g.text)}</p>
        </div>
        ${body}
        <div>
          <div class="progress"><i style="width:${pct}%"></i></div>
          <p class="hint" style="margin-top:8px">${Math.min(g.guessedCount, g.needed)}/${g.needed} ont voté</p>
        </div>
        ${
          host && g.guessedCount < g.needed
            ? '<button class="btn ghost" data-action="force">Révéler sans attendre</button>'
            : ''
        }
      </section>`,
      'guess:' + g.round + ':' + g.index
    );
  }

  function renderReveal(st) {
    const g = st.g;
    const host = amHost();
    const authorName = nameOf(g.authorId);
    const isLast = g.index + 1 >= g.total;
    const rows = g.results
      .map(
        (r) => `<li class="${r.correct ? 'ok' : 'ko'}">
          ${avatar(r.guesserId, nameOf(r.guesserId))}
          <span><b>${esc(nameOf(r.guesserId))}</b> pensait à <b>${esc(nameOf(r.targetId))}</b></span>
          <span class="mark">${r.correct ? '+1 ✓' : '✗'}</span>
        </li>`
      )
      .join('');

    let verdict;
    if (!g.results.length) verdict = "Personne n'a eu le temps de voter.";
    else if (g.fooled > 0)
      verdict = `${esc(authorName)} a trompé ${g.fooled} personne${g.fooled > 1 ? 's' : ''} (+${g.fooled} pt${g.fooled > 1 ? 's' : ''}).`;
    else verdict = 'Tout le monde a trouvé, trop facile !';

    const board = EG.ranked()
      .map(
        (p) => `<li>${avatar(p.id, p.name)}<span class="pname">${esc(p.name)}</span><span class="pts">${p.score}</span></li>`
      )
      .join('');

    mount(
      `<section class="screen reveal">
        ${topbar()}
        <div class="roundtag">Manche ${g.round}/${g.totalRounds} · anecdote ${g.index + 1}/${g.total}</div>
        <div class="card quote">
          <p class="label">${esc(g.prompt)}</p>
          <p class="anec">${esc(g.text)}</p>
        </div>
        <div class="author">
          ${avatar(g.authorId, authorName, 'lg')}
          <div>
            <small>${g.isAuthor ? "C'était toi !" : 'Écrit par'}</small>
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
            : `<p class="waiting">${esc(nameOf(st.hostId))} lance la suite…</p>`
        }
      </section>`,
      'reveal:' + g.round + ':' + g.index
    );
  }

  EG.register('anecdotes', {
    render(st) {
      const g = st.g;
      switch (g.phase) {
        case 'writing':
          return renderWriting(st);
        case 'guessing':
          return renderGuessing(st);
        case 'reveal':
          return renderReveal(st);
        case 'scores':
          return EG.scoresScreen({
            final: g.final,
            roundTag: `Fin de la manche ${g.round}/${g.totalRounds}`,
            note: g.note,
            next: { action: 'nextRound', label: 'Manche suivante' },
          });
      }
    },

    actions: {
      submit() {
        const node = document.getElementById('draft');
        const text = (node ? node.value : draft).trim();
        if (!text) return EG.toast('Écris quelque chose !');
        act({ type: 'submit', text });
      },
      guess(btn) {
        act({ type: 'guess', targetId: btn.dataset.id });
      },
      force() {
        act({ type: 'force' });
      },
      next() {
        act({ type: 'next' });
      },
      nextRound() {
        act({ type: 'nextRound' });
      },
    },

    onInput(t) {
      if (t.id === 'draft') {
        draft = t.value;
        const c = document.getElementById('count');
        if (c) c.textContent = draft.length + '/' + MAX_CHARS;
      }
    },
  });
})();
