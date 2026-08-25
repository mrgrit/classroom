// 헤르메스(Hermes Agent) 연동 핵심 로직
// - 학생별 연동 토큰(해시 저장)으로 신원 확인 → 이메일 → 보드/컬럼 권한은 웹과 동일 규칙(perm.js)
// - 자동 저장 컨텍스트(과목 보드·컬럼·주제)를 서버가 기억하고, 플러그인이 보내는 매 턴을 게시물에 누적
// - 헤르메스 대화 세션 하나 = 게시물 하나(길어지면 (2), (3)… 으로 이어씀)
const crypto = require('crypto');
const db = require('./db');
const perm = require('./perm');
const { isAdminEmail } = require('./auth');

const MAX_CONTENT = 20000; // 헤르메스 게시물 본문 상한 (웹 게시물은 2000)
const MAX_USER_MSG = 4000; // 턴당 질문 보존 길이
const MAX_ASSISTANT_MSG = 12000; // 턴당 답변 보존 길이
const SESSION_GAP_HOURS = 12; // 같은 세션이라도 이 시간 이상 쉬었으면 새 게시물(날짜가 바뀐 대화)
const TOPIC_MAX = 60;
const SKIP_SHORT_MSG = 2; // 이 길이 이하의 질문("ㅇㅋ")은 저장하지 않음

function httpError(status, message, extra) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

const kstDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const kstTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function fmtKst(utc) {
  const d = new Date(String(utc).replace(' ', 'T') + (String(utc).endsWith('Z') ? '' : 'Z'));
  return isNaN(d) ? String(utc) : kstTime.format(d);
}

// ---------- 토큰 ----------

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function userFromRow(u) {
  return { uid: u.id, email: u.email, name: u.name, admin: isAdminEmail(u.email) };
}

// Authorization: Bearer <token> → 사용자 (없거나 틀리면 null)
function authenticate(authHeader) {
  const m = /^Bearer\s+(\S+)$/i.exec(authHeader || '');
  if (!m) return null;
  const row = db
    .prepare('SELECT u.* FROM hermes_links l JOIN users u ON u.id = l.user_id WHERE l.token_hash = ?')
    .get(hashToken(m[1]));
  if (!row) return null;
  db.prepare("UPDATE hermes_links SET last_used_at = datetime('now') WHERE user_id = ?").run(row.id);
  return userFromRow(row);
}

// 토큰 발급(재발급 시 이전 토큰은 즉시 무효). 평문은 이 자리에서 한 번만 돌려줌
function issueToken(userId) {
  const token = 'pdl_' + crypto.randomBytes(24).toString('hex');
  db.prepare(
    `INSERT INTO hermes_links (user_id, token_hash) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = datetime('now'), last_used_at = NULL`
  ).run(userId, hashToken(token));
  return token;
}

function revokeToken(userId) {
  db.prepare('UPDATE hermes_links SET token_hash = NULL WHERE user_id = ?').run(userId);
}

function getLink(userId) {
  return db.prepare('SELECT * FROM hermes_links WHERE user_id = ?').get(userId) || null;
}

// ---------- 저장 대상(과목 보드 / 컬럼) ----------

function isManagedBy(user, columnId) {
  return perm.columnManagers(columnId).includes((user.email || '').toLowerCase());
}

// 사용자가 글을 쓸 수 있는 보드/컬럼 목록. managed = 이 사용자가 컬럼 관리자로 '지정된' 컬럼(자동 저장 기본 대상)
function listTargets(user) {
  const boards = db.prepare('SELECT id, title FROM boards ORDER BY created_at DESC, id DESC').all()
    .filter((b) => perm.canAccessBoard(user, b.id));
  return boards
    .map((b) => ({
      id: b.id,
      title: b.title,
      columns: db.prepare('SELECT id, title FROM columns WHERE board_id = ? ORDER BY position, id').all(b.id)
        .filter((c) => perm.canPostIn(user, c.id))
        .map((c) => ({ id: c.id, title: c.title, managed: isManagedBy(user, c.id) })),
    }))
    .filter((b) => b.columns.length);
}

function defaultColumn(board) {
  return board.columns.find((c) => c.managed) || null;
}

// 검색어(제목 일부) 또는 id로 보드 하나 고르기. 여러 개 걸리면 후보를 알려주는 오류
function pickBoard(targets, query) {
  const q = String(query ?? '').trim();
  if (!q) throw httpError(400, '과목(보드) 이름을 입력하세요.');
  if (/^\d+$/.test(q)) {
    const b = targets.find((t) => t.id === Number(q));
    if (b) return b;
    if (typeof query === 'number') throw httpError(404, '선택할 수 없는 보드입니다.'); // 숫자(id)로 왔으면 이름 검색으로 넘어가지 않음
  }
  const lower = q.toLowerCase();
  let hits = targets.filter((t) => t.title.toLowerCase() === lower);
  if (!hits.length) hits = targets.filter((t) => t.title.toLowerCase().includes(lower));
  if (!hits.length) throw httpError(404, `"${q}"에 해당하는 과목(보드)이 없습니다. 선택 가능: ${targets.map((t) => t.title).join(', ') || '(없음)'}`);
  if (hits.length > 1) throw httpError(409, `"${q}"에 해당하는 과목이 여러 개입니다: ${hits.map((t) => t.title).join(', ')}`);
  return hits[0];
}

function pickColumn(board, query) {
  const q = String(query ?? '').trim();
  if (!q) throw httpError(400, '컬럼 이름을 입력하세요.');
  if (/^\d+$/.test(q)) {
    const c = board.columns.find((t) => t.id === Number(q));
    if (c) return c;
    if (typeof query === 'number') throw httpError(404, `"${board.title}" 보드에서 선택할 수 없는 컬럼입니다.`);
  }
  const lower = q.toLowerCase();
  let hits = board.columns.filter((c) => c.title.toLowerCase() === lower);
  if (!hits.length) hits = board.columns.filter((c) => c.title.toLowerCase().includes(lower));
  if (!hits.length) throw httpError(404, `"${board.title}" 보드에 "${q}" 컬럼이 없거나 글을 쓸 수 없습니다. 선택 가능: ${board.columns.map((c) => c.title).join(', ')}`);
  if (hits.length > 1) throw httpError(409, `"${q}"에 해당하는 컬럼이 여러 개입니다: ${hits.map((c) => c.title).join(', ')}`);
  return hits[0];
}

// ---------- 컨텍스트 ----------

// 현재 컨텍스트(저장 위치·주제·자동 저장 여부). 보드/컬럼이 사라졌거나 권한이 없어졌으면 null로 정리해서 반환
function getContext(user) {
  const link = getLink(user.uid) || {};
  const targets = listTargets(user);
  let board = link.board_id ? targets.find((b) => b.id === link.board_id) || null : null;
  let column = board && link.column_id ? board.columns.find((c) => c.id === link.column_id) || null : null;
  if (!board) column = null;
  return {
    linked: !!link.token_hash,
    last_used_at: link.last_used_at || null,
    board: board ? { id: board.id, title: board.title } : null,
    column: column ? { id: column.id, title: column.title, managed: column.managed } : null,
    topic: link.topic || '',
    auto_save: link.auto_save === undefined ? true : !!link.auto_save,
    targets,
  };
}

function upsertLink(userId, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) return;
  db.prepare(
    `INSERT INTO hermes_links (user_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})
     ON CONFLICT(user_id) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}`
  ).run(userId, ...cols.map((c) => fields[c]));
}

// {board, column, topic, auto_save} 중 주어진 것만 변경. board/column은 id 또는 이름 일부
function setContext(user, input = {}) {
  const ctx = getContext(user);
  const fields = {};
  let board = ctx.board ? ctx.targets.find((b) => b.id === ctx.board.id) : null;

  // null = 해제, undefined/'' = 변경 없음 (모델이 빈 문자열을 넘기는 경우가 잦아 ''는 무시)
  if (input.board === null) {
    board = null;
    fields.board_id = null;
    fields.column_id = null;
  } else if (input.board !== undefined && String(input.board).trim() !== '') {
    board = pickBoard(ctx.targets, input.board);
    fields.board_id = board.id;
    const col = defaultColumn(board);
    fields.column_id = col ? col.id : null; // 보드를 바꾸면 컬럼은 지정 컬럼으로 초기화
  }
  if (input.column === null) {
    fields.column_id = null;
  } else if (input.column !== undefined && String(input.column).trim() !== '') {
    if (!board) throw httpError(400, '먼저 과목(보드)을 선택하세요.');
    fields.column_id = pickColumn(board, input.column).id;
    fields.board_id = board.id;
  }
  if (input.topic !== undefined && input.topic !== null) {
    const t = String(input.topic).trim().slice(0, TOPIC_MAX);
    fields.topic = ['없음', '-', '해제', 'none', 'clear'].includes(t.toLowerCase()) ? '' : t;
  }
  if (input.auto_save !== undefined && input.auto_save !== null) fields.auto_save = input.auto_save ? 1 : 0;

  upsertLink(user.uid, fields);
  return getContext(user);
}

// 컨텍스트가 비어 있을 때: 지정 컬럼이 있는 보드가 정확히 하나면 자동 선택
function ensureContext(user) {
  let ctx = getContext(user);
  if (ctx.column) return ctx;
  const candidates = ctx.targets.filter((b) => b.columns.some((c) => c.managed));
  if (!ctx.board && candidates.length === 1) {
    upsertLink(user.uid, { board_id: candidates[0].id, column_id: defaultColumn(candidates[0]).id });
    ctx = getContext(user);
    if (ctx.column) return ctx;
  }
  const hint = ctx.board
    ? `"${ctx.board.title}" 보드에서 저장할 컬럼을 선택하세요 (/padlet 컬럼 <이름>). 선택 가능: ${(ctx.targets.find((b) => b.id === ctx.board.id) || { columns: [] }).columns.map((c) => c.title).join(', ')}`
    : `저장할 과목(보드)을 선택하세요 (/padlet 과목 <이름>). 선택 가능: ${ctx.targets.map((b) => b.title).join(', ') || '(글을 쓸 수 있는 보드가 없습니다)'}`;
  throw httpError(409, hint, { code: 'NO_CONTEXT' });
}

function statusText(ctx, user) {
  const lines = [`👤 ${user.name} (${user.email})`];
  lines.push(`📚 과목(보드): ${ctx.board ? ctx.board.title : '(미선택)'}`);
  lines.push(`📂 컬럼: ${ctx.column ? ctx.column.title + (ctx.column.managed ? ' (내 지정 컬럼)' : '') : '(미선택)'}`);
  lines.push(`🏷 주제(단원/예제): ${ctx.topic || '(없음)'}`);
  lines.push(`💾 자동 저장: ${ctx.auto_save ? '켜짐' : '꺼짐'}`);
  return lines.join('\n');
}

// ---------- 게시물 저장 ----------

function topPosition(columnId) {
  const row = db.prepare('SELECT COALESCE(MIN(position), 1) AS m FROM posts WHERE column_id = ?').get(columnId);
  return row.m - 1;
}

function summarize(text, max = 40) {
  const line = String(text).split('\n').map((l) => l.trim()).find(Boolean) || '';
  const flat = line.replace(/\s+/g, ' ');
  return flat.length > max ? flat.slice(0, max).trimEnd() + '…' : flat;
}

function makeTitle(topic, firstMessage, part) {
  const date = kstDate.format(new Date());
  const summary = summarize(firstMessage);
  // "[날짜] 주제 — 첫 질문" / 주제가 없으면 "[날짜] 첫 질문"
  let title = `[${date}]` + (topic ? ` ${topic}` : '') + (summary ? (topic ? ' — ' : ' ') + summary : '');
  if (part > 1) title += ` (${part})`;
  return title.slice(0, 100);
}

function clip(text, max) {
  const s = String(text).trim();
  return s.length > max ? s.slice(0, max).trimEnd() + '\n…(생략)' : s;
}

function insertPost({ user, columnId, boardId, title, content, color, source }) {
  const info = db
    .prepare('INSERT INTO posts (board_id, column_id, user_id, title, content, color, position, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(boardId, columnId, user.uid, title, content, color, topPosition(columnId), source);
  return info.lastInsertRowid;
}

// 헤르메스 한 턴(질문+답변) 저장. 세션 매핑에 따라 기존 게시물에 이어쓰거나 새 게시물 생성
function saveTurn(user, input = {}) {
  const sessionId = String(input.session_id || '').trim().slice(0, 100);
  const userMessage = String(input.user_message || '').trim();
  const answer = String(input.assistant_response || '').trim();
  const model = String(input.model || '').trim().slice(0, 100);
  if (!sessionId) throw httpError(400, 'session_id가 필요합니다.');
  if (!userMessage || !answer) throw httpError(400, '질문과 답변이 모두 있어야 합니다.');
  if (userMessage.length <= SKIP_SHORT_MSG) return { saved: false, reason: '너무 짧은 질문은 저장하지 않습니다.' };

  const ctx = ensureContext(user);
  if (!ctx.auto_save) return { saved: false, reason: '자동 저장이 꺼져 있습니다. (/padlet on 으로 켜기)' };
  if (!perm.canPostIn(user, ctx.column.id)) throw httpError(403, perm.MANAGED_MSG);

  const session = db.prepare('SELECT * FROM hermes_sessions WHERE user_id = ? AND session_id = ?').get(user.uid, sessionId);
  let post = session && session.post_id ? db.prepare('SELECT * FROM posts WHERE id = ?').get(session.post_id) : null;
  let part = 1;
  let turns = 0;
  if (session && post) {
    const last = new Date(session.updated_at.replace(' ', 'T') + 'Z');
    const stale = Date.now() - last.getTime() > SESSION_GAP_HOURS * 3600 * 1000;
    // 같은 세션 이어쓰기 조건: 새 글 요청 없음 + 오래 쉬지 않음 + 저장 컬럼이 그대로
    if (!input.new_post && !stale && post.column_id === ctx.column.id) {
      part = session.part;
      turns = session.turns;
    } else {
      post = null;
    }
  } else {
    post = null;
  }

  const n = turns + 1;
  const chunk = `**Q${n}.** ${clip(userMessage, MAX_USER_MSG)}\n\n**A${n}.** ${clip(answer, MAX_ASSISTANT_MSG)}`;
  let created = false;

  const run = db.transaction(() => {
    if (post) {
      const next = `${post.content}\n\n---\n\n${chunk}`;
      if (next.length <= MAX_CONTENT) {
        db.prepare("UPDATE posts SET content = ?, edited_at = datetime('now') WHERE id = ?").run(next, post.id);
      } else {
        part += 1;
        post = null; // 아래에서 (part) 게시물 새로 생성
      }
    }
    if (!post) {
      const header = `> 🤖 헤르메스 대화 기록${model ? ` · 모델 ${model}` : ''} · ${fmtKst(new Date().toISOString())} (KST)`;
      const title = makeTitle(ctx.topic, userMessage, part);
      const id = insertPost({
        user, columnId: ctx.column.id, boardId: ctx.board.id, title,
        content: `${header}\n\n${chunk}`, color: 'blue', source: 'hermes',
      });
      post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
      created = true;
    }
    db.prepare(
      `INSERT INTO hermes_sessions (user_id, session_id, post_id, part, turns, model, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, session_id) DO UPDATE SET post_id = excluded.post_id, part = excluded.part,
         turns = excluded.turns, model = excluded.model, updated_at = excluded.updated_at`
    ).run(user.uid, sessionId, post.id, part, n, model);
  });
  run();

  return {
    saved: true, created, part, turns: n, post_id: post.id,
    board: ctx.board, column: { id: ctx.column.id, title: ctx.column.title },
    title: post.title, url: `/board/${ctx.board.id}#post-${post.id}`,
  };
}

const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'orange'];

// 학생이 의도적으로 남기는 메모/발견 사항(findings) → 별도 게시물
function saveNote(user, input = {}) {
  const content = String(input.content || '').trim();
  if (!content) throw httpError(400, '메모 내용을 입력하세요.');
  if (content.length > MAX_CONTENT) throw httpError(400, `메모는 ${MAX_CONTENT}자 이하여야 합니다.`);
  const ctx = ensureContext(user);
  if (!perm.canPostIn(user, ctx.column.id)) throw httpError(403, perm.MANAGED_MSG);
  let title = String(input.title || '').trim().slice(0, 100);
  if (!title) title = `[${kstDate.format(new Date())}]${ctx.topic ? ' ' + ctx.topic : ''} 메모 — ${summarize(content)}`.slice(0, 100);
  const color = NOTE_COLORS.includes(input.color) ? input.color : 'green';
  const id = insertPost({ user, columnId: ctx.column.id, boardId: ctx.board.id, title, content, color, source: 'hermes-note' });
  return { post_id: id, title, board: ctx.board, column: { id: ctx.column.id, title: ctx.column.title }, url: `/board/${ctx.board.id}#post-${id}` };
}

// 내 게시물(모든 접근 가능한 보드) 검색 → 제목/발췌
function searchNotes(user, query, limit = 10) {
  const q = String(query || '').trim();
  if (!q) throw httpError(400, '검색어를 입력하세요.');
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 30);
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.content, p.source, p.created_at, p.board_id, b.title AS board_title, c.title AS column_title
       FROM posts p JOIN boards b ON b.id = p.board_id LEFT JOIN columns c ON c.id = p.column_id
       WHERE p.user_id = ? AND (p.title LIKE ? OR p.content LIKE ?)
       ORDER BY p.created_at DESC, p.id DESC LIMIT ?`
    )
    .all(user.uid, `%${q}%`, `%${q}%`, lim * 3)
    .filter((p) => perm.canAccessBoard(user, p.board_id))
    .slice(0, lim);
  return rows.map((p) => {
    const idx = p.content.toLowerCase().indexOf(q.toLowerCase());
    const start = Math.max(0, idx - 120);
    const snippet = (start > 0 ? '…' : '') + p.content.slice(start, start + 400).trim() + (p.content.length > start + 400 ? '…' : '');
    return {
      post_id: p.id, title: p.title, board: p.board_title, column: p.column_title, source: p.source,
      created_at: fmtKst(p.created_at), snippet, url: `/board/${p.board_id}#post-${p.id}`,
    };
  });
}

module.exports = {
  MAX_CONTENT, authenticate, issueToken, revokeToken, getLink,
  listTargets, getContext, setContext, ensureContext, statusText,
  saveTurn, saveNote, searchNotes, fmtKst,
};
