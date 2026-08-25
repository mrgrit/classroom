// AI 학습자료 렌더링: markdown → HTML(원시 HTML은 이스케이프) + A4 PDF 변환
// PDF는 playwright-core로 시스템 캐시(~/.cache/ms-playwright)의 Chromium을 사용 (브라우저 다운로드 없음)
const { marked } = require('marked');
const { chromium } = require('playwright-core');

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// 모델/학생이 쓴 원시 HTML·위험한 URL이 그대로 실행되지 않도록 렌더러를 잠금
const renderer = new marked.Renderer();
renderer.html = (html) => escapeHtml(html);
renderer.link = (href, title, text) => {
  if (/^\s*(javascript|vbscript|data):/i.test(String(href || ''))) return text;
  return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''} target="_blank" rel="noopener">${text}</a>`;
};
renderer.image = (href, title, text) => {
  if (!/^(https?:\/\/|\/)/i.test(String(href || ''))) return escapeHtml(text || '');
  return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text || '')}">`;
};

function renderMarkdown(md) {
  return marked.parse(String(md || ''), { renderer, breaks: true, headerIds: false, mangle: false });
}

// ---------- PDF ----------

let browserPromise = null; // Chromium은 첫 요청 때 한 번만 띄우고 재사용

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
      .catch((err) => {
        browserPromise = null;
        const e = new Error(`PDF 변환기(Chromium)를 시작할 수 없습니다: ${err.message.split('\n')[0]}`);
        e.status = 500;
        throw e;
      });
  }
  return browserPromise;
}

async function htmlToPdf(html) {
  let browser = await getBrowser();
  let page;
  try {
    page = await browser.newPage();
  } catch {
    browserPromise = null; // 죽은 브라우저 → 재시작 후 한 번 더
    browser = await getBrowser();
    page = await browser.newPage();
  }
  try {
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format: 'A4',
      margin: { top: '20mm', bottom: '18mm', left: '16mm', right: '16mm' },
      printBackground: true,
    });
  } finally {
    await page.close().catch(() => {});
  }
}

// KST 시각 문자열
const timeFmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function fmtKst(utc) {
  const d = new Date(String(utc).replace(' ', 'T') + 'Z');
  return isNaN(d) ? String(utc) : timeFmt.format(d);
}

// ai_reports 행(+student_name) → 인쇄용 HTML
function reportHtml(r) {
  const metaBits = [
    r.student_name,
    [r.board_title, r.column_title].filter(Boolean).join(' / '),
    r.model,
    `${fmtKst(r.created_at)} (KST)`,
  ].filter(Boolean);
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(r.title)}</title>
<style>
  body { font-family: 'Noto Sans CJK KR', 'NanumGothic', 'Malgun Gothic', sans-serif; color: #1c1e21; line-height: 1.65; font-size: 11pt; }
  .head { border-bottom: 3px solid #e91e63; padding-bottom: 12px; margin-bottom: 22px; }
  .head h1 { font-size: 19pt; margin: 0 0 8px; line-height: 1.3; }
  .meta { color: #666; font-size: 9.5pt; }
  h1, h2, h3 { line-height: 1.35; margin: 20px 0 8px; }
  h2 { font-size: 14pt; border-left: 4px solid #e91e63; padding-left: 9px; }
  h3 { font-size: 12pt; }
  p { margin: 7px 0; }
  ul, ol { margin: 7px 0; padding-left: 24px; }
  code { background: #f2f2f2; padding: 1px 5px; border-radius: 4px; font-size: 9.5pt; }
  pre { background: #f6f6f6; border: 1px solid #ddd; border-radius: 6px; padding: 10px 12px; white-space: pre-wrap; word-break: break-word; font-size: 9pt; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ccc; margin: 8px 0; padding: 4px 12px; color: #555; }
  table { border-collapse: collapse; margin: 8px 0; }
  th, td { border: 1px solid #bbb; padding: 4px 9px; font-size: 10pt; }
  th { background: #f4f4f4; }
  img { max-width: 100%; }
</style></head><body>
<div class="head">
  <h1>${escapeHtml(r.title)}</h1>
  <div class="meta">${metaBits.map(escapeHtml).join(' · ')}</div>
</div>
${renderMarkdown(r.content_md)}
</body></html>`;
}

async function reportPdf(r) {
  return htmlToPdf(reportHtml(r));
}

module.exports = { renderMarkdown, reportHtml, reportPdf, htmlToPdf };
