// 보드 상세 페이지: 게시물 그리드 + 좋아요/댓글, 5초 폴링으로 갱신
(async function () {
  const boardId = location.pathname.split('/').pop();
  const COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'orange'];
  let selectedColor = 'yellow';
  let me = null;

  const loggedIn = await Auth.init();
  if (!loggedIn) return;

  document.getElementById('board-view').classList.remove('hidden');

  // 색상 선택기
  const picker = document.getElementById('color-picker');
  picker.innerHTML = COLORS.map(
    (c) => `<button type="button" class="color-dot color-${c} ${c === selectedColor ? 'selected' : ''}" data-color="${c}" aria-label="${c}"></button>`
  ).join('');
  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('.color-dot');
    if (!btn) return;
    selectedColor = btn.dataset.color;
    picker.querySelectorAll('.color-dot').forEach((d) => d.classList.toggle('selected', d === btn));
  });

  // 새 게시물
  document.getElementById('post-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('post-title').value.trim();
    const content = document.getElementById('post-content').value.trim();
    if (!content) return;
    try {
      await api(`/api/boards/${boardId}/posts`, {
        method: 'POST',
        body: JSON.stringify({ title, content, color: selectedColor }),
      });
      document.getElementById('post-form').reset();
      load();
    } catch (err) {
      alert(err.message);
    }
  });

  async function load() {
    let data;
    try {
      data = await api(`/api/boards/${boardId}`);
    } catch (err) {
      document.getElementById('board-title').textContent = err.message;
      return;
    }
    me = data.me;
    document.title = `${data.board.title} - Classroom Padlet`;
    document.getElementById('board-title').textContent = data.board.title;
    document.getElementById('board-desc').textContent = data.board.description;
    document.getElementById('empty-posts').classList.toggle('hidden', data.posts.length > 0);
    renderPosts(data.posts);
  }

  function renderPosts(posts) {
    const grid = document.getElementById('post-grid');
    // 댓글 입력 중 폴링으로 내용이 날아가지 않게, 입력값을 보존
    const draftComments = {};
    grid.querySelectorAll('.comment-input').forEach((input) => {
      if (input.value) draftComments[input.dataset.postId] = input.value;
    });

    grid.innerHTML = posts.map((p) => postCard(p)).join('');

    for (const [postId, draft] of Object.entries(draftComments)) {
      const input = grid.querySelector(`.comment-input[data-post-id="${postId}"]`);
      if (input) input.value = draft;
    }

    // 좋아요
    grid.querySelectorAll('.like-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const result = await api(`/api/posts/${btn.dataset.id}/like`, { method: 'POST' });
        btn.classList.toggle('liked', result.liked);
        btn.querySelector('.like-count').textContent = result.like_count;
      });
    });

    // 게시물 삭제
    grid.querySelectorAll('.post-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('게시물을 삭제할까요?')) return;
        await api(`/api/posts/${btn.dataset.id}`, { method: 'DELETE' });
        load();
      });
    });

    // 댓글 작성
    grid.querySelectorAll('.comment-form').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = form.querySelector('.comment-input');
        const content = input.value.trim();
        if (!content) return;
        try {
          await api(`/api/posts/${form.dataset.postId}/comments`, {
            method: 'POST',
            body: JSON.stringify({ content }),
          });
          input.value = '';
          load();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    // 댓글 삭제
    grid.querySelectorAll('.comment-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api(`/api/comments/${btn.dataset.id}`, { method: 'DELETE' });
        load();
      });
    });
  }

  function postCard(p) {
    const canDelete = p.is_mine || me.admin;
    const time = p.created_at.replace('T', ' ').slice(0, 16);
    return `
    <div class="post-card color-${p.color}">
      <div class="post-head">
        <span class="post-author">${escapeHtml(p.author_name)}</span>
        ${canDelete ? `<button class="icon-btn post-delete" data-id="${p.id}" title="삭제">✕</button>` : ''}
      </div>
      ${p.title ? `<h3 class="post-title">${escapeHtml(p.title)}</h3>` : ''}
      <p class="post-content">${escapeHtml(p.content)}</p>
      <div class="post-foot">
        <button class="like-btn ${p.liked_by_me ? 'liked' : ''}" data-id="${p.id}">
          ❤️ <span class="like-count">${p.like_count}</span>
        </button>
        <span class="post-time">${time}</span>
      </div>
      <div class="comments">
        ${p.comments
          .map(
            (c) => `
          <div class="comment">
            <span class="comment-author">${escapeHtml(c.author_name)}</span>
            <span class="comment-content">${escapeHtml(c.content)}</span>
            ${c.user_id === me.uid || me.admin ? `<button class="icon-btn comment-delete" data-id="${c.id}" title="삭제">✕</button>` : ''}
          </div>`
          )
          .join('')}
        <form class="comment-form" data-post-id="${p.id}">
          <input type="text" class="comment-input" data-post-id="${p.id}" placeholder="댓글 달기..." maxlength="500">
        </form>
      </div>
    </div>`;
  }

  await load();
  setInterval(load, 5000);
})();
