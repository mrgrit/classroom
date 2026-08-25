// 보드 목록 페이지
(async function () {
  const loggedIn = await Auth.init();
  if (!loggedIn) return;

  document.getElementById('boards-view').classList.remove('hidden');
  if (Auth.me.admin) document.getElementById('admin-panel').classList.remove('hidden');

  let boardsCache = [];

  // 새 보드 폼의 배경 선택기: 기존 보드들이 가장 적게 쓴 테마를 미리 골라 둠
  const $themeRow = document.getElementById('board-theme-row');
  function resetThemePicker() {
    if (!$themeRow) return;
    $themeRow.querySelector('.theme-picker')?.remove();
    $themeRow.insertAdjacentHTML('beforeend', themePickerHtml(suggestTheme(boardsCache.map((b) => b.theme))));
  }
  if ($themeRow) bindThemePicker($themeRow);

  document.getElementById('board-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('board-title').value.trim();
    const description = document.getElementById('board-desc').value.trim();
    const columns = document.getElementById('board-columns').value.split(',').map((c) => c.trim()).filter(Boolean);
    const theme = $themeRow.querySelector('.theme-picker')?.dataset.selected || '';
    if (!title) return;
    try {
      await api('/api/boards', { method: 'POST', body: JSON.stringify({ title, description, columns, theme }) });
      document.getElementById('board-form').reset();
      await loadBoards();
    } catch (err) {
      alert(err.message);
    }
  });

  async function loadBoards() {
    const boards = await api('/api/boards');
    boardsCache = boards;
    const list = document.getElementById('board-list');
    document.getElementById('empty-boards').classList.toggle('hidden', boards.length > 0);
    list.innerHTML = boards
      .map(
        (b) => `
      <a class="board-card" href="/board/${b.id}">
        <div class="card-band ${themeClasses(b.theme) || 'band-none'}" title="${escapeHtml(themeInfo(b.theme).name)}"></div>
        <h3>${escapeHtml(b.title)}</h3>
        <p>${escapeHtml(b.description)}</p>
        ${b.is_private ? `<span class="board-lock">🔒 지정 학생 ${b.member_count}명만 접근</span>` : ''}
        <div class="board-meta">
          <span>📝 게시물 ${b.post_count}개 · 컬럼 ${b.column_count}개</span>
          <span>만든이: ${escapeHtml(b.creator_name)}</span>
        </div>
        ${Auth.me.admin ? `
        <span class="card-btns">
          <button class="btn btn-small board-theme" data-id="${b.id}" title="배경 바꾸기">🎨</button>
          <button class="btn btn-small board-members" data-id="${b.id}" title="접근권한 (지정 학생만 보기)">👥</button>
          <button class="btn btn-small btn-danger board-delete" data-id="${b.id}">삭제</button>
        </span>` : ''}
      </a>`
      )
      .join('');

    list.querySelectorAll('.board-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm('보드와 모든 게시물이 삭제됩니다. 계속할까요?')) return;
        await api(`/api/boards/${btn.dataset.id}`, { method: 'DELETE' });
        loadBoards();
      });
    });
    list.querySelectorAll('.board-members').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const b = boardsCache.find((x) => x.id === Number(btn.dataset.id));
        if (b) openMembersModal(b);
      });
    });
    list.querySelectorAll('.board-theme').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const b = boardsCache.find((x) => x.id === Number(btn.dataset.id));
        if (!b) return;
        openThemeModal({
          title: `"${b.title}" 배경`,
          current: b.theme,
          onSave: async (theme) => {
            try {
              await api(`/api/boards/${b.id}`, { method: 'PUT', body: JSON.stringify({ theme }) });
              await loadBoards();
            } catch (err) { alert(err.message); return false; }
          },
        });
      });
    });
    if (Auth.me.admin) resetThemePicker();
  }

  // 보드 접근권한(멤버) 지정: 로그인한 적 있는 사용자 체크 + 이메일 직접 추가. 비우면 전체 공개
  async function openMembersModal(b) {
    let users = [];
    try { users = await api('/api/users'); } catch (err) { return alert(err.message); }
    const selected = new Set((b.members || []).map((e) => e.toLowerCase()));
    const known = new Set(users.map((u) => u.email.toLowerCase()));
    const extra = [...selected].filter((e) => !known.has(e)); // 아직 로그인 안 한 이메일
    const modal = document.createElement('div');
    modal.className = 'modal-bg';
    modal.innerHTML = `
      <div class="modal">
        <h3>"${escapeHtml(b.title)}" 보드 접근권한</h3>
        <p class="hint">지정하면 관리자(선생님)와 여기 선택된 학생만 이 보드를 보고 쓸 수 있습니다. 아무도 선택하지 않으면 로그인한 누구나 접근할 수 있습니다.</p>
        <input type="text" class="mgr-filter" placeholder="이름/이메일 검색">
        <div class="mgr-list">
          ${users.map((u) => `<label class="mgr-item"><input type="checkbox" value="${escapeHtml(u.email.toLowerCase())}" ${selected.has(u.email.toLowerCase()) ? 'checked' : ''}> ${escapeHtml(u.name)} <span class="hint">${escapeHtml(u.email)}</span></label>`).join('')}
          ${users.length ? '' : '<p class="hint">아직 로그인한 학생이 없습니다. 아래에 이메일을 직접 입력하세요.</p>'}
        </div>
        <input type="text" class="mgr-extra" placeholder="이메일 직접 추가 (쉼표로 여러 명, 아직 로그인 안 한 학생도 가능)" value="${escapeHtml(extra.join(', '))}">
        <div class="modal-actions">
          <button type="button" class="btn mgr-clear">모두 해제</button>
          <span class="spacer"></span>
          <button type="button" class="btn mgr-cancel">취소</button>
          <button type="button" class="btn btn-primary mgr-save">저장</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.mgr-filter').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      modal.querySelectorAll('.mgr-item').forEach((el) => el.classList.toggle('hidden', q && !el.textContent.toLowerCase().includes(q)));
    });
    modal.querySelector('.mgr-clear').addEventListener('click', () => {
      modal.querySelectorAll('.mgr-item input').forEach((c) => { c.checked = false; });
      modal.querySelector('.mgr-extra').value = '';
    });
    modal.querySelector('.mgr-cancel').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('.mgr-save').addEventListener('click', async () => {
      const emails = [...modal.querySelectorAll('.mgr-item input:checked')].map((c) => c.value);
      emails.push(...modal.querySelector('.mgr-extra').value.split(',').map((e) => e.trim()).filter(Boolean));
      try {
        await api(`/api/boards/${b.id}/members`, { method: 'PUT', body: JSON.stringify({ emails }) });
        close();
        loadBoards();
      } catch (err) {
        alert(err.message);
      }
    });
    modal.querySelector('.mgr-filter').focus();
  }

  loadBoards();
})();
