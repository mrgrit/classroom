# Padlet Clone (교실용 담벼락)

패들렛(Padlet)의 핵심 기능만 담은 자체 호스팅 클론입니다.

- **구글 로그인**으로 학생 식별 (Google Identity Services + 서버 측 ID 토큰 검증)
- **관리자**(기본: `mrgrit@ync.ac.kr`)만 보드(담벼락) 생성/삭제
- **학생**: 게시물 작성(색상 선택), 본인 게시물 수정/삭제, 좋아요, 댓글
- **자체 DB**: SQLite 파일 하나 (`data/padlet.db`) — 외부 DB 서버 불필요
- 5초 폴링으로 다른 학생의 게시물이 자동으로 나타남

## 기술 스택

Node.js + Express + better-sqlite3 / 순수 HTML·CSS·JS (빌드 과정 없음)

## 설치 및 실행

```bash
cd padlet
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
systemctl --user status padlet padlet-tunnel    # 상태
journalctl --user -u padlet -f                  # 앱 로그
journalctl --user -u padlet-tunnel -f           # 터널 로그
systemctl --user restart padlet                 # 앱만 재시작 (터널 URL 유지)
systemctl --user restart padlet-tunnel          # 터널 재시작 → URL 바뀜! 구글 콘솔 갱신 필요
```

서비스 없이 잠깐 띄울 때는 `npm start` 와 별도 터미널에서 `npm run tunnel`.

> **주의**: Quick Tunnel 주소는 터널 프로세스를 재시작할 때마다 바뀝니다. 앱 코드만 바꿨을 땐 `padlet` 서비스만 재시작하세요. 고정 주소가 필요해지면 도메인을 하나 사서 Cloudflare 계정에 연결한 뒤 Named Tunnel로 전환하면 됩니다.

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
| 보드 생성/삭제 | ✕ | ✔ |
| 게시물 작성 | ✔ | ✔ |
| 게시물 수정/삭제 | 본인 것만 | 모두 |
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
POST   /api/boards                  보드 생성 (관리자)
DELETE /api/boards/:id              보드 삭제 (관리자)
GET    /api/boards/:id              보드 상세 (게시물+좋아요+댓글)
POST   /api/boards/:id/posts        게시물 작성
PUT    /api/posts/:id               게시물 수정 (본인/관리자)
DELETE /api/posts/:id               게시물 삭제 (본인/관리자)
POST   /api/posts/:id/like          좋아요 토글
POST   /api/posts/:id/comments      댓글 작성
DELETE /api/comments/:id            댓글 삭제 (본인/관리자)
```

## DB 스키마

`users` / `boards` / `posts` / `likes` / `comments` 5개 테이블, `src/db.js`에서 서버 시작 시 자동 생성됩니다. DB 파일은 `data/padlet.db`에 저장되며 git에는 포함되지 않습니다.
