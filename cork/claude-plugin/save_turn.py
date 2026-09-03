#!/usr/bin/env python3
# 코르크(Cork) ↔ Claude Code 연동: Stop 훅 스크립트
# Claude Code가 응답을 마칠 때마다 호출되어, 마지막 턴(질문+답변)을 코르크에 자동 저장한다.
# 어떤 경우에도 Claude Code를 막지 않도록 항상 exit 0. 오류는 옆의 save_turn.log에만 남긴다.
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def load_config():
    path = os.environ.get('CORK_CONFIG') or os.path.join(HERE, 'config.json')
    with open(path, encoding='utf-8') as f:
        cfg = json.load(f)
    return cfg['url'].rstrip('/'), cfg['token']


def text_of(content):
    # message.content는 문자열이거나 [{type:'text',...}, {type:'tool_result',...}] 목록 — text 블록만 모은다
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = [b.get('text', '') for b in content if isinstance(b, dict) and b.get('type') == 'text']
        return '\n'.join(p for p in parts if p).strip()
    return ''


def main():
    hook = json.load(sys.stdin)
    transcript = hook.get('transcript_path')
    if not transcript or not os.path.exists(transcript):
        return

    entries = []
    with open(transcript, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except ValueError:
                pass

    # 마지막 '실제' 사용자 메시지 찾기 (도구 결과·메타·사이드체인·<command-name> 등 시스템 래퍼 제외)
    last_user = -1
    user_msg = ''
    for i, e in enumerate(entries):
        if e.get('type') != 'user' or e.get('isMeta') or e.get('isSidechain'):
            continue
        message = e.get('message') or {}
        content = message.get('content')
        if isinstance(content, list) and any(
            isinstance(b, dict) and b.get('type') == 'tool_result' for b in content
        ):
            continue
        text = text_of(content)
        if not text or text.startswith('<'):
            continue
        last_user = i
        user_msg = text

    if last_user < 0:
        return

    # 그 뒤에 나온 assistant 텍스트를 모두 이어붙여 이번 턴의 답변으로
    answers = []
    model = ''
    for e in entries[last_user + 1:]:
        if e.get('type') != 'assistant' or e.get('isSidechain'):
            continue
        message = e.get('message') or {}
        model = message.get('model') or model
        text = text_of(message.get('content'))
        if text:
            answers.append(text)

    if not answers:
        return

    url, token = load_config()
    body = json.dumps({
        'session_id': hook.get('session_id') or '',
        'user_message': user_msg[:6000],
        'assistant_response': '\n\n'.join(answers)[:16000],
        'model': model,
        'platform': 'claude-code',
    }).encode('utf-8')
    req = urllib.request.Request(
        url + '/api/hermes/turns',
        data=body,
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
    )
    urllib.request.urlopen(req, timeout=10).read()


if __name__ == '__main__':
    try:
        main()
    except Exception as err:  # noqa: BLE001 — 훅은 절대 실패로 Claude를 막지 않는다
        try:
            with open(os.path.join(HERE, 'save_turn.log'), 'a', encoding='utf-8') as f:
                f.write(repr(err) + '\n')
        except Exception:
            pass
    sys.exit(0)
