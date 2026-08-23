// 홈: PIN 입력(모두) + 퀴즈 관리/게임 기록(관리자)
(async function () {
  const loggedIn = await Auth.init();
  if (!loggedIn) return;
  document.getElementById('home-view').classList.remove('hidden');

  const pinInput = document.getElementById('pin-input');
  const urlPin = new URLSearchParams(location.search).get('pin');
  if (urlPin) pinInput.value = urlPin.replace(/\D/g, '').slice(0, 6);

  document.getElementById('join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('join-error');
    errEl.textContent = '';
    try {
      const r = await api('/api/games/join', { method: 'POST', body: JSON.stringify({ pin: pinInput.value.trim() }) });
      location.href = `/play/${r.id}`;
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
  if (urlPin && pinInput.value.length === 6) document.getElementById('join-form').requestSubmit();

  if (!Auth.me.admin) return;
  document.getElementById('admin-view').classList.remove('hidden');

  document.getElementById('new-quiz').addEventListener('click', async () => {
    const title = prompt('퀴즈 제목');
    if (!title || !title.trim()) return;
    const r = await api('/api/quizzes', { method: 'POST', body: JSON.stringify({ title }) });
    location.href = `/quiz/${r.id}`;
  });

  async function loadQuizzes() {
    const quizzes = await api('/api/quizzes');
    document.getElementById('empty-quizzes').classList.toggle('hidden', quizzes.length > 0);
    document.getElementById('quiz-list').innerHTML = quizzes
      .map(
        (q) => `
      <div class="quiz-card" data-id="${q.id}">
        <h3>${escapeHtml(q.title)}</h3>
        <p>${escapeHtml(q.description)}</p>
        <div class="quiz-meta">문제 ${q.question_count}개 · 진행 ${q.game_count}회 · 수정 ${fmtTime(q.updated_at)}</div>
        <div class="quiz-actions">
          <button class="btn btn-primary btn-small act-host" ${q.question_count ? '' : 'disabled title="문제를 먼저 추가하세요"'}>▶ 게임 시작</button>
          <a class="btn btn-small" href="/quiz/${q.id}">✎ 편집</a>
          <button class="btn btn-small act-dup">복제</button>
          <button class="btn btn-small btn-danger act-del">삭제</button>
        </div>
      </div>`
      )
      .join('');
  }

  document.getElementById('quiz-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const card = btn.closest('.quiz-card');
    const id = card.dataset.id;
    try {
      if (btn.classList.contains('act-host')) {
        const r = await api(`/api/quizzes/${id}/games`, { method: 'POST' });
        location.href = `/host/${r.id}`;
      } else if (btn.classList.contains('act-dup')) {
        await api(`/api/quizzes/${id}/duplicate`, { method: 'POST' });
        loadQuizzes();
      } else if (btn.classList.contains('act-del')) {
        if (!confirm(`"${card.querySelector('h3').textContent}" 퀴즈를 삭제할까요? (게임 기록은 남습니다)`)) return;
        await api(`/api/quizzes/${id}`, { method: 'DELETE' });
        loadQuizzes();
      }
    } catch (err) {
      alert(err.message);
    }
  });

  const STATUS_KO = { lobby: '대기실', question: '진행 중', results: '진행 중', leaderboard: '진행 중', finished: '종료' };
  async function loadGames() {
    const games = await api('/api/games');
    document.getElementById('empty-games').classList.toggle('hidden', games.length > 0);
    document.getElementById('game-table').classList.toggle('hidden', games.length === 0);
    document.querySelector('#game-table tbody').innerHTML = games
      .map(
        (g) => `
      <tr data-id="${g.id}">
        <td>${fmtTime(g.created_at)}</td>
        <td>${escapeHtml(g.quiz_title)}</td>
        <td>${g.pin}</td>
        <td><span class="status-pill ${g.status !== 'finished' ? 'live' : ''}">${STATUS_KO[g.status] || g.status}</span></td>
        <td>${g.player_count}명</td>
        <td>${g.question_count}개</td>
        <td>
          ${g.status !== 'finished' ? `<a class="btn btn-small btn-primary" href="/host/${g.id}">진행 화면</a>` : ''}
          <a class="btn btn-small" href="/results/${g.id}">결과</a>
          ${g.status === 'finished' ? `<button class="btn btn-small btn-danger game-del">삭제</button>` : ''}
        </td>
      </tr>`
      )
      .join('');
  }
  document.querySelector('#game-table tbody').addEventListener('click', async (e) => {
    const btn = e.target.closest('.game-del');
    if (!btn) return;
    if (!confirm('이 게임 기록을 삭제할까요?')) return;
    await api(`/api/games/${btn.closest('tr').dataset.id}`, { method: 'DELETE' });
    loadGames();
  });

  loadQuizzes();
  loadGames();
})();
