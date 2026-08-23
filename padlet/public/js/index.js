// 보드 목록 페이지
(async function () {
  const loggedIn = await Auth.init();
  if (!loggedIn) return;

  document.getElementById('boards-view').classList.remove('hidden');
  if (Auth.me.admin) document.getElementById('admin-panel').classList.remove('hidden');

  document.getElementById('board-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('board-title').value.trim();
    const description = document.getElementById('board-desc').value.trim();
    if (!title) return;
    try {
      await api('/api/boards', { method: 'POST', body: JSON.stringify({ title, description }) });
      document.getElementById('board-form').reset();
      loadBoards();
    } catch (err) {
      alert(err.message);
    }
  });

  async function loadBoards() {
    const boards = await api('/api/boards');
    const list = document.getElementById('board-list');
    document.getElementById('empty-boards').classList.toggle('hidden', boards.length > 0);
    list.innerHTML = boards
      .map(
        (b) => `
      <a class="board-card" href="/board/${b.id}">
        <h3>${escapeHtml(b.title)}</h3>
        <p>${escapeHtml(b.description)}</p>
        <div class="board-meta">
          <span>📝 게시물 ${b.post_count}개</span>
          <span>만든이: ${escapeHtml(b.creator_name)}</span>
        </div>
        ${Auth.me.admin ? `<button class="btn btn-small btn-danger board-delete" data-id="${b.id}">삭제</button>` : ''}
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
  }

  loadBoards();
})();
