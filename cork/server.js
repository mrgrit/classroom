require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const db = require('./src/db');
const {
  verifyGoogleToken,
  issueSessionCookie,
  requireAuth,
  requireAdmin,
} = require('./src/auth');
const uploads = require('./src/uploads');
const ai = require('./src/ai');
const report = require('./src/report');
const {
  boardMembers, canAccessBoard, PRIVATE_MSG,
  columnManagers, isColumnManager, canPostIn, canEditPost, MANAGED_MSG,
} = require('./src/perm');
const hermes = require('./src/hermes');
const mcp = require('./src/mcp');
const themes = require('./public/js/themes.js'); // 배경 테마 키 목록 (브라우저와 공유)
const fs = require('fs');
const { execFileSync } = require('child_process');

const app = express();
app.set('trust proxy', 1); // Cloudflare Tunnel 등 리버스 프록시 뒤에서 https 인식
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const POST_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'orange'];
const MAX_COLUMNS = 40;

// ---------- 인증 ----------

app.get('/api/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const user = await verifyGoogleToken(req.body.credential);
    issueSessionCookie(res, user);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || '구글 로그인에 실패했습니다.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, name, picture FROM users WHERE id = ?').get(req.user.uid);
  res.json({ ...user, admin: req.user.admin });
});

// ---------- 첨부파일 ----------

app.post('/api/uploads', requireAuth, uploads.handleUpload);
app.get('/uploads/:name', requireAuth, uploads.serveFile);

// ---------- 보드 ----------

app.get('/api/boards', requireAuth, (req, res) => {
  const boards = db
    .prepare(
      `SELECT b.*, u.name AS creator_name,
              (SELECT COUNT(*) FROM posts p WHERE p.board_id = b.id) AS post_count,
              (SELECT COUNT(*) FROM columns c WHERE c.board_id = b.id) AS column_count
       FROM boards b JOIN users u ON u.id = b.created_by
       ORDER BY b.created_at DESC`
    )
    .all()
    .filter((b) => canAccessBoard(req.user, b.id));
  for (const b of boards) {
    const members = boardMembers(b.id);
    b.member_count = members.length;
    b.is_private = members.length > 0;
    if (req.user.admin) b.members = members;
  }
  res.json(boards);
});

// 보드 멤버 지정(전체 교체): {emails: [...]} — 빈 배열이면 전체 공개로 복귀
app.put('/api/boards/:id/members', requireAdmin, (req, res) => {
  const board = db.prepare('SELECT id FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: '보드가 없습니다.' });
  const emails = [...new Set((Array.isArray(req.body.emails) ? req.body.emails : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  const bad = emails.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (bad) return res.status(400).json({ error: `이메일 형식이 올바르지 않습니다: ${bad}` });
  if (emails.length > 100) return res.status(400).json({ error: '보드 멤버는 최대 100명까지 지정할 수 있습니다.' });
  db.transaction(() => {
    db.prepare('DELETE FROM board_members WHERE board_id = ?').run(board.id);
    const ins = db.prepare('INSERT INTO board_members (board_id, email) VALUES (?, ?)');
    emails.forEach((e) => ins.run(board.id, e));
  })();
  res.json({ ok: true, emails });
});

// 컬럼 제목 목록 정리: 공백 제거, 빈 값 제외, 최대 개수 제한. 비어 있으면 기본 컬럼 1개
function normalizeColumnTitles(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  const titles = list.map((t) => String(t).trim().slice(0, 50)).filter(Boolean).slice(0, MAX_COLUMNS);
  return titles.length ? titles : [db.DEFAULT_COLUMN_TITLE];
}

app.post('/api/boards', requireAdmin, (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: '보드 제목을 입력하세요.' });
  const description = (req.body.description || '').trim();
  const columnTitles = normalizeColumnTitles(req.body.columns);
  // 배경 테마: 지정하지 않으면 기존 보드들이 가장 적게 쓴 테마를 골라 서로 구별되게 함
  const theme = req.body.theme === undefined
    ? themes.suggestTheme(db.prepare('SELECT theme FROM boards').all().map((b) => b.theme))
    : String(req.body.theme || '');
  if (!themes.isValidTheme(theme)) return res.status(400).json({ error: '배경 테마가 올바르지 않습니다.' });

  const create = db.transaction(() => {
    const boardId = db
      .prepare('INSERT INTO boards (title, description, theme, created_by) VALUES (?, ?, ?, ?)')
      .run(title, description, theme, req.user.uid).lastInsertRowid;
    const insertCol = db.prepare('INSERT INTO columns (board_id, title, position) VALUES (?, ?, ?)');
    columnTitles.forEach((t, i) => insertCol.run(boardId, t, i));
    return boardId;
  });
  res.status(201).json({ id: create() });
});

// 보드 설정 변경 (관리자): {title, description, theme} 중 주어진 것만 변경
app.put('/api/boards/:id', requireAdmin, (req, res) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: '보드가 없습니다.' });
  let { title, description, theme } = board;
  if (req.body.title !== undefined) {
    title = String(req.body.title).trim();
    if (!title) return res.status(400).json({ error: '보드 제목을 입력하세요.' });
    if (title.length > 100) return res.status(400).json({ error: '보드 제목은 100자 이하여야 합니다.' });
  }
  if (req.body.description !== undefined) description = String(req.body.description).trim();
  if (req.body.theme !== undefined) {
    theme = String(req.body.theme || '');
    if (!themes.isValidTheme(theme)) return res.status(400).json({ error: '배경 테마가 올바르지 않습니다.' });
  }
  db.prepare('UPDATE boards SET title = ?, description = ?, theme = ? WHERE id = ?').run(title, description, theme, board.id);
  res.json({ ok: true, title, description, theme });
});

app.delete('/api/boards/:id', requireAdmin, (req, res) => {
  const postIds = db.prepare('SELECT id FROM posts WHERE board_id = ?').all(req.params.id).map((p) => p.id);
  uploads.deleteForPosts(postIds);
  db.prepare('DELETE FROM boards WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 보드 상세: 컬럼별 게시물 + 좋아요 수/내 좋아요 여부 + 댓글까지 한 번에
app.get('/api/boards/:id', requireAuth, (req, res) => {
  const board = db
    .prepare(
      `SELECT b.*, u.name AS creator_name FROM boards b JOIN users u ON u.id = b.created_by WHERE b.id = ?`
    )
    .get(req.params.id);
  if (!board) return res.status(404).json({ error: '보드가 없습니다.' });
  if (!canAccessBoard(req.user, board.id)) return res.status(403).json({ error: PRIVATE_MSG });

  const columns = db
    .prepare('SELECT id, title, position FROM columns WHERE board_id = ? ORDER BY position, id')
    .all(req.params.id);

  const posts = db
    .prepare(
      `SELECT p.*, u.name AS author_name, u.picture AS author_picture,
              (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
              EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.board_id = ? ORDER BY p.position, p.created_at DESC, p.id DESC`
    )
    .all(req.user.uid, req.params.id);

  const commentStmt = db.prepare(
    `SELECT c.*, u.name AS author_name FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ? ORDER BY c.created_at ASC`
  );
  uploads.attachTo('post', posts);
  const nameByEmail = new Map(db.prepare('SELECT email, name FROM users').all().map((u) => [u.email.toLowerCase(), u.name]));
  for (const col of columns) {
    col.managers = columnManagers(col.id).map((email) => ({ email, name: nameByEmail.get(email) || null }));
    col.can_post = canPostIn(req.user, col.id);
    col.can_manage = isColumnManager(req.user, col.id);
  }
  const byColumn = new Map(columns.map((c) => [c.id, []]));
  for (const post of posts) {
    post.comments = commentStmt.all(post.id);
    uploads.attachTo('comment', post.comments);
    post.is_mine = post.user_id === req.user.uid;
    post.can_edit = canEditPost(req.user, post);
    if (post.source && post.source !== 'web') post.content_html = report.renderMarkdown(post.content); // 헤르메스 기록은 markdown
    (byColumn.get(post.column_id) || byColumn.get(columns[0]?.id))?.push(post);
  }
  for (const col of columns) col.posts = byColumn.get(col.id);

  res.json({ board, columns, me: { uid: req.user.uid, admin: req.user.admin } });
});

// ---------- 컬럼 (관리자) ----------

app.post('/api/boards/:id/columns', requireAdmin, (req, res) => {
  const board = db.prepare('SELECT id FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: '보드가 없습니다.' });
  const title = (req.body.title || '').trim().slice(0, 50);
  if (!title) return res.status(400).json({ error: '컬럼 제목을 입력하세요.' });

  const { c, maxPos } = db
    .prepare('SELECT COUNT(*) AS c, COALESCE(MAX(position), -1) AS maxPos FROM columns WHERE board_id = ?')
    .get(req.params.id);
  if (c >= MAX_COLUMNS) return res.status(400).json({ error: `컬럼은 최대 ${MAX_COLUMNS}개까지 만들 수 있습니다.` });

  const info = db
    .prepare('INSERT INTO columns (board_id, title, position) VALUES (?, ?, ?)')
    .run(req.params.id, title, maxPos + 1);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put('/api/columns/:id', requireAdmin, (req, res) => {
  const col = db.prepare('SELECT * FROM columns WHERE id = ?').get(req.params.id);
  if (!col) return res.status(404).json({ error: '컬럼이 없습니다.' });
  const title = (req.body.title || '').trim().slice(0, 50);
  if (!title) return res.status(400).json({ error: '컬럼 제목을 입력하세요.' });
  db.prepare('UPDATE columns SET title = ? WHERE id = ?').run(title, req.params.id);
  res.json({ ok: true });
});

// 컬럼 순서 변경: 해당 보드의 컬럼 id 전체를 원하는 순서대로 배열로 전달
app.put('/api/boards/:id/columns/order', requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  const existing = db.prepare('SELECT id FROM columns WHERE board_id = ?').all(req.params.id).map((c) => c.id);
  const sameSet = ids.length === existing.length && existing.every((id) => ids.includes(id));
  if (!sameSet) return res.status(400).json({ error: '컬럼 목록이 보드와 일치하지 않습니다.' });

  const update = db.prepare('UPDATE columns SET position = ? WHERE id = ? AND board_id = ?');
  db.transaction(() => ids.forEach((id, i) => update.run(i, id, req.params.id)))();
  res.json({ ok: true });
});

// 컬럼 관리자 지정(전체 교체): {emails: [...]} — 빈 배열이면 지정 해제(누구나 작성 가능으로 복귀)
app.put('/api/columns/:id/managers', requireAdmin, (req, res) => {
  const col = db.prepare('SELECT id FROM columns WHERE id = ?').get(req.params.id);
  if (!col) return res.status(404).json({ error: '컬럼이 없습니다.' });
  const emails = [...new Set((Array.isArray(req.body.emails) ? req.body.emails : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  const bad = emails.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (bad) return res.status(400).json({ error: `이메일 형식이 올바르지 않습니다: ${bad}` });
  if (emails.length > 20) return res.status(400).json({ error: '컬럼 관리자는 최대 20명까지 지정할 수 있습니다.' });
  db.transaction(() => {
    db.prepare('DELETE FROM column_managers WHERE column_id = ?').run(col.id);
    const ins = db.prepare('INSERT INTO column_managers (column_id, email) VALUES (?, ?)');
    emails.forEach((e) => ins.run(col.id, e));
  })();
  res.json({ ok: true, emails });
});

// 로그인한 적 있는 사용자 목록 (컬럼 관리자 선택용)
app.get('/api/users', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, email, name FROM users ORDER BY name, email').all());
});

app.delete('/api/columns/:id', requireAdmin, (req, res) => {
  const col = db.prepare('SELECT * FROM columns WHERE id = ?').get(req.params.id);
  if (!col) return res.status(404).json({ error: '컬럼이 없습니다.' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM columns WHERE board_id = ?').get(col.board_id).c;
  if (count <= 1) return res.status(400).json({ error: '마지막 컬럼은 삭제할 수 없습니다.' });
  const postIds = db.prepare('SELECT id FROM posts WHERE column_id = ?').all(req.params.id).map((p) => p.id);
  uploads.deleteForPosts(postIds);
  db.prepare('DELETE FROM columns WHERE id = ?').run(req.params.id); // 게시물은 CASCADE 삭제
  res.json({ ok: true });
});

// ---------- 게시물 ----------

// 게시물이 들어갈 컬럼 결정: 요청한 column_id가 해당 보드 것이면 사용, 없으면 첫 컬럼
function resolveColumn(boardId, columnId) {
  if (columnId) {
    const col = db.prepare('SELECT id FROM columns WHERE id = ? AND board_id = ?').get(columnId, boardId);
    if (col) return col.id;
    return null;
  }
  const first = db.prepare('SELECT id FROM columns WHERE board_id = ? ORDER BY position, id LIMIT 1').get(boardId);
  return first ? first.id : null;
}

// 컬럼 맨 위에 올 position 값 (새 게시물·컬럼 이동 시 최상단 배치)
function topPosition(columnId) {
  const row = db.prepare('SELECT COALESCE(MIN(position), 1) AS m FROM posts WHERE column_id = ?').get(columnId);
  return row.m - 1;
}

app.post('/api/boards/:id/posts', requireAuth, (req, res) => {
  const board = db.prepare('SELECT id FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: '보드가 없습니다.' });
  if (!canAccessBoard(req.user, board.id)) return res.status(403).json({ error: PRIVATE_MSG });

  const content = (req.body.content || '').trim();
  const attachmentIds = Array.isArray(req.body.attachment_ids) ? req.body.attachment_ids : [];
  if (!content && !attachmentIds.length) return res.status(400).json({ error: '내용을 입력하거나 파일을 첨부하세요.' });
  if (content.length > 2000) return res.status(400).json({ error: '내용은 2000자 이하로 입력하세요.' });

  const columnId = resolveColumn(board.id, req.body.column_id);
  if (!columnId) return res.status(400).json({ error: '컬럼이 올바르지 않습니다.' });
  if (!canPostIn(req.user, columnId)) return res.status(403).json({ error: MANAGED_MSG });

  const title = (req.body.title || '').trim().slice(0, 100);
  const color = POST_COLORS.includes(req.body.color) ? req.body.color : 'yellow';

  const info = db
    .prepare('INSERT INTO posts (board_id, column_id, user_id, title, content, color, position) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, columnId, req.user.uid, title, content, color, topPosition(columnId));
  const attached = uploads.claim('post', info.lastInsertRowid, attachmentIds, req.user.uid);
  if (!content && !attached) {
    db.prepare('DELETE FROM posts WHERE id = ?').run(info.lastInsertRowid);
    return res.status(400).json({ error: '첨부파일이 올바르지 않습니다.' });
  }
  res.status(201).json({ id: info.lastInsertRowid });
});

// 수정: 제목/내용/색상 변경, 첨부 추가(attachment_ids)/삭제(remove_attachment_ids), 또는 column_id만 보내서 컬럼 이동
app.put('/api/posts/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '게시물이 없습니다.' });
  if (!canAccessBoard(req.user, post.board_id)) return res.status(403).json({ error: PRIVATE_MSG });
  if (!canEditPost(req.user, post))
    return res.status(403).json({ error: columnManagers(post.column_id).length ? MANAGED_MSG : '본인 게시물만 수정할 수 있습니다.' });

  let columnId = post.column_id;
  if (req.body.column_id !== undefined) {
    columnId = resolveColumn(post.board_id, req.body.column_id);
    if (!columnId) return res.status(400).json({ error: '컬럼이 올바르지 않습니다.' });
    if (columnId !== post.column_id && !canPostIn(req.user, columnId)) return res.status(403).json({ error: MANAGED_MSG });
  }

  let { title, content, color } = post;
  const editing = req.body.content !== undefined || req.body.title !== undefined || req.body.color !== undefined
    || req.body.attachment_ids !== undefined || req.body.remove_attachment_ids !== undefined;
  if (req.body.content !== undefined) content = String(req.body.content).trim();
  if (req.body.title !== undefined) title = String(req.body.title).trim().slice(0, 100);
  if (req.body.color !== undefined && POST_COLORS.includes(req.body.color)) color = req.body.color;
  const maxLen = post.source && post.source !== 'web' ? hermes.MAX_CONTENT : 2000; // 헤르메스 기록은 대화가 길어 상한이 큼
  if (content.length > maxLen) return res.status(400).json({ error: `내용은 ${maxLen}자 이하로 입력하세요.` });

  const removeIds = Array.isArray(req.body.remove_attachment_ids) ? req.body.remove_attachment_ids.map(Number) : [];
  const addIds = Array.isArray(req.body.attachment_ids) ? req.body.attachment_ids : [];
  if (editing) {
    const existing = db.prepare("SELECT id FROM attachments WHERE owner_type = 'post' AND owner_id = ?").all(post.id).map((a) => a.id);
    const remaining = existing.filter((id) => !removeIds.includes(id)).length + uploads.countClaimable(addIds, req.user.uid);
    if (!content && remaining === 0) return res.status(400).json({ error: '내용을 입력하거나 파일을 첨부하세요.' });
  }

  const position = columnId !== post.column_id ? topPosition(columnId) : post.position;
  db.transaction(() => {
    uploads.removeFromPost(post.id, removeIds);
    uploads.claim('post', post.id, addIds, req.user.uid);
    db.prepare(
      `UPDATE posts SET title = ?, content = ?, color = ?, column_id = ?, position = ?,
       edited_at = CASE WHEN ? THEN datetime('now') ELSE edited_at END WHERE id = ?`
    ).run(title, content, color, columnId, position, editing ? 1 : 0, req.params.id);
  })();
  res.json({ ok: true });
});

// 드래그 이동: {column_id, index} → 해당 컬럼의 index 번째(0부터) 위치로. 같은 컬럼이면 순서만 변경
app.put('/api/posts/:id/move', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '게시물이 없습니다.' });
  if (!canAccessBoard(req.user, post.board_id)) return res.status(403).json({ error: PRIVATE_MSG });
  if (!canEditPost(req.user, post))
    return res.status(403).json({ error: columnManagers(post.column_id).length ? MANAGED_MSG : '본인 게시물만 이동할 수 있습니다.' });

  const columnId = resolveColumn(post.board_id, req.body.column_id ?? post.column_id);
  if (!columnId) return res.status(400).json({ error: '컬럼이 올바르지 않습니다.' });
  if (columnId !== post.column_id && !canPostIn(req.user, columnId)) return res.status(403).json({ error: MANAGED_MSG });
  const index = Number.isInteger(req.body.index) && req.body.index >= 0 ? req.body.index : 0;

  db.transaction(() => {
    const ids = db
      .prepare('SELECT id FROM posts WHERE column_id = ? AND id != ? ORDER BY position, created_at DESC, id DESC')
      .all(columnId, post.id)
      .map((r) => r.id);
    ids.splice(Math.min(index, ids.length), 0, post.id);
    const update = db.prepare('UPDATE posts SET position = ?, column_id = ? WHERE id = ?');
    ids.forEach((id, i) => update.run(i, columnId, id));
  })();
  res.json({ ok: true });
});

app.delete('/api/posts/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '게시물이 없습니다.' });
  if (!canAccessBoard(req.user, post.board_id)) return res.status(403).json({ error: PRIVATE_MSG });
  if (!canEditPost(req.user, post))
    return res.status(403).json({ error: columnManagers(post.column_id).length ? MANAGED_MSG : '본인 게시물만 삭제할 수 있습니다.' });

  uploads.deleteForPosts([post.id]);
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 좋아요 ----------

app.post('/api/posts/:id/like', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id, board_id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '게시물이 없습니다.' });
  if (!canAccessBoard(req.user, post.board_id)) return res.status(403).json({ error: PRIVATE_MSG });

  const existing = db
    .prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?')
    .get(req.params.id, req.user.uid);
  if (existing) {
    db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').run(req.params.id, req.user.uid);
  } else {
    db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').run(req.params.id, req.user.uid);
  }
  const count = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE post_id = ?').get(req.params.id).c;
  res.json({ liked: !existing, like_count: count });
});

// ---------- 댓글 ----------

app.post('/api/posts/:id/comments', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id, board_id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '게시물이 없습니다.' });
  if (!canAccessBoard(req.user, post.board_id)) return res.status(403).json({ error: PRIVATE_MSG });

  const content = (req.body.content || '').trim();
  const attachmentIds = Array.isArray(req.body.attachment_ids) ? req.body.attachment_ids : [];
  if (!content && !attachmentIds.length) return res.status(400).json({ error: '댓글 내용을 입력하거나 파일을 첨부하세요.' });
  if (content.length > 500) return res.status(400).json({ error: '댓글은 500자 이하로 입력하세요.' });

  const info = db
    .prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)')
    .run(req.params.id, req.user.uid, content);
  const attached = uploads.claim('comment', info.lastInsertRowid, attachmentIds, req.user.uid);
  if (!content && !attached) {
    db.prepare('DELETE FROM comments WHERE id = ?').run(info.lastInsertRowid);
    return res.status(400).json({ error: '첨부파일이 올바르지 않습니다.' });
  }
  res.status(201).json({ id: info.lastInsertRowid });
});

app.delete('/api/comments/:id', requireAuth, (req, res) => {
  const comment = db
    .prepare('SELECT c.*, p.board_id FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?')
    .get(req.params.id);
  if (!comment) return res.status(404).json({ error: '댓글이 없습니다.' });
  if (!canAccessBoard(req.user, comment.board_id)) return res.status(403).json({ error: PRIVATE_MSG });
  if (comment.user_id !== req.user.uid && !req.user.admin)
    return res.status(403).json({ error: '본인 댓글만 삭제할 수 있습니다.' });

  uploads.deleteForComments([comment.id]);
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 글쓰기 양식 (관리자가 만들고, 학생이 게시물 작성 시 선택) ----------

const MAX_TEMPLATE_FIELDS = 20;

// {name, description, fields:[{label, placeholder}]} 검증·정리. 문제가 있으면 {error}
function normalizeTemplate(body) {
  const name = String(body.name || '').trim().slice(0, 50);
  if (!name) return { error: '양식 이름을 입력하세요.' };
  const description = String(body.description || '').trim().slice(0, 200);
  const fields = (Array.isArray(body.fields) ? body.fields : [])
    .map((f) => ({
      label: String((f && f.label) || '').trim().slice(0, 50),
      placeholder: String((f && f.placeholder) || '').trim().slice(0, 200),
    }))
    .filter((f) => f.label);
  if (!fields.length) return { error: '항목을 하나 이상 입력하세요.' };
  if (fields.length > MAX_TEMPLATE_FIELDS) return { error: `항목은 최대 ${MAX_TEMPLATE_FIELDS}개까지 만들 수 있습니다.` };
  return { name, description, fields };
}

app.get('/api/templates', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM templates ORDER BY id').all();
  res.json(rows.map((t) => ({ ...t, fields: JSON.parse(t.fields) })));
});

app.post('/api/templates', requireAdmin, (req, res) => {
  const t = normalizeTemplate(req.body);
  if (t.error) return res.status(400).json({ error: t.error });
  const info = db
    .prepare('INSERT INTO templates (name, description, fields) VALUES (?, ?, ?)')
    .run(t.name, t.description, JSON.stringify(t.fields));
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put('/api/templates/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT id FROM templates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '양식이 없습니다.' });
  const t = normalizeTemplate(req.body);
  if (t.error) return res.status(400).json({ error: t.error });
  db.prepare("UPDATE templates SET name = ?, description = ?, fields = ?, updated_at = datetime('now') WHERE id = ?")
    .run(t.name, t.description, JSON.stringify(t.fields), row.id);
  res.json({ ok: true });
});

app.delete('/api/templates/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 내 AI 설정 (학생별 Ollama) ----------

app.get('/api/my/ai', requireAuth, (req, res) => {
  const row = db.prepare('SELECT ollama_url, model FROM ai_settings WHERE user_id = ?').get(req.user.uid);
  res.json(row || { ollama_url: '', model: '' });
});

// 서버 연결 확인 + 모델 목록 (저장은 하지 않음)
app.post('/api/my/ai/connect', requireAuth, async (req, res) => {
  try {
    const url = ai.normalizeOllamaUrl(req.body.url);
    const models = await ai.listModels(url);
    res.json({ url, models });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.put('/api/my/ai', requireAuth, (req, res) => {
  let url = '';
  try {
    url = req.body.ollama_url ? ai.normalizeOllamaUrl(req.body.ollama_url) : '';
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const model = String(req.body.model || '').trim().slice(0, 100);
  db.prepare(
    `INSERT INTO ai_settings (user_id, ollama_url, model, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET ollama_url = excluded.ollama_url, model = excluded.model, updated_at = excluded.updated_at`
  ).run(req.user.uid, url, model);
  res.json({ ok: true, ollama_url: url, model });
});

// ---------- AI 학습자료 생성 ----------

// 컬럼 기록으로 개인 학습자료 생성 시작 → {job_id} (진행 상황은 폴링)
app.post('/api/columns/:id/report', requireAuth, (req, res) => {
  const col = db.prepare('SELECT * FROM columns WHERE id = ?').get(req.params.id);
  if (!col) return res.status(404).json({ error: '컬럼이 없습니다.' });
  if (!canAccessBoard(req.user, col.board_id)) return res.status(403).json({ error: PRIVATE_MSG });
  const setting = db.prepare('SELECT ollama_url, model FROM ai_settings WHERE user_id = ?').get(req.user.uid);
  if (!setting || !setting.ollama_url || !setting.model)
    return res.status(400).json({ error: '먼저 내 정보 페이지에서 Ollama 서버를 연결하고 모델을 선택하세요.' });
  try {
    const job = ai.startReportJob({
      user: { uid: req.user.uid, name: req.user.name },
      columnId: col.id,
      instructions: req.body.instructions,
      ollamaUrl: setting.ollama_url,
      model: setting.model,
    });
    res.status(202).json({ job_id: job.id });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/ai/jobs/:id', requireAuth, (req, res) => {
  const job = ai.getJob(req.params.id);
  if (!job || job.userId !== req.user.uid) return res.status(404).json({ error: '작업을 찾을 수 없습니다.' });
  res.json(ai.jobInfo(job));
});

app.delete('/api/ai/jobs/:id', requireAuth, (req, res) => {
  const job = ai.getJob(req.params.id);
  if (!job || job.userId !== req.user.uid) return res.status(404).json({ error: '작업을 찾을 수 없습니다.' });
  ai.cancelJob(req.params.id);
  res.json({ ok: true });
});

// ---------- AI 학습자료 (저장된 결과) ----------

// 본인 것 또는 admin만 접근 가능. 실패 시 응답까지 처리하고 null 반환
function findReport(req, res) {
  const r = db
    .prepare('SELECT r.*, u.name AS student_name FROM ai_reports r JOIN users u ON u.id = r.user_id WHERE r.id = ?')
    .get(req.params.id);
  if (!r) {
    res.status(404).json({ error: '학습자료가 없습니다.' });
    return null;
  }
  if (r.user_id !== req.user.uid && !req.user.admin) {
    res.status(403).json({ error: '본인 학습자료만 볼 수 있습니다.' });
    return null;
  }
  return r;
}

// 다운로드 파일명 (한글 파일명 RFC 5987 인코딩 + ASCII 대체)
function setDownloadName(res, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`);
}

app.get('/api/my/reports', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, title, board_title, column_title, model, created_at
       FROM ai_reports WHERE user_id = ? ORDER BY created_at DESC, id DESC`
    )
    .all(req.user.uid);
  res.json(rows);
});

app.get('/api/reports/:id', requireAuth, (req, res) => {
  const r = findReport(req, res);
  if (!r) return;
  res.json({ ...r, html: report.renderMarkdown(r.content_md) });
});

app.get('/api/reports/:id/pdf', requireAuth, async (req, res) => {
  const r = findReport(req, res);
  if (!r) return;
  try {
    const pdf = await report.reportPdf(r);
    res.setHeader('Content-Type', 'application/pdf');
    setDownloadName(res, `${r.title}.pdf`);
    res.send(pdf);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/reports/:id', requireAuth, (req, res) => {
  const r = findReport(req, res);
  if (!r) return;
  db.prepare('DELETE FROM ai_reports WHERE id = ?').run(r.id);
  res.json({ ok: true });
});

// ---------- 내보내기 (markdown) ----------

app.get('/api/columns/:id/export.md', requireAuth, (req, res) => {
  const col = db.prepare('SELECT id, board_id FROM columns WHERE id = ?').get(req.params.id);
  if (!col) return res.status(404).json({ error: '컬럼이 없습니다.' });
  if (!canAccessBoard(req.user, col.board_id)) return res.status(403).json({ error: PRIVATE_MSG });
  const { board, column, markdown } = ai.columnMarkdown(col.id);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  setDownloadName(res, `${board.title}-${column.title}.md`);
  res.send(markdown);
});

app.get('/api/boards/:id/export.md', requireAuth, (req, res) => {
  const b = db.prepare('SELECT id FROM boards WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: '보드가 없습니다.' });
  if (!canAccessBoard(req.user, b.id)) return res.status(403).json({ error: PRIVATE_MSG });
  const { board, markdown } = ai.boardMarkdown(b.id);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  setDownloadName(res, `${board.title}.md`);
  res.send(markdown);
});

// ---------- AI 에이전트(헤르메스 · Claude Code) 연동 ----------
// 웹(로그인 쿠키)은 내 정보 페이지용, /api/hermes/* 와 /mcp 는 플러그인·훅·MCP 클라이언트용(Bearer 연동 토큰)
// 같은 토큰·API를 헤르메스 플러그인과 Claude Code 훅이 함께 사용한다.

const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;
const installCommand = (req, token) => `curl -fsSL ${baseUrl(req)}/hermes/install.sh | CORK_TOKEN=${token || '<토큰>'} bash`;
const claudeInstallCommand = (req, token) => `curl -fsSL ${baseUrl(req)}/claude/install.sh | CORK_TOKEN=${token || '<토큰>'} bash`;

app.get('/api/my/hermes', requireAuth, (req, res) => {
  const link = hermes.getLink(req.user.uid);
  res.json({
    ...hermes.getContext(req.user),
    created_at: link ? link.created_at : null,
    install_command: installCommand(req, null),
    install_command_claude: claudeInstallCommand(req, null),
  });
});

// 토큰 발급/재발급 — 평문은 이 응답에서만 볼 수 있음
app.post('/api/my/hermes/token', requireAuth, (req, res) => {
  const token = hermes.issueToken(req.user.uid);
  res.json({ token, install_command: installCommand(req, token), install_command_claude: claudeInstallCommand(req, token) });
});

app.delete('/api/my/hermes/token', requireAuth, (req, res) => {
  hermes.revokeToken(req.user.uid);
  res.json({ ok: true });
});

app.put('/api/my/hermes/context', requireAuth, (req, res) => {
  try {
    res.json(hermes.setContext(req.user, req.body));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

function requireHermes(req, res, next) {
  const user = hermes.authenticate(req.get('authorization'));
  if (!user) return res.status(401).json({ error: '헤르메스 연동 토큰이 없거나 유효하지 않습니다. 코르크 내 정보 페이지에서 토큰을 다시 발급하세요.' });
  req.user = user;
  next();
}
const hermesError = (res, err) => res.status(err.status || 500).json({ error: err.message, code: err.code });

app.get('/api/hermes/me', requireHermes, (req, res) => {
  const ctx = hermes.getContext(req.user);
  const status_text = hermes.statusText(ctx, req.user);
  if (req.query.format === 'text') return res.type('text/plain').send(status_text + '\n');
  res.json({ user: { name: req.user.name, email: req.user.email, admin: req.user.admin }, ...ctx, status_text });
});

app.get('/api/hermes/targets', requireHermes, (req, res) => res.json(hermes.listTargets(req.user)));

app.put('/api/hermes/context', requireHermes, (req, res) => {
  try {
    const ctx = hermes.setContext(req.user, req.body);
    res.json({ ...ctx, status_text: hermes.statusText(ctx, req.user) });
  } catch (err) {
    hermesError(res, err);
  }
});

// 플러그인 훅이 매 턴 호출: {session_id, user_message, assistant_response, model, platform, new_post}
app.post('/api/hermes/turns', requireHermes, (req, res) => {
  try {
    res.json(hermes.saveTurn(req.user, req.body));
  } catch (err) {
    hermesError(res, err);
  }
});

app.post('/api/hermes/notes', requireHermes, (req, res) => {
  try {
    res.status(201).json(hermes.saveNote(req.user, req.body));
  } catch (err) {
    hermesError(res, err);
  }
});

app.get('/api/hermes/search', requireHermes, (req, res) => {
  try {
    res.json(hermes.searchNotes(req.user, req.query.q, req.query.limit));
  } catch (err) {
    hermesError(res, err);
  }
});

// MCP 서버 (Streamable HTTP, 무상태). 도구: cork_status / list_targets / set_context / save_note / search_notes
app.post('/mcp', requireHermes, (req, res) => mcp.handle(req, res));
app.all('/mcp', (req, res) => res.status(405).json({ error: 'POST만 지원합니다.' }));

// 플러그인 배포: 설치 스크립트(주소 치환) + 플러그인 디렉토리 tarball(소스가 바뀌면 다시 묶음)
const PLUGIN_DIR = path.join(__dirname, 'hermes-plugin');
const PLUGIN_TGZ = path.join(process.env.CORK_DATA_DIR || path.join(__dirname, 'data'), 'hermes-plugin.tgz');
function pluginTarball() {
  let newest = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '__pycache__') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
  };
  walk(PLUGIN_DIR);
  if (!fs.existsSync(PLUGIN_TGZ) || fs.statSync(PLUGIN_TGZ).mtimeMs < newest) {
    execFileSync('tar', ['--exclude=__pycache__', '--exclude=install.sh', '-czf', PLUGIN_TGZ, '-C', PLUGIN_DIR, '.']);
  }
  return PLUGIN_TGZ;
}
app.get('/hermes/plugin.tgz', (req, res) => res.sendFile(pluginTarball()));
app.get('/hermes/install.sh', (req, res) => {
  const script = fs.readFileSync(path.join(PLUGIN_DIR, 'install.sh'), 'utf8').replace(/__CORK_URL__/g, baseUrl(req));
  res.type('text/x-shellscript').send(script);
});

// Claude Code 연동 배포: 설치 스크립트(주소 치환) + 저장 훅 + /cork 슬래시 명령
const CLAUDE_PLUGIN_DIR = path.join(__dirname, 'claude-plugin');
app.get('/claude/install.sh', (req, res) => {
  const script = fs.readFileSync(path.join(CLAUDE_PLUGIN_DIR, 'install.sh'), 'utf8').replace(/__CORK_URL__/g, baseUrl(req));
  res.type('text/x-shellscript').send(script);
});
app.get('/claude/save_turn.py', (req, res) => res.type('text/x-python').sendFile(path.join(CLAUDE_PLUGIN_DIR, 'save_turn.py')));
app.get('/claude/cork.md', (req, res) => res.type('text/markdown').sendFile(path.join(CLAUDE_PLUGIN_DIR, 'commands', 'cork.md')));

// ---------- 페이지 라우팅 ----------

app.get('/board/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'board.html'));
});

app.get('/me', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'me.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/report/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'report.html'));
});

app.listen(PORT, () => {
  console.log(`코르크(Cork) 서버 실행 중: http://localhost:${PORT}`);
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.warn('경고: GOOGLE_CLIENT_ID가 설정되지 않았습니다. .env 파일을 확인하세요.');
  }
});
