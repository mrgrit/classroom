#!/usr/bin/env python3
"""~/.hermes/config.yaml 에 코르크 플러그인 활성화 + MCP 서버(cork) 등록. install.sh가 호출.

사용법: setup_config.py <CORK_URL>          등록
        setup_config.py --remove               제거
HERMES_HOME 환경변수를 존중한다 (프로필 사용 시).
"""
import os
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("PyYAML을 찾을 수 없어 config.yaml을 자동으로 고치지 못했습니다. 아래를 config.yaml에 직접 추가하세요:")
    print("  plugins:\n    enabled: [cork]\n  mcp_servers:\n    cork:\n      url: <CORK_URL>/mcp\n      headers:\n        Authorization: \"Bearer ${CORK_TOKEN}\"")
    sys.exit(2)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    remove = sys.argv[1] == "--remove"
    home = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes"))
    path = home / "config.yaml"
    cfg = yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else None
    if not isinstance(cfg, dict):
        cfg = {}

    plugins = cfg.get("plugins")
    if not isinstance(plugins, dict):
        plugins = {}
        cfg["plugins"] = plugins
    enabled = plugins.get("enabled")
    if not isinstance(enabled, list):
        enabled = []
        plugins["enabled"] = enabled
    servers = cfg.get("mcp_servers")
    if not isinstance(servers, dict):
        servers = {}
        cfg["mcp_servers"] = servers

    if remove:
        if "cork" in enabled:
            enabled.remove("cork")
        servers.pop("cork", None)
        if not servers:
            cfg.pop("mcp_servers", None)
        msg = "config.yaml에서 cork 플러그인/MCP 서버를 제거했습니다."
    else:
        url = sys.argv[1].strip().rstrip("/")
        if "cork" not in enabled:
            enabled.append("cork")
        disabled = plugins.get("disabled")
        if isinstance(disabled, list) and "cork" in disabled:
            disabled.remove("cork")
        servers["cork"] = {
            "url": url + "/mcp",
            "headers": {"Authorization": "Bearer ${CORK_TOKEN}"},
            "timeout": 60,
            "connect_timeout": 30,
        }
        msg = f"config.yaml: plugins.enabled에 cork 추가, mcp_servers.cork = {url}/mcp"

    home.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False, default_flow_style=False), encoding="utf-8")
    print(msg)


if __name__ == "__main__":
    main()
