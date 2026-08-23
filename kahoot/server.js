require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const { WebSocketServer } = require('ws');
const db = require('./src/db');
const { verifyGoogleToken, issueSessionCookie, requireAuth, requireAdmin, userFromCookieHeader } = require('./src/auth');
const game = require('./src/game');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3001;
const MAX_QUESTIONS = 100;
const MAX_OPTIONS = 4;

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

// ---------- 퀴즈 (관리자) ----------

app.get('/api/quizzes', requireAdmin, (req, res) => {
  const quizzes = db
    .prepare(
      `SELECT q.id, q.title, q.description, q.created_at, q.updated_at,
              (SELECT COUNT(*) FROM questions qq WHERE qq.quiz_id = q.id) AS question_count,
              (SELECT COUNT(*) FROM games g WHERE g.quiz_id = q.id) AS game_count
       FROM quizzes q ORDER BY q.updated_at DESC`
    )
    .all();
  res.json(quizzes);
});

app.post('/api/quizzes', requireAdmin, (req, res) => {
  const title = (req.body.title || '').trim().slice(0, 100);
  if (!title) return res.status(400).json({ error: '퀴즈 제목을 입력하세요.' });
  const id = db
    .prepare('INSERT INTO quizzes (title, description, created_by) VALUES (?, ?, ?)')
    .run(title, (req.body.description || '').trim().slice(0, 300), req.user.uid).lastInsertRowid;
  res.status(201).json({ id });
});

app.get('/api/quizzes/:id', requireAdmin, (req, res) => {
  const quiz = game.loadQuiz(req.params.id);
  if (!quiz) return res.status(404).json({ error: '퀴즈가 없습니다.' });
  res.json(quiz);
});

// 퀴즈 전체 저장: 제목/설명 + 문제 목록을 통째로 교체
function validateQuestions(input) {
  if (!Array.isArray(input)) throw new Error('문제 목록이 올바르지 않습니다.');
  if (input.length > MAX_QUESTIONS) throw new Error(`문제는 최대 ${MAX_QUESTIONS}개까지 가능합니다.`);
  return input.map((q, i) => {
    const text = String(q.text || '').trim().slice(0, 500);
    if (!text) throw new Error(`${i + 1}번 문제의 내용을 입력하세요.`);
    const time_limit = game.TIME_LIMITS.includes(Number(q.time_limit)) ? Number(q.time_limit) : 20;
    const points = [0, 500, 1000, 2000].includes(Number(q.points)) ? Number(q.points) : 1000;
    const options = (Array.isArray(q.options) ? q.options : [])
      .map((o) => ({ text: String(o.text || '').trim().slice(0, 200), is_correct: o.is_correct ? 1 : 0 }))
      .filter((o) => o.text)
      .slice(0, MAX_OPTIONS);
    if (options.length < 2) throw new Error(`${i + 1}번 문제는 보기가 2개 이상이어야 합니다.`);
    if (!options.some((o) => o.is_correct)) throw new Error(`${i + 1}번 문제의 정답을 표시하세요.`);
    return { text, time_limit, points, options };
  });
}

app.put('/api/quizzes/:id', requireAdmin, (req, res) => {
  const quiz = db.prepare('SELECT id FROM quizzes WHERE id = ?').get(req.params.id);
  if (!quiz) return res.status(404).json({ error: '퀴즈가 없습니다.' });
  const title = (req.body.title || '').trim().slice(0, 100);
  if (!title) return res.status(400).json({ error: '퀴즈 제목을 입력하세요.' });
  let questions;
  try {
    questions = validateQuestions(req.body.questions || []);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  db.transaction(() => {
    db.prepare("UPDATE quizzes SET title = ?, description = ?, updated_at = datetime('now') WHERE id = ?").run(
      title, (req.body.description || '').trim().slice(0, 300), quiz.id
    );
    db.prepare('DELETE FROM questions WHERE quiz_id = ?').run(quiz.id);
    const insQ = db.prepare('INSERT INTO questions (quiz_id, position, text, time_limit, points) VALUES (?, ?, ?, ?, ?)');
    const insO = db.prepare('INSERT INTO options (question_id, position, text, is_correct) VALUES (?, ?, ?, ?)');
    questions.forEach((q, i) => {
      const qid = insQ.run(quiz.id, i, q.text, q.time_limit, q.points).lastInsertRowid;
      q.options.forEach((o, j) => insO.run(qid, j, o.text, o.is_correct));
    });
  })();
  res.json({ ok: true, question_count: questions.length });
});

app.post('/api/quizzes/:id/duplicate', requireAdmin, (req, res) => {
  const quiz = game.loadQuiz(req.params.id);
  if (!quiz) return res.status(404).json({ error: '퀴즈가 없습니다.' });
  const id = db.transaction(() => {
    const newId = db
      .prepare('INSERT INTO quizzes (title, description, created_by) VALUES (?, ?, ?)')
      .run(`${quiz.title} (복사본)`.slice(0, 100), quiz.description, req.user.uid).lastInsertRowid;
    const insQ = db.prepare('INSERT INTO questions (quiz_id, position, text, time_limit, points) VALUES (?, ?, ?, ?, ?)');
    const insO = db.prepare('INSERT INTO options (question_id, position, text, is_correct) VALUES (?, ?, ?, ?)');
    quiz.questions.forEach((q, i) => {
      const qid = insQ.run(newId, i, q.text, q.time_limit, q.points).lastInsertRowid;
      q.options.forEach((o, j) => insO.run(qid, j, o.text, o.is_correct));
    });
    return newId;
  })();
  res.status(201).json({ id });
});

app.delete('/api/quizzes/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM quizzes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 게임 ----------

app.post('/api/quizzes/:id/games', requireAdmin, (req, res) => {
  try {
    const g = game.createGame(Number(req.params.id), req.user.uid);
    res.status(201).json({ id: g.id, pin: g.pin });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// PIN으로 참가 → 게임 id 반환 (실제 참가 등록은 WebSocket 연결 시)
app.post('/api/games/join', requireAuth, (req, res) => {
  const g = game.findByPin(req.body.pin);
  if (!g) return res.status(404).json({ error: 'PIN이 올바르지 않거나 게임이 끝났습니다.' });
  if (g.status === 'finished') return res.status(400).json({ error: '이미 끝난 게임입니다.' });
  res.json({ id: g.id, title: g.title });
});

app.get('/api/games', requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT g.id, g.quiz_id, g.quiz_title, g.pin, g.status, g.question_count, g.current_index, g.created_at, g.finished_at,
              (SELECT COUNT(*) FROM players p WHERE p.game_id = g.id) AS player_count
       FROM games g ORDER BY g.created_at DESC LIMIT 100`
    )
    .all();
  res.json(rows);
});

app.get('/api/games/:id', requireAuth, (req, res) => {
  const live = game.getGame(req.params.id);
  if (live) return res.json({ id: live.id, pin: live.pin, title: live.title, status: live.status, live: true });
  const row = db.prepare('SELECT id, pin, quiz_title AS title, status FROM games WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '게임이 없습니다.' });
  res.json({ ...row, live: false });
});

// 결과표: 참가자별 점수·정답 수·문제별 응답
function buildResults(gameId) {
  const g = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
  if (!g) return null;
  const players = db
    .prepare(
      `SELECT p.id, p.name, p.score, u.email FROM players p JOIN users u ON u.id = p.user_id
       WHERE p.game_id = ? ORDER BY p.score DESC, p.name`
    )
    .all(gameId);
  const answers = db.prepare('SELECT * FROM answers WHERE game_id = ? ORDER BY question_index').all(gameId);
  const questions = [];
  const byPlayer = new Map(players.map((p) => [p.id, p]));
  for (const p of players) { p.answers = {}; p.correct_count = 0; }
  for (const a of answers) {
    if (!questions[a.question_index]) questions[a.question_index] = { index: a.question_index, text: a.question_text, correct_count: 0, answered_count: 0 };
    const q = questions[a.question_index];
    const p = byPlayer.get(a.player_id);
    if (!p) continue;
    p.answers[a.question_index] = { option_text: a.option_text, is_correct: !!a.is_correct, answer_ms: a.answer_ms, points: a.points };
    if (a.option_text !== null) q.answered_count++;
    if (a.is_correct) { q.correct_count++; p.correct_count++; }
  }
  return { game: g, questions: questions.filter(Boolean), players: players.map((p, i) => ({ ...p, rank: i + 1 })) };
}

app.get('/api/games/:id/results', requireAdmin, (req, res) => {
  const data = buildResults(req.params.id);
  if (!data) return res.status(404).json({ error: '게임이 없습니다.' });
  res.json(data);
});

app.get('/api/games/:id/results.csv', requireAdmin, (req, res) => {
  const data = buildResults(req.params.id);
  if (!data) return res.status(404).json({ error: '게임이 없습니다.' });
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const head = ['순위', '이름', '이메일', '점수', '정답수', ...data.questions.map((q) => `Q${q.index + 1} ${q.text}`)];
  const lines = [head.map(esc).join(',')];
  for (const p of data.players) {
    const cells = [p.rank, p.name, p.email, p.score, p.correct_count];
    for (const q of data.questions) {
      const a = p.answers[q.index];
      cells.push(!a || a.option_text === null ? '미응답' : `${a.is_correct ? 'O' : 'X'} ${a.option_text} (${(a.answer_ms / 1000).toFixed(1)}s, ${a.points}점)`);
    }
    lines.push(cells.map(esc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="kahoot-${data.game.id}.csv"`);
  res.send('\uFEFF' + lines.join('\r\n')); // BOM: 엑셀 한글 깨짐 방지
});

app.delete('/api/games/:id', requireAdmin, (req, res) => {
  if (game.getGame(req.params.id)) return res.status(400).json({ error: '진행 중인 게임은 삭제할 수 없습니다.' });
  db.prepare('DELETE FROM games WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 페이지 ----------

const page = (name) => (req, res) => res.sendFile(path.join(__dirname, 'public', name));
app.get('/quiz/:id', page('quiz.html'));
app.get('/host/:id', page('host.html'));
app.get('/play/:id', page('play.html'));
app.get('/results/:id', page('results.html'));

// ---------- WebSocket ----------

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws') return socket.destroy();
  const user = userFromCookieHeader(req.headers.cookie);
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    game.attachSocket(ws, user);
  });
});

// 죽은 연결 정리 (휴대폰 화면 꺼짐 등)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`카훗 클론 서버 실행 중: http://localhost:${PORT}`);
  if (!process.env.GOOGLE_CLIENT_ID) console.warn('경고: GOOGLE_CLIENT_ID가 설정되지 않았습니다. .env 파일을 확인하세요.');
});
