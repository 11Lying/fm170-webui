#!/bin/sh
# FM170 统一串口访问器 (socat + flock 全局锁) — 有序不抢占
PORT="$1"; TIMEOUT="$2"; shift 2 || true
case "$TIMEOUT" in ''|*[!0-9]*) TIMEOUT=3;; esac
LOCKDIR="${FM170_AT_LOCKDIR:-/tmp/fm170}"; mkdir -p "$LOCKDIR" 2>/dev/null
LOCK="$LOCKDIR/at_lock.$(basename "$PORT")"
[ -n "$1" ] || { echo "usage: fm170_at.sh <port> <timeout> '<AT>' | -m ..."; exit 2; }

exec 9>"$LOCK"
flock 9 || { echo "AT_BUSY:$PORT"; exit 3; }

# 构造发送: 每条命令以 \r 结尾, 多条用 \r\n
inp="$*"
if [ "$1" = "-m" ]; then
  shift
  inp="$*"
fi
payload=$(printf '%s' "$inp" | awk '{ printf "%s\r", $0 }')

# 发送(不转换换行), raw 模式, echo关闭
printf '%s\r\n' "$payload" | /usr/bin/socat -T "$TIMEOUT" - "$PORT,b115200,raw,echo=0" 2>/dev/null
exec 9>&-
exit 0
