---
description: 코르크(Cork) 연동 상태 확인·저장 위치 설정
allowed-tools: mcp__cork__cork_status, mcp__cork__cork_list_targets, mcp__cork__cork_set_context, mcp__cork__cork_save_note, mcp__cork__cork_search_notes
---

코르크(교실 담벼락 게시판) 연동 명령입니다. 인자: "$ARGUMENTS"

인자를 해석해 알맞은 cork MCP 도구를 호출하고, 결과를 한국어로 짧게 요약해 보여주세요.

- 인자가 없으면 → `cork_status` (현재 저장 위치·주제·자동 저장 상태)
- `목록` → `cork_list_targets` (글을 쓸 수 있는 과목/컬럼 목록)
- `과목 <이름>` → `cork_set_context` {board: <이름>}
- `컬럼 <이름>` → `cork_set_context` {column: <이름>}
- `주제 <문구>` → `cork_set_context` {topic: <문구>}
- `on` / `off` → `cork_set_context` {auto_save: true/false}
- 그 밖의 인자는 주제(topic) 설정으로 처리

참고: 대화는 매 턴 자동으로 코르크에 저장됩니다(자동 저장이 켜져 있을 때). 사용자가 "코르크에 메모해줘"라고 하면 `cork_save_note`, "전에 정리한 것 찾아줘"라고 하면 `cork_search_notes`를 사용하세요.
