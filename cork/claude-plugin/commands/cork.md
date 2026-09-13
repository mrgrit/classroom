---
description: 코르크(Cork) 연동 — 이 폴더 저장 켜기/끄기, 상태 확인, 저장 위치 설정
allowed-tools: mcp__cork__cork_status, mcp__cork__cork_list_targets, mcp__cork__cork_set_context, mcp__cork__cork_save_note, mcp__cork__cork_search_notes, Bash(git rev-parse:*), Bash(touch:*), Bash(ls:*)
---

코르크(교실 담벼락 게시판) 연동 명령입니다. 인자: "$ARGUMENTS"

인자를 해석해 알맞은 동작을 하고, 결과를 한국어로 짧게 요약해 보여주세요.

- `시작` → 이 프로젝트의 대화 자동 저장 켜기: 프로젝트 루트(`git rev-parse --show-toplevel`, git이 아니면 현재 폴더)에 `.cork` 빈 파일을 만들고(`touch <루트>/.cork`), `cork_status`로 저장 위치도 함께 보여주기
- `중지` → 현재 폴더부터 상위 폴더로 올라가며 처음 만나는 `.cork` 파일을 찾아 삭제하고, 이 폴더의 대화가 더 이상 저장되지 않음을 알려주기
- 인자가 없으면 → `cork_status` (저장 위치·주제·자동 저장 상태) + 이 폴더의 저장 여부(현재 폴더와 상위에 `.cork` 파일이 있는지 확인해서 함께 표시)
- `목록` → `cork_list_targets` (글을 쓸 수 있는 과목/컬럼 목록)
- `과목 <이름>` → `cork_set_context` {board: <이름>}
- `컬럼 <이름>` → `cork_set_context` {column: <이름>}
- `주제 <문구>` → `cork_set_context` {topic: <문구>}
- `on` / `off` → `cork_set_context` {auto_save: true/false}
- 그 밖의 인자는 주제(topic) 설정으로 처리

참고: 대화 자동 저장은 두 조건을 모두 만족할 때만 동작합니다 — ① 세션을 연 폴더(또는 그 상위)에 `.cork` 파일이 있고(`/cork 시작`으로 생성), ② 서버 쪽 자동 저장이 켜져 있을 때(`/cork on`). 사용자가 "코르크에 메모해줘"라고 하면 `cork_save_note`, "전에 정리한 것 찾아줘"라고 하면 `cork_search_notes`를 사용하세요.
