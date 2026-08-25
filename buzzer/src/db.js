const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.BUZZER_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// 개명 이전(kahoot.db) 데이터가 있으면 buzzer.db로 이름만 바꿔 그대로 사용 (WAL/SHM 포함)
const DB_FILE = path.join(DATA_DIR, 'buzzer.db');
const LEGACY_DB = path.join(DATA_DIR, 'kahoot.db');
if (!fs.existsSync(DB_FILE) && fs.existsSync(LEGACY_DB)) {
  for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(LEGACY_DB + suffix)) fs.renameSync(LEGACY_DB + suffix, DB_FILE + suffix);
}
const db = new Database(DB_FILE);
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
  theme       TEXT NOT NULL DEFAULT '',  -- 배경 테마 키 (public/js/themes.js), 빈 값이면 기본
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
  theme          TEXT NOT NULL DEFAULT '',  -- 게임 생성 시점의 퀴즈 테마 스냅샷
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

// 배경 테마 기능 이전 DB: quizzes.theme / games.theme 추가 + 기존 퀴즈에 서로 다른 테마를 순서대로 배정
for (const table of ['quizzes', 'games']) {
  const cols = db.prepare(`PRAGMA table_info('${table}')`).all().map((c) => c.name);
  if (cols.includes('theme')) continue;
  db.exec(`ALTER TABLE ${table} ADD COLUMN theme TEXT NOT NULL DEFAULT ''`);
  if (table !== 'quizzes') continue;
  const { suggestTheme } = require('../public/js/themes.js');
  const used = [];
  const setTheme = db.prepare('UPDATE quizzes SET theme = ? WHERE id = ?');
  db.transaction(() => {
    for (const { id } of db.prepare('SELECT id FROM quizzes ORDER BY id').all()) {
      const theme = suggestTheme(used);
      used.push(theme);
      setTheme.run(theme, id);
    }
  })();
}

// 서버 재시작으로 메모리의 진행 상태를 잃은 게임은 종료 처리
db.prepare("UPDATE games SET status = 'finished', finished_at = datetime('now') WHERE status != 'finished'").run();

module.exports = db;
