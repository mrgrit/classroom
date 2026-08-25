// 첨부파일 업로드/서빙/정리. 파일은 data/uploads/ 에 저장, 메타는 attachments 테이블.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('./db');

const UPLOAD_DIR = path.join(process.env.CORK_DATA_DIR || path.join(__dirname, '..', 'data'), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES_PER_POST = 5;
const MAX_FILES_PER_COMMENT = 2;

// 브라우저에서 바로 보여줄 이미지 (svg는 스크립트 실행 가능성 때문에 제외)
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
// 그 외 허용 확장자 (다운로드용)
const ALLOWED_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.pdf', '.txt', '.md', '.csv', '.zip',
  '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.hwp', '.hwpx',
]);

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || mimeToExt(file.mimetype);
    cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

function mimeToExt(mime) {
  return { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }[mime] || '';
}

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    // 클립보드 캡처는 이름이 'image.png' 등으로 옴. 확장자 없으면 mime으로 판단
    const ext = path.extname(file.originalname || '').toLowerCase() || mimeToExt(file.mimetype);
    if (!ALLOWED_EXT.has(ext)) {
      const err = new Error('허용되지 않는 파일 형식입니다. (이미지, PDF, 문서, zip 가능)');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

// multer 미들웨어 + DB 기록. 업로드 직후에는 owner가 없고, 게시물/댓글 저장 시 연결됨
function handleUpload(req, res) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '파일은 10MB 이하만 업로드할 수 있습니다.' : err.message;
      return res.status(err.status || 400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });

    const isImage = IMAGE_MIMES.has(req.file.mimetype) ? 1 : 0;
    // 원본 파일명: 경로 제거, 너무 길면 자름. 한글 파일명은 multer가 latin1로 깨뜨리므로 복원
    let original = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    original = path.basename(original).slice(0, 200) || req.file.filename;

    const info = db
      .prepare(
        `INSERT INTO attachments (user_id, stored_name, original_name, mime, size, is_image)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(req.user.uid, req.file.filename, original, req.file.mimetype, req.file.size, isImage);

    res.status(201).json(toClient(db.prepare('SELECT * FROM attachments WHERE id = ?').get(info.lastInsertRowid)));
  });
}

function toClient(a) {
  return {
    id: a.id,
    url: `/uploads/${a.stored_name}`,
    name: a.original_name,
    mime: a.mime,
    size: a.size,
    is_image: !!a.is_image,
  };
}

// 로그인한 사용자에게만 파일 제공
function serveFile(req, res) {
  const name = path.basename(req.params.name);
  const a = db.prepare('SELECT * FROM attachments WHERE stored_name = ?').get(name);
  if (!a) return res.status(404).end();
  const filePath = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).end();

  const inline = a.is_image || a.mime === 'application/pdf';
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.original_name)}`
  );
  res.type(a.mime);
  res.sendFile(filePath);
}

// 업로드된(아직 주인 없는, 본인이 올린) 첨부를 게시물/댓글에 연결. 연결된 개수 반환
function claim(ownerType, ownerId, ids, userId) {
  const max = ownerType === 'post' ? MAX_FILES_PER_POST : MAX_FILES_PER_COMMENT;
  const existing = countFor(ownerType, ownerId);
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger).slice(0, Math.max(0, max - existing));
  if (!list.length) return 0;
  const stmt = db.prepare(
    `UPDATE attachments SET owner_type = ?, owner_id = ?
     WHERE id = ? AND user_id = ? AND owner_type IS NULL`
  );
  let n = 0;
  for (const id of list) n += stmt.run(ownerType, ownerId, id, userId).changes;
  return n;
}

function countFor(ownerType, ownerId) {
  return db.prepare('SELECT COUNT(*) AS c FROM attachments WHERE owner_type = ? AND owner_id = ?').get(ownerType, ownerId).c;
}

// 아직 주인 없는 본인 첨부 중 실제로 연결 가능한 id 개수 (수정 시 사전 검증용)
function countClaimable(ids, userId) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger);
  if (!list.length) return 0;
  const stmt = db.prepare('SELECT 1 FROM attachments WHERE id = ? AND user_id = ? AND owner_type IS NULL');
  return list.filter((id) => stmt.get(id, userId)).length;
}

// 게시물에서 특정 첨부만 제거 (파일도 삭제)
function removeFromPost(postId, ids) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger);
  if (!list.length) return;
  const ph = list.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id, stored_name FROM attachments WHERE owner_type = 'post' AND owner_id = ? AND id IN (${ph})`)
    .all(postId, ...list);
  removeRows(rows);
}

// 게시물/댓글 목록에 attachments 배열을 붙임
function attachTo(ownerType, items) {
  if (!items.length) return;
  const stmt = db.prepare(
    'SELECT * FROM attachments WHERE owner_type = ? AND owner_id = ? ORDER BY id'
  );
  for (const item of items) item.attachments = stmt.all(ownerType, item.id).map(toClient);
}

function unlinkQuietly(storedName) {
  fs.unlink(path.join(UPLOAD_DIR, storedName), () => {});
}

// 게시물 삭제 전 호출: 게시물 + 그 댓글들의 첨부파일 삭제
function deleteForPosts(postIds) {
  if (!postIds.length) return;
  const ph = postIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, stored_name FROM attachments
       WHERE (owner_type = 'post' AND owner_id IN (${ph}))
          OR (owner_type = 'comment' AND owner_id IN (SELECT id FROM comments WHERE post_id IN (${ph})))`
    )
    .all(...postIds, ...postIds);
  removeRows(rows);
}

function deleteForComments(commentIds) {
  if (!commentIds.length) return;
  const ph = commentIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id, stored_name FROM attachments WHERE owner_type = 'comment' AND owner_id IN (${ph})`)
    .all(...commentIds);
  removeRows(rows);
}

function removeRows(rows) {
  if (!rows.length) return;
  const del = db.prepare('DELETE FROM attachments WHERE id = ?');
  for (const r of rows) {
    del.run(r.id);
    unlinkQuietly(r.stored_name);
  }
}

// 업로드만 하고 게시하지 않은 첨부는 1시간 뒤 정리 (30분마다)
function cleanupOrphans() {
  const rows = db
    .prepare(`SELECT id, stored_name FROM attachments WHERE owner_type IS NULL AND created_at < datetime('now', '-1 hour')`)
    .all();
  removeRows(rows);
}
setInterval(cleanupOrphans, 30 * 60 * 1000).unref();
cleanupOrphans();

module.exports = { handleUpload, serveFile, claim, countFor, countClaimable, removeFromPost, attachTo, deleteForPosts, deleteForComments };
