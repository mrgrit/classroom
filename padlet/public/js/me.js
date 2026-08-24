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
})();
