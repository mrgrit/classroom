// 게임 결과표 (관리자): 참가자별 점수·정답 수·문제별 응답
(async function () {
  const gameId = location.pathname.split('/').pop();
  const loggedIn = await Auth.init();
  if (!loggedIn) return;
  if (!Auth.me.admin) {
    document.body.insertAdjacentHTML('beforeend', '<p class="empty">관리자만 결과를 볼 수 있습니다.</p>');
    return;
  }
  document.getElementById('results-view').classList.remove('hidden');
  document.getElementById('csv').href = `/api/games/${gameId}/results.csv`;

  let data;
  try {
    data = await api(`/api/games/${gameId}/results`);
  } catch (err) {
    document.getElementById('title').textContent = err.message;
    return;
  }
  const { game, questions, players } = data;
  document.title = `${game.quiz_title} 결과 - 버저`;
  document.getElementById('title').textContent = `${game.quiz_title} — 결과`;
  document.getElementById('meta').textContent =
    `${fmtTime(game.created_at)} · PIN ${game.pin} · 참가자 ${players.length}명 · 문제 ${game.question_count}개` +
    (game.status !== 'finished' ? ' · 진행 중' : '');
  document.getElementById('empty').classList.toggle('hidden', players.length > 0);

  document.querySelector('#table thead').innerHTML = `
    <tr><th>순위</th><th>이름</th><th>이메일</th><th>점수</th><th>정답</th>
    ${questions.map((q) => `<th title="${escapeHtml(q.text)}">Q${q.index + 1}<br><small>${q.correct_count}/${q.answered_count} 정답</small></th>`).join('')}</tr>`;
  document.querySelector('#table tbody').innerHTML = players
    .map(
      (p) => `
    <tr>
      <td>${p.rank}</td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.email)}</td>
      <td><b>${p.score.toLocaleString()}</b></td><td>${p.correct_count}/${questions.length}</td>
      ${questions.map((q) => {
        const a = p.answers[q.index];
        if (!a || a.option_text === null) return '<td style="color:#999">–</td>';
        return `<td title="${escapeHtml(a.option_text)} · ${(a.answer_ms / 1000).toFixed(1)}초">${a.is_correct ? '<span style="color:var(--green)">O</span>' : '<span style="color:var(--red)">X</span>'} <small>${a.points}</small></td>`;
      }).join('')}
    </tr>`
    )
    .join('');
})();
