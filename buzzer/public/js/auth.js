// 공통 인증 처리: 세션 확인 → 로그인/본화면 전환, 구글 로그인 버튼 렌더링
const Auth = {
  me: null,

  async init() {
    try {
      const res = await fetch('/api/me');
      if (res.ok) {
        this.me = await res.json();
        this.renderUserArea();
        return true;
      }
    } catch {}
    await this.showLogin();
    return false;
  },

  async showLogin() {
    document.getElementById('login-view').classList.remove('hidden');
    const cfg = await fetch('/api/config').then((r) => r.json());
    if (!cfg.googleClientId) {
      this.showLoginError('서버에 GOOGLE_CLIENT_ID가 설정되지 않았습니다. 관리자에게 문의하세요.');
      return;
    }
    const renderButton = () => {
      google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: (response) => this.onGoogleCredential(response),
      });
      google.accounts.id.renderButton(document.getElementById('google-signin-btn'), {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        width: 280,
      });
    };
    if (window.google && google.accounts) renderButton();
    else window.addEventListener('load', renderButton);
  },

  async onGoogleCredential(response) {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });
    if (res.ok) {
      location.reload();
    } else {
      const data = await res.json().catch(() => ({}));
      this.showLoginError(data.error || '로그인에 실패했습니다.');
    }
  },

  showLoginError(msg) {
    const el = document.getElementById('login-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  },

  renderUserArea() {
    const area = document.getElementById('user-area');
    const avatar = this.me.picture
      ? `<img class="avatar" src="${this.me.picture}" alt="" referrerpolicy="no-referrer">`
      : '';
    area.innerHTML = `
      ${avatar}
      <span class="user-name">${escapeHtml(this.me.name)}${this.me.admin ? ' <span class="badge">관리자</span>' : ''}</span>
      <button id="logout-btn" class="btn btn-small">로그아웃</button>
    `;
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      location.href = '/';
    });
  },
};

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}
