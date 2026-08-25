// 재접속되는 WebSocket 클라이언트. 연결될 때마다 onOpen으로 join/host 메시지를 다시 보내면 서버가 현재 상태를 내려준다.
function connectWs({ onOpen, onMessage, onClose }) {
  let ws = null;
  let retry = 0;
  let stopped = false;

  function open() {
    if (stopped) return;
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { retry = 0; onOpen(send); };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      onMessage(msg, send);
    };
    ws.onclose = () => {
      if (stopped) return;
      if (onClose) onClose();
      setTimeout(open, Math.min(1000 * 2 ** retry++, 8000));
    };
    ws.onerror = () => ws.close();
  }
  function send(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }
  open();
  return { send, stop: () => { stopped = true; ws && ws.close(); } };
}

const SHAPES = ['▲', '◆', '●', '■'];
const OPTION_COLORS = ['opt-0', 'opt-1', 'opt-2', 'opt-3'];

function showToast(msg, ms = 2500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function fmtTime(utc) {
  if (!utc) return '';
  const d = new Date(utc.replace(' ', 'T') + 'Z');
  return isNaN(d) ? utc : new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}
