const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.KAHOOT_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'kahoot.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub  TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  picture     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quizzes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id     INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  text        TEXT NOT NULL,
  time_limit  INTEGER NOT NULL DEFAULT 20,   -- 초
  points      INTEGER NOT NULL DEFAULT 1000  -- 만점 (0이면 연습 문제)
);

CREATE TABLE IF NOT EXISTS options (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  text        TEXT NOT NULL,
  is_correct  INTEGER NOT NULL DEFAULT 0
);

-- 게임(세션) 기록. 퀴즈가 나중에 수정/삭제되어도 결과가 남도록 제목·문제·보기 텍스트를 스냅샷으로 저장
CREATE TABLE IF NOT EXISTS games (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id        INTEGER REFERENCES quizzes(id) ON DELETE SET NULL,
  quiz_title     TEXT NOT NULL,
  pin            TEXT NOT NULL,
  host_id        INTEGER NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL DEFAULT 'lobby',  -- lobby | question | results | leaderboard | finished
  question_count INTEGER NOT NULL DEFAULT 0,
  current_index  INTEGER NOT NULL DEFAULT -1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at    TEXT
);

CREATE TABLE IF NOT EXISTS players (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  score       INTEGER NOT NULL DEFAULT 0,
  joined_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (game_id, user_id)
);

CREATE TABLE IF NOT EXISTS answers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id        INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id      INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  question_index INTEGER NOT NULL,
  question_text  TEXT NOT NULL,
  option_text    TEXT,                          -- NULL이면 미응답
  is_correct     INTEGER NOT NULL DEFAULT 0,
  answer_ms      INTEGER,
  points         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (game_id, player_id, question_index)
);

CREATE INDEX IF NOT EXISTS idx_questions_quiz ON questions(quiz_id, position);
CREATE INDEX IF NOT EXISTS idx_options_question ON options(question_id, position);
CREATE INDEX IF NOT EXISTS idx_games_created ON games(created_at);
CREATE INDEX IF NOT EXISTS idx_players_game ON players(game_id);
CREATE INDEX IF NOT EXISTS idx_answers_game ON answers(game_id, question_index);
`);

// 서버 재시작으로 메모리의 진행 상태를 잃은 게임은 종료 처리
db.prepare("UPDATE games SET status = 'finished', finished_at = datetime('now') WHERE status != 'finished'").run();

module.exports = db;
