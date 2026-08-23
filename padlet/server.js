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

const app = express();
app.set('trust proxy', 1); // Cloudflare Tunnel 등 리버스 프록시 뒤에서 https 인식
app.use(express.json());
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
    .all();
  res.json(boards);
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

  const create = db.transaction(() => {
    const boardId = db
      .prepare('INSERT INTO boards (title, description, created_by) VALUES (?, ?, ?)')
      .run(title, description, req.user.uid).lastInsertRowid;
    const insertCol = db.prepare('INSERT INTO columns (board_id, title, position) VALUES (?, ?, ?)');
    columnTitles.forEach((t, i) => insertCol.run(boardId, t, i));
    return boardId;
  });
  res.status(201).json({ id: create() });
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
  const byColumn = new Map(columns.map((c) => [c.id, []]));
  for (const post of posts) {
    post.comments = commentStmt.all(post.id);
    uploads.attachTo('comment', post.comments);
    post.is_mine = post.user_id === req.user.uid;
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

  const content = (req.body.content || '').trim();
  const attachmentIds = Array.isArray(req.body.attachment_ids) ? req.body.attachment_ids : [];
  if (!content && !attachmentIds.length) return res.status(400).json({ error: '내용을 입력하거나 파일을 첨부하세요.' });
  if (content.length > 2000) return res.status(400).json({ error: '내용은 2000자 이하로 입력하세요.' });

  const columnId = resolveColumn(board.id, req.body.column_id);
  if (!columnId) return res.status(400).json({ error: '컬럼이 올바르지 않습니다.' });

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

// 수정: 제목/내용 변경 또는 column_id만 보내서 다른 컬럼으로 이동
app.put('/api/posts/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '게시물이 없습니다.' });
  if (post.user_id !== req.user.uid && !req.user.admin)
    return res.status(403).json({ error: '본인 게시물만 수정할 수 있습니다.' });

  let columnId = post.column_id;
  if (req.body.column_id !== undefined) {
    columnId = resolveColumn(post.board_id, req.body.column_id);
    if (!columnId) return res.status(400).json({ error: '컬럼이 올바르지 않습니다.' });
  }

  let { title, content } = post;
  if (req.body.content !== undefined) {
    content = String(req.body.content).trim();
    const hasFiles = db.prepare("SELECT 1 FROM attachments WHERE owner_type = 'post' AND owner_id = ?").get(post.id);
    if (!content && !hasFiles) return res.status(400).json({ error: '내용을 입력하세요.' });
    if (content.length > 2000) return res.status(400).json({ error: '내용은 2000자 이하로 입력하세요.' });
  }
  if (req.body.title !== undefined) title = String(req.body.title).trim().slice(0, 100);

  const position = columnId !== post.column_id ? topPosition(columnId) : post.position;
  db.prepare('UPDATE posts SET title = ?, content = ?, column_id = ?, position = ? WHERE id = ?').run(
    title, content, columnId, position, req.params.id
  );
  res.json({ ok: true });
});

// 드래그 이동: {column_id, index} → 해당 컬럼의 index 번째(0부터) 위치로. 같은 컬럼이면 순서만 변경
app.put('/api/posts/:id/move', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '게시물이 없습니다.' });
  if (post.user_id !== req.user.uid && !req.user.admin)
    return res.status(403).json({ error: '본인 게시물만 이동할 수 있습니다.' });

  const columnId = resolveColumn(post.board_id, req.body.column_id ?? post.column_id);
  if (!columnId) return res.status(400).json({ error: '컬럼이 올바르지 않습니다.' });
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
  if (post.user_id !== req.user.uid && !req.user.admin)
    return res.status(403).json({ error: '본인 게시물만 삭제할 수 있습니다.' });

  uploads.deleteForPosts([post.id]);
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 좋아요 ----------

app.post('/api/posts/:id/like', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '게시물이 없습니다.' });

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
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '게시물이 없습니다.' });

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
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: '댓글이 없습니다.' });
  if (comment.user_id !== req.user.uid && !req.user.admin)
    return res.status(403).json({ error: '본인 댓글만 삭제할 수 있습니다.' });

  uploads.deleteForComments([comment.id]);
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 페이지 라우팅 ----------

app.get('/board/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'board.html'));
});

app.listen(PORT, () => {
  console.log(`패들렛 클론 서버 실행 중: http://localhost:${PORT}`);
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.warn('경고: GOOGLE_CLIENT_ID가 설정되지 않았습니다. .env 파일을 확인하세요.');
  }
});
