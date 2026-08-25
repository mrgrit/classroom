// 보드 상세 페이지: 컬럼(셸프) 레이아웃 + 게시물/좋아요/댓글 + 파일 첨부(복붙/드래그/선택)
(async function () {
  const boardId = location.pathname.split('/').pop();
  const COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'orange'];

  const state = { board: null, columns: [], me: null };
  // 작성/수정 폼 상태. mode 'compose'(columnId에 새 글) 또는 'edit'(postId 게시물 수정)
  // files: 업로드 결과 또는 기존 첨부(existing:true), removed: 수정 중 제거한 기존 첨부 id
  let compose = null;
  const isComposing = (colId) => compose && compose.mode === 'compose' && compose.columnId === colId;
  const isEditing = (postId) => compose && compose.mode === 'edit' && compose.postId === postId;
  const commentDrafts = {}; // postId -> { text, files: [...] }
  const expanded = new Set(); // 펼쳐 놓은 긴 게시물(헤르메스 기록) id

  const loggedIn = await Auth.init();
  if (!loggedIn) return;
  document.getElementById('board-view').classList.remove('hidden');

  const $columns = document.getElementById('board-columns');
  const $tools = document.getElementById('board-tools');

  // ---------- 데이터 로드 ----------

  let renderedSnap = null; // 마지막으로 화면에 그린 서버 데이터 (변화 없으면 재렌더링 생략)

  async function load(force = false) {
    let data;
    try {
      data = await api(`/api/boards/${boardId}`);
    } catch (err) {
      document.getElementById('board-title').textContent = err.message;
      return;
    }
    Object.assign(state, data);
    document.title = `${data.board.title} - 코르크`;
    document.getElementById('board-title').textContent = data.board.title;
    document.getElementById('board-desc').textContent = data.board.description;
    applyBodyTheme(data.board.theme);
    const snap = JSON.stringify(data);
    if (!force && snap === renderedSnap) return;
    // 입력 중이면 폴링 갱신으로 화면을 다시 그리지 않음 (포커스/커서 보호)
    if (!force && isTyping()) return;
    renderedSnap = snap;
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
    // innerHTML 교체는 스크롤을 0으로 되돌리므로 컬럼별 세로/보드 가로 위치를 보존
    const colScroll = {};
    for (const el of $columns.querySelectorAll('.column')) {
      const posts = el.querySelector('.column-posts');
      if (posts && posts.scrollTop) colScroll[el.dataset.col] = posts.scrollTop;
    }
    const boardScrollLeft = $columns.scrollLeft;
    $tools.innerHTML =
      `<a class="btn btn-small" href="/api/boards/${boardId}/export.md" title="보드 전체를 markdown 파일로 저장">⬇ 내보내기</a>` +
      (me.admin ? `<button class="btn btn-small board-theme" title="배경 바꾸기">🎨 배경</button><button class="btn btn-small col-add">＋ 컬럼 추가</button>` : '');
    $columns.classList.toggle('single', columns.length === 1);
    $columns.innerHTML = columns.map((col, i) => columnHtml(col, i, columns.length)).join('');
    $columns.scrollLeft = boardScrollLeft;
    for (const [id, top] of Object.entries(colScroll)) {
      const posts = $columns.querySelector(`.column[data-col="${id}"] .column-posts`);
      if (posts) posts.scrollTop = top;
    }
  }

  function columnHtml(col, index, total) {
    const { me } = state;
    const adminTools = me.admin
      ? `<button class="icon-btn col-left" data-id="${col.id}" title="왼쪽으로" ${index === 0 ? 'disabled' : ''}>◀</button>
         <button class="icon-btn col-right" data-id="${col.id}" title="오른쪽으로" ${index === total - 1 ? 'disabled' : ''}>▶</button>
         <button class="icon-btn col-rename" data-id="${col.id}" title="이름 변경">✎</button>
         <button class="icon-btn col-managers" data-id="${col.id}" title="컬럼 관리자 지정">👤</button>
         <button class="icon-btn col-delete" data-id="${col.id}" title="컬럼 삭제" ${total <= 1 ? 'disabled' : ''}>✕</button>`
      : '';
    const colTools = `<span class="col-tools">
           <button class="icon-btn col-ai" data-id="${col.id}" title="AI 학습자료 만들기">🤖</button>
           <button class="icon-btn col-export" data-id="${col.id}" title="컬럼 내용을 markdown 파일로 저장">⬇</button>
           ${adminTools}
         </span>`;
    const composeArea = isComposing(col.id)
      ? composeHtml()
      : col.can_post
        ? `<button class="col-add-post" data-col="${col.id}">＋ 게시물 올리기</button>`
        : `<div class="col-locked">🔒 지정된 관리자만 작성할 수 있습니다</div>`;
    const managersLine = col.managers.length
      ? `<div class="col-managers-line" title="${col.managers.map((m) => escapeHtml(m.email)).join(', ')}">👤 ${col.managers.map((m) => escapeHtml(m.name || m.email.split('@')[0])).join(', ')}</div>`
      : '';
    const colHandle = me.admin && total > 1 ? `<span class="drag-handle col-handle" title="끌어서 컬럼 순서 변경">⠿</span>` : '';
    return `
    <section class="column" data-col="${col.id}" data-can-post="${col.can_post ? 1 : 0}">
      <header class="column-head">
        <h3>${colHandle}${escapeHtml(col.title)} <span class="col-count">${col.posts.length}</span></h3>
        ${colTools}
      </header>
      ${managersLine}
      ${composeArea}
      <div class="column-posts">
        ${col.posts.map((p) => postCard(p)).join('')}
        ${col.posts.length === 0 && !isComposing(col.id) ? '<p class="col-empty">아직 게시물이 없습니다.</p>' : ''}
      </div>
    </section>`;
  }

  function composeHtml() {
    const edit = compose.mode === 'edit';
    return `
    <form class="compose-form post-card color-${compose.color}" ${edit ? `data-id="${compose.postId}"` : ''}>
      ${edit ? '<div class="edit-label">✎ 게시물 수정</div>' : ''}
      <input type="text" class="compose-title" placeholder="제목 (선택)" maxlength="100" value="${escapeHtml(compose.title)}">
      <textarea class="compose-content" placeholder="내용을 입력하세요. 캡처한 이미지를 붙여넣거나(Ctrl+V) 파일을 끌어다 놓을 수 있습니다." rows="4" maxlength="${compose.source && compose.source !== 'web' ? 20000 : 2000}">${escapeHtml(compose.content)}</textarea>
      <div class="chips compose-chips">${chipsHtml(compose.files, 'compose')}</div>
      <div class="compose-footer">
        <div class="color-picker">
          ${COLORS.map((c) => `<button type="button" class="color-dot color-${c} ${c === compose.color ? 'selected' : ''}" data-color="${c}" aria-label="${c}"></button>`).join('')}
        </div>
        <div class="compose-actions">
          <input type="file" class="compose-file hidden" multiple>
          <button type="button" class="btn btn-small compose-attach" title="파일 첨부">📎 파일</button>
          <button type="button" class="btn btn-small compose-cancel">취소</button>
          <button type="submit" class="btn btn-small btn-primary">${edit ? '저장' : '게시'}</button>
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
        .map((a) => `<a href="${a.url}" class="att-img" data-name="${escapeHtml(a.name)}"><img src="${a.url}" alt="${escapeHtml(a.name)}" loading="lazy"></a>`)
        .join('')}</div>` : ''}
      ${files.length ? `<div class="att-files">${files
        .map((a) => `<a class="att-file" href="${a.url}" target="_blank" rel="noopener">📄 ${escapeHtml(a.name)} <span class="att-size">${fmtSize(a.size)}</span></a>`)
        .join('')}</div>` : ''}`;
  }

  // 헤르메스가 올린 게시물 표시: 대화 자동 기록 / 메모
  function sourceBadge(p) {
    if (p.source === 'hermes') return '<span class="src-badge" title="헤르메스 대화 자동 기록">🤖 대화 기록</span>';
    if (p.source === 'hermes-note') return '<span class="src-badge" title="헤르메스에서 저장한 메모">📝 메모</span>';
    return '';
  }

  // 본문: 헤르메스 기록은 서버가 렌더한 markdown(content_html), 길면 접어서 표시
  function contentHtml(p) {
    if (!p.content) return '';
    if (!p.content_html) return `<p class="post-content">${escapeHtml(p.content)}</p>`;
    const long = p.content.length > 700;
    const open = expanded.has(p.id);
    return `<div class="post-content md ${long && !open ? 'collapsed' : ''}">${p.content_html}</div>` +
      (long ? `<button type="button" class="post-expand" data-id="${p.id}">${open ? '접기 ▴' : '더 보기 ▾'}</button>` : '');
  }

  function postCard(p) {
    if (isEditing(p.id)) return composeHtml();
    const { me, columns } = state;
    const canEdit = p.can_edit;
    const time = fmtTime(p.created_at) + (p.edited_at ? ' (수정됨)' : '');
    const draft = commentDrafts[p.id] || { text: '', files: [] };
    const moveSelect =
      canEdit && columns.length > 1
        ? `<select class="post-move" data-id="${p.id}" title="다른 컬럼으로 이동">
             ${columns.filter((c) => c.can_post || c.id === p.column_id).map((c) => `<option value="${c.id}" ${c.id === p.column_id ? 'selected' : ''}>${escapeHtml(c.title)}</option>`).join('')}
           </select>`
        : '';
    return `
    <article class="post-card color-${p.color}" data-id="${p.id}" id="post-${p.id}">
      <div class="post-head">
        <span class="post-author">${canEdit ? '<span class="drag-handle post-handle" title="끌어서 이동">⠿</span>' : ''}${escapeHtml(p.author_name)}${sourceBadge(p)}</span>
        <span class="post-head-tools">
          ${moveSelect}
          ${canEdit ? `<button class="icon-btn post-edit" data-id="${p.id}" title="수정">✎</button><button class="icon-btn post-delete" data-id="${p.id}" title="삭제">✕</button>` : ''}
        </span>
      </div>
      ${p.title ? `<h4 class="post-title">${escapeHtml(p.title)}</h4>` : ''}
      ${contentHtml(p)}
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
    } else if (e.target.closest('.board-theme')) {
      openThemeModal({
        title: `"${state.board.title}" 배경`,
        current: state.board.theme,
        onSave: (theme) => run(() => api(`/api/boards/${boardId}`, { method: 'PUT', body: JSON.stringify({ theme }) })),
      });
    }
  });

  $columns.addEventListener('click', async (e) => {
    const expandBtn = e.target.closest('.post-expand');
    if (expandBtn) {
      const id = Number(expandBtn.dataset.id);
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      render();
      return;
    }
    const t = e.target;
    const btn = t.closest('button');
    if (!btn) return;

    if (btn.classList.contains('col-add-post')) {
      compose = { mode: 'compose', columnId: Number(btn.dataset.col), title: '', content: '', color: 'yellow', files: [] };
      render();
      $columns.querySelector('.compose-content')?.focus();
      return;
    }
    if (btn.classList.contains('post-edit')) {
      const p = state.columns.flatMap((c) => c.posts).find((x) => x.id === Number(btn.dataset.id));
      if (!p) return;
      compose = {
        mode: 'edit', postId: p.id, title: p.title, content: p.content, color: p.color, source: p.source || 'web',
        files: p.attachments.map((a) => ({ ...a, existing: true })), removed: [],
      };
      render();
      const ta = $columns.querySelector('.compose-content');
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
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
        const [removed] = compose.files.splice(idx, 1);
        if (removed && removed.existing) compose.removed.push(removed.id);
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
    if (btn.classList.contains('col-export')) {
      location.href = `/api/columns/${btn.dataset.id}/export.md`;
      return;
    }
    if (btn.classList.contains('col-ai')) {
      openAiModal(state.columns.find((c) => c.id === Number(btn.dataset.id)));
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
    if (btn.classList.contains('col-managers')) {
      openManagerModal(state.columns.find((c) => c.id === Number(btn.dataset.id)));
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
    if (form.classList.contains('compose-form') && compose.mode === 'edit') {
      if (compose.files.some((f) => f.uploading)) return alert('파일 업로드가 끝날 때까지 기다려주세요.');
      const body = {
        title: compose.title,
        content: compose.content,
        color: compose.color,
        attachment_ids: compose.files.filter((f) => !f.existing).map((f) => f.id),
        remove_attachment_ids: compose.removed,
      };
      if (!body.content.trim() && !compose.files.length) return alert('내용을 입력하거나 파일을 첨부하세요.');
      const ok = await run(() => api(`/api/posts/${compose.postId}`, { method: 'PUT', body: JSON.stringify(body) }), false);
      if (ok) {
        compose = null;
        await load(true);
      }
    } else if (form.classList.contains('compose-form')) {
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
        const allowed = column && (column.dataset.canPost === '1' || column === drag.el.closest('.column'));
        if (column && column !== drag.placeholder && allowed) placePostPlaceholder(column, e.clientX, e.clientY);
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

  // ---------- 컬럼 관리자 지정 (관리자) ----------
  // 로그인한 적 있는 사용자 목록에서 체크 + 이메일 직접 추가. 비우면 해제(누구나 작성 가능)
  async function openManagerModal(col) {
    let users = [];
    try { users = await api('/api/users'); } catch (err) { return alert(err.message); }
    const selected = new Set(col.managers.map((m) => m.email));
    const known = new Set(users.map((u) => u.email.toLowerCase()));
    const extra = [...selected].filter((e) => !known.has(e)); // 아직 로그인 안 한 이메일
    const modal = document.createElement('div');
    modal.className = 'modal-bg';
    modal.innerHTML = `
      <div class="modal">
        <h3>"${escapeHtml(col.title)}" 컬럼 관리자</h3>
        <p class="hint">지정하면 관리자(선생님)와 여기 선택된 사람만 이 컬럼에 글을 쓰고 고칠 수 있습니다. 아무도 선택하지 않으면 누구나 쓸 수 있습니다.</p>
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
      const ok = await run(() => api(`/api/columns/${col.id}/managers`, { method: 'PUT', body: JSON.stringify({ emails }) }));
      if (ok) close();
    });
    modal.querySelector('.mgr-filter').focus();
  }

  // ---------- AI 학습자료 만들기 ----------
  // 내 정보에서 설정한 개인 Ollama로 컬럼 전체 기록을 정리·분석한 학습자료를 생성. 진행 상황은 1.5초 폴링
  async function openAiModal(col) {
    let setting = { ollama_url: '', model: '' };
    try { setting = await api('/api/my/ai'); } catch {}
    const ready = setting.ollama_url && setting.model;
    const modal = document.createElement('div');
    modal.className = 'modal-bg';
    modal.innerHTML = `
      <div class="modal">
        <h3>🤖 "${escapeHtml(col.title)}" AI 학습자료 만들기</h3>
        ${ready ? `
        <p class="hint">이 컬럼의 게시물 ${col.posts.length}개와 댓글을 내 AI(<b>${escapeHtml(setting.model)}</b>)가 정리·분석해서 개인 학습자료를 만듭니다. 완성된 자료는 <a href="/me">내 정보</a>에 저장되고 PDF로 받을 수 있습니다.</p>
        <textarea class="ai-instructions" rows="3" maxlength="500" placeholder="AI에게 추가로 요청할 내용 (선택) — 예: 시험 대비 요점 위주로 정리해줘"></textarea>
        <div class="ai-status hidden"></div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn ai-close">닫기</button>
          <button type="button" class="btn btn-primary ai-start">생성 시작</button>
        </div>` : `
        <p class="hint">아직 내 AI가 설정되지 않았습니다. 먼저 <b>내 정보</b> 페이지에서 Ollama 서버를 연결하고 모델을 선택하세요.</p>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn ai-close">닫기</button>
          <a class="btn btn-primary" href="/me">내 정보로 이동</a>
        </div>`}
      </div>`;
    document.body.appendChild(modal);

    let jobId = null;
    let timer = null;
    const close = () => {
      if (timer) clearInterval(timer);
      if (jobId) api(`/api/ai/jobs/${jobId}`, { method: 'DELETE' }).catch(() => {}); // 진행 중이면 취소
      modal.remove();
    };
    modal.querySelector('.ai-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    const startBtn = modal.querySelector('.ai-start');
    const status = modal.querySelector('.ai-status');
    startBtn?.addEventListener('click', async () => {
      startBtn.disabled = true;
      status.classList.remove('hidden');
      status.textContent = '작업을 시작하는 중...';
      let started;
      try {
        const job = await api(`/api/columns/${col.id}/report`, {
          method: 'POST',
          body: JSON.stringify({ instructions: modal.querySelector('.ai-instructions').value }),
        });
        jobId = job.job_id;
        started = Date.now();
      } catch (err) {
        status.textContent = `❌ ${err.message}`;
        startBtn.disabled = false;
        return;
      }
      timer = setInterval(async () => {
        let info;
        try {
          info = await api(`/api/ai/jobs/${jobId}`);
        } catch (err) {
          clearInterval(timer); timer = null; jobId = null;
          status.textContent = `❌ ${err.message}`;
          startBtn.disabled = false;
          return;
        }
        if (info.status === 'running') {
          status.textContent = `⏳ 생성 중... ${Math.round((Date.now() - started) / 1000)}초 경과 · ${info.chars}자 작성됨 (창을 닫으면 취소됩니다)`;
        } else if (info.status === 'done') {
          clearInterval(timer); timer = null; jobId = null;
          status.innerHTML = `✅ 완성! <a href="/report/${info.report_id}"><b>자료 보기</b></a> · <a href="/api/reports/${info.report_id}/pdf">PDF 다운로드</a>` +
            (info.truncated ? '<br><span class="hint">기록이 너무 길어 앞부분만 사용되었습니다.</span>' : '');
        } else {
          clearInterval(timer); timer = null; jobId = null;
          status.textContent = `❌ ${info.error}`;
          startBtn.disabled = false;
        }
      }, 1500);
    });
  }

  // ---------- 이미지 크게 보기 (라이트박스) ----------
  // 게시물/댓글의 이미지 첨부를 클릭하면 페이지 안에서 크게 표시. 같은 묶음 안에서 ←→ 로 이동
  const lightbox = { items: [], index: 0, el: null };
  $columns.addEventListener('click', (e) => {
    const link = e.target.closest('a.att-img');
    if (!link) return;
    e.preventDefault();
    lightbox.items = [...link.parentElement.querySelectorAll('a.att-img')].map((a) => ({ url: a.getAttribute('href'), name: a.dataset.name }));
    lightbox.index = lightbox.items.findIndex((it) => it.url === link.getAttribute('href'));
    openLightbox();
  });

  function openLightbox() {
    if (!lightbox.el) {
      lightbox.el = document.createElement('div');
      lightbox.el.className = 'lightbox';
      lightbox.el.innerHTML = `
        <button class="lb-close" title="닫기 (Esc)">✕</button>
        <button class="lb-prev" title="이전 (←)">‹</button>
        <img alt="">
        <button class="lb-next" title="다음 (→)">›</button>
        <div class="lb-caption"><span class="lb-name"></span> <a class="lb-open" target="_blank" rel="noopener">원본 열기</a></div>`;
      document.body.appendChild(lightbox.el);
      lightbox.el.addEventListener('click', (e) => {
        if (e.target.closest('.lb-prev')) return showLightbox(lightbox.index - 1);
        if (e.target.closest('.lb-next')) return showLightbox(lightbox.index + 1);
        if (e.target.closest('.lb-open')) return;
        closeLightbox();
      });
      document.addEventListener('keydown', (e) => {
        if (!lightbox.el.classList.contains('open')) return;
        if (e.key === 'Escape') closeLightbox();
        else if (e.key === 'ArrowLeft') showLightbox(lightbox.index - 1);
        else if (e.key === 'ArrowRight') showLightbox(lightbox.index + 1);
      });
    }
    lightbox.el.classList.add('open');
    document.body.classList.add('no-scroll');
    showLightbox(lightbox.index);
  }
  function showLightbox(i) {
    const n = lightbox.items.length;
    lightbox.index = ((i % n) + n) % n;
    const it = lightbox.items[lightbox.index];
    lightbox.el.querySelector('img').src = it.url;
    lightbox.el.querySelector('.lb-name').textContent = n > 1 ? `${it.name} (${lightbox.index + 1}/${n})` : it.name;
    lightbox.el.querySelector('.lb-open').href = it.url;
    lightbox.el.classList.toggle('multi', n > 1);
  }
  function closeLightbox() {
    lightbox.el.classList.remove('open');
    document.body.classList.remove('no-scroll');
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
  // /board/1#post-5 로 들어오면(헤르메스 저장 결과 링크) 해당 카드로 스크롤 + 잠깐 강조
  if (/^#post-\d+$/.test(location.hash)) {
    const card = document.getElementById(location.hash.slice(1));
    if (card) {
      card.scrollIntoView({ block: 'center', inline: 'center' });
      card.classList.add('highlight');
      setTimeout(() => document.getElementById(location.hash.slice(1))?.classList.remove('highlight'), 3000);
    }
  }
  setInterval(load, 5000);
})();
