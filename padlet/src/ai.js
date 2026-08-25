// 학생 개인 Ollama 연동: 서버 연결/모델 목록, 컬럼 기록 → markdown 내보내기,
// 컬럼 기록을 정리·분석한 개인 학습자료(markdown) 생성 (백그라운드 작업)
const db = require('./db');
const uploads = require('./uploads');

const MAX_SOURCE_CHARS = 24000; // 모델에 넣는 학생 기록 최대 길이
const JOB_TTL_MS = 30 * 60 * 1000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ---------- Ollama ----------

// "192.168.0.10" / "host:11434" / "http://host:11434/" → "http://host:11434"
function normalizeOllamaUrl(input) {
  let url = String(input || '').trim().replace(/\/+$/, '');
  if (!url) throw httpError(400, 'Ollama 서버 주소를 입력하세요.');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  let parsed;
  try { parsed = new URL(url); } catch { throw httpError(400, '주소 형식이 올바르지 않습니다.'); }
  if (!parsed.port && parsed.protocol === 'http:') parsed.port = '11434';
  return parsed.origin;
}

async function listModels(baseUrl) {
  let res;
  try {
    res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(8000) });
  } catch (err) {
    throw httpError(502, `Ollama 서버에 연결할 수 없습니다 (${baseUrl}): ${err.cause?.code || err.name}`);
  }
  if (!res.ok) throw httpError(502, `Ollama 응답 오류 ${res.status}`);
  const data = await res.json();
  return (data.models || []).map((m) => ({
    name: m.name,
    size: m.size,
    parameter_size: m.details?.parameter_size || '',
    family: m.details?.family || '',
    modified_at: m.modified_at,
  }));
}

function estimateCtx(prompt) {
  const est = Math.ceil(prompt.length / 1.5) + 2048; // 한국어 기준 보수적 추정
  let ctx = 4096;
  while (ctx < est && ctx < 32768) ctx *= 2;
  return ctx;
}

// Ollama /api/chat 스트리밍 호출. onProgress(chars)로 진행 상황 보고
async function ollamaChat(baseUrl, model, prompt, onProgress, signal) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    think: false,
    options: { temperature: 0.6, num_ctx: estimateCtx(prompt) },
  };
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const err = new Error(`Ollama 오류 ${res.status}: ${(await res.text()).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  let content = '';
  let buf = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.error) throw new Error(`Ollama 오류: ${obj.error}`);
      if (obj.message?.content) { content += obj.message.content; onProgress(content.length); }
    }
  }
  return content;
}

// ---------- 컬럼/보드 기록 → markdown ----------

// DB의 UTC 시각 → 서울 시간 "YYYY-MM-DD HH:MM"
const timeFmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function fmtKst(utc) {
  const d = new Date(String(utc).replace(' ', 'T') + 'Z');
  return isNaN(d) ? String(utc) : timeFmt.format(d);
}

function columnData(columnId) {
  const column = db.prepare('SELECT * FROM columns WHERE id = ?').get(columnId);
  if (!column) throw httpError(404, '컬럼이 없습니다.');
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(column.board_id);
  const posts = db
    .prepare(
      `SELECT p.*, u.name AS author_name FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.column_id = ? ORDER BY p.position, p.created_at DESC, p.id DESC`
    )
    .all(columnId);
  const commentStmt = db.prepare(
    `SELECT c.*, u.name AS author_name FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ? ORDER BY c.created_at ASC`
  );
  uploads.attachTo('post', posts);
  for (const p of posts) p.comments = commentStmt.all(p.id);
  return { board, column, posts };
}

// 게시물 1개 → markdown. h = 게시물 제목의 heading 수준('##' 또는 '###')
function postMd(p, idx, h) {
  const lines = [`${h} ${p.title || `게시물 ${idx + 1}`}`, ''];
  lines.push(`- 작성자: ${p.author_name} · ${fmtKst(p.created_at)}${p.edited_at ? ' (수정됨)' : ''}`);
  if (p.source === 'hermes') lines.push('- 출처: 헤르메스 대화 자동 기록');
  else if (p.source === 'hermes-note') lines.push('- 출처: 헤르메스 메모');
  if (p.content) lines.push('', p.content);
  const files = (p.attachments || []).map((a) => a.name);
  if (files.length) lines.push('', `첨부파일: ${files.join(', ')}`);
  if (p.comments.length) {
    lines.push('', '댓글:');
    for (const c of p.comments) lines.push(`- ${c.author_name}: ${String(c.content).replace(/\n/g, ' ')}`);
  }
  return lines.join('\n');
}

function columnMarkdown(columnId) {
  const { board, column, posts } = columnData(columnId);
  const parts = [`# ${board.title} — ${column.title}`];
  if (board.description) parts.push('', board.description);
  parts.push('', `게시물 ${posts.length}개 · 내보낸 시각: ${fmtKst(new Date().toISOString())} (KST)`);
  posts.forEach((p, i) => parts.push('', '---', '', postMd(p, i, '##')));
  return { board, column, posts, markdown: parts.join('\n') + '\n' };
}

function boardMarkdown(boardId) {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId);
  if (!board) throw httpError(404, '보드가 없습니다.');
  const columns = db.prepare('SELECT id, title FROM columns WHERE board_id = ? ORDER BY position, id').all(boardId);
  const parts = [`# ${board.title}`];
  if (board.description) parts.push('', board.description);
  parts.push('', `내보낸 시각: ${fmtKst(new Date().toISOString())} (KST)`);
  for (const col of columns) {
    const { posts } = columnData(col.id);
    parts.push('', `## 컬럼: ${col.title} (게시물 ${posts.length}개)`);
    posts.forEach((p, i) => parts.push('', postMd(p, i, '###')));
  }
  return { board, markdown: parts.join('\n') + '\n' };
}

// ---------- 개인 학습자료 생성 (백그라운드 작업) ----------

function buildReportPrompt({ studentName, boardTitle, columnTitle, recordMd, instructions }) {
  return `당신은 학생의 학습 기록을 정리해 개인 학습자료를 만들어 주는 교육 도우미입니다.
아래는 학생 "${studentName}"이(가) 수업 보드 "${boardTitle}"의 "${columnTitle}" 컬럼에 기록한 내용(질문, 메모, 조사한 것, 발견한 것 등)입니다.
이 기록을 바탕으로 이 학생을 위한 개인화된 학습 정리 자료를 작성하세요.

자료 구성:
1. 학습 주제 요약
2. 주제별 핵심 내용 정리 (기록을 체계적으로 재구성)
3. 개념 설명 보강 (기록에 나온 개념 중 설명이 부족한 부분을 일반적으로 알려진 지식으로 보충)
4. 학습 분석 (잘 이해한 부분 / 보완이 필요한 부분)
5. 추천 학습 방향과 연습 문제 2~3개 (답 포함)

규칙:
- 반드시 한국어 markdown으로만 작성하고, 전체를 코드 블록(\`\`\`)으로 감싸지 말 것
- 첫 줄은 "# 제목" 형식의 자료 제목
- 학생 기록에 없는 사실을 기록에 있었던 것처럼 지어내지 말 것
${instructions ? `- 학생의 추가 요청: ${instructions}\n` : ''}
[학생 기록]
"""
${recordMd}
"""`;
}

const jobs = new Map();
let jobSeq = 0;

function startReportJob({ user, columnId, instructions, ollamaUrl, model }) {
  const { board, column, posts, markdown } = columnMarkdown(columnId);
  if (!posts.length) throw httpError(400, '이 컬럼에는 아직 기록(게시물)이 없습니다.');
  if (!model) throw httpError(400, '모델을 선택하세요.');

  const truncated = markdown.length > MAX_SOURCE_CHARS;
  const prompt = buildReportPrompt({
    studentName: user.name || '학생',
    boardTitle: board.title,
    columnTitle: column.title,
    recordMd: markdown.slice(0, MAX_SOURCE_CHARS),
    instructions: String(instructions || '').trim().slice(0, 500),
  });

  const id = String(++jobSeq);
  const job = {
    id, userId: user.uid, status: 'running', started: Date.now(),
    chars: 0, report_id: null, error: null, truncated, model,
    controller: new AbortController(),
  };
  jobs.set(id, job);
  setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref?.();

  (async () => {
    try {
      const raw = await ollamaChat(ollamaUrl, model, prompt, (c) => { job.chars = c; }, job.controller.signal);
      let md = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const fence = md.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n?```\s*$/i);
      if (fence) md = fence[1].trim();
      if (!md) throw new Error('모델이 빈 내용을 반환했습니다.');
      const mTitle = md.match(/^#\s+(.+)$/m);
      const title = (mTitle ? mTitle[1] : `${column.title} 학습자료`).trim().slice(0, 100);
      const info = db
        .prepare(
          `INSERT INTO ai_reports (user_id, board_id, column_id, board_title, column_title, title, content_md, model)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(user.uid, board.id, column.id, board.title, column.title, title, md, model);
      job.report_id = info.lastInsertRowid;
      job.status = 'done';
    } catch (err) {
      job.status = 'error';
      job.error = err.name === 'AbortError' ? '취소되었습니다.' : err.message;
    }
    job.finished = Date.now();
  })();
  return job;
}

function jobInfo(job) {
  return {
    id: job.id,
    status: job.status,
    model: job.model,
    elapsed_ms: (job.finished || Date.now()) - job.started,
    chars: job.chars,
    truncated: job.truncated,
    report_id: job.report_id,
    error: job.error,
  };
}

function getJob(id) {
  return jobs.get(String(id)) || null;
}
function cancelJob(id) {
  const job = jobs.get(String(id));
  if (job && job.status === 'running') job.controller.abort();
  return !!job;
}

module.exports = {
  MAX_SOURCE_CHARS,
  normalizeOllamaUrl, listModels,
  columnMarkdown, boardMarkdown,
  startReportJob, getJob, jobInfo, cancelJob,
};
