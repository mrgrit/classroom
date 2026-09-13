#!/usr/bin/env python3
# 코르크(Cork) ↔ Claude Code 연동: Stop/SessionEnd 훅 스크립트
# 응답이 끝날 때마다(그리고 세션이 끝날 때) 트랜스크립트에서 완성된 턴(질문+답변)들을 뽑아 코르크에 저장한다.
# - 저장 범위: 세션을 연 폴더(또는 그 상위)에 `.cork` 파일이 있을 때만 (프로젝트별 opt-in, /cork 시작)
# - Stop 시점엔 마지막 답변이 아직 트랜스크립트 파일에 안 실렸을 수 있다 → 파일이 잠잠해질 때까지
#   잠시 기다리고, 그래도 안 보이면 보내지 않는다. 대신 세션별 전송 기록(state/)을 남겨
#   다음 훅(다음 턴 종료·세션 종료)에서 빠진 턴을 만회 전송한다(중복 없이).
# - 어떤 경우에도 Claude Code를 막지 않도록 항상 exit 0. 오류는 옆의 save_turn.log에만 남긴다.
import json
import os
import sys
import time
import hashlib
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_BACKLOG = 10  # 한 번의 훅에서 만회 전송할 최대 턴 수
SKIP_PREFIX = ('<', '[Request interrupted', 'This session is being continued', 'Caveat:')


def load_config():
    path = os.environ.get('CORK_CONFIG') or os.path.join(HERE, 'config.json')
    with open(path, encoding='utf-8') as f:
        cfg = json.load(f)
    state_dir = os.path.join(os.path.dirname(os.path.abspath(path)), 'state')
    return cfg['url'].rstrip('/'), cfg['token'], state_dir


def log(msg):
    try:
        base = os.path.dirname(os.path.abspath(os.environ.get('CORK_CONFIG') or os.path.join(HERE, 'config.json')))
        path = os.path.join(base, 'save_turn.log')
        if os.path.exists(path) and os.path.getsize(path) > 512 * 1024:
            os.replace(path, path + '.old')
        with open(path, 'a', encoding='utf-8') as f:
            f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + msg + '\n')
    except Exception:
        pass


def has_marker(start):
    # start부터 상위 폴더로 올라가며 저장 opt-in 표시(.cork 파일)를 찾는다
    d = os.path.abspath(start or os.getcwd())
    while True:
        if os.path.exists(os.path.join(d, '.cork')):
            return True
        parent = os.path.dirname(d)
        if parent == d:
            return False
        d = parent


def text_of(content):
    # message.content는 문자열이거나 [{type:'text',...}, {type:'tool_result',...}] 목록 — text 블록만 모은다
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = [b.get('text', '') for b in content if isinstance(b, dict) and b.get('type') == 'text']
        return '\n'.join(p for p in parts if p).strip()
    return ''


def build_pairs(transcript):
    # 트랜스크립트 → (질문, 답변들) 페어 목록. 마지막 페어는 아직 답변이 기록 중일 수 있다(closed=False)
    pairs = []
    cur = None

    def close():
        nonlocal cur
        if cur:
            cur['closed'] = True
            pairs.append(cur)
            cur = None

    with open(transcript, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get('isSidechain'):
                continue
            t = e.get('type')
            if t == 'user':
                message = e.get('message') or {}
                content = message.get('content')
                if isinstance(content, list) and any(
                    isinstance(b, dict) and b.get('type') == 'tool_result' for b in content
                ):
                    continue  # 턴 내부의 도구 결과 — 턴 경계가 아님
                if e.get('isMeta') or e.get('isCompactSummary'):
                    continue  # 시스템이 끼워 넣은 항목 — 사용자 입력 아님
                close()  # 새 사용자 입력 = 이전 턴 종료
                text = text_of(content)
                if not text or text.startswith(SKIP_PREFIX) or len(text) <= 2:
                    continue  # /명령 래퍼·중단 알림·아주 짧은 말("ㅇㅋ")은 질문으로 치지 않음
                cur = {
                    'uuid': e.get('uuid') or hashlib.sha1(text.encode('utf-8')).hexdigest(),
                    'q': text,
                    'answers': [],
                    'model': '',
                    'closed': False,
                }
            elif t == 'assistant' and cur is not None:
                message = e.get('message') or {}
                cur['model'] = message.get('model') or cur['model']
                text = text_of(message.get('content'))
                if text:
                    cur['answers'].append(text)
    if cur:
        pairs.append(cur)
    return pairs


def post_turn(url, token, sid, pair):
    body = json.dumps({
        'session_id': sid,
        'user_message': pair['q'][:6000],
        'assistant_response': '\n\n'.join(pair['answers'])[:16000],
        'model': pair['model'],
        'platform': 'claude-code',
    }).encode('utf-8')
    req = urllib.request.Request(
        url + '/api/hermes/turns',
        data=body,
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
    )
    urllib.request.urlopen(req, timeout=10).read()


def main():
    hook = json.load(sys.stdin)
    transcript = hook.get('transcript_path')
    sid = (hook.get('session_id') or '').strip()[:100]
    if not transcript or not sid or not os.path.exists(transcript):
        return
    if not has_marker(hook.get('cwd')):
        return  # .cork 없는 폴더의 세션은 저장하지 않음

    url, token, state_dir = load_config()
    os.makedirs(state_dir, exist_ok=True)
    state_path = os.path.join(state_dir, sid + '.json')

    # 같은 세션의 훅이 겹쳐 돌 때(Stop 직후 SessionEnd 등) 중복 전송 방지 — 순서대로 실행
    lock = None
    try:
        import fcntl
        lock = open(state_path + '.lock', 'w')
        fcntl.flock(lock, fcntl.LOCK_EX)
    except Exception:
        pass

    # flush 대기: 파일 크기가 잠잠해지고 마지막 페어가 온전해질 때까지 (상한: Stop 6초 / SessionEnd 3초)
    wait = float(os.environ.get('CORK_WAIT') or (3 if hook.get('hook_event_name') == 'SessionEnd' else 6))
    deadline = time.time() + wait
    last_size = -1
    stable = False
    pairs = []
    while True:
        size = os.path.getsize(transcript)
        pairs = build_pairs(transcript)
        stable = size == last_size
        if stable and pairs and (pairs[-1]['closed'] or pairs[-1]['answers']):
            break
        if time.time() >= deadline:
            break
        last_size = size
        time.sleep(0.5)
    if not pairs:
        return

    # 세션별 전송 기록. 첫 실행(설치 전부터 있던 세션)이면 지난 대화는 건너뛰고 마지막 턴부터 시작
    sent = None
    if os.path.exists(state_path):
        try:
            with open(state_path, encoding='utf-8') as f:
                sent = json.load(f).get('sent', [])
        except Exception:
            sent = None
    if sent is None:
        sent = [p['uuid'] for p in pairs[:-1]]
    sent_set = set(sent)

    # 보낼 턴: 아직 안 보냈고 답변이 있는 것. 마지막(열린) 페어는 파일이 안정된 경우에만
    todo = [p for p in pairs if p['uuid'] not in sent_set and p['answers'] and (p['closed'] or stable)]
    todo = todo[:MAX_BACKLOG]

    for p in todo:
        try:
            post_turn(url, token, sid, p)
        except urllib.error.HTTPError as err:
            if err.code not in (400, 403):
                # 409(저장 위치 미설정)·5xx 등 — 상태를 남기지 않고 다음 훅에서 재시도
                log(f'{sid[:8]} 턴 저장 실패(HTTP {err.code}) — 다음 턴에서 재시도')
                break
            log(f'{sid[:8]} 턴 저장 거절(HTTP {err.code}) — 이 턴은 건너뜀')
        except Exception as err:
            log(f'{sid[:8]} 전송 실패: {err!r} — 다음 턴에서 재시도')
            break
        sent.append(p['uuid'])

    # 상태 저장(전송 못 했어도 '첫 실행 기준점'은 기록) + 오래된 세션 기록 정리
    tmp = state_path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump({'sent': sent[-300:]}, f)
    os.replace(tmp, state_path)
    try:
        now = time.time()
        for fn in os.listdir(state_dir):
            p = os.path.join(state_dir, fn)
            if now - os.path.getmtime(p) > 45 * 86400:
                os.remove(p)
    except Exception:
        pass


if __name__ == '__main__':
    try:
        main()
    except Exception as err:  # noqa: BLE001 — 훅은 절대 실패로 Claude를 막지 않는다
        log(repr(err))
    sys.exit(0)
