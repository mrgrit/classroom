# classroom

교실에서 쓰는 에듀테크 도구 모음 (자체 호스팅). 상용 서비스(Padlet, Kahoot! 등)와 이름이 겹치지 않도록 각 도구는 고유한 이름을 씁니다.

| 디렉토리 | 도구 | 설명 | 상태 |
|---|---|---|---|
| [`cork/`](./cork) | **코르크 (Cork)** | 코르크 게시판 — 담벼락(보드)에 학생들이 게시물을 올리고 좋아요/댓글. 보드별 배경 테마, 보드 접근권한, markdown 내보내기, 학생별 Ollama로 컬럼 기록 → 개인 학습자료 PDF 생성, 헤르메스(Hermes Agent) 대화 자동 저장 연동(플러그인+MCP) | ✅ 사용 가능 |
| [`buzzer/`](./buzzer) | **버저 (Buzzer)** | 퀴즈 버저 — PIN으로 참가하는 실시간 퀴즈 게임, 퀴즈별 배경 테마, 점수·순위·결과표, AI(Ollama) 문제 생성 | ✅ 사용 가능 |

각 디렉토리의 README를 참고하세요. 두 도구는 같은 구조(Node.js + Express + SQLite, 구글 로그인, systemd 유저 서비스 + Cloudflare Tunnel)이며 배경 테마(`public/css/themes.css`, `public/js/themes.js`)는 두 앱에 같은 파일을 둡니다.

> 2026-08-26에 `padlet/`→`cork/`, `kahoot/`→`buzzer/`로 이름을 바꿨습니다. 서비스 이름(`cork`, `cork-tunnel`, `buzzer`, `buzzer-tunnel`), DB 파일(`cork.db`, `buzzer.db`), 환경변수(`CORK_DATA_DIR`, `BUZZER_DATA_DIR`), 헤르메스 플러그인(`/cork`, `CORK_TOKEN`)도 함께 바뀌었고, 예전 DB 파일(`padlet.db`/`kahoot.db`)은 서버 시작 시 자동으로 이름이 바뀝니다.
