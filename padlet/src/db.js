const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.PADLET_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'padlet.db'));
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
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 보드 안의 컬럼(섹션). 패들렛 '셸프' 레이아웃
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

module.exports = db;
module.exports.DEFAULT_COLUMN_TITLE = DEFAULT_COLUMN_TITLE;
