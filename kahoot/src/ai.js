// AI 퀴즈 생성: Ollama 서버 연결 → 자료(텍스트/파일/URL)에서 텍스트 추출 → 객관식 문제 JSON 생성(백그라운드 작업)
const db = require('./db');
const AdmZip = require('adm-zip');
const pdfParse = require('pdf-parse');

const MAX_SOURCE_CHARS = 12000; // 모델에 넣는 자료 최대 길이
const JOB_TTL_MS = 30 * 60 * 1000;
const DIFFICULTIES = { easy: '쉬움 (기본 개념 확인)', normal: '보통', hard: '어려움 (응용·심화)' };
const LANGUAGES = { ko: '한국어', en: 'English' };

db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

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

// ---------- 텍스트 추출 ----------

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

function cleanText(t) {
  return t.replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// OOXML 계열(pptx/docx/hwpx): zip 안의 XML에서 텍스트 태그만 추출
function extractFromZip(buffer, entryPattern, textTag, paraTag) {
  const zip = new AdmZip(buffer);
  const entries = zip
    .getEntries()
    .filter((e) => entryPattern.test(e.entryName))
    .sort((a, b) => {
      const na = Number((a.entryName.match(/(\d+)\.xml$/) || [])[1] || 0);
      const nb = Number((b.entryName.match(/(\d+)\.xml$/) || [])[1] || 0);
      return na - nb || a.entryName.localeCompare(b.entryName);
    });
  const parts = [];
  const textRe = new RegExp(`<${textTag}(?:\\s[^>]*)?>([^<]*)</${textTag}>|</${paraTag}>`, 'g');
  for (const e of entries) {
    const xml = e.getData().toString('utf8');
    let out = '';
    let m;
    while ((m = textRe.exec(xml))) out += m[1] !== undefined ? decodeXml(m[1]) : '\n';
    if (out.trim()) parts.push(out);
  }
  return parts.join('\n\n');
}

async function extractFile(name, buffer) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['txt', 'md', 'csv', 'json', 'html', 'htm'].includes(ext)) {
    const text = buffer.toString('utf8');
    return cleanText(ext.startsWith('htm') ? htmlToText(text).text : text);
  }
  if (ext === 'pdf') {
    const data = await pdfParse(buffer);
    return cleanText(data.text || '');
  }
  if (ext === 'pptx') return cleanText(extractFromZip(buffer, /^ppt\/slides\/slide\d+\.xml$/, 'a:t', 'a:p'));
  if (ext === 'docx') return cleanText(extractFromZip(buffer, /^word\/document\.xml$/, 'w:t', 'w:p'));
  if (ext === 'hwpx') return cleanText(extractFromZip(buffer, /^Contents\/section\d+\.xml$/, 'hp:t', 'hp:p'));
  if (['ppt', 'doc', 'hwp'].includes(ext))
    throw httpError(400, `.${ext} (구형 바이너리 형식)은 지원하지 않습니다. .${ext}x 또는 PDF로 저장해서 올려주세요.`);
  throw httpError(400, `지원하지 않는 파일 형식입니다 (.${ext}). PDF, PPTX, DOCX, HWPX, TXT, MD, CSV 가능`);
}

function htmlToText(html) {
  const title = decodeXml((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  let s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<head[\s\S]*?<\/head>/i, ' ')
    .replace(/<(script|style|noscript|svg|nav|header|footer|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre|td|th|dd|dt)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeXml(s.replace(/&nbsp;/g, ' '));
  return { title, text: cleanText(s) };
}

async function extractUrl(input) {
  let url;
  try { url = new URL(String(input || '').trim()); } catch { throw httpError(400, 'URL 형식이 올바르지 않습니다.'); }
  if (!/^https?:$/.test(url.protocol)) throw httpError(400, 'http/https URL만 가능합니다.');
  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; ClassroomKahoot/1.0)', accept: 'text/html,application/pdf,text/plain,*/*' },
    });
  } catch (err) {
    throw httpError(502, `URL을 가져올 수 없습니다: ${err.cause?.code || err.name}`);
  }
  if (!res.ok) throw httpError(502, `URL 응답 오류 ${res.status}`);
  const type = (res.headers.get('content-type') || '').toLowerCase();
  const buffer = Buffer.from(await res.arrayBuffer());
  if (type.includes('pdf') || url.pathname.toLowerCase().endsWith('.pdf')) {
    return { title: url.pathname.split('/').pop(), text: cleanText((await pdfParse(buffer)).text || '') };
  }
  if (type.includes('text/plain')) return { title: url.hostname, text: cleanText(buffer.toString('utf8')) };
  const { title, text } = htmlToText(buffer.toString('utf8'));
  return { title: title || url.hostname, text };
}

// ---------- 문제 생성 (백그라운드 작업) ----------

const jobs = new Map();
let jobSeq = 0;

const QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
          correct_indices: { type: 'array', items: { type: 'integer' } },
        },
        required: ['question', 'options', 'correct_indices'],
      },
    },
  },
  required: ['title', 'questions'],
};

function buildPrompt({ text, count, difficulty, language, instructions }) {
  const lang = LANGUAGES[language] || LANGUAGES.ko;
  return `당신은 교사를 돕는 퀴즈 출제 도우미입니다. 아래 자료를 바탕으로 카훗(Kahoot) 스타일의 객관식 문제 ${count}개를 만드세요.

규칙:
- 문제와 보기는 반드시 ${lang}로 작성
- 난이도: ${DIFFICULTIES[difficulty] || DIFFICULTIES.normal}
- 각 문제는 보기 4개. 정답은 보통 1개 (꼭 필요할 때만 복수 정답)
- 문제는 120자 이내, 보기는 각 60자 이내로 짧고 명확하게
- 자료에 근거한 내용만 출제하고, 오답 보기는 그럴듯하게 만들 것
- 정답 위치(0~3)를 골고루 섞을 것
- 같은 내용을 반복 출제하지 말 것
${instructions ? `- 추가 지시: ${instructions}\n` : ''}
출력은 아래 형식의 JSON만 (설명 없이):
{"title": "퀴즈 제목", "questions": [{"question": "문제", "options": ["보기1", "보기2", "보기3", "보기4"], "correct_indices": [0]}]}

자료:
"""
${text}
"""`;
}

function estimateCtx(prompt) {
  const est = Math.ceil(prompt.length / 1.5) + 2048; // 한국어 기준 보수적 추정
  let ctx = 4096;
  while (ctx < est && ctx < 32768) ctx *= 2;
  return ctx;
}

// Ollama /api/chat 스트리밍 호출. onProgress(chars)로 진행 상황 보고
async function ollamaChat(baseUrl, model, prompt, format, onProgress, signal) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    format,
    think: false,
    options: { temperature: 0.7, num_ctx: estimateCtx(prompt) },
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

function parseQuizJson(raw) {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('모델이 JSON을 반환하지 않았습니다.');
  s = s.slice(start, end + 1);
  try { return JSON.parse(s); } catch {}
  // 흔한 오류 보정: 후행 쉼표
  try { return JSON.parse(s.replace(/,\s*([\]}])/g, '$1')); } catch {}
  throw new Error('모델 출력을 JSON으로 해석할 수 없습니다.');
}

// 모델 출력 → 카훗 문제 형식 {text, time_limit, points, options:[{text,is_correct}]}
function normalizeQuestions(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data.questions) ? data.questions : [];
  const out = [];
  for (const q of list) {
    const text = String(q.question || q.text || '').trim().slice(0, 500);
    let options = (Array.isArray(q.options) ? q.options : []).map((o) => String(typeof o === 'object' && o ? o.text : o).trim()).filter(Boolean);
    options = [...new Set(options)].slice(0, 4);
    if (!text || options.length < 2) continue;
    let correct = [];
    if (Array.isArray(q.correct_indices)) correct = q.correct_indices.map(Number);
    else if (q.correct_index !== undefined) correct = [Number(q.correct_index)];
    else if (typeof q.answer === 'number') correct = [q.answer];
    else if (typeof q.answer === 'string') correct = [options.findIndex((o) => o.toLowerCase() === q.answer.trim().toLowerCase())];
    correct = correct.filter((i) => Number.isInteger(i) && i >= 0 && i < options.length);
    if (!correct.length) continue;
    out.push({ text, time_limit: 20, points: 1000, options: options.map((o, i) => ({ text: o.slice(0, 200), is_correct: correct.includes(i) })) });
  }
  return out;
}

function startJob({ baseUrl, model, text, count, difficulty, language, instructions }) {
  const source = String(text || '').trim();
  if (!source) throw httpError(400, '자료 텍스트가 비어 있습니다.');
  if (!model) throw httpError(400, '모델을 선택하세요.');
  const n = Math.min(30, Math.max(1, Number(count) || 10));
  const truncated = source.length > MAX_SOURCE_CHARS;
  const prompt = buildPrompt({ text: source.slice(0, MAX_SOURCE_CHARS), count: n, difficulty, language, instructions: String(instructions || '').trim().slice(0, 500) });

  const id = String(++jobSeq);
  const job = { id, status: 'running', started: Date.now(), chars: 0, result: null, error: null, truncated, model, controller: new AbortController() };
  jobs.set(id, job);
  setTimeout(() => jobs.delete(id), JOB_TTL_MS);

  (async () => {
    const progress = (c) => { job.chars = c; };
    let raw;
    try {
      try {
        raw = await ollamaChat(baseUrl, model, prompt, QUIZ_SCHEMA, progress, job.controller.signal);
      } catch (err) {
        // 구버전 Ollama는 JSON 스키마 format을 모름 → "json"으로 재시도
        if (err.status === 400) raw = await ollamaChat(baseUrl, model, prompt, 'json', progress, job.controller.signal);
        else throw err;
      }
      const data = parseQuizJson(raw);
      const questions = normalizeQuestions(data);
      if (!questions.length) throw new Error(`유효한 문제가 없습니다. 모델 출력: ${raw.slice(0, 200)}`);
      job.result = { title: String(data.title || '').trim().slice(0, 100), questions, raw_chars: raw.length };
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
    result: job.result,
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
  MAX_SOURCE_CHARS, DIFFICULTIES, LANGUAGES,
  getSetting, setSetting, normalizeOllamaUrl, listModels,
  extractFile, extractUrl, startJob, getJob, jobInfo, cancelJob,
  // 테스트용
  parseQuizJson, normalizeQuestions, htmlToText,
};
