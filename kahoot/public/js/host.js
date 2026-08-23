// 호스트(선생님) 화면: 빔프로젝터에 띄우는 큰 화면. 상태는 전부 서버가 보내는 state로 그린다.
(async function () {
  const gameId = location.pathname.split('/').pop();
  const loggedIn = await Auth.init();
  if (!loggedIn) return;
  if (!Auth.me.admin) {
    document.body.insertAdjacentHTML('beforeend', '<p class="empty">관리자만 진행할 수 있습니다.</p>');
    return;
  }
  document.getElementById('host-view').classList.remove('hidden');

  const $stage = document.getElementById('stage');
  const $left = document.getElementById('bar-left');
  const $pin = document.getElementById('bar-pin');
  const $end = document.getElementById('btn-end');
  let state = null;
  let timerId = null;
  let deadline = 0;
  let lastStatusKey = '';

  const info = await api(`/api/games/${gameId}`).catch(() => null);
  if (!info || !info.live) {
    $stage.innerHTML = `<h2>이 게임은 종료되었습니다.</h2><a class="btn" href="/results/${gameId}">결과 보기</a>`;
    return;
  }

  const conn = connectWs({
    onOpen: (send) => send({ type: 'host', game_id: Number(gameId) }),
    onMessage: (msg) => {
      if (msg.type === 'error') {
        showToast(msg.message);
        if (msg.fatal) { conn.stop(); $stage.innerHTML = `<h2>${escapeHtml(msg.message)}</h2><a class="btn" href="/results/${gameId}">결과 보기</a>`; }
        return;
      }
      if (msg.type === 'state') { state = msg; render(); }
    },
    onClose: () => showToast('서버와 연결이 끊겼습니다. 다시 연결 중…'),
  });

  $end.addEventListener('click', () => {
    if (confirm('게임을 지금 종료할까요? 현재까지의 점수로 최종 결과가 나옵니다.')) conn.send({ type: 'end' });
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); advance(); }
  });
  $stage.addEventListener('click', (e) => {
    if (e.target.closest('.btn-next')) advance();
    const kick = e.target.closest('.kick');
    if (kick && confirm(`${kick.dataset.name} 님을 내보낼까요?`)) conn.send({ type: 'kick', uid: Number(kick.dataset.uid) });
  });

  function advance() {
    if (!state) return;
    if (state.status === 'finished') return;
    if (state.status === 'question' && !confirm('시간을 지금 끝낼까요?')) return;
    conn.send({ type: 'next' });
  }

  function joinUrl() {
    return `${location.origin}/?pin=${state.pin}`;
  }

  function render() {
    const s = state;
    const key = `${s.status}:${s.index}`;
    const statusChanged = key !== lastStatusKey;
    lastStatusKey = key;
    $pin.textContent = `PIN ${s.pin}`;
    $left.textContent = s.status === 'lobby' ? s.title : `${s.title} · 문제 ${s.index + 1}/${s.total}`;
    $end.classList.toggle('hidden', s.status === 'finished' || s.status === 'lobby');

    if (s.status === 'lobby') return renderLobby();
    if (s.status === 'question') return renderQuestion(statusChanged);
    stopTimer();
    if (s.status === 'results') return renderResults();
    if (s.status === 'leaderboard') return renderLeaderboard();
    if (s.status === 'finished') return renderFinished();
  }

  function renderLobby() {
    const s = state;
    $stage.innerHTML = `
      <div class="pin-box">
        <div class="label">${escapeHtml(location.host)} 에 접속해서 PIN 입력</div>
        <div class="pin">${s.pin}</div>
        <div class="url">${escapeHtml(joinUrl())}</div>
      </div>
      <div class="count-big">참가자 ${s.players.length}명</div>
      <div class="player-bubbles">
        ${s.players.map((p) => `<span class="bubble ${p.connected ? '' : 'offline'}">${escapeHtml(p.name)} <button class="kick" data-uid="${p.uid}" data-name="${escapeHtml(p.name)}" title="내보내기">✕</button></span>`).join('')}
      </div>
      <button class="btn btn-big btn-next" ${s.players.length ? '' : 'disabled'}>시작 ▶</button>
      <div class="sub">학생들은 휴대폰으로 구글 로그인 후 PIN을 입력하면 됩니다. (스페이스/엔터로 진행)</div>`;
  }

  function renderQuestion(fresh) {
    const s = state;
    const q = s.question;
    if (fresh) {
      deadline = Date.now() + s.remaining_ms;
      $stage.innerHTML = `
        <div class="q-meta">
          <div class="timer" id="timer">${Math.ceil(s.remaining_ms / 1000)}</div>
          <div class="q-text">${escapeHtml(q.text)}</div>
          <div class="answered-count"><span id="answered">${s.answered}</span> / ${s.player_count}<br><small>답변</small></div>
        </div>
        <div class="option-board">
          ${q.options.map((o, i) => `<div class="option-card ${OPTION_COLORS[i]}"><span class="shape">${SHAPES[i]}</span>${escapeHtml(o.text)}</div>`).join('')}
        </div>
        <button class="btn btn-next">시간 종료 ⏭</button>`;
      startTimer();
    } else {
      const el = document.getElementById('answered');
      if (el) el.textContent = s.answered;
      const ac = $stage.querySelector('.answered-count');
      if (ac) ac.innerHTML = `<span id="answered">${s.answered}</span> / ${s.player_count}<br><small>답변</small>`;
    }
  }

  function startTimer() {
    stopTimer();
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      const el = document.getElementById('timer');
      if (!el) return stopTimer();
      el.textContent = left;
      el.classList.toggle('urgent', left <= 5);
      if (left <= 0) stopTimer();
    };
    tick();
    timerId = setInterval(tick, 250);
  }
  function stopTimer() { clearInterval(timerId); timerId = null; }

  function renderResults() {
    const s = state;
    const q = s.question;
    const r = s.results;
    const max = Math.max(1, ...Object.values(r.counts));
    const last = s.index >= s.total - 1;
    $stage.innerHTML = `
      <div class="q-text">${escapeHtml(q.text)}</div>
      <div class="bars">
        ${q.options.map((o, i) => `
          <div class="bar-col">
            <div class="bar-count">${r.counts[o.id]}</div>
            <div class="bar ${OPTION_COLORS[i]}" style="height:${Math.max(3, (r.counts[o.id] / max) * 70)}%"></div>
            <div class="bar-label ${r.correct_ids.includes(o.id) ? 'correct' : ''}">${SHAPES[i]}</div>
          </div>`).join('')}
      </div>
      <div class="option-board">
        ${q.options.map((o, i) => `<div class="option-card ${OPTION_COLORS[i]} ${r.correct_ids.includes(o.id) ? '' : 'dim'}"><span class="shape">${SHAPES[i]}</span>${escapeHtml(o.text)}${r.correct_ids.includes(o.id) ? '<span class="mark">✔</span>' : ''}</div>`).join('')}
      </div>
      <button class="btn btn-big btn-next">${last ? '최종 결과 🏆' : '순위 보기 ▶'}</button>`;
  }

  function renderLeaderboard() {
    const s = state;
    $stage.innerHTML = `
      <h2>순위 (문제 ${s.index + 1}/${s.total} 까지)</h2>
      <div class="leaderboard">
        ${s.results.leaderboard.slice(0, 5).map((p) => `<div class="lb-row"><span class="rank">${p.rank}</span><span class="name">${escapeHtml(p.name)}</span><span>${p.score.toLocaleString()}</span></div>`).join('')}
      </div>
      <button class="btn btn-big btn-next">다음 문제 ▶</button>`;
  }

  function renderFinished() {
    const s = state;
    const f = s.final || [];
    const top = [f[1], f[0], f[2]];
    const cls = ['p2', 'p1', 'p3'];
    const medal = ['🥈', '🥇', '🥉'];
    $stage.innerHTML = `
      <h2>🏆 최종 결과 — ${escapeHtml(s.title)}</h2>
      <div class="podium">
        ${top.map((p, i) => p ? `<div class="podium-col ${cls[i]}"><div class="pname">${medal[i]} ${escapeHtml(p.name)}</div><div class="pscore">${p.score.toLocaleString()}점</div><div class="block">${p.rank}</div></div>` : '<div class="podium-col"></div>').join('')}
      </div>
      <div class="leaderboard">
        ${f.slice(3, 10).map((p) => `<div class="lb-row"><span class="rank">${p.rank}</span><span class="name">${escapeHtml(p.name)}</span><span>${p.score.toLocaleString()}</span></div>`).join('')}
      </div>
      <div>
        <a class="btn btn-big" href="/results/${gameId}">결과 상세 / CSV</a>
        <a class="btn btn-big" href="/">홈으로</a>
      </div>`;
  }
})();
