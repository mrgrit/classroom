// 퀴즈 편집기: 메모리의 questions 배열을 편집하고 "저장"으로 통째로 저장
(async function () {
  const quizId = location.pathname.split('/').pop();
  const TIME_LIMITS = [5, 10, 20, 30, 60, 90, 120];
  const POINTS = [{ v: 1000, t: '기본 1000점' }, { v: 2000, t: '2배 2000점' }, { v: 500, t: '500점' }, { v: 0, t: '점수 없음' }];

  const loggedIn = await Auth.init();
  if (!loggedIn) return;
  if (!Auth.me.admin) {
    document.body.insertAdjacentHTML('beforeend', '<p class="empty">관리자만 퀴즈를 편집할 수 있습니다.</p>');
    return;
  }
  document.getElementById('editor-view').classList.remove('hidden');
  document.getElementById('ai-link').href = `/ai?quiz=${quizId}`;

  let questions = [];
  let dirty = false;
  const $q = document.getElementById('questions');
  const $title = document.getElementById('quiz-title');
  const $desc = document.getElementById('quiz-desc');

  try {
    const quiz = await api(`/api/quizzes/${quizId}`);
    $title.value = quiz.title;
    $desc.value = quiz.description;
    document.title = `${quiz.title} - 편집`;
    questions = quiz.questions.map((q) => ({
      text: q.text, time_limit: q.time_limit, points: q.points,
      options: [0, 1, 2, 3].map((i) => ({ text: q.options[i]?.text || '', is_correct: !!q.options[i]?.is_correct })),
    }));
  } catch (err) {
    alert(err.message);
    location.href = '/';
    return;
  }

  function newQuestion() {
    return { text: '', time_limit: 20, points: 1000, options: [0, 1, 2, 3].map(() => ({ text: '', is_correct: false })) };
  }

  function setDirty(v) {
    dirty = v;
    const el = document.getElementById('save-state');
    el.textContent = v ? '저장되지 않은 변경' : '저장됨';
    el.classList.toggle('dirty', v);
  }

  function render() {
    document.getElementById('empty-questions').classList.toggle('hidden', questions.length > 0);
    $q.innerHTML = questions
      .map(
        (q, i) => `
      <div class="question-card" data-i="${i}">
        <div class="question-head">
          <span class="q-num">Q${i + 1}</span>
          <select class="q-time" title="제한 시간">${TIME_LIMITS.map((t) => `<option value="${t}" ${t === q.time_limit ? 'selected' : ''}>${t}초</option>`).join('')}</select>
          <select class="q-points" title="점수">${POINTS.map((p) => `<option value="${p.v}" ${p.v === q.points ? 'selected' : ''}>${p.t}</option>`).join('')}</select>
          <span class="spacer"></span>
          <button class="icon-btn q-up" title="위로" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="icon-btn q-down" title="아래로" ${i === questions.length - 1 ? 'disabled' : ''}>▼</button>
          <button class="icon-btn q-dup" title="복제">⧉</button>
          <button class="icon-btn q-del" title="삭제">✕</button>
        </div>
        <textarea class="q-text" rows="2" placeholder="문제를 입력하세요" maxlength="500">${escapeHtml(q.text)}</textarea>
        <div class="option-grid">
          ${q.options.map((o, j) => `
            <div class="option-row ${OPTION_COLORS[j]}">
              <span class="shape">${SHAPES[j]}</span>
              <input type="text" class="o-text" data-j="${j}" placeholder="보기 ${j + 1}${j >= 2 ? ' (선택)' : ''}" maxlength="200" value="${escapeHtml(o.text)}">
              <label><input type="checkbox" class="o-correct" data-j="${j}" ${o.is_correct ? 'checked' : ''}> 정답</label>
            </div>`).join('')}
        </div>
      </div>`
      )
      .join('');
  }

  $q.addEventListener('input', (e) => {
    const t = e.target;
    const q = questions[Number(t.closest('.question-card').dataset.i)];
    if (t.classList.contains('q-text')) q.text = t.value;
    else if (t.classList.contains('o-text')) q.options[Number(t.dataset.j)].text = t.value;
    else return;
    setDirty(true);
  });
  $q.addEventListener('change', (e) => {
    const t = e.target;
    const q = questions[Number(t.closest('.question-card').dataset.i)];
    if (t.classList.contains('q-time')) q.time_limit = Number(t.value);
    else if (t.classList.contains('q-points')) q.points = Number(t.value);
    else if (t.classList.contains('o-correct')) q.options[Number(t.dataset.j)].is_correct = t.checked;
    else return;
    setDirty(true);
  });
  $q.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const i = Number(btn.closest('.question-card').dataset.i);
    if (btn.classList.contains('q-up') && i > 0) [questions[i - 1], questions[i]] = [questions[i], questions[i - 1]];
    else if (btn.classList.contains('q-down') && i < questions.length - 1) [questions[i + 1], questions[i]] = [questions[i], questions[i + 1]];
    else if (btn.classList.contains('q-dup')) questions.splice(i + 1, 0, JSON.parse(JSON.stringify(questions[i])));
    else if (btn.classList.contains('q-del')) {
      if (questions[i].text && !confirm(`Q${i + 1}을 삭제할까요?`)) return;
      questions.splice(i, 1);
    } else return;
    setDirty(true);
    render();
  });

  document.getElementById('add-question').addEventListener('click', () => {
    questions.push(newQuestion());
    setDirty(true);
    render();
    const cards = $q.querySelectorAll('.question-card');
    cards[cards.length - 1].querySelector('.q-text').focus();
    cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $title.addEventListener('input', () => setDirty(true));
  $desc.addEventListener('input', () => setDirty(true));

  // 텍스트 일괄 입력
  const modal = document.getElementById('bulk-modal');
  document.getElementById('bulk-import').addEventListener('click', () => { modal.classList.remove('hidden'); document.getElementById('bulk-text').focus(); });
  document.getElementById('bulk-cancel').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('bulk-ok').addEventListener('click', () => {
    const blocks = document.getElementById('bulk-text').value.replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    const parsed = [];
    for (const block of blocks) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length < 3) continue;
      const q = newQuestion();
      q.text = lines[0].replace(/^(\d+[.)]|Q\d+[.:]?)\s*/i, '');
      lines.slice(1, 5).forEach((l, j) => {
        const correct = /^\*/.test(l);
        q.options[j] = { text: l.replace(/^\*\s*/, '').replace(/^[①②③④⑤]|^[1-4][.)]\s*|^[a-dA-D][.)]\s*/, '').trim(), is_correct: correct };
      });
      if (!q.options.some((o) => o.is_correct)) q.options[0].is_correct = true; // 표시 없으면 첫 보기를 정답으로
      parsed.push(q);
    }
    if (!parsed.length) return alert('인식된 문제가 없습니다. 형식을 확인하세요.');
    questions.push(...parsed);
    setDirty(true);
    render();
    modal.classList.add('hidden');
    document.getElementById('bulk-text').value = '';
    showToast(`문제 ${parsed.length}개를 추가했습니다. 정답 표시를 확인한 뒤 저장하세요.`, 4000);
  });

  function validate() {
    if (!$title.value.trim()) return '퀴즈 제목을 입력하세요.';
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.text.trim()) return `Q${i + 1}의 문제를 입력하세요.`;
      const filled = q.options.filter((o) => o.text.trim());
      if (filled.length < 2) return `Q${i + 1}의 보기를 2개 이상 입력하세요.`;
      if (!filled.some((o) => o.is_correct)) return `Q${i + 1}의 정답을 표시하세요.`;
    }
    return null;
  }

  async function save() {
    const problem = validate();
    if (problem) { alert(problem); return false; }
    const body = {
      title: $title.value,
      description: $desc.value,
      questions: questions.map((q) => ({ ...q, options: q.options.filter((o) => o.text.trim()) })),
    };
    try {
      await api(`/api/quizzes/${quizId}`, { method: 'PUT', body: JSON.stringify(body) });
      setDirty(false);
      document.title = `${$title.value} - 편집`;
      return true;
    } catch (err) {
      alert(err.message);
      return false;
    }
  }

  document.getElementById('save').addEventListener('click', save);
  document.getElementById('host').addEventListener('click', async () => {
    if (!questions.length) return alert('문제를 먼저 추가하세요.');
    if (dirty && !(await save())) return;
    try {
      const r = await api(`/api/quizzes/${quizId}/games`, { method: 'POST' });
      location.href = `/host/${r.id}`;
    } catch (err) {
      alert(err.message);
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  setDirty(false);
  render();
})();
