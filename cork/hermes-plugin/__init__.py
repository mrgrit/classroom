"""cork — 코르크 연동 플러그인 (Hermes Agent)

무엇을 하나
- ``post_llm_call`` 훅: 매 턴(학생 질문 + 최종 답변)을 코르크 REST API로 보내 학생 컬럼의 게시물에 누적한다.
  모델이 도구를 부르든 말든 무조건 실행되므로 저장 누락이 없다. (전송은 백그라운드 스레드)
- ``/cork`` 슬래시 명령: 저장 위치(과목·컬럼)/주제/자동 저장 설정, 상태 확인, 메모, 검색.
- MCP 서버(``CORK_URL/mcp``)는 install.sh가 config.yaml에 등록한다 — 모델이 쓰는 메모 저장/검색/컨텍스트 변경 도구.

설정: ``~/.hermes/.env`` 의 ``CORK_URL``, ``CORK_TOKEN`` (코르크 '내 정보' 페이지의 설치 명령이 기록함)
"""

from __future__ import annotations

import atexit
import json
import logging
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

TIMEOUT = 10  # 초
_lock = threading.Lock()
_state: Dict[str, Any] = {
    "force_new": False,     # /cork 새글 → 다음 턴은 새 게시물로
    "saved": 0,             # 이번 프로세스에서 저장된 턴 수
    "last": None,           # 마지막 저장 결과
    "last_error": None,     # 마지막 저장 실패 메시지
    "threads": [],          # 진행 중인 전송 스레드
}


class CorkError(Exception):
    code: Optional[str] = None
    status: Optional[int] = None


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def _cfg():
    url = os.environ.get("CORK_URL", "").strip().rstrip("/")
    token = os.environ.get("CORK_TOKEN", "").strip()
    return url, token


def _request(method: str, path: str, body: Any = None, timeout: int = TIMEOUT) -> Any:
    url, token = _cfg()
    if not url or not token:
        raise CorkError(
            "CORK_URL / CORK_TOKEN이 설정되지 않았습니다. "
            "코르크 '내 정보' 페이지의 설치 명령을 다시 실행하세요."
        )
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "hermes-cork-plugin/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        payload: Dict[str, Any] = {}
        try:
            payload = json.loads(e.read().decode("utf-8"))
        except Exception:
            pass
        err = CorkError(payload.get("error") or f"HTTP {e.code}")
        err.code = payload.get("code")
        err.status = e.code
        raise err
    except urllib.error.URLError as e:
        raise CorkError(f"코르크 서버({url})에 연결할 수 없습니다: {e.reason}")
    except (TimeoutError, OSError) as e:
        raise CorkError(f"코르크 서버 응답 없음: {e}")


# ---------------------------------------------------------------------------
# 자동 저장 훅
# ---------------------------------------------------------------------------

def _message_text(msg: Any) -> str:
    """훅이 넘기는 메시지(str 또는 멀티모달 파트 목록)에서 텍스트만 추출."""
    if msg is None:
        return ""
    if isinstance(msg, str):
        return msg
    if isinstance(msg, list):
        parts: List[str] = []
        for part in msg:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                if part.get("type") == "text" and part.get("text"):
                    parts.append(str(part["text"]))
                elif part.get("type") in ("image", "image_url"):
                    parts.append("[이미지]")
        return "\n".join(parts)
    if isinstance(msg, dict):
        return _message_text(msg.get("content") or msg.get("text"))
    return str(msg)


def _send_turn(payload: Dict[str, Any]) -> None:
    try:
        result = _request("POST", "/api/hermes/turns", payload)
        with _lock:
            if result.get("saved"):
                _state["saved"] += 1
                _state["last"] = result
                _state["last_error"] = None
            else:
                _state["last_error"] = result.get("reason")
    except CorkError as e:
        with _lock:
            _state["last_error"] = str(e)
        logger.warning("cork 자동 저장 실패: %s", e)
    except Exception as e:  # noqa: BLE001
        with _lock:
            _state["last_error"] = str(e)
        logger.warning("cork 자동 저장 오류: %s", e)


def _prune_threads() -> None:
    _state["threads"] = [t for t in _state["threads"] if t.is_alive()]


def _on_post_llm_call(
    *,
    session_id: str = "",
    user_message: Any = None,
    assistant_response: Any = None,
    model: str = "",
    platform: str = "",
    **_: Any,
) -> None:
    question = _message_text(user_message).strip()
    answer = _message_text(assistant_response).strip()
    if not question or not answer or question.startswith("/"):
        return
    url, token = _cfg()
    if not url or not token:
        return
    with _lock:
        new_post = bool(_state["force_new"])
        _state["force_new"] = False
        _prune_threads()
    payload = {
        "session_id": session_id or "unknown",
        "user_message": question,
        "assistant_response": answer,
        "model": model or "",
        "platform": platform or "",
        "new_post": new_post,
    }
    t = threading.Thread(target=_send_turn, args=(payload,), name="cork-save", daemon=True)
    with _lock:
        _state["threads"].append(t)
    t.start()


def _drain(max_wait: float = 8.0) -> None:
    """프로세스 종료(예: `hermes chat -q`) 시 전송 중인 저장이 끝나길 잠깐 기다림."""
    with _lock:
        threads = list(_state["threads"])
    import time

    deadline = time.monotonic() + max_wait
    for t in threads:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        t.join(remaining)


# ---------------------------------------------------------------------------
# /cork 슬래시 명령
# ---------------------------------------------------------------------------

USAGE = """/cork 사용법
  /cork                 현재 저장 위치·주제·자동 저장 상태
  /cork 과목 <이름>      과목(보드) 선택 — 이름 일부로 검색 (예: /cork 과목 네트워크)
  /cork 컬럼 <이름>      저장할 컬럼 선택
  /cork 주제 <문구>      주제(단원/예제) 설정 — 그냥 "/cork 3단원 예제2" 도 됨. 지우기: /cork 주제 없음
  /cork 새글             다음 대화부터 새 게시물로 저장
  /cork on | off         대화 자동 저장 켜기 / 끄기
  /cork 목록             저장 가능한 과목/컬럼 목록
  /cork 메모 <내용>      메모 게시물로 바로 저장
  /cork 검색 <검색어>    내 기록 검색"""


def _status() -> str:
    me = _request("GET", "/api/hermes/me")
    lines = [me.get("status_text", "")]
    with _lock:
        saved, last, err = _state["saved"], _state["last"], _state["last_error"]
    lines.append(f"📝 이번 실행에서 저장한 대화: {saved}턴")
    if last:
        lines.append(f"   최근 저장 → {last['board']['title']} / {last['column']['title']} · \"{last.get('title', '')}\"")
    if err:
        lines.append(f"⚠️ 최근 저장 실패: {err}")
    if not me.get("column"):
        lines.append("ℹ️ 저장 위치가 없습니다. /cork 과목 <이름> 으로 과목을 선택하세요.")
    return "\n".join(lines)


def _set(fields: Dict[str, Any]) -> str:
    ctx = _request("PUT", "/api/hermes/context", fields)
    return "설정했습니다.\n" + ctx.get("status_text", "")


def _targets() -> str:
    targets = _request("GET", "/api/hermes/targets")
    if not targets:
        return "글을 쓸 수 있는 보드가 없습니다. 관리자에게 보드 접근권한/컬럼 지정을 요청하세요."
    out = ["저장 가능한 과목(보드) / 컬럼  (★ = 내 지정 컬럼)"]
    for b in targets:
        out.append(f"- {b['title']}")
        for c in b["columns"]:
            out.append(f"    · {c['title']}{' ★' if c.get('managed') else ''}")
    return "\n".join(out)


def _search(query: str) -> str:
    rows = _request("GET", "/api/hermes/search?" + urllib.parse.urlencode({"q": query, "limit": 8}))
    if not rows:
        return f'"{query}"에 해당하는 내 기록이 없습니다.'
    out = []
    for i, r in enumerate(rows, 1):
        out.append(f"{i}. [{r['created_at']}] {r['title']}  ({r['board']} / {r.get('column') or '-'})")
        out.append("   " + r["snippet"].replace("\n", " ")[:200])
    return "\n".join(out)


def _cmd(raw_args: str) -> str:
    args = (raw_args or "").strip()
    try:
        if not args:
            return _status()
        head, _, rest = args.partition(" ")
        rest = rest.strip()
        key = head.lower()
        if key in ("help", "도움말", "?", "사용법"):
            return USAGE
        if key in ("on", "켜기", "켜"):
            return _set({"auto_save": True})
        if key in ("off", "끄기", "꺼"):
            return _set({"auto_save": False})
        if key in ("과목", "board", "보드"):
            return _set({"board": rest}) if rest else "과목 이름을 입력하세요. 예: /cork 과목 네트워크\n" + _targets()
        if key in ("컬럼", "column"):
            return _set({"column": rest}) if rest else "컬럼 이름을 입력하세요. 예: /cork 컬럼 홍길동\n" + _targets()
        if key in ("주제", "topic"):
            return _set({"topic": rest}) if rest else "주제를 입력하세요. 예: /cork 주제 3단원 예제2 (지우기: /cork 주제 없음)"
        if key in ("새글", "new"):
            with _lock:
                _state["force_new"] = True
            return "다음 대화부터 새 게시물로 저장합니다."
        if key in ("목록", "list", "ls"):
            return _targets()
        if key in ("메모", "note"):
            if not rest:
                return "메모 내용을 입력하세요. 예: /cork 메모 TCP 3-way handshake 정리 완료"
            r = _request("POST", "/api/hermes/notes", {"content": rest})
            return f"메모를 저장했습니다: \"{r['title']}\" → {r['board']['title']} / {r['column']['title']}"
        if key in ("검색", "search", "find"):
            return _search(rest) if rest else "검색어를 입력하세요. 예: /cork 검색 handshake"
        # 그 외 텍스트는 주제로
        return _set({"topic": args})
    except CorkError as e:
        return f"❌ {e}"
    except Exception as e:  # noqa: BLE001
        logger.exception("/cork 명령 오류")
        return f"❌ 오류: {e}"


# ---------------------------------------------------------------------------
# 등록
# ---------------------------------------------------------------------------

def register(ctx) -> None:
    ctx.register_hook("post_llm_call", _on_post_llm_call)
    ctx.register_command(
        "cork",
        _cmd,
        description="코르크 연동: 저장 위치(과목/컬럼)·주제·자동 저장 설정, 메모, 검색",
        args_hint="[과목|컬럼|주제|on|off|새글|목록|메모|검색] ...",
    )
    skill = Path(__file__).resolve().parent / "skills" / "cork" / "SKILL.md"
    if skill.exists():
        try:
            ctx.register_skill("cork", skill, description="코르크 연동 도구 사용법")
        except Exception as e:  # noqa: BLE001
            logger.debug("cork 스킬 등록 생략: %s", e)
    atexit.register(_drain)
