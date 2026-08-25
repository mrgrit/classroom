// AI 퀴즈 만들기: Ollama 연결 → 자료 텍스트 → 생성(백그라운드 작업 폴링) → 미리보기 → 퀴즈로 저장
(async function () {
  const loggedIn = await Auth.init();
  if (!loggedIn) return;
  if (!Auth.me.admin) {
    document.body.insertAdjacentHTML('beforeend', '<p class="empty">관리자만 사용할 수 있습니다.</p>');
    return;
  }
  document.getElementById('ai-view').classList.remove('hidden');

  const $ = (id) => document.getElementById(id);
  const $url = $('ollama-url'), $model = $('model'), $conn = $('conn-status');
  const $source = $('source'), $info = $('source-info');
  const $gen = $('generate'), $cancel = $('cancel'), $genStatus = $('gen-status');
  let settings = null;
  let result = null; // { title, questions }
  let jobId = null;
  let pollTimer = null;
  const presetQuiz = new URLSearchParams(location.search).get('quiz');

  // ---------- 설정/모델 ----------
  settings = await api('/api/ai/settings');
  $url.value = settings.ollama_url;
  for (const [k, v] of Object.entries(settings.difficulties)) $('difficulty').insertAdjacentHTML('beforeend', `<option value="${k}" ${k === 'normal' ? 'selected' : ''}>${escapeHtml(v)}</option>`);
  for (const [k, v] of Object.entries(settings.languages)) $('language').insertAdjacentHTML('beforeend', `<option value="${k}">${escapeHtml(v)}</option>`);
  if (settings.ollama_url) connect(true);

  async function connect(silent) {
    $conn.textContent = '연결 중…';
    $conn.className = 'hint';
    try {
      const r = await api('/api/ai/connect', { method: 'POST', body: JSON.stringify({ url: $url.value }) });
      $url.value = r.url;
      $model.disabled = false;
      $model.innerHTML = r.models.length
        ? r.models.map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}${m.parameter_size ? ` (${escapeHtml(m.parameter_size)})` : ''}</option>`).join('')
        : '<option value="">설치된 모델이 없습니다 (ollama pull 필요)</option>';
      if (settings.model && r.models.some((m) => m.name === settings.model)) $model.value = settings.model;
      $conn.textContent = `연결됨 — 모델 ${r.models.length}개`;
      $conn.className = 'hint ok';
    } catch (err) {
      $model.disabled = true;
      $model.innerHTML = '<option value="">연결 실패</option>';
      $conn.textContent = err.message;
      $conn.className = 'hint error';
      if (!silent) alert(err.message);
    }
  }
  $('connect').addEventListener('click', () => connect(false));
  $url.addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(false); });

  // ---------- 자료 ----------
  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      document.querySelectorAll('.tab-body').forEach((b) => b.classList.toggle('hidden', b.id !== `tab-${t.dataset.tab}`));
    })
  );

  function appendSource(label, text) {
    const cur = $source.value.trim();
    $source.value = (cur ? cur + '\n\n' : '') + `### ${label}\n${text}`;
    updateInfo();
    $source.scrollTop = $source.scrollHeight;
  }
  function updateInfo() {
    const n = $source.value.length;
    $info.textContent = n
      ? `${n.toLocaleString()}자` + (n > settings.max_source_chars ? ` — 최대 ${settings.max_source_chars.toLocaleString()}자까지만 모델에 전달됩니다 (앞부분 사용). 필요한 부분만 남겨주세요.` : '')
      : '';
    $info.classList.toggle('warn', n > settings.max_source_chars);
  }
  $source.addEventListener('input', updateInfo);
  $('clear-source').addEventListener('click', () => { $source.value = ''; updateInfo(); });

  $('extract').addEventListener('click', async () => {
    const files = $('files').files;
    if (!files.length) return alert('파일을 선택하세요.');
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    const btn = $('extract');
    btn.disabled = true; btn.textContent = '추출 중…';
    try {
      const res = await fetch('/api/ai/extract', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '추출 실패');
      const failed = [];
      for (const p of data.parts) {
        if (p.error) failed.push(`${p.name}: ${p.error}`);
        else if (!p.text) failed.push(`${p.name}: 텍스트가 없습니다 (스캔 이미지 PDF일 수 있음)`);
        else appendSource(`${p.name} (${p.chars.toLocaleString()}자)`, p.text);
      }
      if (failed.length) alert(failed.join('\n'));
      $('files').value = '';
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false; btn.textContent = '텍스트 추출';
    }
  });

  $('fetch-url').addEventListener('click', async () => {
    const url = $('url').value.trim();
    if (!url) return;
    const btn = $('fetch-url');
    btn.disabled = true; btn.textContent = '가져오는 중…';
    try {
      const r = await api('/api/ai/fetch-url', { method: 'POST', body: JSON.stringify({ url }) });
      if (!r.text) throw new Error('본문 텍스트를 찾지 못했습니다.');
      appendSource(`${r.title || url} (${r.text.length.toLocaleString()}자)`, r.text);
      if (!$('new-title').value) $('new-title').value = r.title || '';
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false; btn.textContent = '가져오기';
    }
  });

  // ---------- 생성 ----------
  $gen.addEventListener('click', async () => {
    if (!$model.value) return alert('Ollama에 연결하고 모델을 선택하세요.');
    if (!$source.value.trim()) return alert('자료 텍스트를 넣으세요.');
    const body = {
      url: $url.value, model: $model.value, text: $source.value,
      count: Number($('count').value), difficulty: $('difficulty').value, language: $('language').value,
      instructions: $('instructions').value,
    };
    setGenerating(true);
    try {
      const job = await api('/api/ai/generate', { method: 'POST', body: JSON.stringify(body) });
      jobId = job.id;
      poll();
    } catch (err) {
      alert(err.message);
      setGenerating(false);
    }
  });
  $cancel.addEventListener('click', async () => {
    if (jobId) await api(`/api/ai/jobs/${jobId}`, { method: 'DELETE' }).catch(() => {});
  });

  function setGenerating(on) {
    $gen.disabled = on;
    $cancel.classList.toggle('hidden', !on);
    if (!on) { clearTimeout(pollTimer); jobId = null; }
  }

  async function poll() {
    if (!jobId) return;
    let job;
    try {
      job = await api(`/api/ai/jobs/${jobId}`);
    } catch (err) {
      $genStatus.textContent = err.message;
      setGenerating(false);
      return;
    }
    const sec = Math.round(job.elapsed_ms / 1000);
    if (job.status === 'running') {
      $genStatus.textContent = `생성 중… ${sec}초 경과, ${job.chars.toLocaleString()}자 출력 (${job.model})${job.truncated ? ' · 자료 앞부분만 사용됨' : ''}`;
      pollTimer = setTimeout(poll, 1500);
      return;
    }
    setGenerating(false);
    if (job.status === 'error') {
      $genStatus.textContent = `실패: ${job.error}`;
      $genStatus.className = 'hint error';
      return;
    }
    $genStatus.className = 'hint ok';
    $genStatus.textContent = `완료 — ${job.result.questions.length}문제, ${sec}초`;
    result = job.result;
    if (!$('new-title').value) $('new-title').value = result.title;
    renderResult();
  }

  // ---------- 결과 미리보기 ----------
  function renderResult() {
    $('result').classList.remove('hidden');
    $('result-count').textContent = `(${result.questions.length}문제)`;
    $('questions').innerHTML = result.questions
      .map(
        (q, i) => `
      <div class="gen-q">
        <label class="gen-head"><input type="checkbox" class="use" data-i="${i}" checked> <b>Q${i + 1}.</b> ${escapeHtml(q.text)}</label>
        <ul class="gen-opts">
          ${q.options.map((o, j) => `<li class="${o.is_correct ? 'correct' : ''}"><span class="shape ${OPTION_COLORS[j]}">${SHAPES[j]}</span> ${escapeHtml(o.text)}${o.is_correct ? ' ✔' : ''}</li>`).join('')}
        </ul>
      </div>`
      )
      .join('');
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    loadQuizTargets();
  }

  async function loadQuizTargets() {
    const quizzes = await api('/api/quizzes');
    const sel = $('append-target');
    sel.innerHTML = quizzes.length
      ? quizzes.map((q) => `<option value="${q.id}">${escapeHtml(q.title)} (${q.question_count}문제)</option>`).join('')
      : '<option value="">기존 퀴즈 없음</option>';
    if (presetQuiz && quizzes.some((q) => String(q.id) === presetQuiz)) {
      sel.value = presetQuiz;
      document.querySelector('input[name="push-mode"][value="append"]').checked = true;
    }
  }

  $('push').addEventListener('click', async () => {
    if (!result) return;
    const picked = [...document.querySelectorAll('.use:checked')].map((c) => result.questions[Number(c.dataset.i)]);
    if (!picked.length) return alert('넣을 문제를 하나 이상 선택하세요.');
    const mode = document.querySelector('input[name="push-mode"]:checked').value;
    const btn = $('push');
    btn.disabled = true;
    try {
      let quizId;
      if (mode === 'new') {
        const title = $('new-title').value.trim() || result.title || 'AI 생성 퀴즈';
        quizId = (await api('/api/quizzes', { method: 'POST', body: JSON.stringify({ title, description: `AI 생성 (${$model.value})` }) })).id;
      } else {
        quizId = $('append-target').value;
        if (!quizId) throw new Error('추가할 퀴즈를 선택하세요.');
      }
      await api(`/api/quizzes/${quizId}/questions`, { method: 'POST', body: JSON.stringify({ questions: picked }) });
      location.href = `/quiz/${quizId}`;
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
    }
  });
})();
