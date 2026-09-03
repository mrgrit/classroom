// 관리 페이지 (관리자 전용): 글쓰기 양식 만들기/수정/삭제
(async function () {
  const loggedIn = await Auth.init();
  if (!loggedIn) return;
  const $view = document.getElementById('admin-view');
  $view.classList.remove('hidden');
  if (!Auth.me.admin) {
    $view.innerHTML = '<p class="empty">관리자만 접근할 수 있는 페이지입니다.</p>';
    return;
  }

  const $list = document.getElementById('tpl-list');
  const $empty = document.getElementById('tpl-empty');
  const $editor = document.getElementById('tpl-editor');
  const $newBtn = document.getElementById('tpl-new');

  let templates = [];
  let editing = null; // { id?, name, description, fields: [{label, placeholder}] }

  async function load() {
    try {
      templates = await api('/api/templates');
    } catch (err) {
      $list.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
      return;
    }
    renderList();
  }

  function renderList() {
    $empty.classList.toggle('hidden', templates.length > 0);
    $list.innerHTML = templates
      .map(
        (t) => `
      <div class="tpl-row" data-id="${t.id}">
        <div class="tpl-row-main">
          <b>📋 ${escapeHtml(t.name)}</b>${t.description ? ` <span class="hint">${escapeHtml(t.description)}</span>` : ''}
          <div class="hint">항목 ${t.fields.length}개: ${t.fields.map((f) => escapeHtml(f.label)).join(' · ')}</div>
        </div>
        <button class="btn btn-small tpl-edit" data-id="${t.id}">수정</button>
        <button class="btn btn-small btn-danger tpl-delete" data-id="${t.id}">삭제</button>
      </div>`
      )
      .join('');
  }

  function openEditor(tpl) {
    editing = tpl
      ? { id: tpl.id, name: tpl.name, description: tpl.description, fields: tpl.fields.map((f) => ({ ...f })) }
      : { name: '', description: '', fields: [{ label: '', placeholder: '' }] };
    renderEditor();
    $editor.querySelector('.tpl-name').focus();
  }

  function closeEditor() {
    editing = null;
    $editor.classList.add('hidden');
    $editor.innerHTML = '';
  }

  function renderEditor() {
    $editor.classList.remove('hidden');
    $editor.innerHTML = `
      <h3>${editing.id ? '양식 수정' : '새 양식 만들기'}</h3>
      <div class="ai-form">
        <label>양식 이름
          <input type="text" class="tpl-name" maxlength="50" placeholder="예: 주간업무보고" value="${escapeHtml(editing.name)}">
        </label>
        <label>설명 (선택)
          <input type="text" class="tpl-desc" maxlength="200" placeholder="예: 매주 금요일까지 제출" value="${escapeHtml(editing.description)}">
        </label>
      </div>
      <h4>항목 <span class="hint">— 학생에게 이 순서대로 입력칸이 보입니다</span></h4>
      <div class="tpl-fields">
        ${editing.fields
          .map(
            (f, i) => `
        <div class="tpl-field-row" data-idx="${i}">
          <input type="text" class="tpl-f-label" maxlength="50" placeholder="항목 이름 (예: 이번 주 한 일)" value="${escapeHtml(f.label)}">
          <input type="text" class="tpl-f-ph" maxlength="200" placeholder="입력 안내문 (선택)" value="${escapeHtml(f.placeholder || '')}">
          <button type="button" class="icon-btn tpl-f-up" title="위로" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" class="icon-btn tpl-f-down" title="아래로" ${i === editing.fields.length - 1 ? 'disabled' : ''}>▼</button>
          <button type="button" class="icon-btn tpl-f-remove" title="항목 삭제" ${editing.fields.length <= 1 ? 'disabled' : ''}>✕</button>
        </div>`
          )
          .join('')}
      </div>
      <button type="button" class="btn btn-small tpl-f-add">＋ 항목 추가</button>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" class="btn tpl-cancel">취소</button>
        <button type="button" class="btn btn-primary tpl-save">${editing.id ? '저장' : '만들기'}</button>
      </div>
      <p class="hint tpl-status"></p>`;
  }

  // 편집 중인 입력값을 editing에 반영 (재렌더링 전 호출)
  function syncEditing() {
    editing.name = $editor.querySelector('.tpl-name').value;
    editing.description = $editor.querySelector('.tpl-desc').value;
    editing.fields = [...$editor.querySelectorAll('.tpl-field-row')].map((row) => ({
      label: row.querySelector('.tpl-f-label').value,
      placeholder: row.querySelector('.tpl-f-ph').value,
    }));
  }

  $newBtn.addEventListener('click', () => openEditor(null));

  $list.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const tpl = templates.find((t) => t.id === Number(btn.dataset.id));
    if (!tpl) return;
    if (btn.classList.contains('tpl-edit')) {
      openEditor(tpl);
    } else if (btn.classList.contains('tpl-delete')) {
      if (!confirm(`"${tpl.name}" 양식을 삭제할까요? (이미 작성된 게시물은 그대로 남습니다)`)) return;
      try {
        await api(`/api/templates/${tpl.id}`, { method: 'DELETE' });
        if (editing && editing.id === tpl.id) closeEditor();
        await load();
      } catch (err) {
        alert(err.message);
      }
    }
  });

  $editor.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn || !editing) return;
    const row = btn.closest('.tpl-field-row');
    const idx = row ? Number(row.dataset.idx) : -1;

    if (btn.classList.contains('tpl-f-add')) {
      syncEditing();
      editing.fields.push({ label: '', placeholder: '' });
      renderEditor();
      const rows = $editor.querySelectorAll('.tpl-f-label');
      rows[rows.length - 1].focus();
    } else if (btn.classList.contains('tpl-f-remove')) {
      syncEditing();
      editing.fields.splice(idx, 1);
      renderEditor();
    } else if (btn.classList.contains('tpl-f-up') || btn.classList.contains('tpl-f-down')) {
      syncEditing();
      const j = btn.classList.contains('tpl-f-up') ? idx - 1 : idx + 1;
      [editing.fields[idx], editing.fields[j]] = [editing.fields[j], editing.fields[idx]];
      renderEditor();
    } else if (btn.classList.contains('tpl-cancel')) {
      closeEditor();
    } else if (btn.classList.contains('tpl-save')) {
      syncEditing();
      const body = {
        name: editing.name,
        description: editing.description,
        fields: editing.fields.filter((f) => f.label.trim()),
      };
      const $status = $editor.querySelector('.tpl-status');
      btn.disabled = true;
      try {
        if (editing.id) await api(`/api/templates/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
        else await api('/api/templates', { method: 'POST', body: JSON.stringify(body) });
        closeEditor();
        await load();
      } catch (err) {
        $status.textContent = `❌ ${err.message}`;
        btn.disabled = false;
      }
    }
  });

  await load();
})();
