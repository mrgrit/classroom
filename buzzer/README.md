# 버저 Buzzer (교실용 실시간 퀴즈)

버저(quiz buzzer)는 PIN으로 참가하는 수업용 실시간 퀴즈 게임입니다. 자체 호스팅이며 외부 서비스에 의존하지 않습니다.

- **구글 로그인**으로 학생 식별 — 닉네임 대신 구글 이름이 표시되고, 결과표에 이메일이 남아 누가 몇 점인지 바로 알 수 있음
- **관리자**(기본: `mrgrit@ync.ac.kr`)만 퀴즈 작성·게임 진행·결과 열람
- **퀴즈 편집기**: 문제당 보기 2~4개, 정답(복수 가능), 제한 시간(5~120초), 점수(0/500/1000/2000). 문제 순서 이동·복제, **텍스트로 한번에 입력**(문제 한 줄 + 보기 줄, 정답에 `*`)
- **퀴즈별 배경 테마**: 편집기의 🎨 배경(파스텔 패턴·그라데이션·어두운 테마 20종, 코르크와 같은 목록)을 고르면 호스트 화면과 학생 휴대폰 화면의 무대 배경이 그 테마로 바뀜(밝은 테마는 글자를 어둡게 자동 조정). 새 퀴즈는 덜 쓰인 테마가 자동 배정되고, 목록 카드 위쪽 띠로 구별. 게임은 시작 시점의 테마를 스냅샷으로 저장. 테마 목록은 `public/js/themes.js`, 스타일은 `public/css/themes.css`
- **게임 진행**: 6자리 PIN → 대기실(참가자 이름 표시) → 문제(카운트다운, 답변 수) → 결과(보기별 막대그래프 + 정답) → 순위(상위 5명) → … → 최종 시상대(1·2·3위)
- **학생 화면(휴대폰)**: 4색 도형 버튼, 정답/오답과 획득 점수, 현재 순위. 화면이 꺼졌다 켜져도 자동 재접속
- **점수**: 퀴즈쇼 방식 — 정답이면 `만점 × (1 − 소요시간비율 / 2)`, 빠를수록 높음
- **결과표/CSV**: 참가자별 점수·정답 수·문제별 O/X·응답 시간. 엑셀용 CSV 다운로드
- **AI로 퀴즈 만들기** (`/ai`, 관리자): Ollama 서버 주소 입력 → 모델 선택 → 자료(텍스트 붙여넣기 / PDF·PPTX·DOCX·HWPX·TXT 파일 / URL)에서 텍스트 추출 → 문제 수·난이도·언어·추가 지시를 정해 객관식 문제 생성 → 미리보기에서 골라 새 퀴즈로 만들거나 기존 퀴즈에 추가
- **자체 DB**: SQLite 파일 하나 (`data/buzzer.db`)

## 기술 스택

Node.js + Express + better-sqlite3 + ws(WebSocket) / 순수 HTML·CSS·JS (빌드 과정 없음)

## 설치 및 실행

```bash
cd buzzer
npm install
cp .env.example .env
# .env 파일을 열어 GOOGLE_CLIENT_ID, JWT_SECRET 설정 (코르크와 같은 클라이언트 ID 사용 가능)
npm start
# http://localhost:3001
```

구글 OAuth 클라이언트 설정은 [코르크 README](../cork/README.md#구글-oauth-클라이언트-만들기)와 같습니다. 같은 클라이언트 ID를 쓰되 **승인된 자바스크립트 원본에 버저 주소를 추가**하면 됩니다.

## 외부 공개 (Cloudflare Tunnel)

코르크와 동일하게 Quick Tunnel + systemd 유저 서비스(`buzzer`, `buzzer-tunnel`)로 공개합니다.

```bash
./deploy/install-services.sh     # 서비스 등록 (cloudflared가 ~/.local/bin에 있어야 함)
cat data/tunnel-url.txt          # 공개 주소 → Google Cloud Console '승인된 자바스크립트 원본'에 등록
systemctl --user restart buzzer  # 코드 변경 후 앱만 재시작 (터널 URL 유지)
journalctl --user -u buzzer -f   # 로그
```

> 터널을 재시작하면 주소가 바뀝니다(코르크와 별개 주소). 앱 코드만 바꿨을 땐 `buzzer` 서비스만 재시작하세요.

## 수업에서 쓰는 순서

1. 관리자 로그인 → **새 퀴즈** → 문제 입력 → 저장
2. **게임 시작** → 빔프로젝터에 호스트 화면(PIN) 표시
3. 학생: 휴대폰으로 접속 → 구글 로그인 → PIN 입력 (호스트 화면의 `/?pin=XXXXXX` 주소로 바로 들어가도 됨)
4. 호스트 화면에서 **시작** → 스페이스/엔터/→ 키 또는 버튼으로 진행
5. 끝나면 **결과 상세 / CSV**

서버가 재시작되면 진행 중이던 게임은 종료 처리됩니다(그때까지의 답안은 기록에 남음).

## AI로 퀴즈 만들기 (Ollama)

별도 설치 없이 교내/연구실의 [Ollama](https://ollama.com) 서버를 연결해 씁니다.

1. Ollama 서버에서 외부 접속 허용: `OLLAMA_HOST=0.0.0.0 ollama serve` (기본은 localhost만 받음), 모델 준비 `ollama pull qwen2.5:7b` 등
2. 버저 홈 → **✨ AI로 퀴즈 만들기** → 서버 주소(`192.168.0.10:11434` 형식, 포트 생략 시 11434) 입력 → **연결** → 모델 선택 (주소·모델은 저장되어 다음에 자동 연결)
3. 자료 넣기: 텍스트 붙여넣기, 파일 업로드(PDF·PPTX·DOCX·HWPX·TXT·MD·CSV, 30MB·10개까지), URL(웹페이지·PDF 링크). 추출된 텍스트는 편집창에 모이므로 불필요한 부분은 지우면 됨. 스캔 이미지 PDF는 텍스트가 없어 지원 안 됨. 구형 .ppt/.doc/.hwp는 x 형식이나 PDF로 변환 필요
4. 문제 수(5~30)·난이도·언어·추가 지시 → **퀴즈 생성**. 생성은 서버에서 백그라운드로 돌고 화면은 진행 상황(경과 시간·출력 글자 수)을 폴링 — 터널 환경의 응답 시간 제한과 무관. 취소 가능
5. 결과에서 뺄 문제 체크 해제 → **새 퀴즈로 만들기** 또는 **기존 퀴즈에 추가** → 편집기로 이동해 검토·수정 후 게임 시작

동작 메모: 자료는 앞 12,000자까지만 모델에 전달(`src/ai.js`의 `MAX_SOURCE_CHARS`). Ollama 구조화 출력(JSON 스키마)을 사용하고, 구버전 Ollama면 `format: "json"`으로 자동 폴백. 추론 모델(qwen3 등)은 `think: false`로 호출. 품질은 모델에 좌우되므로 7B 이상 한국어 가능한 모델(qwen2.5/qwen3, exaone, gemma3 등) 권장. 생성 문제는 기본 20초·1000점으로 들어가며 편집기에서 바꿀 수 있음.

## 환경 변수 (.env)

| 변수 | 설명 |
|---|---|
| `GOOGLE_CLIENT_ID` | 구글 OAuth 웹 클라이언트 ID (필수) |
| `ADMIN_EMAILS` | 관리자 이메일, 쉼표 구분 (기본 예시: `mrgrit@ync.ac.kr`) |
| `JWT_SECRET` | 세션 토큰 서명 키 — 긴 랜덤 문자열로 변경 필수 |
| `PORT` | 서버 포트 (기본 3001) |
| `ALLOWED_HOSTED_DOMAIN` | 설정 시 해당 도메인(예: `ync.ac.kr`) 구글 계정만 로그인 허용 |
| `BUZZER_DATA_DIR` | 데이터 디렉토리 변경 (기본 `data/`) |

## API 요약

```
GET    /api/config, POST /api/auth/google, POST /api/auth/logout, GET /api/me   (코르크와 동일)
GET    /api/quizzes                      퀴즈 목록 (관리자)
POST   /api/quizzes                      퀴즈 생성 {title, theme} (theme 생략 시 덜 쓰인 테마 자동 배정)
GET    /api/quizzes/:id                  퀴즈 + 문제/보기 (+ theme)
PUT    /api/quizzes/:id                  퀴즈 전체 저장 {title, description, theme, questions:[{text,time_limit,points,options:[{text,is_correct}]}]}
POST   /api/quizzes/:id/duplicate        복제
DELETE /api/quizzes/:id                  삭제 (게임 기록은 유지)
POST   /api/quizzes/:id/questions        문제 덧붙이기 {questions:[...]} (AI 생성 결과 넣기)
GET    /api/ai/settings                  저장된 Ollama 주소/모델
POST   /api/ai/connect                   Ollama 연결 확인 + 모델 목록 {url}
POST   /api/ai/extract                   파일 텍스트 추출 (multipart 'files')
POST   /api/ai/fetch-url                 URL 텍스트 추출 {url}
POST   /api/ai/generate                  생성 작업 시작 {model,text,count,difficulty,language,instructions} → {id}
GET    /api/ai/jobs/:id                  작업 상태/결과 폴링,  DELETE 취소
POST   /api/quizzes/:id/games            게임 생성 → {id, pin}
POST   /api/games/join                   PIN으로 참가 {pin} → {id}
GET    /api/games                        게임 기록 (관리자)
GET    /api/games/:id                    게임 요약 (+ theme)
GET    /api/games/:id/results(.csv)      결과표 (관리자)
DELETE /api/games/:id                    기록 삭제 (종료된 게임만)
WS     /ws                               실시간: host/join/answer/next/end/kick ↔ state (state에 theme 포함)
```

## DB 스키마

`users` / `quizzes` / `questions` / `options` / `games` / `players` / `answers` / `settings`(Ollama 주소·모델). 게임 기록(`games`, `answers`)은 퀴즈 제목·문제·보기 텍스트(와 배경 테마)를 스냅샷으로 저장하므로 퀴즈를 나중에 고치거나 지워도 결과는 그대로 남습니다. `quizzes.theme`/`games.theme`이 없던 DB에는 컬럼이 추가되고, 개명 이전의 `kahoot.db`(+wal/shm)는 `buzzer.db`로 자동 개명됩니다.
