// 보드 상세 페이지: 컬럼(셸프) 레이아웃 + 게시물/좋아요/댓글 + 파일 첨부(복붙/드래그/선택)
(async function () {
  const boardId = location.pathname.split('/').pop();
  const COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'orange'];

  const state = { board: null, columns: [], me: null };
  let compose = null; // { columnId, title, content, color, files: [...] }
  const commentDrafts = {}; // postId -> { text, files: [...] }

  const loggedIn = await Auth.init();
  if (!loggedIn) return;
  document.getElementById('board-view').classList.remove('hidden');

  const $columns = document.getElementById('board-columns');
  const $tools = document.getElementById('board-tools');

  // ---------- 데이터 로드 ----------

  async function load(force = false) {
    let data;
    try {
      data = await api(`/api/boards/${boardId}`);
    } catch (err) {
      document.getElementById('board-title').textContent = err.message;
      return;
    }
    Object.assign(state, data);
    document.title = `${data.board.title} - Classroom Padlet`;
    document.getElementById('board-title').textContent = data.board.title;
    document.getElementById('board-desc').textContent = data.board.description;
    // 입력 중이면 폴링 갱신으로 화면을 다시 그리지 않음 (포커스/커서 보호)
    if (!force && isTyping()) return;
    render();
  }

  function isTyping() {
    if (drag) return true; // 드래그 중 재렌더링하면 드래그가 끊김
    const el = document.activeElement;
    return el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && $columns.contains(el);
  }

  // ---------- 렌더링 ----------

  function render() {
    const { columns, me } = state;
    $tools.innerHTML = me.admin ? `<button class="btn btn-small col-add">＋ 컬럼 추가</button>` : '';
    $columns.classList.toggle('single', columns.length === 1);
    $columns.innerHTML = columns.map((col, i) => columnHtml(col, i, columns.length)).join('');
  }

  function columnHtml(col, index, total) {
    const { me } = state;
    const adminTools = me.admin
      ? `<span class="col-tools">
           <button class="icon-btn col-left" data-id="${col.id}" title="왼쪽으로" ${index === 0 ? 'disabled' : ''}>◀</button>
           <button class="icon-btn col-right" data-id="${col.id}" title="오른쪽으로" ${index === total - 1 ? 'disabled' : ''}>▶</button>
           <button class="icon-btn col-rename" data-id="${col.id}" title="이름 변경">✎</button>
           <button class="icon-btn col-delete" data-id="${col.id}" title="컬럼 삭제" ${total <= 1 ? 'disabled' : ''}>✕</button>
         </span>`
      : '';
    const composeArea =
      compose && compose.columnId === col.id
        ? composeHtml()
        : `<button class="col-add-post" data-col="${col.id}">＋ 게시물 올리기</button>`;
    const colHandle = me.admin && total > 1 ? `<span class="drag-handle col-handle" title="끌어서 컬럼 순서 변경">⠿</span>` : '';
    return `
    <section class="column" data-col="${col.id}">
      <header class="column-head">
        <h3>${colHandle}${escapeHtml(col.title)} <span class="col-count">${col.posts.length}</span></h3>
        ${adminTools}
      </header>
      ${composeArea}
      <div class="column-posts">
        ${col.posts.map((p) => postCard(p)).join('')}
        ${col.posts.length === 0 && !(compose && compose.columnId === col.id) ? '<p class="col-empty">아직 게시물이 없습니다.</p>' : ''}
      </div>
    </section>`;
  }

  function composeHtml() {
    return `
    <form class="compose-form post-card color-${compose.color}">
      <input type="text" class="compose-title" placeholder="제목 (선택)" maxlength="100" value="${escapeHtml(compose.title)}">
      <textarea class="compose-content" placeholder="내용을 입력하세요. 캡처한 이미지를 붙여넣거나(Ctrl+V) 파일을 끌어다 놓을 수 있습니다." rows="4" maxlength="2000">${escapeHtml(compose.content)}</textarea>
      <div class="chips compose-chips">${chipsHtml(compose.files, 'compose')}</div>
      <div class="compose-footer">
        <div class="color-picker">
          ${COLORS.map((c) => `<button type="button" class="color-dot color-${c} ${c === compose.color ? 'selected' : ''}" data-color="${c}" aria-label="${c}"></button>`).join('')}
        </div>
        <div class="compose-actions">
          <input type="file" class="compose-file hidden" multiple>
          <button type="button" class="btn btn-small compose-attach" title="파일 첨부">📎 파일</button>
          <button type="button" class="btn btn-small compose-cancel">취소</button>
          <button type="submit" class="btn btn-small btn-primary">게시</button>
        </div>
      </div>
    </form>`;
  }

  function chipsHtml(files, scope, postId = '') {
    return files
      .map((f, i) => {
        const thumb = f.uploading
          ? '<span class="chip-spinner">⏳</span>'
          : f.is_image
            ? `<img src="${f.url}" alt="">`
            : '<span class="chip-icon">📄</span>';
        return `<span class="chip ${f.uploading ? 'uploading' : ''}">
          ${thumb}<span class="chip-name">${escapeHtml(f.name)}</span>
          <button type="button" class="chip-remove" data-scope="${scope}" data-post-id="${postId}" data-idx="${i}" title="제거">✕</button>
        </span>`;
      })
      .join('');
  }

  function attachmentsHtml(list, small = false) {
    if (!list || !list.length) return '';
    const images = list.filter((a) => a.is_image);
    const files = list.filter((a) => !a.is_image);
    return `
      ${images.length ? `<div class="att-images ${small ? 'small' : ''}">${images
        .map((a) => `<a href="${a.url}" target="_blank" rel="noopener"><img src="${a.url}" alt="${escapeHtml(a.name)}" loading="lazy"></a>`)
        .join('')}</div>` : ''}
      ${files.length ? `<div class="att-files">${files
        .map((a) => `<a class="att-file" href="${a.url}" target="_blank" rel="noopener">📄 ${escapeHtml(a.name)} <span class="att-size">${fmtSize(a.size)}</span></a>`)
        .join('')}</div>` : ''}`;
  }

  function postCard(p) {
    const { me, columns } = state;
    const canEdit = p.is_mine || me.admin;
    const time = fmtTime(p.created_at);
    const draft = commentDrafts[p.id] || { text: '', files: [] };
    const moveSelect =
      canEdit && columns.length > 1
        ? `<select class="post-move" data-id="${p.id}" title="다른 컬럼으로 이동">
             ${columns.map((c) => `<option value="${c.id}" ${c.id === p.column_id ? 'selected' : ''}>${escapeHtml(c.title)}</option>`).join('')}
           </select>`
        : '';
    return `
    <article class="post-card color-${p.color}" data-id="${p.id}">
      <div class="post-head">
        <span class="post-author">${canEdit ? '<span class="drag-handle post-handle" title="끌어서 이동">⠿</span>' : ''}${escapeHtml(p.author_name)}</span>
        <span class="post-head-tools">
          ${moveSelect}
          ${canEdit ? `<button class="icon-btn post-delete" data-id="${p.id}" title="삭제">✕</button>` : ''}
        </span>
      </div>
      ${p.title ? `<h4 class="post-title">${escapeHtml(p.title)}</h4>` : ''}
      ${p.content ? `<p class="post-content">${escapeHtml(p.content)}</p>` : ''}
      ${attachmentsHtml(p.attachments)}
      <div class="post-foot">
        <button class="like-btn ${p.liked_by_me ? 'liked' : ''}" data-id="${p.id}">❤️ <span class="like-count">${p.like_count}</span></button>
        <span class="post-time">${time}</span>
      </div>
      <div class="comments">
        ${p.comments.map((c) => `
          <div class="comment">
            <div class="comment-body">
              <span class="comment-author">${escapeHtml(c.author_name)}</span>
              <span class="comment-content">${escapeHtml(c.content)}</span>
              ${attachmentsHtml(c.attachments, true)}
            </div>
            ${c.user_id === me.uid || me.admin ? `<button class="icon-btn comment-delete" data-id="${c.id}" title="삭제">✕</button>` : ''}
          </div>`).join('')}
        <form class="comment-form" data-post-id="${p.id}">
          <div class="chips comment-chips">${chipsHtml(draft.files, 'comment', p.id)}</div>
          <div class="comment-row">
            <input type="text" class="comment-input" data-post-id="${p.id}" placeholder="댓글 달기... (이미지 붙여넣기 가능)" maxlength="500" value="${escapeHtml(draft.text)}">
            <input type="file" class="comment-file hidden" data-post-id="${p.id}" multiple>
            <button type="button" class="icon-btn comment-attach" data-post-id="${p.id}" title="파일 첨부">📎</button>
          </div>
        </form>
      </div>
    </article>`;
  }

  // DB의 UTC 시각("YYYY-MM-DD HH:MM:SS") → 서울 시간 "YYYY-MM-DD HH:MM"
  const timeFmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  function fmtTime(utc) {
    const d = new Date(utc.replace(' ', 'T') + 'Z');
    return isNaN(d) ? utc : timeFmt.format(d);
  }

  function fmtSize(n) {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
    return `${(n / 1024 / 1024).toFixed(1)}MB`;
  }

  // ---------- 업로드 ----------

  async function uploadFile(file) {
    const fd = new FormData();
    fd.append('file', file, file.name || 'image.png');
    const res = await fetch('/api/uploads', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '업로드 실패');
    return data;
  }

  // files: FileList 또는 File[] → target.files 배열에 업로드 결과 추가 (진행 중엔 placeholder)
  async function addFiles(fileList, target, scope, postId) {
    const max = scope === 'compose' ? 5 : 2;
    for (const file of Array.from(fileList)) {
      if (target.files.length >= max) {
        alert(`파일은 최대 ${max}개까지 첨부할 수 있습니다.`);
        break;
      }
      const placeholder = { uploading: true, name: file.name || '이미지', is_image: false };
      target.files.push(placeholder);
      refreshChips(scope, postId);
      try {
        const result = await uploadFile(file);
        const idx = target.files.indexOf(placeholder);
        if (idx >= 0) target.files[idx] = result;
      } catch (err) {
        target.files.splice(target.files.indexOf(placeholder), 1);
        alert(err.message);
      }
      refreshChips(scope, postId);
    }
  }

  function refreshChips(scope, postId) {
    if (scope === 'compose') {
      const el = $columns.querySelector('.compose-chips');
      if (el && compose) el.innerHTML = chipsHtml(compose.files, 'compose');
    } else {
      const el = $columns.querySelector(`.comment-form[data-post-id="${postId}"] .comment-chips`);
      const draft = commentDrafts[postId];
      if (el && draft) el.innerHTML = chipsHtml(draft.files, 'comment', postId);
    }
  }

  function filesFromClipboard(e) {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return [];
    const files = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    return files;
  }

  function getDraft(postId) {
    if (!commentDrafts[postId]) commentDrafts[postId] = { text: '', files: [] };
    return commentDrafts[postId];
  }

  // ---------- 이벤트 (위임) ----------

  $tools.addEventListener('click', async (e) => {
    if (e.target.closest('.col-add')) {
      const title = prompt('새 컬럼 이름');
      if (!title || !title.trim()) return;
      await run(() => api(`/api/boards/${boardId}/columns`, { method: 'POST', body: JSON.stringify({ title }) }));
    }
  });

  $columns.addEventListener('click', async (e) => {
    const t = e.target;
    const btn = t.closest('button');
    if (!btn) return;

    if (btn.classList.contains('col-add-post')) {
      compose = { columnId: Number(btn.dataset.col), title: '', content: '', color: 'yellow', files: [] };
      render();
      $columns.querySelector('.compose-content')?.focus();
      return;
    }
    if (btn.classList.contains('compose-cancel')) {
      compose = null;
      render();
      return;
    }
    if (btn.classList.contains('compose-attach')) {
      $columns.querySelector('.compose-file').click();
      return;
    }
    if (btn.classList.contains('color-dot')) {
      compose.color = btn.dataset.color;
      const form = btn.closest('.compose-form');
      form.className = `compose-form post-card color-${compose.color}`;
      form.querySelectorAll('.color-dot').forEach((d) => d.classList.toggle('selected', d === btn));
      return;
    }
    if (btn.classList.contains('chip-remove')) {
      const idx = Number(btn.dataset.idx);
      if (btn.dataset.scope === 'compose') {
        compose.files.splice(idx, 1);
        refreshChips('compose');
      } else {
        getDraft(btn.dataset.postId).files.splice(idx, 1);
        refreshChips('comment', btn.dataset.postId);
      }
      return;
    }
    if (btn.classList.contains('comment-attach')) {
      $columns.querySelector(`.comment-file[data-post-id="${btn.dataset.postId}"]`).click();
      return;
    }
    if (btn.classList.contains('like-btn')) {
      const result = await api(`/api/posts/${btn.dataset.id}/like`, { method: 'POST' });
      btn.classList.toggle('liked', result.liked);
      btn.querySelector('.like-count').textContent = result.like_count;
      return;
    }
    if (btn.classList.contains('post-delete')) {
      if (!confirm('게시물을 삭제할까요?')) return;
      await run(() => api(`/api/posts/${btn.dataset.id}`, { method: 'DELETE' }));
      return;
    }
    if (btn.classList.contains('comment-delete')) {
      await run(() => api(`/api/comments/${btn.dataset.id}`, { method: 'DELETE' }));
      return;
    }
    // 관리자 컬럼 도구
    if (btn.classList.contains('col-rename')) {
      const col = state.columns.find((c) => c.id === Number(btn.dataset.id));
      const title = prompt('컬럼 이름', col.title);
      if (!title || !title.trim() || title === col.title) return;
      await run(() => api(`/api/columns/${col.id}`, { method: 'PUT', body: JSON.stringify({ title }) }));
      return;
    }
    if (btn.classList.contains('col-delete')) {
      const col = state.columns.find((c) => c.id === Number(btn.dataset.id));
      if (!confirm(`"${col.title}" 컬럼과 그 안의 게시물 ${col.posts.length}개가 삭제됩니다. 계속할까요?`)) return;
      await run(() => api(`/api/columns/${col.id}`, { method: 'DELETE' }));
      return;
    }
    if (btn.classList.contains('col-left') || btn.classList.contains('col-right')) {
      const ids = state.columns.map((c) => c.id);
      const i = ids.indexOf(Number(btn.dataset.id));
      const j = btn.classList.contains('col-left') ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await run(() => api(`/api/boards/${boardId}/columns/order`, { method: 'PUT', body: JSON.stringify({ ids }) }));
    }
  });

  $columns.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.classList.contains('compose-form')) {
      if (compose.files.some((f) => f.uploading)) return alert('파일 업로드가 끝날 때까지 기다려주세요.');
      const body = {
        column_id: compose.columnId,
        title: compose.title,
        content: compose.content,
        color: compose.color,
        attachment_ids: compose.files.map((f) => f.id),
      };
      if (!body.content.trim() && !body.attachment_ids.length) return alert('내용을 입력하거나 파일을 첨부하세요.');
      const ok = await run(() => api(`/api/boards/${boardId}/posts`, { method: 'POST', body: JSON.stringify(body) }), false);
      if (ok) {
        compose = null;
        await load(true);
      }
    } else if (form.classList.contains('comment-form')) {
      const postId = form.dataset.postId;
      const draft = getDraft(postId);
      if (draft.files.some((f) => f.uploading)) return alert('파일 업로드가 끝날 때까지 기다려주세요.');
      if (!draft.text.trim() && !draft.files.length) return;
      const body = { content: draft.text, attachment_ids: draft.files.map((f) => f.id) };
      const ok = await run(() => api(`/api/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify(body) }), false);
      if (ok) {
        delete commentDrafts[postId];
        await load(true);
      }
    }
  });

  $columns.addEventListener('input', (e) => {
    const t = e.target;
    if (t.classList.contains('compose-title')) compose.title = t.value;
    else if (t.classList.contains('compose-content')) compose.content = t.value;
    else if (t.classList.contains('comment-input')) getDraft(t.dataset.postId).text = t.value;
  });

  $columns.addEventListener('change', (e) => {
    const t = e.target;
    if (t.classList.contains('compose-file')) {
      addFiles(t.files, compose, 'compose');
      t.value = '';
    } else if (t.classList.contains('comment-file')) {
      addFiles(t.files, getDraft(t.dataset.postId), 'comment', t.dataset.postId);
      t.value = '';
    } else if (t.classList.contains('post-move')) {
      run(() => api(`/api/posts/${t.dataset.id}`, { method: 'PUT', body: JSON.stringify({ column_id: Number(t.value) }) }));
    }
  });

  // 클립보드 붙여넣기: 캡처 이미지 → 업로드
  $columns.addEventListener('paste', (e) => {
    const t = e.target;
    const files = filesFromClipboard(e);
    if (!files.length) return;
    if (t.classList.contains('compose-content') || t.classList.contains('compose-title')) {
      e.preventDefault();
      addFiles(files, compose, 'compose');
    } else if (t.classList.contains('comment-input')) {
      e.preventDefault();
      addFiles(files, getDraft(t.dataset.postId), 'comment', t.dataset.postId);
    }
  });

  // ---------- 드래그 앤 드롭 ----------
  // (1) 파일을 작성 폼 위에 떨어뜨리면 첨부
  // (2) 게시물 손잡이(⠿)를 끌어 같은 컬럼 안에서 위아래로, 또는 다른 컬럼으로 이동
  // (3) 컬럼 손잡이(⠿)를 끌어 컬럼 좌우 순서 변경 (관리자)

  let drag = null; // { type: 'post'|'column', id, el, placeholder }

  // 손잡이를 누르는 동안에만 draggable 활성화 (카드 안의 입력창 텍스트 선택을 방해하지 않기 위해)
  $columns.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const el = handle.closest(handle.classList.contains('col-handle') ? '.column' : '.post-card[data-id]');
    if (el) el.setAttribute('draggable', 'true');
  });
  document.addEventListener('mouseup', () => {
    if (!drag) $columns.querySelectorAll('[draggable]').forEach((el) => el.removeAttribute('draggable'));
  });

  $columns.addEventListener('dragstart', (e) => {
    const el = e.target.closest && e.target.closest('[draggable="true"]');
    if (!el) return;
    const isColumn = el.classList.contains('column');
    const placeholder = document.createElement('div');
    placeholder.className = isColumn ? 'column drop-placeholder-col' : 'drop-placeholder';
    if (!isColumn) placeholder.style.height = `${el.offsetHeight}px`;
    drag = { type: isColumn ? 'column' : 'post', id: Number(isColumn ? el.dataset.col : el.dataset.id), el, placeholder };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(drag.id)); // Firefox는 데이터가 있어야 드래그 시작
    // 드래그 이미지가 잡힌 뒤에 원본을 숨기고 자리 표시
    setTimeout(() => {
      if (!drag) return;
      el.parentNode.insertBefore(placeholder, el);
      el.classList.add('drag-source');
    }, 0);
  });

  // 포인터 위치에 가장 가까운 요소와, 그 앞/뒤 중 어디에 넣을지 계산
  function nearest(items, x, y, horizontal) {
    let best = null;
    for (const item of items) {
      const r = item.getBoundingClientRect();
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      const d = dx * dx + dy * dy;
      if (!best || d < best.d) best = { item, r, d };
    }
    if (!best) return null;
    const after = horizontal ? x > (best.r.left + best.r.right) / 2 : y > (best.r.top + best.r.bottom) / 2;
    return { item: best.item, after };
  }

  function placePostPlaceholder(column, x, y) {
    const postsEl = column.querySelector('.column-posts');
    const cards = [...postsEl.querySelectorAll(':scope > .post-card[data-id]')].filter((c) => c !== drag.el);
    const n = nearest(cards, x, y, false);
    const ref = skipDragNodes(n ? (n.after ? n.item.nextElementSibling : n.item) : postsEl.firstElementChild);
    if (drag.placeholder.parentNode !== postsEl || drag.placeholder.nextElementSibling !== ref) {
      postsEl.insertBefore(drag.placeholder, ref);
    }
    $columns.querySelectorAll('.column.drop-target').forEach((c) => c !== column && c.classList.remove('drop-target'));
    column.classList.add('drop-target');
  }

  function placeColumnPlaceholder(x, y) {
    const cols = [...$columns.querySelectorAll(':scope > .column')].filter((c) => c !== drag.el && c !== drag.placeholder);
    const n = nearest(cols, x, y, true);
    if (!n) return;
    const ref = skipDragNodes(n.after ? n.item.nextElementSibling : n.item);
    if (drag.placeholder.nextElementSibling !== ref) $columns.insertBefore(drag.placeholder, ref);
  }

  // 기준 요소가 드래그 중인 원본이나 자리표시자면 그 다음 요소로
  function skipDragNodes(node) {
    while (node && (node === drag.el || node === drag.placeholder)) node = node.nextElementSibling;
    return node;
  }

  $columns.addEventListener('dragover', (e) => {
    if (drag) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (drag.type === 'column') {
        placeColumnPlaceholder(e.clientX, e.clientY);
      } else {
        const column = e.target.closest('.column');
        if (column && column !== drag.placeholder) placePostPlaceholder(column, e.clientX, e.clientY);
      }
      return;
    }
    const form = e.target.closest('.compose-form, .comment-form');
    if (form) {
      e.preventDefault();
      form.classList.add('dragging');
    }
  });

  $columns.addEventListener('dragleave', (e) => {
    if (drag) return;
    const form = e.target.closest('.compose-form, .comment-form');
    if (form) form.classList.remove('dragging');
  });

  $columns.addEventListener('drop', async (e) => {
    if (drag) {
      e.preventDefault();
      const { type, id, el, placeholder } = drag;
      if (!placeholder.parentNode) return;
      // 화면 먼저 갱신(낙관적), 그 다음 서버 반영
      placeholder.parentNode.insertBefore(el, placeholder);
      el.classList.remove('drag-source');
      if (type === 'post') {
        const column = el.closest('.column');
        const columnId = Number(column.dataset.col);
        const index = [...column.querySelectorAll('.column-posts > .post-card[data-id]')].indexOf(el);
        cleanupDrag();
        await run(() => api(`/api/posts/${id}/move`, { method: 'PUT', body: JSON.stringify({ column_id: columnId, index }) }));
      } else {
        const ids = [...$columns.querySelectorAll(':scope > .column[data-col]')].map((c) => Number(c.dataset.col));
        cleanupDrag();
        await run(() => api(`/api/boards/${boardId}/columns/order`, { method: 'PUT', body: JSON.stringify({ ids }) }));
      }
      return;
    }
    const form = e.target.closest('.compose-form, .comment-form');
    if (!form) return;
    e.preventDefault();
    form.classList.remove('dragging');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    if (form.classList.contains('compose-form')) addFiles(files, compose, 'compose');
    else addFiles(files, getDraft(form.dataset.postId), 'comment', form.dataset.postId);
  });

  // 드롭 없이 끝난 경우(ESC, 밖에 놓음) 원상 복구
  $columns.addEventListener('dragend', () => {
    if (!drag) return;
    drag.el.classList.remove('drag-source');
    cleanupDrag();
  });

  function cleanupDrag() {
    if (!drag) return;
    drag.placeholder.remove();
    drag.el.removeAttribute('draggable');
    $columns.querySelectorAll('.column.drop-target').forEach((c) => c.classList.remove('drop-target'));
    drag = null;
  }

  // API 호출 후 화면 갱신. 실패 시 alert. 성공 여부 반환
  async function run(fn, reload = true) {
    try {
      await fn();
      if (reload) await load(true);
      return true;
    } catch (err) {
      alert(err.message);
      return false;
    }
  }

  await load(true);
  setInterval(load, 5000);
})();
