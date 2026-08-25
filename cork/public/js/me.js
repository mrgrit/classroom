// 내 정보 페이지: 프로필 + 개인 Ollama 설정(연결→모델 선택→저장) + 내 AI 학습자료 목록
(async function () {
  const loggedIn = await Auth.init();
  if (!loggedIn) return;
  document.getElementById('me-view').classList.remove('hidden');

  const me = Auth.me;
  document.getElementById('profile-card').innerHTML = `
    <div class="me-profile">
      ${me.picture ? `<img class="avatar" src="${me.picture}" alt="" referrerpolicy="no-referrer">` : ''}
      <div>
        <div class="me-name">${escapeHtml(me.name)}${me.admin ? ' <span class="badge">관리자</span>' : ''}</div>
        <div class="hint">${escapeHtml(me.email)}</div>
      </div>
    </div>`;

  // DB의 UTC 시각 → 서울 시간
  const timeFmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const fmtTime = (utc) => {
    const d = new Date(String(utc).replace(' ', 'T') + 'Z');
    return isNaN(d) ? utc : timeFmt.format(d);
  };

  // ---------- AI 설정 ----------

  const $url = document.getElementById('ai-url');
  const $connect = document.getElementById('ai-connect');
  const $model = document.getElementById('ai-model');
  const $save = document.getElementById('ai-save');
  const $cstat = document.getElementById('ai-connect-status');
  const $sstat = document.getElementById('ai-save-status');

  let saved = { ollama_url: '', model: '' };
  try { saved = await api('/api/my/ai'); } catch {}
  $url.value = saved.ollama_url;
  if (saved.ollama_url && saved.model) $sstat.textContent = `현재 설정: ${saved.model} @ ${saved.ollama_url}`;

  async function connect(silent = false) {
    const url = $url.value.trim();
    if (!url) {
      if (!silent) $cstat.textContent = '서버 주소를 입력하세요.';
      return;
    }
    $connect.disabled = true;
    $cstat.textContent = '⏳ 연결 중...';
    try {
      const { url: normalized, models } = await api('/api/my/ai/connect', { method: 'POST', body: JSON.stringify({ url }) });
      $url.value = normalized;
      $model.innerHTML = models.length
        ? models.map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}${m.parameter_size ? ` (${escapeHtml(m.parameter_size)})` : ''}</option>`).join('')
        : '<option value="">서버에 설치된 모델이 없습니다</option>';
      if (saved.model && models.some((m) => m.name === saved.model)) $model.value = saved.model;
      $model.disabled = !models.length;
      $save.disabled = !models.length;
      $cstat.textContent = `✅ 연결됨 — 사용 가능한 모델 ${models.length}개`;
    } catch (err) {
      $cstat.textContent = `❌ ${err.message}`;
    }
    $connect.disabled = false;
  }
  $connect.addEventListener('click', () => connect());
  $url.addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
  if (saved.ollama_url) connect(true); // 저장된 서버가 있으면 조용히 자동 연결

  $save.addEventListener('click', async () => {
    $save.disabled = true;
    try {
      const result = await api('/api/my/ai', { method: 'PUT', body: JSON.stringify({ ollama_url: $url.value, model: $model.value }) });
      saved = { ollama_url: result.ollama_url, model: result.model };
      $sstat.textContent = `✅ 저장됨 — ${result.model} @ ${result.ollama_url}`;
    } catch (err) {
      $sstat.textContent = `❌ ${err.message}`;
    }
    $save.disabled = false;
  });

  // ---------- 내 학습자료 ----------

  async function loadReports() {
    let reports = [];
    try { reports = await api('/api/my/reports'); } catch (err) { return; }
    const list = document.getElementById('report-list');
    document.getElementById('empty-reports').classList.toggle('hidden', reports.length > 0);
    list.innerHTML = reports
      .map(
        (r) => `
      <div class="report-row" data-id="${r.id}">
        <div class="report-row-main">
          <a href="/report/${r.id}">${escapeHtml(r.title)}</a>
          <div class="hint">${escapeHtml([r.board_title, r.column_title].filter(Boolean).join(' / '))} · ${escapeHtml(r.model)} · ${fmtTime(r.created_at)}</div>
        </div>
        <a class="btn btn-small" href="/api/reports/${r.id}/pdf">PDF</a>
        <button class="btn btn-small btn-danger report-delete" data-id="${r.id}">삭제</button>
      </div>`
      )
      .join('');
    list.querySelectorAll('.report-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('이 학습자료를 삭제할까요?')) return;
        try {
          await api(`/api/reports/${btn.dataset.id}`, { method: 'DELETE' });
          loadReports();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }
  loadReports();
  // ---------- 헤르메스 연동 ----------

  const $h = (id) => document.getElementById(id);
  let hermesData = null;

  async function loadHermes() {
    try {
      hermesData = await api('/api/my/hermes');
    } catch (err) {
      $h('hermes-status').textContent = `❌ ${err.message}`;
      return;
    }
    renderHermes();
  }

  function renderHermes() {
    const d = hermesData;
    $h('hermes-status').textContent = d.linked
      ? `✅ 연동됨 — 토큰 발급 ${fmtTime(d.created_at)}${d.last_used_at ? `, 마지막 사용 ${fmtTime(d.last_used_at)}` : ', 아직 사용된 적 없음'}`
      : '아직 연동되지 않았습니다. 토큰을 발급하세요.';
    $h('hermes-issue').textContent = d.linked ? '토큰 재발급' : '토큰 발급';
    $h('hermes-revoke').classList.toggle('hidden', !d.linked);
    $h('hermes-board').innerHTML =
      '<option value="">(선택 안 함)</option>' +
      d.targets.map((b) => `<option value="${b.id}" ${d.board && d.board.id === b.id ? 'selected' : ''}>${escapeHtml(b.title)}</option>`).join('');
    fillHermesColumns();
    $h('hermes-topic').value = d.topic || '';
    $h('hermes-auto').checked = !!d.auto_save;
    if (!d.targets.length) $h('hermes-save-status').textContent = '글을 쓸 수 있는 보드가 없습니다. 관리자에게 보드 접근권한/컬럼 지정을 요청하세요.';
  }

  // 과목을 고르면 컬럼 목록 채움. 저장된 컬럼이 있으면 그것, 없으면 내 지정(★) 컬럼을 기본 선택
  function fillHermesColumns() {
    const d = hermesData;
    const $c = $h('hermes-column');
    const board = d.targets.find((b) => b.id === Number($h('hermes-board').value));
    const current = board && d.board && d.board.id === board.id && d.column ? d.column.id : null;
    $c.innerHTML = board
      ? board.columns.map((c) => `<option value="${c.id}" ${c.id === current || (!current && c.managed) ? 'selected' : ''}>${escapeHtml(c.title)}${c.managed ? ' ★ 내 지정 컬럼' : ''}</option>`).join('')
      : '<option value="">과목을 먼저 선택하세요</option>';
    $c.disabled = !board;
  }
  $h('hermes-board').addEventListener('change', fillHermesColumns);

  $h('hermes-issue').addEventListener('click', async () => {
    if (hermesData?.linked && !confirm('토큰을 재발급하면 이전 토큰으로 연결된 헤르메스는 더 이상 저장하지 못합니다. 계속할까요?')) return;
    try {
      const r = await api('/api/my/hermes/token', { method: 'POST' });
      $h('hermes-token').textContent = r.token;
      $h('hermes-install').textContent = r.install_command;
      $h('hermes-token-box').classList.remove('hidden');
      await loadHermes();
    } catch (err) {
      alert(err.message);
    }
  });

  $h('hermes-revoke').addEventListener('click', async () => {
    if (!confirm('헤르메스 연동을 해제할까요? (토큰이 무효화되고, 저장 위치 설정은 유지됩니다)')) return;
    try {
      await api('/api/my/hermes/token', { method: 'DELETE' });
      $h('hermes-token-box').classList.add('hidden');
      await loadHermes();
    } catch (err) {
      alert(err.message);
    }
  });

  $h('hermes-copy-install').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($h('hermes-install').textContent);
      $h('hermes-copy-install').textContent = '복사됨 ✓';
      setTimeout(() => { $h('hermes-copy-install').textContent = '복사'; }, 1500);
    } catch {
      alert('클립보드 복사에 실패했습니다. 직접 선택해서 복사하세요.');
    }
  });

  $h('hermes-save').addEventListener('click', async () => {
    const boardId = $h('hermes-board').value;
    const body = {
      board: boardId ? Number(boardId) : null,
      column: boardId && $h('hermes-column').value ? Number($h('hermes-column').value) : null,
      topic: $h('hermes-topic').value,
      auto_save: $h('hermes-auto').checked,
    };
    $h('hermes-save').disabled = true;
    try {
      const ctx = await api('/api/my/hermes/context', { method: 'PUT', body: JSON.stringify(body) });
      hermesData = { ...hermesData, ...ctx };
      renderHermes();
      $h('hermes-save-status').textContent = ctx.column
        ? `✅ 저장됨 — ${ctx.board.title} / ${ctx.column.title}${ctx.topic ? ` · ${ctx.topic}` : ''} · 자동 저장 ${ctx.auto_save ? '켜짐' : '꺼짐'}`
        : '✅ 저장됨 — 저장 위치가 비어 있습니다. 과목과 컬럼을 선택하면 자동 저장이 시작됩니다.';
    } catch (err) {
      $h('hermes-save-status').textContent = `❌ ${err.message}`;
    }
    $h('hermes-save').disabled = false;
  });
  loadHermes();
})();
