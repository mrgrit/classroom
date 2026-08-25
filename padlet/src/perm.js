// 보드/컬럼 권한 규칙 — 웹 API(server.js)와 헤르메스 연동(src/hermes.js, src/mcp.js)이 공유
const db = require('./db');

// ---------- 보드 접근 권한 ----------
// 보드에 멤버가 지정되어 있으면 admin + 등록된 이메일만 접근(보기/쓰기) 가능. 지정이 없으면 로그인한 누구나
const boardMemberStmt = db.prepare('SELECT email FROM board_members WHERE board_id = ? ORDER BY email');
function boardMembers(boardId) {
  return boardMemberStmt.all(boardId).map((r) => r.email);
}
function canAccessBoard(user, boardId) {
  if (user.admin) return true;
  const members = boardMembers(boardId);
  return !members.length || members.includes((user.email || '').toLowerCase());
}
const PRIVATE_MSG = '이 보드는 지정된 학생만 접근할 수 있습니다.';

// ---------- 컬럼 권한 ----------
// 컬럼에 관리자가 지정되어 있으면 admin + 지정 관리자만 글 작성/수정/삭제/이동 가능.
// 지정이 없으면 누구나 작성, 본인 글만 수정/삭제 (admin은 모두)
const managerStmt = db.prepare('SELECT email FROM column_managers WHERE column_id = ? ORDER BY email');
function columnManagers(columnId) {
  return managerStmt.all(columnId).map((r) => r.email);
}
function isColumnManager(user, columnId) {
  return user.admin || columnManagers(columnId).includes((user.email || '').toLowerCase());
}
function canPostIn(user, columnId) {
  return user.admin || !columnManagers(columnId).length || isColumnManager(user, columnId);
}
function canEditPost(user, post) {
  if (user.admin) return true;
  if (columnManagers(post.column_id).length) return isColumnManager(user, post.column_id);
  return post.user_id === user.uid;
}
const MANAGED_MSG = '이 컬럼은 지정된 관리자만 글을 쓰거나 고칠 수 있습니다.';

module.exports = {
  boardMembers, canAccessBoard, PRIVATE_MSG,
  columnManagers, isColumnManager, canPostIn, canEditPost, MANAGED_MSG,
};
