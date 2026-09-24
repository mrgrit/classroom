# 코르크 Cork (교실용 담벼락 게시판)

코르크(corkboard, 코르크 게시판)는 담벼락(보드)에 학생들이 게시물을 붙이는 수업용 게시판입니다. 자체 호스팅이며 외부 서비스에 의존하지 않습니다.

- **구글 로그인**으로 학생 식별 (Google Identity Services + 서버 측 ID 토큰 검증)
- **관리자**(기본: `mrgrit@ync.ac.kr`)만 보드(담벼락) 생성/삭제, 보드 안의 **컬럼**(섹션) 추가/이름 변경/순서 이동/삭제
- **컬럼 레이아웃**: 보드 하나에 컬럼 여러 개(예: 1조/2조/3조, 최대 40개), 컬럼이 1개면 전체폭 담벼락
- **보드별 배경 테마**: 새 보드를 만들 때 🎨 배경(파스텔 패턴 20종 — 물방울·모눈종이·체크·별·하트·구름·공책·벌집·그라데이션·밤하늘·칠판 등)을 고르고, 보드 페이지의 **🎨 배경** 버튼이나 목록 카드의 🎨로 언제든 바꿀 수 있음. 지정하지 않으면 기존 보드들이 가장 적게 쓴 테마가 자동 배정되어 과목/보드가 한눈에 구별됨. 목록 카드 위쪽 띠와 보드 페이지 전체 배경에 적용(어두운 테마는 글자색이 자동으로 흰색). 테마 목록은 `public/js/themes.js`, 스타일은 `public/css/themes.css` (버저와 같은 파일)
- **컬럼 관리자**: 관리자가 컬럼 헤더 👤로 학생(이메일)을 컬럼 관리자로 지정하면 **관리자 + 지정된 학생만** 그 컬럼에 글 작성·수정·삭제·이동 가능 (지정된 학생은 그 컬럼의 모든 글을 고칠 수 있음). 지정이 없는 컬럼은 누구나 작성, 본인 글만 수정. 좋아요·댓글은 누구나. 아직 로그인 안 한 학생도 이메일로 미리 지정 가능
- **학생**: 컬럼별 게시물 작성(색상 선택), 본인 게시물 **수정**(✎: 제목·내용·색상·첨부 추가/삭제, "수정됨" 표시)/삭제/컬럼 이동, 좋아요, 댓글
- **글쓰기 양식**: 관리자가 **관리 페이지(`/admin`, 상단 🛠 관리)** 에서 양식(이름 + 항목들, 예: 주간업무보고 — 이번 주 한 일/다음 주 계획/이슈)을 만들면, 학생이 게시물을 쓸 때 양식을 골라 **항목별 입력칸**으로 작성(제목 자동 채움). 채운 항목만 `【항목】` 표시로 본문에 합쳐지고 굵게 강조됨. 양식을 고르지 않으면(또는 양식이 없으면) 기존처럼 자유 작성
- **드래그 앤 드롭**: 게시물의 ⠿ 손잡이를 끌어 같은 컬럼 안에서 위아래로, 또는 다른 컬럼으로 이동(본인 글, 관리자는 모두). 관리자는 컬럼 제목의 ⠿ 로 컬럼 좌우 순서 변경. 모바일(터치)에서는 드롭다운/◀▶ 버튼 사용
- **컬럼 너비 조절(개인별)**: 컬럼 오른쪽 가장자리를 잡고 좌우로 드래그해 너비 조절(220~680px), 더블클릭하면 원래 너비(300px). **내 브라우저(localStorage)에만 저장**되어 다른 사람 화면에는 영향 없음. 단일 컬럼 보드·모바일에서는 비활성
- **파일 첨부**: 게시물(최대 5개)·댓글(최대 2개)에 파일 첨부 — **캡처한 이미지를 Ctrl+V로 바로 붙여넣기**, 드래그 앤 드롭, 📎 버튼. 이미지는 인라인 표시(클릭하면 페이지 안에서 크게 보기, ←→ 이동), 그 외(PDF/문서/zip)는 다운로드 링크. 파일당 10MB, 로그인 사용자만 열람 가능
- **보드 접근권한**: 관리자가 보드 카드의 👥로 학생(이메일)을 지정하면 **관리자 + 지정된 학생만** 그 보드를 보고 쓸 수 있음(목록에서도 숨겨짐, 🔒 배지 표시). 지정이 없으면 로그인한 누구나 접근
- **내 정보 페이지**(`/me`): 프로필 + **개인 Ollama 서버 연결**(주소 입력 → 연결 → 모델 선택 → 저장) + 내 AI 학습자료 목록
- **AI 학습자료(PDF)**: 컬럼 헤더의 🤖 버튼 → 학생이 자기 Ollama 모델로 **컬럼 전체 기록(게시물+댓글)을 정리·분석한 개인화 학습자료**를 생성. 결과는 markdown으로 저장되고(`/report/:id`에서 보기) **A4 PDF로 다운로드** 가능. 수업 기록 기반 과제평가·자료 보강 용도
- **내보내기**: 컬럼 헤더의 ⬇ 로 컬럼 전체, 보드 상단의 ⬇ 내보내기로 보드 전체를 **markdown 파일로 다운로드** (게시물·작성자·시각·첨부 파일명·댓글 포함) — 학생이 자기 AI로 꾸미고 보강하는 과제의 원본 자료
- **AI 에이전트 연동(헤르메스 · Claude Code)**: 학생이 `/me`에서 **연동 토큰**을 발급해 설치 명령 한 줄을 자기 PC에서 실행하면, 헤르메스(Hermes Agent) 또는 **Claude Code**에서 AI와 나눈 **대화(질문+답변)가 지정 컬럼의 게시물로 자동 저장**됨(세션 하나 = 게시물 하나, 제목에 날짜·주제(단원/예제)·첫 질문, 헤더에 플랫폼·모델 표시). 두 에이전트 모두 `/cork` 명령으로 과목·컬럼·주제·자동 저장을 바꾸고, MCP 도구로 메모 저장/내 기록 검색 가능(Claude Code는 `.cork` 표시 파일이 있는 프로젝트 폴더의 세션만 저장 — `/cork 시작`으로 켬). 저장된 기록은 🤖 배지 + markdown 렌더링
- **자체 DB**: SQLite 파일 하나 (`data/cork.db`) — 외부 DB 서버 불필요
- 5초 폴링으로 다른 학생의 게시물이 자동으로 나타남

## AI 학습자료 생성 구조

- 학생마다 **자기 Ollama 서버**(`ai_settings`)를 사용 — 서버에 공용 AI 키/비용 없음
- 생성은 백그라운드 작업으로 실행되고 브라우저가 1.5초마다 진행 상황(경과 시간·생성 글자 수)을 폴링 (Cloudflare Tunnel의 ~100초 응답 제한 회피)
- 결과 markdown은 `ai_reports`에 저장 — 보드/컬럼이 삭제돼도 자료는 남음(과제 증빙), 본인 + 관리자만 열람 가능
- PDF는 `playwright-core`가 시스템 캐시(`~/.cache/ms-playwright`)의 Chromium으로 렌더링 (별도 브라우저 다운로드 없음, 한글 폰트는 시스템 폰트 사용)
- 모델/학생이 쓴 원시 HTML은 렌더링 시 전부 이스케이프 (XSS 방지)

## AI 에이전트 연동 구조 (헤르메스 · Claude Code)

학생마다 자기 PC(또는 프로필)의 에이전트가 모델과 대화합니다. **신원은 모델 서버가 아니라 학생의 에이전트 설치본에 넣는 코르크 토큰**으로 확인합니다. 헤르메스와 Claude Code는 같은 토큰·같은 API(`/api/hermes/*`, `/mcp`)를 사용합니다.

```
학생 PC: hermes ──(플러그인 post_llm_call 훅)──▶ POST /api/hermes/turns ┐ Authorization: Bearer <연동 토큰>
          └──(MCP 클라이언트)──────────────────▶ POST /mcp (도구 5개)     ┘ → 서버가 토큰→학생→보드/컬럼 권한 해석
학생 PC: claude ──(Stop/SessionEnd 훅 save_turn.py)▶ POST /api/hermes/turns (같은 토큰, platform=claude-code)
          └──(MCP HTTP 클라이언트)─────────────▶ POST /mcp (같은 도구 5개)
```

- **토큰**: `/me`에서 발급(재발급 시 이전 토큰 즉시 무효, 해시만 저장 `hermes_links`). 모델 서버 IP가 바뀌거나 한 서버를 여럿이 써도 무관
- **설치(헤르메스)**: `/me`가 보여주는 `curl -fsSL <주소>/hermes/install.sh | CORK_TOKEN=... bash` 한 줄 — `~/.hermes/plugins/cork`(플러그인) + `~/.hermes/skills/cork`(스킬) 설치, `.env`에 `CORK_URL`/`CORK_TOKEN`, `config.yaml`에 `plugins.enabled` + `mcp_servers.cork`(헤더는 `${CORK_TOKEN}` 참조) 등록. 소스는 `hermes-plugin/`, 서버가 `/hermes/plugin.tgz`로 묶어 배포. 제거: `... | bash -s -- --uninstall`
- **설치(Claude Code)**: `curl -fsSL <주소>/claude/install.sh | CORK_TOKEN=... bash` 한 줄 — `~/.claude/cork/`에 저장 훅(`save_turn.py`, python3)과 설정(`config.json`, 600 권한), `settings.json`에 **Stop/SessionEnd 훅**, `claude mcp add`로 MCP 서버(user 범위, `Authorization` 헤더), `~/.claude/commands/cork.md`(`/cork` 명령) 등록. `CLAUDE_CONFIG_DIR`를 쓰면 그 경로에 설치. 소스는 `claude-plugin/`. 제거: `... | bash -s -- --uninstall`
- **Claude Code 저장 범위·방식**: 훅은 모든 세션에서 돌지만 **`.cork` 파일이 있는 폴더(하위 포함)에서 연 세션만 저장**(`/cork 시작`이 생성, `/cork 중지`가 삭제) — 다른 프로젝트의 대화가 코르크로 새지 않음. 트랜스크립트를 (질문, 답변) 페어로 추출해 전송하되, **Stop 시점엔 마지막 답변이 아직 파일에 안 실렸을 수 있어** 파일이 잠잠해질 때까지 최대 6초 대기하고, 그래도 없으면 세션별 전송 기록(`cork/state/`, uuid 기준 중복 방지)을 근거로 **다음 훅(다음 턴·SessionEnd)에서 만회 전송**. 서버 오류(409·5xx·네트워크)도 다음 훅에서 재시도. 설치 전부터 있던 세션은 첫 훅에서 마지막 턴부터(과거 대화 일괄 전송 방지). 도구 결과·메타·서브에이전트(sidechain)·`/명령` 래퍼·중단 알림은 저장에서 제외. 실패해도 Claude를 막지 않음(오류는 `save_turn.log`)
- **자동 저장은 훅**(헤르메스 `post_llm_call` / Claude Code `Stop`)이 담당(모델이 도구를 부르지 않아도 100% 저장). **MCP 도구**는 학생이 의도적으로 쓰는 것만: `cork_status`, `cork_list_targets`, `cork_set_context`, `cork_save_note`, `cork_search_notes`
- **저장 위치(컨텍스트)**: 서버가 학생별로 과목 보드·컬럼·주제·자동 저장 여부를 기억(`hermes_links`). 기본 대상은 학생이 **컬럼 관리자로 지정된 컬럼**(★). 지정 컬럼이 있는 보드가 하나뿐이면 자동 선택, 여러 과목이면 `/cork 과목 <이름>`으로 선택. 지정 컬럼이 없는 보드로는 자동 저장하지 않음(명시적으로 컬럼을 골라야 함)
- **게시물 형식**: 제목 `[2026-08-25] 3단원 예제2 — 첫 질문 요약`, 본문은 markdown(`> 🤖 헤르메스 대화 기록 · 모델 …` 또는 `> 🤖 Claude Code 대화 기록 · 모델 …` 헤더 + `**Q1.** … **A1.** …`). 헤르메스 세션 하나 = 게시물 하나(`hermes_sessions`), 12시간 이상 쉬거나 `/cork 새글`이면 새 게시물, 본문 20,000자를 넘으면 `(2)` 게시물로 이어씀. 2자 이하 질문과 `/`로 시작하는 명령은 저장하지 않음
- 헤르메스 게시물(`posts.source = 'hermes' | 'hermes-note'`)은 카드에 배지가 붙고 markdown으로 렌더링(700자 넘으면 접힘), 웹 수정 상한 20,000자, export/AI 학습자료에 출처 표시
- **주의**: Quick Tunnel 주소가 바뀌면 학생 전원의 설정이 깨지므로 이 기능은 고정 주소(네임드 터널/도메인)에서 쓰는 것이 좋음. 같은 PC를 여럿이 쓰면 `hermes profile create <이름>`으로 프로필을 분리해 각자 토큰을 넣을 것

## 기술 스택

Node.js + Express + better-sqlite3 / 순수 HTML·CSS·JS (빌드 과정 없음)

## 설치 및 실행

```bash
cd cork
npm install
cp .env.example .env
# .env 파일을 열어 GOOGLE_CLIENT_ID, JWT_SECRET 설정
npm start
# http://localhost:3000
```

## 구글 OAuth 클라이언트 만들기

1. [Google Cloud Console → API 및 서비스 → 사용자 인증 정보](https://console.cloud.google.com/apis/credentials) 접속
2. **사용자 인증 정보 만들기 → OAuth 클라이언트 ID → 웹 애플리케이션** 선택
3. **승인된 자바스크립트 원본**에 서비스 주소 추가
   - 개발: `http://localhost:3000`
   - 운영: `https://your-domain.com`
4. 생성된 클라이언트 ID를 `.env`의 `GOOGLE_CLIENT_ID`에 입력
5. (처음이라면) OAuth 동의 화면 구성 필요 — 테스트 모드면 테스트 사용자에 학생 계정 추가, 또는 게시 상태로 전환

## 외부 공개 (Cloudflare Tunnel, 도메인 불필요)

구글 OAuth는 IP 주소 원본을 허용하지 않고 localhost 외에는 HTTPS가 필요합니다. 도메인 없이 쓰려면 Cloudflare Quick Tunnel로 `https://xxxx.trycloudflare.com` 주소를 받으면 됩니다 (무료, 계정 불필요).

```bash
# 1) cloudflared 설치 (sudo 없이 ~/.local/bin)
curl -fsSL -o ~/.local/bin/cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x ~/.local/bin/cloudflared

# 2) 앱 + 터널을 systemd 유저 서비스로 등록 (재부팅/로그아웃 후에도 유지)
./deploy/install-services.sh

# 3) 공개 주소 확인 → Google Cloud Console '승인된 자바스크립트 원본'에 등록
cat data/tunnel-url.txt
```

운영 명령:

```bash
systemctl --user status cork cork-tunnel    # 상태
journalctl --user -u cork -f                  # 앱 로그
journalctl --user -u cork-tunnel -f           # 터널 로그
systemctl --user restart cork                 # 앱만 재시작 (터널 URL 유지)
systemctl --user restart cork-tunnel          # 터널 재시작 → URL 바뀜! 구글 콘솔 갱신 필요
```

서비스 없이 잠깐 띄울 때는 `npm start` 와 별도 터미널에서 `npm run tunnel`.

> **주의**: Quick Tunnel 주소는 터널 프로세스를 재시작할 때마다 바뀝니다. 앱 코드만 바꿨을 땐 `cork` 서비스만 재시작하세요. 고정 주소가 필요해지면 도메인을 하나 사서 Cloudflare 계정에 연결한 뒤 Named Tunnel로 전환하면 됩니다.

## 환경 변수 (.env)

| 변수 | 설명 |
|---|---|
| `GOOGLE_CLIENT_ID` | 구글 OAuth 웹 클라이언트 ID (필수) |
| `ADMIN_EMAILS` | 관리자 이메일, 쉼표 구분 (기본 예시: `mrgrit@ync.ac.kr`) |
| `JWT_SECRET` | 세션 토큰 서명 키 — 긴 랜덤 문자열로 변경 필수 |
| `PORT` | 서버 포트 (기본 3000) |
| `ALLOWED_HOSTED_DOMAIN` | 설정 시 해당 도메인(예: `ync.ac.kr`) 구글 계정만 로그인 허용 |

## 권한 구조

| 기능 | 학생 | 관리자 |
|---|---|---|
| 보드 생성/삭제/접근권한(멤버) 지정/배경 테마 변경 | ✕ | ✔ |
| 글쓰기 양식 만들기/수정/삭제 (`/admin`) | ✕ | ✔ |
| 게시물 작성 시 글쓰기 양식 선택 | ✔ | ✔ |
| 멤버 지정된 보드 접근(보기/쓰기 전부) | 지정된 학생만 | ✔ |
| 컬럼/보드 markdown 내보내기 | 접근 가능한 보드만 | ✔ |
| AI 학습자료 생성(자기 Ollama)/열람/PDF/삭제 | 본인 것만 | 열람은 모두 |
| 헤르메스 연동 토큰 발급/해제, 자동 저장 위치 설정 | 본인 것만 | 본인 것만 |
| 헤르메스 자동 저장/메모 대상 컬럼 | 글을 쓸 수 있는 컬럼만(기본: 지정 컬럼) | 모든 컬럼 |
| 컬럼 추가/이름 변경/순서/삭제/관리자 지정 | ✕ | ✔ |
| 관리자 지정된 컬럼에 글 작성/수정/삭제 | 지정된 학생만 | ✔ |
| 게시물 작성 (컬럼 선택) | ✔ | ✔ |
| 게시물 수정/삭제/컬럼 이동/순서 변경(드래그) | 본인 것만 | 모두 |
| 파일 첨부 (게시물/댓글) | ✔ | ✔ |
| 좋아요 (토글) | ✔ | ✔ |
| 댓글 작성 | ✔ | ✔ |
| 댓글 삭제 | 본인 것만 | 모두 |

## API 요약

```
GET    /api/config                  구글 클라이언트 ID 조회
POST   /api/auth/google             구글 ID 토큰으로 로그인 → 세션 쿠키 발급
POST   /api/auth/logout             로그아웃
GET    /api/me                      내 정보
GET    /api/boards                  보드 목록
POST   /api/boards                  보드 생성 {title, description, columns, theme} (관리자, theme 생략 시 덜 쓰인 테마 자동 배정)
PUT    /api/boards/:id              보드 설정 변경 {title, description, theme} 중 주어진 것만 (관리자)
DELETE /api/boards/:id              보드 삭제 (관리자)
GET    /api/boards/:id              보드 상세 (컬럼별 게시물+첨부+좋아요+댓글, 컬럼 managers/can_post, 게시물 can_edit)
POST   /api/boards/:id/columns      컬럼 추가 (관리자)
PUT    /api/columns/:id             컬럼 이름 변경 (관리자)
PUT    /api/boards/:id/columns/order 컬럼 순서 변경 {ids:[...]} (관리자)
PUT    /api/columns/:id/managers    컬럼 관리자 지정 {emails:[...]} (관리자, 빈 배열이면 해제)
GET    /api/users                   로그인한 적 있는 사용자 목록 (관리자)
DELETE /api/columns/:id             컬럼 삭제, 게시물 포함 (관리자, 마지막 컬럼은 불가)
POST   /api/uploads                 파일 업로드 (multipart 'file') → {id,url,...}
GET    /uploads/:name               첨부파일 열람 (로그인 필요)
POST   /api/boards/:id/posts        게시물 작성 {column_id, content, attachment_ids}
PUT    /api/posts/:id               게시물 수정 {title, content, color, attachment_ids(추가), remove_attachment_ids(삭제)} 또는 {column_id} 이동 (본인/관리자)
PUT    /api/posts/:id/move          드래그 이동 {column_id, index} → 해당 컬럼의 index 위치로 (본인/관리자)
DELETE /api/posts/:id               게시물 삭제 (본인/관리자)
POST   /api/posts/:id/like          좋아요 토글
POST   /api/posts/:id/comments      댓글 작성 {content, attachment_ids}
DELETE /api/comments/:id            댓글 삭제 (본인/관리자)
PUT    /api/boards/:id/members      보드 접근권한(멤버) 지정 {emails:[...]} (관리자, 빈 배열이면 전체 공개)
GET    /api/templates               글쓰기 양식 목록 (로그인 사용자)
POST   /api/templates               양식 생성 {name, description, fields:[{label, placeholder}]} (관리자)
PUT    /api/templates/:id           양식 수정 (관리자)
DELETE /api/templates/:id           양식 삭제 (관리자, 기존 게시물은 유지)
GET    /api/my/ai                   내 Ollama 설정 조회
POST   /api/my/ai/connect           Ollama 서버 연결 확인 {url} → {url, models}
PUT    /api/my/ai                   내 Ollama 설정 저장 {ollama_url, model}
POST   /api/columns/:id/report      AI 학습자료 생성 시작 {instructions} → {job_id}
GET    /api/ai/jobs/:id             생성 진행 상황 (본인만, 1.5초 폴링용)
DELETE /api/ai/jobs/:id             생성 취소 (본인만)
GET    /api/my/reports              내 학습자료 목록
GET    /api/reports/:id             학습자료 조회 (markdown + 렌더링된 HTML, 본인/관리자)
GET    /api/reports/:id/pdf         학습자료 A4 PDF 다운로드 (본인/관리자)
DELETE /api/reports/:id             학습자료 삭제 (본인/관리자)
GET    /api/columns/:id/export.md   컬럼 전체 markdown 다운로드
GET    /api/boards/:id/export.md    보드 전체 markdown 다운로드
GET    /api/my/hermes               에이전트 연동 상태 + 저장 컨텍스트 + 선택 가능한 보드/컬럼
POST   /api/my/hermes/token         연동 토큰 발급/재발급 → {token, install_command, install_command_claude} (평문은 이때만)
DELETE /api/my/hermes/token         연동 해제
PUT    /api/my/hermes/context       저장 위치/주제/자동 저장 {board, column, topic, auto_save} (null = 해제)
--- 아래는 Authorization: Bearer <연동 토큰> (헤르메스 플러그인 / Claude Code 훅 / MCP) ---
GET    /api/hermes/me               내 연동 상태 (?format=text 면 텍스트)
GET    /api/hermes/targets          글을 쓸 수 있는 보드/컬럼 (managed=지정 컬럼)
PUT    /api/hermes/context          저장 위치/주제/자동 저장 (board/column은 이름 일부 또는 id)
POST   /api/hermes/turns            대화 한 턴 저장 {session_id, user_message, assistant_response, model, platform, new_post}
POST   /api/hermes/notes            메모 게시물 저장 {title, content, color}
GET    /api/hermes/search?q=        내 게시물 검색
POST   /mcp                         MCP 서버 (Streamable HTTP, 무상태)
GET    /hermes/install.sh           헤르메스 설치 스크립트 (주소 자동 치환), /hermes/plugin.tgz 플러그인 묶음
GET    /claude/install.sh           Claude Code 설치 스크립트 (주소 자동 치환), /claude/save_turn.py 저장 훅, /claude/cork.md /cork 명령
```

페이지: `/` 보드 목록, `/board/:id` 보드, `/me` 내 정보, `/admin` 관리(글쓰기 양식, 관리자 전용), `/report/:id` AI 학습자료.

멤버가 지정된 보드는 상세/글쓰기/수정/이동/삭제/좋아요/댓글/내보내기/AI 생성 전부에서 비멤버에게 403을 반환합니다.

## DB 스키마

`users` / `boards` / `columns` / `column_managers` / `board_members` / `posts` / `likes` / `comments` / `attachments` / `templates` / `ai_settings` / `ai_reports` / `hermes_links` / `hermes_sessions` 14개 테이블, `src/db.js`에서 서버 시작 시 자동 생성·마이그레이션됩니다(컬럼 기능 이전 DB는 보드마다 기본 컬럼 "게시물"이 생기고 기존 게시물이 배정됨, `posts.position`이 없던 DB는 기존 최신순으로 번호가 매겨짐). `boards.theme`이 없던 DB에는 컬럼이 추가되고, 개명 이전의 `padlet.db`(+wal/shm)는 `cork.db`로 자동 개명됩니다. DB 파일은 `data/cork.db`, 첨부파일은 `data/uploads/`에 저장되며 git에는 포함되지 않습니다. `CORK_DATA_DIR` 환경변수로 데이터 위치를 바꿀 수 있습니다.
