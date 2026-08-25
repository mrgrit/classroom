// 배경 테마 목록 + 선택기 — 코르크(보드)·버저(퀴즈) 공통. 두 앱의 public/js/themes.js 는 같은 파일.
// 브라우저에서는 전역 함수로, 서버(Node)에서는 require 해서 키 검증/추천에 사용한다. 스타일은 css/themes.css.
const THEMES = [
  { key: '', name: '기본' },
  { key: 'dots-pink', name: '분홍 물방울' },
  { key: 'dots-mint', name: '민트 물방울' },
  { key: 'grid-sky', name: '하늘 모눈종이' },
  { key: 'stripes-lemon', name: '레몬 줄무늬' },
  { key: 'gingham-peach', name: '복숭아 체크' },
  { key: 'zigzag-lime', name: '라임 지그재그' },
  { key: 'confetti', name: '컨페티' },
  { key: 'notebook', name: '공책' },
  { key: 'stars-lavender', name: '라벤더 별' },
  { key: 'hearts-rose', name: '로즈 하트' },
  { key: 'clouds-sky', name: '하늘 구름' },
  { key: 'waves-aqua', name: '아쿠아 물결' },
  { key: 'plus-sand', name: '모래 십자' },
  { key: 'honeycomb', name: '벌집' },
  { key: 'sunset', name: '노을' },
  { key: 'ocean', name: '바다' },
  { key: 'candy', name: '캔디' },
  { key: 'night', name: '밤하늘', dark: true },
  { key: 'chalkboard', name: '칠판', dark: true },
  { key: 'grape', name: '포도', dark: true },
];
const THEME_KEYS = THEMES.map((t) => t.key);

function themeInfo(key) {
  return THEMES.find((t) => t.key === (key || '')) || THEMES[0];
}

// 요소에 붙일 클래스 문자열. 기본 테마면 빈 문자열
function themeClasses(key) {
  const t = themeInfo(key);
  return t.key ? `themed ${t.dark ? 'th-dark' : 'th-light'} theme-${t.key}` : '';
}

// 사용 횟수가 가장 적은 테마 키 (새 보드/퀴즈가 서로 겹치지 않게). used: 기존 항목들의 테마 키 배열
function suggestTheme(used) {
  const count = {};
  for (const k of used || []) count[k] = (count[k] || 0) + 1;
  let best = null;
  for (const t of THEMES) {
    if (!t.key) continue;
    const c = count[t.key] || 0;
    if (!best || c < best.c) best = { key: t.key, c };
  }
  return best ? best.key : '';
}

function isValidTheme(key) {
  return THEME_KEYS.includes(key || '');
}

// 아래는 브라우저 전용
function themePickerHtml(selected) {
  const sel = selected || '';
  return `<div class="theme-picker" data-selected="${sel}">
    ${THEMES.map((t) => `<button type="button" class="theme-swatch ${themeClasses(t.key) || 'theme-none'} ${t.key === sel ? 'selected' : ''}" data-theme="${t.key}" title="${t.name}" aria-label="${t.name}"></button>`).join('')}
    <span class="theme-name">${themeInfo(sel).name}</span>
  </div>`;
}

// root 안의 선택기 클릭 처리. 선택된 키는 .theme-picker의 data-selected 에 남고 onChange(key) 호출
function bindThemePicker(root, onChange) {
  root.addEventListener('click', (e) => {
    const sw = e.target.closest('.theme-swatch');
    if (!sw || !root.contains(sw)) return;
    const picker = sw.closest('.theme-picker');
    picker.dataset.selected = sw.dataset.theme;
    picker.querySelectorAll('.theme-swatch').forEach((b) => b.classList.toggle('selected', b === sw));
    picker.querySelector('.theme-name').textContent = themeInfo(sw.dataset.theme).name;
    if (onChange) onChange(sw.dataset.theme);
  });
}

// body(페이지 전체)에 테마 적용/해제
function applyBodyTheme(key) {
  document.body.className = document.body.className.replace(/\b(themed|th-light|th-dark|theme-[a-z0-9-]+)\b/g, '').replace(/\s+/g, ' ').trim();
  const cls = themeClasses(key);
  if (cls) document.body.classList.add(...cls.split(' '));
}

// 테마 선택 모달: 저장하면 onSave(key)
function openThemeModal({ title, current, onSave }) {
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal">
      <h3>🎨 ${title || '배경 선택'}</h3>
      <p class="hint">보드·퀴즈마다 다른 배경을 두면 한눈에 구별됩니다.</p>
      ${themePickerHtml(current)}
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" class="btn theme-cancel">취소</button>
        <button type="button" class="btn btn-primary theme-save">저장</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  bindThemePicker(modal);
  const close = () => modal.remove();
  modal.querySelector('.theme-cancel').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('.theme-save').addEventListener('click', async () => {
    const key = modal.querySelector('.theme-picker').dataset.selected;
    const ok = await onSave(key);
    if (ok !== false) close();
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { THEMES, THEME_KEYS, themeInfo, themeClasses, suggestTheme, isValidTheme };
}
