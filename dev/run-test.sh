#!/bin/bash
# 本地测试：起 mock server -> 跑 Playwright -> 清理
set -u
cd /workspace/fm170-webui
pkill -f "[m]ock-server.js" 2>/dev/null
sleep 0.5
nohup node dev/mock-server.js 8123 > /tmp/mock.log 2>&1 &
sleep 1
curl -s -o /dev/null -w "srv:%{http_code}\n" http://localhost:8123/
cd /skills/playwright-skill && node run.js "${1:-/tmp/playwright-new.js}" 2>&1
rc=${PIPESTATUS[0]}
echo "--- server log (tail) ---"
tail -5 /tmp/mock.log
pkill -f "[m]ock-server.js" 2>/dev/null
exit $rc
