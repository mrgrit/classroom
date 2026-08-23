// 참가자(학생) 화면: 휴대폰용. 4색 버튼으로 답하고 결과/순위를 본다.
(async function () {
  const gameId = location.pathname.split('/').pop();
  const loggedIn = await Auth.init();
  if (!loggedIn) return;
  document.getElementById('play-view').classList.remove('hidden');

  const $stage = document.getElementById('stage');
  const $left = document.getElementById('bar-left');
  const $right = document.getElementById('bar-right');
  let state = null;
  let lastKey = '';
  let timerId = null;
  let deadline = 0;
  let picked = null; // 내가 고른 보기 id (서버 확인 전 즉시 표시)

  const info = await api(`/api/games/${gameId}`).catch(() => null);
  if (!info || !info.live) {
    $stage.innerHTML = '<h2>이 게임은 종료되었습니다.</h2><a class="btn" href="/">홈으로</a>';
    return;
  }

  const conn = connectWs({
    onOpen: (send) => send({ type: 'join', game_id: Number(gameId) }),
    onMessage: (msg) => {
      if (msg.type === 'error') {
        showToast(msg.message);
        if (msg.fatal) { conn.stop(); $stage.innerHTML = `<h2>${escapeHtml(msg.message)}</h2><a class="btn" href="/">홈으로</a>`; }
        return;
      }
      if (msg.type === 'state') { state = msg; render(); }
    },
    onClose: () => showToast('연결이 끊겼습니다. 다시 연결 중…'),
  });

  $stage.addEventListener('click', (e) => {
    const btn = e.target.closest('.answer-btn');
    if (!btn || btn.disabled || !state || state.status !== 'question') return;
    picked = Number(btn.dataset.id);
    conn.send({ type: 'answer', option_id: picked });
    renderQuestion(false);
  });

  function render() {
    const s = state;
    const key = `${s.status}:${s.index}`;
    const fresh = key !== lastKey;
    lastKey = key;
    $left.textContent = s.status === 'lobby' ? s.title : `문제 ${s.index + 1}/${s.total}`;
    $right.textContent = s.me ? `${s.me.score.toLocaleString()}점` : '';
    if (fresh) picked = null;

    if (s.status === 'lobby') return renderLobby();
    if (s.status === 'question') return renderQuestion(fresh);
    stopTimer();
    if (s.status === 'results' || s.status === 'leaderboard') return renderResult();
    if (s.status === 'finished') return renderFinished();
  }

  function renderLobby() {
    const s = state;
    $stage.innerHTML = `
      <h2>참가 완료!</h2>
      <div class="score-box">${escapeHtml(s.me ? s.me.name : Auth.me.name)}</div>
      <p class="sub">곧 시작합니다. 호스트 화면을 보세요 <span class="wait-dots"></span></p>
      <p class="sub">참가자 ${s.player_count}명</p>`;
  }

  function renderQuestion(fresh) {
    const s = state;
    const q = s.question;
    const answered = (s.me && s.me.answered) || picked !== null;
    const mine = s.me && s.me.option_id !== null ? s.me.option_id : picked;
    if (fresh) {
      deadline = Date.now() + s.remaining_ms;
      $stage.innerHTML = `
        <div class="timebar"><div id="timebar-fill" style="width:100%"></div></div>
        <div class="play-q">${escapeHtml(q.text)}</div>
        <div class="answer-grid">
          ${q.options.map((o, i) => `<button class="answer-btn ${OPTION_COLORS[i]}" data-id="${o.id}"><span class="shape">${SHAPES[i]}</span><span>${escapeHtml(o.text)}</span></button>`).join('')}
        </div>
        <p class="sub" id="answer-msg"></p>`;
      startTimer(q.time_limit * 1000);
    }
    $stage.querySelectorAll('.answer-btn').forEach((b) => {
      b.disabled = answered;
      b.classList.toggle('picked', answered && Number(b.dataset.id) === mine);
      b.classList.toggle('faded', answered && Number(b.dataset.id) !== mine);
    });
    const msg = document.getElementById('answer-msg');
    if (msg) msg.innerHTML = answered ? '답변 완료! 결과를 기다리세요 <span class="wait-dots"></span>' : '';
  }

  function startTimer(totalMs) {
    stopTimer();
    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      const el = document.getElementById('timebar-fill');
      if (!el) return stopTimer();
      el.style.width = `${(left / totalMs) * 100}%`;
      if (left <= 0) {
        stopTimer();
        $stage.querySelectorAll('.answer-btn').forEach((b) => { b.disabled = true; });
      }
    };
    tick();
    timerId = setInterval(tick, 500);
  }
  function stopTimer() { clearInterval(timerId); timerId = null; }

  function renderResult() {
    const s = state;
    const me = s.me;
    if (!me) return;
    const answered = me.option_id !== null;
    const correctTexts = s.question.options.filter((o) => s.results.correct_ids.includes(o.id)).map((o) => o.text);
    const last = s.index >= s.total - 1;
    $stage.innerHTML = `
      <div class="big-result ${me.correct ? 'ok' : 'bad'}">${!answered ? '⏰ 시간 초과' : me.correct ? '⭕ 정답!' : '❌ 오답'}</div>
      ${me.correct ? `<div class="points-pop">+${me.points.toLocaleString()}점</div>` : `<div class="sub">정답: ${correctTexts.map(escapeHtml).join(', ')}</div>`}
      <div class="score-box">총 ${me.score.toLocaleString()}점 · 현재 ${me.rank}위 / ${s.player_count}명</div>
      ${s.status === 'leaderboard' ? `<div class="leaderboard">${s.results.leaderboard.slice(0, 5).map((p) => `<div class="lb-row ${p.uid === Auth.me.id ? 'me' : ''}"><span class="rank">${p.rank}</span><span class="name">${escapeHtml(p.name)}</span><span>${p.score.toLocaleString()}</span></div>`).join('')}</div>` : ''}
      <p class="sub">${last && s.status === 'results' ? '최종 결과를 기다리세요' : '다음 문제를 기다리세요'} <span class="wait-dots"></span></p>`;
  }

  function renderFinished() {
    const s = state;
    const me = s.me;
    const medal = me && me.rank <= 3 ? ['🥇', '🥈', '🥉'][me.rank - 1] : '🎉';
    $stage.innerHTML = `
      <h2>게임 종료!</h2>
      <div class="big-result">${medal}</div>
      ${me ? `<div class="points-pop">${me.rank}위 / ${s.player_count}명</div><div class="score-box">${me.score.toLocaleString()}점</div>` : ''}
      <div class="leaderboard">${(s.results ? s.results.leaderboard : []).slice(0, 5).map((p) => `<div class="lb-row ${p.uid === Auth.me.id ? 'me' : ''}"><span class="rank">${p.rank}</span><span class="name">${escapeHtml(p.name)}</span><span>${p.score.toLocaleString()}</span></div>`).join('')}</div>
      <a class="btn" href="/">홈으로</a>`;
    conn.stop();
  }
})();
