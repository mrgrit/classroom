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

const app = express();
app.set('trust proxy', 1); // Cloudflare Tunnel 등 리버스 프록시 뒤에서 https 인식
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const POST_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'orange'];

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

// ---------- 보드 ----------

app.get('/api/boards', requireAuth, (req, res) => {
  const boards = db
    .prepare(
      `SELECT b.*, u.name AS creator_name,
              (SELECT COUNT(*) FROM posts p WHERE p.board_id = b.id) AS post_count
       FROM boards b JOIN users u ON u.id = b.created_by
       ORDER BY b.created_at DESC`
    )
    .all();
  res.json(boards);
});

app.post('/api/boards', requireAdmin, (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: '보드 제목을 입력하세요.' });
  const description = (req.body.description || '').trim();
  const info = db
    .prepare('INSERT INTO boards (title, description, created_by) VALUES (?, ?, ?)')
    .run(title, description, req.user.uid);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.delete('/api/boards/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM boards WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 보드 상세: 게시물 + 좋아요 수/내 좋아요 여부 + 댓글까지 한 번에
app.get('/api/boards/:id', requireAuth, (req, res) => {
  const board = db
    .prepare(
      `SELECT b.*, u.name AS creator_name FROM boards b JOIN users u ON u.id = b.created_by WHERE b.id = ?`
    )
    .get(req.params.id);
  if (!board) return res.status(404).json({ error: '보드가 없습니다.' });

  const posts = db
    .prepare(
      `SELECT p.*, u.name AS author_name, u.picture AS author_picture,
              (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
              EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.board_id = ? ORDER BY p.created_at DESC`
    )
    .all(req.user.uid, req.params.id);

  const commentStmt = db.prepare(
    `SELECT c.*, u.name AS author_name FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ? ORDER BY c.created_at ASC`
  );
  for (const post of posts) {
    post.comments = commentStmt.all(post.id);
    post.is_mine = post.user_id === req.user.uid;
  }

  res.json({ board, posts, me: { uid: req.user.uid, admin: req.user.admin } });
});

// ---------- 게시물 ----------

app.post('/api/boards/:id/posts', requireAuth, (req, res) => {
  const board = db.prepare('SELECT id FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: '보드가 없습니다.' });

  const content = (req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: '내용을 입력하세요.' });
  if (content.length > 2000) return res.status(400).json({ error: '내용은 2000자 이하로 입력하세요.' });

  const title = (req.body.title || '').trim().slice(0, 100);
  const color = POST_COLORS.includes(req.body.color) ? req.body.color : 'yellow';

  const info = db
    .prepare('INSERT INTO posts (board_id, user_id, title, content, color) VALUES (?, ?, ?, ?, ?)')
    .run(req.params.id, req.user.uid, title, content, color);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put('/api/posts/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '게시물이 없습니다.' });
  if (post.user_id !== req.user.uid && !req.user.admin)
    return res.status(403).json({ error: '본인 게시물만 수정할 수 있습니다.' });

  const content = (req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: '내용을 입력하세요.' });
  const title = (req.body.title || '').trim().slice(0, 100);

  db.prepare('UPDATE posts SET title = ?, content = ? WHERE id = ?').run(title, content, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/posts/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '게시물이 없습니다.' });
  if (post.user_id !== req.user.uid && !req.user.admin)
    return res.status(403).json({ error: '본인 게시물만 삭제할 수 있습니다.' });

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
  if (!content) return res.status(400).json({ error: '댓글 내용을 입력하세요.' });
  if (content.length > 500) return res.status(400).json({ error: '댓글은 500자 이하로 입력하세요.' });

  const info = db
    .prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)')
    .run(req.params.id, req.user.uid, content);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.delete('/api/comments/:id', requireAuth, (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: '댓글이 없습니다.' });
  if (comment.user_id !== req.user.uid && !req.user.admin)
    return res.status(403).json({ error: '본인 댓글만 삭제할 수 있습니다.' });

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
