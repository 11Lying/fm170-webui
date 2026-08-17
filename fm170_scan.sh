#!/bin/sh

# Command-line GTCELLSCAN request for the fm170_scheduler daemon.
# This script never opens a modem serial port.

STATE_DIR="${FM170_STATE_DIR:-/tmp/fm170}"
REQUEST_FILE="$STATE_DIR/cellscan_request.json"
STATUS_FILE="$STATE_DIR/cellscan_status.json"
DAEMON_PID_FILE="/var/run/fm170_scheduler.pid"
TIMEOUT="${FM170_SCAN_TIMEOUT:-180}"
ATTEMPT_TIMEOUT="${FM170_SCAN_ATTEMPT_TIMEOUT:-180}"
MAX_ATTEMPTS="${FM170_SCAN_MAX_ATTEMPTS:-3}"
RETRY_DELAY="${FM170_SCAN_RETRY_DELAY:-5}"

case "$TIMEOUT" in
  ''|*[!0-9]*) TIMEOUT=180 ;;
esac
if [ "$TIMEOUT" -lt 1 ]; then
  TIMEOUT=180
fi
case "$ATTEMPT_TIMEOUT" in
  ''|*[!0-9]*) ATTEMPT_TIMEOUT=180 ;;
esac
if [ "$ATTEMPT_TIMEOUT" -lt 1 ] || [ "$ATTEMPT_TIMEOUT" -gt "$TIMEOUT" ]; then
  ATTEMPT_TIMEOUT="$TIMEOUT"
fi
case "$MAX_ATTEMPTS" in
  ''|*[!0-9]*) MAX_ATTEMPTS=3 ;;
esac
if [ "$MAX_ATTEMPTS" -lt 1 ]; then
  MAX_ATTEMPTS=1
fi
if [ "$MAX_ATTEMPTS" -gt 5 ]; then
  MAX_ATTEMPTS=5
fi
case "$RETRY_DELAY" in
  ''|*[!0-9]*) RETRY_DELAY=5 ;;
esac
if [ "$RETRY_DELAY" -lt 1 ]; then
  RETRY_DELAY=5
fi

if ! command -v jq >/dev/null 2>&1; then
  echo '{"ok":false,"error":"jq is required"}'
  exit 1
fi

if [ ! -f "$DAEMON_PID_FILE" ]; then
  echo '{"ok":false,"error":"fm170_scheduler is not running"}'
  exit 1
fi
daemon_pid="$(cat "$DAEMON_PID_FILE" 2>/dev/null || echo 0)"
case "$daemon_pid" in
  ''|*[!0-9]*) daemon_pid=0 ;;
esac
if [ "$daemon_pid" -le 0 ] || ! kill -0 "$daemon_pid" 2>/dev/null; then
  echo '{"ok":false,"error":"fm170_scheduler is not running"}'
  exit 1
fi

if [ -f "$STATUS_FILE" ]; then
  current_scan_status="$(jq -r '.status // "idle"' "$STATUS_FILE" 2>/dev/null || echo idle)"
  if [ "$current_scan_status" = "starting" ] || [ "$current_scan_status" = "running" ]; then
    echo '{"ok":false,"error":"scan is already running"}'
    exit 1
  fi
fi

mkdir -p "$STATE_DIR"
job_id="fm170-$(date +%s)-$$-$RANDOM-$RANDOM"
created_at="$(date '+%Y-%m-%d %H:%M:%S')"
jq -n \
  --arg jobId "$job_id" \
  --arg trigger "manual" \
  --arg timeout "$TIMEOUT" \
  --arg attemptTimeout "$ATTEMPT_TIMEOUT" \
  --arg maxAttempts "$MAX_ATTEMPTS" \
  --arg retryDelay "$RETRY_DELAY" \
  --arg createdAt "$created_at" \
  '{jobId:$jobId,trigger:$trigger,timeout:($timeout|tonumber),attemptTimeout:($attemptTimeout|tonumber),maxAttempts:($maxAttempts|tonumber),retryDelay:($retryDelay|tonumber),createdAt:$createdAt}' \
  > "$REQUEST_FILE.tmp"
mv "$REQUEST_FILE.tmp" "$REQUEST_FILE"

printf '{"ok":true,"accepted":true,"jobId":"%s","trigger":"manual","status":"running","timeout":%s}\n' \
  "$job_id" "$TIMEOUT"
