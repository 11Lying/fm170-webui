#!/bin/sh
# FM170 /tmp/fm170 日志体积控制
# 目的：防止 scheduler/dial/sms 等纯 append 日志长期运行无限增长。
# 行为：对 /tmp/fm170/*.log (含 *.log.worker.* 等) 超过 MAX_BYTES 的，保留末尾 KEEP_BYTES 截断。
# 安全：用「尾部保留 + cat 写回同一 inode」方式，不影响正在 append 的进程（保持原 inode）。
# 用法：直接执行 或 cron 定时调用。幂等、无副作用；日志极小时不做任何事。
#
# 默认阈值：2MB 触发，保留 200KB。可通过环境变量覆盖。
MAX_BYTES="${FM170_LOG_MAX:-2097152}"   # 2 MB
KEEP_BYTES="${FM170_LOG_KEEP:-204800}"  # 200 KB

STATE_DIR="${FM170_STATE_DIR:-/tmp/fm170}"
[ -d "$STATE_DIR" ] || exit 0

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"; }

find_logs() {
  # 匹配所有日志类文件（含 worker 分片）
  find "$STATE_DIR" -maxdepth 1 -type f \
    \( -name '*.log' -o -name '*.log.worker.*' -o -name 'dial.log' -o -name 'sms.log' -o -name 'scheduler.log*' \) 2>/dev/null
}

trim_one() {
  f="$1"
  size=$(wc -c < "$f" 2>/dev/null || echo 0)
  case "$size" in ''|*[!0-9]*) return 0 ;; esac
  [ "$size" -le "$MAX_BYTES" ] && return 0
  keep="$KEEP_BYTES"
  [ "$keep" -ge "$size" ] && keep=$((size - 1))
  tmp="$f.trim.$$"
  # 保留末尾 keep 字节，写到临时文件，再 cat 回原 inode（保持同一 inode，避免 append 进程丢日志）
  if tail -c "$keep" "$f" > "$tmp" 2>/dev/null; then
    if cat "$tmp" > "$f" 2>/dev/null; then
      log "trimmed $f: $size -> $(wc -c < "$f") bytes"
    fi
    rm -f "$tmp" 2>/dev/null
  else
    rm -f "$tmp" 2>/dev/null
  fi
}

found=0
find_logs | while read -r f; do
  [ -f "$f" ] || continue
  [ -s "$f" ] || continue
  found=1
  trim_one "$f"
done

exit 0
