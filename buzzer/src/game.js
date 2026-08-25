// 게임 진행 엔진: 메모리에 진행 상태를 두고 WebSocket으로 호스트/참가자 화면을 동기화.
// 참가자·답안·점수는 단계가 바뀔 때마다 SQLite에 기록되어 결과 페이지에서 볼 수 있다.
const db = require('./db');

const games = new Map(); // gameId -> game
const byPin = new Map(); // pin -> game

const GRACE_MS = 300; // 네트워크 지연 여유
const TIME_LIMITS = [5, 10, 20, 30, 60, 90, 120];

function loadQuiz(quizId) {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(quizId);
  if (!quiz) return null;
  quiz.questions = db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position, id').all(quizId);
  const optStmt = db.prepare('SELECT id, text, is_correct FROM options WHERE question_id = ? ORDER BY position, id');
  for (const q of quiz.questions) q.options = optStmt.all(q.id);
  return quiz;
}

function genPin() {
  for (;;) {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    if (!byPin.has(pin)) return pin;
  }
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ---------- 게임 생성/조회 ----------

function createGame(quizId, hostUid) {
  const quiz = loadQuiz(quizId);
  if (!quiz) throw httpError(404, '퀴즈가 없습니다.');
  if (!quiz.questions.length) throw httpError(400, '문제가 없는 퀴즈는 진행할 수 없습니다.');
  if (quiz.questions.some((q) => q.options.length < 2 || !q.options.some((o) => o.is_correct)))
    throw httpError(400, '보기가 2개 미만이거나 정답이 없는 문제가 있습니다. 퀴즈를 먼저 수정하세요.');

  const pin = genPin();
  const id = db
    .prepare('INSERT INTO games (quiz_id, quiz_title, theme, pin, host_id, status, question_count) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(quizId, quiz.title, quiz.theme || '', pin, hostUid, 'lobby', quiz.questions.length).lastInsertRowid;

  const game = {
    id,
    pin,
    quizId,
    title: quiz.title,
    theme: quiz.theme || '', // 배경 테마 (호스트/참가자 화면 공통)
    questions: quiz.questions,
    status: 'lobby',
    index: -1,
    startedAt: 0,
    timer: null,
    hostUid,
    hosts: new Set(), // 호스트 화면 소켓들
    players: new Map(), // uid -> { id, uid, name, score, sockets:Set, answer }
  };
  games.set(id, game);
  byPin.set(pin, game);
  return game;
}

function getGame(id) {
  return games.get(Number(id)) || null;
}

function findByPin(pin) {
  return byPin.get(String(pin || '').trim()) || null;
}

function joinGame(game, user) {
  if (game.status === 'finished') throw httpError(400, '이미 끝난 게임입니다.');
  let player = game.players.get(user.uid);
  if (!player) {
    const id = db
      .prepare(
        `INSERT INTO players (game_id, user_id, name) VALUES (?, ?, ?)
         ON CONFLICT(game_id, user_id) DO UPDATE SET name = excluded.name`
      )
      .run(game.id, user.uid, user.name).lastInsertRowid;
    const row = db.prepare('SELECT id FROM players WHERE game_id = ? AND user_id = ?').get(game.id, user.uid);
    player = { id: row ? row.id : id, uid: user.uid, name: user.name, score: 0, sockets: new Set(), answer: null };
    game.players.set(user.uid, player);
    broadcastHosts(game);
  }
  return player;
}

// ---------- 진행 ----------

function currentQuestion(game) {
  return game.questions[game.index] || null;
}

function remainingMs(game) {
  const q = currentQuestion(game);
  if (game.status !== 'question' || !q) return 0;
  return Math.max(0, game.startedAt + q.time_limit * 1000 - Date.now());
}

function startQuestion(game, index) {
  game.index = index;
  game.status = 'question';
  game.startedAt = Date.now();
  for (const p of game.players.values()) p.answer = null;
  clearTimeout(game.timer);
  game.timer = setTimeout(() => endQuestion(game), currentQuestion(game).time_limit * 1000 + GRACE_MS);
  persistStatus(game);
  broadcastAll(game);
}

function submitAnswer(game, player, optionId) {
  if (game.status !== 'question') return { error: '지금은 답할 수 없습니다.' };
  if (player.answer) return { error: '이미 답했습니다.' };
  const q = currentQuestion(game);
  const option = q.options.find((o) => o.id === Number(optionId));
  if (!option) return { error: '보기가 올바르지 않습니다.' };
  const ms = Date.now() - game.startedAt;
  if (ms > q.time_limit * 1000 + GRACE_MS) return { error: '시간이 끝났습니다.' };

  player.answer = { option, ms: Math.min(ms, q.time_limit * 1000), correct: !!option.is_correct };
  // 접속 중인 참가자가 모두 답하면 바로 종료
  const connected = [...game.players.values()].filter((p) => p.sockets.size > 0);
  const allAnswered = connected.length > 0 && connected.every((p) => p.answer);
  broadcastHosts(game);
  if (allAnswered) endQuestion(game);
  return { ok: true };
}

// 퀴즈쇼 방식 점수: 빠를수록 높음 — 만점 × (1 − 소요시간비율/2), 정답일 때만
function calcPoints(q, ms) {
  if (!q.points) return 0;
  const ratio = Math.min(1, ms / (q.time_limit * 1000));
  return Math.round(q.points * (1 - ratio / 2));
}

function endQuestion(game) {
  if (game.status !== 'question') return;
  clearTimeout(game.timer);
  const q = currentQuestion(game);
  const insert = db.prepare(
    `INSERT OR REPLACE INTO answers (game_id, player_id, question_index, question_text, option_text, is_correct, answer_ms, points)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateScore = db.prepare('UPDATE players SET score = ? WHERE id = ?');
  db.transaction(() => {
    for (const p of game.players.values()) {
      const a = p.answer;
      const points = a && a.correct ? calcPoints(q, a.ms) : 0;
      if (a) a.points = points;
      p.score += points;
      insert.run(game.id, p.id, game.index, q.text, a ? a.option.text : null, a && a.correct ? 1 : 0, a ? a.ms : null, points);
      updateScore.run(p.score, p.id);
    }
  })();
  game.status = 'results';
  persistStatus(game);
  broadcastAll(game);
}

function next(game) {
  switch (game.status) {
    case 'lobby':
      if (!game.players.size) return { error: '참가자가 없습니다.' };
      startQuestion(game, 0);
      break;
    case 'question':
      endQuestion(game); // 호스트가 일찍 종료
      break;
    case 'results':
      if (game.index >= game.questions.length - 1) finish(game);
      else {
        game.status = 'leaderboard';
        persistStatus(game);
        broadcastAll(game);
      }
      break;
    case 'leaderboard':
      startQuestion(game, game.index + 1);
      break;
    default:
      return { error: '게임이 끝났습니다.' };
  }
  return { ok: true };
}

function finish(game) {
  clearTimeout(game.timer);
  if (game.status === 'question') endQuestion(game);
  game.status = 'finished';
  db.prepare("UPDATE games SET status = 'finished', current_index = ?, finished_at = datetime('now') WHERE id = ?").run(game.index, game.id);
  broadcastAll(game);
  // 잠시 뒤 메모리에서 제거 (끝난 화면은 이미 받았음)
  setTimeout(() => {
    games.delete(game.id);
    byPin.delete(game.pin);
    for (const p of game.players.values()) for (const ws of p.sockets) safeClose(ws);
    for (const ws of game.hosts) safeClose(ws);
  }, 60 * 60 * 1000);
}

function persistStatus(game) {
  db.prepare('UPDATE games SET status = ?, current_index = ? WHERE id = ?').run(game.status, game.index, game.id);
}

// ---------- 상태 스냅샷 ----------

function ranking(game) {
  return [...game.players.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((p, i) => ({ uid: p.uid, name: p.name, score: p.score, rank: i + 1 }));
}

function publicQuestion(q) {
  return { text: q.text, time_limit: q.time_limit, points: q.points, options: q.options.map((o) => ({ id: o.id, text: o.text })) };
}

function resultsPayload(game) {
  const q = currentQuestion(game);
  const counts = {};
  for (const o of q.options) counts[o.id] = 0;
  for (const p of game.players.values()) if (p.answer) counts[p.answer.option.id]++;
  return { counts, correct_ids: q.options.filter((o) => o.is_correct).map((o) => o.id), leaderboard: ranking(game).slice(0, 10) };
}

function stateFor(game, role, uid) {
  const q = currentQuestion(game);
  const showQuestion = ['question', 'results', 'leaderboard'].includes(game.status) && q;
  const base = {
    type: 'state',
    status: game.status,
    pin: game.pin,
    title: game.title,
    theme: game.theme,
    index: game.index,
    total: game.questions.length,
    player_count: game.players.size,
    question: showQuestion ? publicQuestion(q) : null,
    remaining_ms: remainingMs(game),
    answered: [...game.players.values()].filter((p) => p.answer).length,
    results: ['results', 'leaderboard', 'finished'].includes(game.status) && q ? resultsPayload(game) : null,
  };
  if (role === 'host') {
    base.players = [...game.players.values()].map((p) => ({ uid: p.uid, name: p.name, score: p.score, connected: p.sockets.size > 0, answered: !!p.answer }));
    if (game.status === 'finished') base.final = ranking(game);
    return base;
  }
  const p = game.players.get(uid);
  if (p) {
    const rank = ranking(game).find((r) => r.uid === uid);
    base.me = {
      name: p.name,
      score: p.score,
      rank: rank ? rank.rank : null,
      answered: !!p.answer,
      option_id: p.answer ? p.answer.option.id : null,
      correct: p.answer ? p.answer.correct : null,
      points: p.answer ? p.answer.points || 0 : 0,
    };
  }
  return base;
}

// ---------- 전송 ----------

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function safeClose(ws) {
  try { ws.close(); } catch {}
}
function broadcastHosts(game) {
  if (!game.hosts.size) return;
  const msg = stateFor(game, 'host');
  for (const ws of game.hosts) send(ws, msg);
}
function broadcastPlayers(game) {
  for (const p of game.players.values()) {
    if (!p.sockets.size) continue;
    const msg = stateFor(game, 'player', p.uid);
    for (const ws of p.sockets) send(ws, msg);
  }
}
function broadcastAll(game) {
  broadcastHosts(game);
  broadcastPlayers(game);
}

// ---------- WebSocket 연결 처리 ----------

function attachSocket(ws, user) {
  let game = null;
  let role = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'host') {
      const g = getGame(msg.game_id);
      if (!g) return send(ws, { type: 'error', message: '게임이 없거나 이미 종료되었습니다.', fatal: true });
      if (!user.admin) return send(ws, { type: 'error', message: '관리자만 진행할 수 있습니다.', fatal: true });
      detach();
      game = g; role = 'host';
      game.hosts.add(ws);
      send(ws, stateFor(game, 'host'));
      return;
    }
    if (msg.type === 'join') {
      const g = getGame(msg.game_id);
      if (!g) return send(ws, { type: 'error', message: '게임이 없거나 이미 종료되었습니다.', fatal: true });
      let player;
      try { player = joinGame(g, user); } catch (err) { return send(ws, { type: 'error', message: err.message, fatal: true }); }
      detach();
      game = g; role = 'player';
      player.sockets.add(ws);
      send(ws, stateFor(game, 'player', user.uid));
      broadcastHosts(game); // 접속 상태 갱신
      return;
    }
    if (!game) return;

    if (role === 'player' && msg.type === 'answer') {
      const player = game.players.get(user.uid);
      const r = submitAnswer(game, player, msg.option_id);
      if (r.error) send(ws, { type: 'error', message: r.error });
      else if (game.status === 'question') send(ws, stateFor(game, 'player', user.uid));
      return;
    }
    if (role === 'host') {
      if (msg.type === 'next') {
        const r = next(game);
        if (r.error) send(ws, { type: 'error', message: r.error });
      } else if (msg.type === 'end') {
        finish(game);
      } else if (msg.type === 'kick' && game.status === 'lobby') {
        const p = game.players.get(Number(msg.uid));
        if (p) {
          for (const s of p.sockets) { send(s, { type: 'error', message: '호스트가 내보냈습니다.', fatal: true }); safeClose(s); }
          game.players.delete(p.uid);
          db.prepare('DELETE FROM players WHERE id = ?').run(p.id);
          broadcastHosts(game);
        }
      }
    }
  });

  function detach() {
    if (!game) return;
    if (role === 'host') game.hosts.delete(ws);
    else {
      const p = game.players.get(user.uid);
      if (p) {
        p.sockets.delete(ws);
        broadcastHosts(game);
      }
    }
    game = null; role = null;
  }
  ws.on('close', detach);
}

module.exports = { createGame, getGame, findByPin, attachSocket, TIME_LIMITS, loadQuiz };
