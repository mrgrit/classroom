const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.CORK_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// 개명 이전(padlet.db) 데이터가 있으면 cork.db로 이름만 바꿔 그대로 사용 (WAL/SHM 포함)
const DB_FILE = path.join(DATA_DIR, 'cork.db');
const LEGACY_DB = path.join(DATA_DIR, 'padlet.db');
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

CREATE TABLE IF NOT EXISTS boards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  theme       TEXT NOT NULL DEFAULT '',  -- 배경 테마 키 (public/js/themes.js), 빈 값이면 기본
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 보드 안의 컬럼(섹션). 셸프 레이아웃
CREATE TABLE IF NOT EXISTS columns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id    INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 컬럼 관리자: 지정되면 관리자(admin)와 여기 등록된 이메일의 사용자만 그 컬럼에 글 작성/수정/삭제 가능
CREATE TABLE IF NOT EXISTS column_managers (
  column_id   INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (column_id, email)
);

CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id    INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  column_id   INTEGER REFERENCES columns(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'yellow',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at   TEXT
);

CREATE TABLE IF NOT EXISTS likes (
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 첨부파일: 업로드 직후엔 owner 없음(null), 게시물/댓글 저장 시 연결됨
CREATE TABLE IF NOT EXISTS attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  owner_type    TEXT CHECK (owner_type IN ('post', 'comment')),
  owner_id      INTEGER,
  stored_name   TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  is_image      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 보드 멤버: 지정되면 admin + 등록된 이메일의 사용자만 그 보드에 접근 가능. 비어 있으면 전체 공개
CREATE TABLE IF NOT EXISTS board_members (
  board_id    INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (board_id, email)
);

-- 학생별 개인 Ollama 서버/모델 설정
CREATE TABLE IF NOT EXISTS ai_settings (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id),
  ollama_url  TEXT NOT NULL DEFAULT '',
  model       TEXT NOT NULL DEFAULT '',
  updated_at  TEXT
);

-- AI가 만든 개인 학습자료. 컬럼/보드가 삭제돼도 과제 증빙으로 남도록 느슨한 참조 + 제목 스냅샷
CREATE TABLE IF NOT EXISTS ai_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  board_id     INTEGER,
  column_id    INTEGER,
  board_title  TEXT,
  column_title TEXT,
  title        TEXT NOT NULL,
  content_md   TEXT NOT NULL,
  model        TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 헤르메스(Hermes Agent) 연동: 사용자당 토큰 1개(해시만 저장) + 자동 저장 컨텍스트(과목 보드·컬럼·주제)
CREATE TABLE IF NOT EXISTS hermes_links (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id),
  token_hash   TEXT UNIQUE,
  board_id     INTEGER,
  column_id    INTEGER,
  topic        TEXT NOT NULL DEFAULT '',
  auto_save    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

-- 헤르메스 대화 세션 ↔ 게시물 매핑 (세션 하나 = 게시물 하나, 길어지면 part를 늘려 새 게시물로 이어씀)
CREATE TABLE IF NOT EXISTS hermes_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  session_id  TEXT NOT NULL,
  post_id     INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  part        INTEGER NOT NULL DEFAULT 1,
  turns       INTEGER NOT NULL DEFAULT 0,
  model       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_reports_user ON ai_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_columns_board ON columns(board_id, position);
CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board_id);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
`);

// ---------- 마이그레이션 ----------
// 컬럼 기능 이전에 만들어진 DB: posts.column_id 추가 + 보드마다 기본 컬럼 생성 후 기존 게시물 배정
const postCols = db.prepare("PRAGMA table_info('posts')").all().map((c) => c.name);
if (!postCols.includes('column_id')) {
  db.exec('ALTER TABLE posts ADD COLUMN column_id INTEGER REFERENCES columns(id) ON DELETE CASCADE');
}

const DEFAULT_COLUMN_TITLE = '게시물';
const migrate = db.transaction(() => {
  const boardsWithoutColumns = db
    .prepare('SELECT id FROM boards b WHERE NOT EXISTS (SELECT 1 FROM columns c WHERE c.board_id = b.id)')
    .all();
  const insertCol = db.prepare('INSERT INTO columns (board_id, title, position) VALUES (?, ?, 0)');
  const assign = db.prepare('UPDATE posts SET column_id = ? WHERE board_id = ? AND column_id IS NULL');
  for (const { id } of boardsWithoutColumns) {
    const colId = insertCol.run(id, DEFAULT_COLUMN_TITLE).lastInsertRowid;
    assign.run(colId, id);
  }
  // 컬럼은 있는데 column_id가 비어 있는 게시물 → 첫 컬럼으로
  db.exec(`
    UPDATE posts SET column_id = (
      SELECT id FROM columns c WHERE c.board_id = posts.board_id ORDER BY position, id LIMIT 1
    ) WHERE column_id IS NULL
  `);
});
migrate();
db.exec('CREATE INDEX IF NOT EXISTS idx_posts_column ON posts(column_id)');

// 게시물 순서(드래그 정렬) 기능 이전 DB: posts.position 추가 후 기존 순서(최신순) 그대로 번호 매김
if (!postCols.includes('position')) {
  db.exec('ALTER TABLE posts ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    UPDATE posts SET position = (
      SELECT COUNT(*) FROM posts p2
      WHERE p2.column_id = posts.column_id
        AND (p2.created_at > posts.created_at OR (p2.created_at = posts.created_at AND p2.id > posts.id))
    )
  `);
}

// 게시물 수정 기능 이전 DB: edited_at 추가
if (!postCols.includes('edited_at')) db.exec('ALTER TABLE posts ADD COLUMN edited_at TEXT');

// 배경 테마 기능 이전 DB: boards.theme 추가
const boardCols = db.prepare("PRAGMA table_info('boards')").all().map((c) => c.name);
if (!boardCols.includes('theme')) db.exec("ALTER TABLE boards ADD COLUMN theme TEXT NOT NULL DEFAULT ''");

// 헤르메스 연동 이전 DB: posts.source 추가 ('web' | 'hermes' 대화 기록 | 'hermes-note' 메모)
if (!postCols.includes('source')) db.exec("ALTER TABLE posts ADD COLUMN source TEXT NOT NULL DEFAULT 'web'");

module.exports = db;
module.exports.DEFAULT_COLUMN_TITLE = DEFAULT_COLUMN_TITLE;
