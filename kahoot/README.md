# Kahoot Clone (교실용 실시간 퀴즈)

카훗(Kahoot!)의 핵심 기능만 담은 자체 호스팅 클론입니다.

- **구글 로그인**으로 학생 식별 — 닉네임 대신 구글 이름이 표시되고, 결과표에 이메일이 남아 누가 몇 점인지 바로 알 수 있음
- **관리자**(기본: `mrgrit@ync.ac.kr`)만 퀴즈 작성·게임 진행·결과 열람
- **퀴즈 편집기**: 문제당 보기 2~4개, 정답(복수 가능), 제한 시간(5~120초), 점수(0/500/1000/2000). 문제 순서 이동·복제, **텍스트로 한번에 입력**(문제 한 줄 + 보기 줄, 정답에 `*`)
- **게임 진행**: 6자리 PIN → 대기실(참가자 이름 표시) → 문제(카운트다운, 답변 수) → 결과(보기별 막대그래프 + 정답) → 순위(상위 5명) → … → 최종 시상대(1·2·3위)
- **학생 화면(휴대폰)**: 4색 도형 버튼, 정답/오답과 획득 점수, 현재 순위. 화면이 꺼졌다 켜져도 자동 재접속
- **점수**: 카훗 방식 — 정답이면 `만점 × (1 − 소요시간비율 / 2)`, 빠를수록 높음
- **결과표/CSV**: 참가자별 점수·정답 수·문제별 O/X·응답 시간. 엑셀용 CSV 다운로드
- **자체 DB**: SQLite 파일 하나 (`data/kahoot.db`)

## 기술 스택

Node.js + Express + better-sqlite3 + ws(WebSocket) / 순수 HTML·CSS·JS (빌드 과정 없음)

## 설치 및 실행

```bash
cd kahoot
npm install
cp .env.example .env
# .env 파일을 열어 GOOGLE_CLIENT_ID, JWT_SECRET 설정 (패들렛과 같은 클라이언트 ID 사용 가능)
npm start
# http://localhost:3001
```

구글 OAuth 클라이언트 설정은 [패들렛 README](../padlet/README.md#구글-oauth-클라이언트-만들기)와 같습니다. 같은 클라이언트 ID를 쓰되 **승인된 자바스크립트 원본에 카훗 주소를 추가**하면 됩니다.

## 외부 공개 (Cloudflare Tunnel)

패들렛과 동일하게 Quick Tunnel + systemd 유저 서비스(`kahoot`, `kahoot-tunnel`)로 공개합니다.

```bash
./deploy/install-services.sh     # 서비스 등록 (cloudflared가 ~/.local/bin에 있어야 함)
cat data/tunnel-url.txt          # 공개 주소 → Google Cloud Console '승인된 자바스크립트 원본'에 등록
systemctl --user restart kahoot  # 코드 변경 후 앱만 재시작 (터널 URL 유지)
journalctl --user -u kahoot -f   # 로그
```

> 터널을 재시작하면 주소가 바뀝니다(패들렛과 별개 주소). 앱 코드만 바꿨을 땐 `kahoot` 서비스만 재시작하세요.

## 수업에서 쓰는 순서

1. 관리자 로그인 → **새 퀴즈** → 문제 입력 → 저장
2. **게임 시작** → 빔프로젝터에 호스트 화면(PIN) 표시
3. 학생: 휴대폰으로 접속 → 구글 로그인 → PIN 입력 (호스트 화면의 `/?pin=XXXXXX` 주소로 바로 들어가도 됨)
4. 호스트 화면에서 **시작** → 스페이스/엔터/→ 키 또는 버튼으로 진행
5. 끝나면 **결과 상세 / CSV**

서버가 재시작되면 진행 중이던 게임은 종료 처리됩니다(그때까지의 답안은 기록에 남음).

## 환경 변수 (.env)

| 변수 | 설명 |
|---|---|
| `GOOGLE_CLIENT_ID` | 구글 OAuth 웹 클라이언트 ID (필수) |
| `ADMIN_EMAILS` | 관리자 이메일, 쉼표 구분 (기본 예시: `mrgrit@ync.ac.kr`) |
| `JWT_SECRET` | 세션 토큰 서명 키 — 긴 랜덤 문자열로 변경 필수 |
| `PORT` | 서버 포트 (기본 3001) |
| `ALLOWED_HOSTED_DOMAIN` | 설정 시 해당 도메인(예: `ync.ac.kr`) 구글 계정만 로그인 허용 |
| `KAHOOT_DATA_DIR` | 데이터 디렉토리 변경 (기본 `data/`) |

## API 요약

```
GET    /api/config, POST /api/auth/google, POST /api/auth/logout, GET /api/me   (패들렛과 동일)
GET    /api/quizzes                      퀴즈 목록 (관리자)
POST   /api/quizzes                      퀴즈 생성 {title}
GET    /api/quizzes/:id                  퀴즈 + 문제/보기
PUT    /api/quizzes/:id                  퀴즈 전체 저장 {title, description, questions:[{text,time_limit,points,options:[{text,is_correct}]}]}
POST   /api/quizzes/:id/duplicate        복제
DELETE /api/quizzes/:id                  삭제 (게임 기록은 유지)
POST   /api/quizzes/:id/games            게임 생성 → {id, pin}
POST   /api/games/join                   PIN으로 참가 {pin} → {id}
GET    /api/games                        게임 기록 (관리자)
GET    /api/games/:id                    게임 요약
GET    /api/games/:id/results(.csv)      결과표 (관리자)
DELETE /api/games/:id                    기록 삭제 (종료된 게임만)
WS     /ws                               실시간: host/join/answer/next/end/kick ↔ state
```

## DB 스키마

`users` / `quizzes` / `questions` / `options` / `games` / `players` / `answers`. 게임 기록(`games`, `answers`)은 퀴즈 제목·문제·보기 텍스트를 스냅샷으로 저장하므로 퀴즈를 나중에 고치거나 지워도 결과는 그대로 남습니다.
