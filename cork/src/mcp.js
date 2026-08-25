// 헤르메스(및 다른 MCP 호스트)용 MCP 서버 — Streamable HTTP, 무상태(요청마다 서버 인스턴스 생성)
// 인증은 server.js의 requireHermes(Bearer 연동 토큰)가 먼저 처리하고 req.user를 채워 넘김.
// 자동 저장은 플러그인 훅이 REST로 처리하므로 여기는 학생이 '의도적으로' 쓰는 도구 5개만 둔다.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const hermes = require('./hermes');

const text = (s) => ({ content: [{ type: 'text', text: String(s) }] });
const fail = (err) => ({ content: [{ type: 'text', text: `오류: ${err.message}` }], isError: true });

function targetsText(targets) {
  if (!targets.length) return '글을 쓸 수 있는 보드가 없습니다. 관리자에게 보드 접근권한/컬럼 지정을 요청하세요.';
  return targets
    .map((b) => `- ${b.title} (id ${b.id})\n` + b.columns.map((c) => `    · ${c.title} (id ${c.id})${c.managed ? ' ★ 내 지정 컬럼' : ''}`).join('\n'))
    .join('\n');
}

function buildServer(user) {
  const server = new McpServer({ name: 'classroom-cork', version: '1.0.0' });

  server.registerTool(
    'cork_status',
    {
      title: '코르크 연동 상태',
      description: '코르크(Cork) 연동 상태를 보여준다: 현재 저장 위치(과목 보드·컬럼), 주제(단원/예제), 자동 저장 여부. 학생이 "지금 어디에 저장되고 있어?"라고 물으면 사용.',
      inputSchema: {},
    },
    async () => {
      try {
        return text(hermes.statusText(hermes.getContext(user), user));
      } catch (err) { return fail(err); }
    }
  );

  server.registerTool(
    'cork_list_targets',
    {
      title: '저장 가능한 과목/컬럼 목록',
      description: '이 학생이 글을 쓸 수 있는 코르크 보드(과목)와 컬럼 목록. ★ 표시는 학생에게 지정된 컬럼(자동 저장 기본 위치).',
      inputSchema: {},
    },
    async () => {
      try { return text(targetsText(hermes.listTargets(user))); } catch (err) { return fail(err); }
    }
  );

  server.registerTool(
    'cork_set_context',
    {
      title: '저장 위치/주제 설정',
      description:
        '대화 자동 저장의 컨텍스트를 바꾼다. 학생이 "지금부터 3단원 예제2 공부해", "네트워크보안 과목으로 저장해", "자동 저장 꺼줘" 같이 말하면 사용. ' +
        '인자는 바꿀 것만 넣는다. board/column은 이름 일부(예: "네트워크")나 id. topic은 단원·예제 등 짧은 문구(60자 이하).',
      inputSchema: {
        board: z.string().optional().describe('과목(보드) 이름 일부 또는 id'),
        column: z.string().optional().describe('컬럼 이름 일부 또는 id (보드 선택 후)'),
        topic: z.string().optional().describe('주제(단원/예제). 빈 문자열이면 지움'),
        auto_save: z.boolean().optional().describe('대화 자동 저장 켜기/끄기'),
      },
    },
    async (args) => {
      try {
        const ctx = hermes.setContext(user, args || {});
        return text(`설정했습니다.\n${hermes.statusText(ctx, user)}`);
      } catch (err) { return fail(err); }
    }
  );

  server.registerTool(
    'cork_save_note',
    {
      title: '메모/발견 사항 저장',
      description:
        '학생이 "이거 코르크에 메모해줘", "지금 정리한 내용 저장해줘", "발견한 내용 기록해줘"라고 하면 사용. 현재 컨텍스트의 컬럼에 별도 게시물(메모)로 저장한다. ' +
        'content는 markdown 가능. 대화 전체는 이미 자동 저장되므로, 여기에는 학생이 남기고 싶은 정리/요약/발견 사항만 넣는다.',
      inputSchema: {
        title: z.string().optional().describe('제목 (없으면 날짜+주제로 자동 생성)'),
        content: z.string().describe('메모 본문 (markdown 가능)'),
        color: z.enum(['yellow', 'pink', 'blue', 'green', 'purple', 'orange']).optional().describe('카드 색 (기본 green)'),
      },
    },
    async (args) => {
      try {
        const r = hermes.saveNote(user, args || {});
        return text(`저장했습니다: "${r.title}" → ${r.board.title} / ${r.column.title} (게시물 id ${r.post_id})`);
      } catch (err) { return fail(err); }
    }
  );

  server.registerTool(
    'cork_search_notes',
    {
      title: '내 기록 검색',
      description:
        '코르크에 저장된 내 게시물(이전 대화 기록·메모)을 검색한다. 학생이 "지난번에 ~에 대해 뭐라고 했지?", "내가 전에 정리한 ~ 찾아줘"라고 하면 사용. 결과의 발췌를 답변에 활용한다.',
      inputSchema: {
        query: z.string().describe('검색어 (제목/본문 포함 검색)'),
        limit: z.number().int().min(1).max(30).optional().describe('최대 결과 수 (기본 10)'),
      },
    },
    async (args) => {
      try {
        const rows = hermes.searchNotes(user, args.query, args.limit);
        if (!rows.length) return text(`"${args.query}"에 해당하는 내 기록이 없습니다.`);
        return text(
          rows.map((r, i) => `${i + 1}. [${r.created_at}] ${r.title}  (${r.board} / ${r.column || '-'}, id ${r.post_id})\n${r.snippet}`).join('\n\n')
        );
      } catch (err) { return fail(err); }
    }
  );

  return server;
}

// POST /mcp 처리. 무상태 모드: 세션 id 없이 요청마다 transport/server를 만들고 응답 후 정리
async function handle(req, res) {
  const server = buildServer(req.user);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: err.message }, id: null });
  }
}

module.exports = { handle, buildServer };
