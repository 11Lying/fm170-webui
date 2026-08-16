#!/bin/sh

STATE_DIR="${FM170_STATE_DIR:-/tmp/fm170}"
STATUS_FILE="$STATE_DIR/status.json"
ERROR_FILE="$STATE_DIR/status_error.json"
SCAN_STATUS="$STATE_DIR/cellscan_status.json"
SCAN_RESULT="$STATE_DIR/cellscan_result.json"
SCAN_REQUEST="$STATE_DIR/cellscan_request.json"
SCAN_START_LOCK="$STATE_DIR/cellscan_start.lock"
PORTS_FILE="$STATE_DIR/ports.json"
DAEMON_PID_FILE="/var/run/fm170_scheduler.pid"
STATUS_TTL="${FM170_STATUS_TTL:-90}"
SCAN_TIMEOUT="${FM170_SCAN_TIMEOUT:-90}"
SCAN_ATTEMPT_TIMEOUT="${FM170_SCAN_ATTEMPT_TIMEOUT:-90}"
SCAN_MAX_ATTEMPTS="${FM170_SCAN_MAX_ATTEMPTS:-3}"
SCAN_RETRY_DELAY="${FM170_SCAN_RETRY_DELAY:-5}"

case "$SCAN_TIMEOUT" in
  ''|*[!0-9]*) SCAN_TIMEOUT=90 ;;
esac
if [ "$SCAN_TIMEOUT" -lt 1 ]; then
  SCAN_TIMEOUT=90
fi
case "$SCAN_ATTEMPT_TIMEOUT" in
  ''|*[!0-9]*) SCAN_ATTEMPT_TIMEOUT=90 ;;
esac
if [ "$SCAN_ATTEMPT_TIMEOUT" -lt 1 ] || [ "$SCAN_ATTEMPT_TIMEOUT" -gt "$SCAN_TIMEOUT" ]; then
  SCAN_ATTEMPT_TIMEOUT="$SCAN_TIMEOUT"
fi
case "$SCAN_MAX_ATTEMPTS" in
  ''|*[!0-9]*) SCAN_MAX_ATTEMPTS=3 ;;
esac
if [ "$SCAN_MAX_ATTEMPTS" -lt 1 ]; then
  SCAN_MAX_ATTEMPTS=1
fi
if [ "$SCAN_MAX_ATTEMPTS" -gt 5 ]; then
  SCAN_MAX_ATTEMPTS=5
fi
case "$SCAN_RETRY_DELAY" in
  ''|*[!0-9]*) SCAN_RETRY_DELAY=5 ;;
esac
if [ "$SCAN_RETRY_DELAY" -lt 1 ]; then
  SCAN_RETRY_DELAY=5
fi

if ! command -v jq >/dev/null 2>&1; then
  printf 'Content-Type: application/json; charset=utf-8\r\n\r\n'
  printf '{"ok":false,"error":"jq is required"}'
  exit 0
fi

send_json() {
  printf 'Content-Type: application/json; charset=utf-8\r\n'
  printf 'Cache-Control: no-store\r\n'
  printf '\r\n'
  cat
}

json_error() {
  jq -n --arg error "$1" '{ok:false,error:$error}'
}

send_denied() {
  printf 'Status: 403 Forbidden\r\n'
  printf 'Content-Type: application/json; charset=utf-8\r\n'
  printf 'Cache-Control: no-store\r\n'
  printf 'X-LuCI-Login-Required: yes\r\n'
  printf '\r\n'
  jq -n '{ok:false,error:"please login to the router control session",authRequired:true}'
}

query_value=""
query_param() {
  key="$1"
  query_value=""
  pairs="$QUERY_STRING&"
  while [ -n "$pairs" ]; do
    pair="${pairs%%&*}"
    pairs="${pairs#*&}"
    case "$pair" in
      "$key="*) query_value="${pair#*=}"; break ;;
    esac
  done
}

urldecode() {
  value="$1"
  if command -v uhttpd >/dev/null 2>&1; then
    value="$(uhttpd -d "$value")"
  fi
  printf '%s' "$value"
}

session_valid() {
  sid="$1"
  case "$sid" in
    ''|*[!0-9a-fA-F]*) return 1 ;;
  esac
  if [ "${#sid}" != "32" ]; then
    return 1
  fi
  session_out="$(ubus call session get "{\"ubus_rpc_session\":\"$sid\"}" 2>/dev/null)"
  session_user="$(printf '%s' "$session_out" | jq -r '.values.username // ""' 2>/dev/null)"
  session_token="$(printf '%s' "$session_out" | jq -r '.values.token // ""' 2>/dev/null)"
  if [ "$session_user" != "root" ]; then
    return 1
  fi
  case "$session_token" in
    fm170-*) return 0 ;;
  esac
  return 1
}

require_auth() {
  query_param sid
  SID="$(urldecode "$query_value")"
  if ! session_valid "$SID"; then
    send_denied
    exit 0
  fi
}

daemon_running() {
  [ -f "$DAEMON_PID_FILE" ] || return 1
  daemon_pid="$(cat "$DAEMON_PID_FILE" 2>/dev/null || echo 0)"
  case "$daemon_pid" in
    ''|*[!0-9]*) daemon_pid=0 ;;
  esac
  [ "$daemon_pid" -gt 0 ] || return 1
  kill -0 "$daemon_pid" 2>/dev/null
}

scan_status_is_stale() {
  [ -f "$SCAN_STATUS" ] || return 1
  current_scan_status="$(jq -r '.status // "idle"' "$SCAN_STATUS" 2>/dev/null || echo idle)"
  case "$current_scan_status" in
    starting|running) ;;
    *) return 1 ;;
  esac

  if ! daemon_running; then
    return 0
  fi

  status_epoch="$(jq -r '.epoch // 0' "$SCAN_STATUS" 2>/dev/null || echo 0)"
  case "$status_epoch" in
    ''|*[!0-9]*) status_epoch=0 ;;
  esac
  if [ "$status_epoch" -le 0 ]; then
    return 1
  fi
  now_epoch="$(date +%s)"
  [ $((now_epoch - status_epoch)) -gt 200 ]
}

mark_scan_stale() {
  [ -f "$SCAN_STATUS" ] || return 0
  now_text="$(date '+%Y-%m-%d %H:%M:%S')"
  tmp_file="$SCAN_STATUS.tmp"
  jq --arg error "scheduler unavailable or scan job is stale" --arg finishedAt "$now_text" \
    '.status = "timeout" | .error = $error | .finishedAt = $finishedAt | .elapsed = .timeout' \
    "$SCAN_STATUS" > "$tmp_file"
  mv "$tmp_file" "$SCAN_STATUS"
  rm -f "$SCAN_REQUEST"
}

status_payload() {
  if [ ! -f "$STATUS_FILE" ]; then
    if [ -f "$ERROR_FILE" ]; then
      daemon_error="$(jq -r '.error // "status daemon has not reported yet"' "$ERROR_FILE" 2>/dev/null || echo "status daemon has not reported yet")"
    else
      daemon_error="status daemon has not reported yet"
    fi
    jq -n --arg error "$daemon_error" '{ok:true,fresh:false,error:$error,raw:{}}'
    return
  fi

  status_epoch="$(jq -r '.epoch // 0' "$STATUS_FILE" 2>/dev/null || echo 0)"
  error_epoch="$(jq -r '.epoch // 0' "$ERROR_FILE" 2>/dev/null || echo 0)"
  if [ "$error_epoch" -gt "$status_epoch" ]; then
    daemon_error="$(jq -r '.error // "status query failed"' "$ERROR_FILE" 2>/dev/null || echo "status query failed")"
    jq --arg error "$daemon_error" '.ok = true | .fresh = false | .error = $error' "$STATUS_FILE"
    return
  fi

  now_epoch="$(date +%s)"
  age=$((now_epoch - status_epoch))
  if [ "$age" -le "$STATUS_TTL" ] && [ "$(jq -r '.fresh // "false"' "$STATUS_FILE" 2>/dev/null)" = "true" ]; then
    cat "$STATUS_FILE"
    return
  fi
  jq --arg error "status data is stale" '.ok = true | .fresh = false | .error = $error' "$STATUS_FILE"
}

cellscan_status_payload() {
  if [ ! -f "$SCAN_STATUS" ]; then
    jq -n \
      --arg timeout "$SCAN_TIMEOUT" \
      --arg attemptTimeout "$SCAN_ATTEMPT_TIMEOUT" \
      --arg retryDelay "$SCAN_RETRY_DELAY" \
      --arg maxAttempts "$SCAN_MAX_ATTEMPTS" \
      --arg port "${FM170_PORT_B:-/dev/ttyUSB1}" \
      '{ok:true,jobId:"",status:"idle",trigger:"manual",startedAt:null,elapsed:0,finishedAt:null,resultCount:0,error:"",timeout:($timeout|tonumber),attemptTimeout:($attemptTimeout|tonumber),retryDelay:($retryDelay|tonumber),attempts:0,maxAttempts:($maxAttempts|tonumber),port:$port,raw:""}'
    return
  fi
  if scan_status_is_stale; then
    mark_scan_stale
  fi
  current_scan_status="$(jq -r '.status // "idle"' "$SCAN_STATUS" 2>/dev/null || echo idle)"
  if [ "$current_scan_status" = "starting" ] || [ "$current_scan_status" = "running" ]; then
    started_epoch="$(jq -r '.epoch // 0' "$SCAN_STATUS" 2>/dev/null || echo 0)"
    case "$started_epoch" in
      ''|*[!0-9]*) started_epoch=0 ;;
    esac
    now_epoch="$(date +%s)"
    elapsed=0
    if [ "$started_epoch" -gt 0 ] && [ "$now_epoch" -ge "$started_epoch" ]; then
      elapsed=$((now_epoch - started_epoch))
    fi
    jq --argjson elapsed "$elapsed" '.elapsed = $elapsed' "$SCAN_STATUS"
  else
    cat "$SCAN_STATUS"
  fi
}

cellscan_result_payload() {
  if [ ! -f "$SCAN_RESULT" ]; then
    jq -n '{ok:true,status:"idle",jobId:"",startedAt:null,finishedAt:null,duration:0,resultCount:0,raw:"",cells:[],parserError:""}'
    return
  fi
  cat "$SCAN_RESULT"
}

scheduler_status_payload() {
  if [ ! -f "$PORTS_FILE" ]; then
    jq -n \
      --arg portA "${FM170_PORT_A:-/dev/ttyUSB2}" \
      --arg portB "${FM170_PORT_B:-/dev/ttyUSB1}" \
      '{ok:true,A:{state:"disconnected",currentCommand:"",currentJobId:"",port:$portA,startedAt:"",lastActivity:"",lastError:""},B:{state:"disconnected",currentCommand:"",currentJobId:"",port:$portB,startedAt:"",lastActivity:"",lastError:""},updatedAt:""}'
    return
  fi
  cat "$PORTS_FILE"
}

cellscan_start() {
  if [ "${REQUEST_METHOD:-GET}" != "POST" ]; then
    json_error "cellscan_start requires POST"
    exit 0
  fi
  (
    exec 9>"$SCAN_START_LOCK"
    if ! flock -n 9; then
      json_error "scan start is busy"
      exit 0
    fi

    if [ -f "$SCAN_STATUS" ]; then
      current_scan_status="$(jq -r '.status // "idle"' "$SCAN_STATUS" 2>/dev/null || echo idle)"
      if [ "$current_scan_status" = "starting" ] || [ "$current_scan_status" = "running" ]; then
        if scan_status_is_stale; then
          mark_scan_stale
        else
          current_scan_job_id="$(jq -r '.jobId // ""' "$SCAN_STATUS" 2>/dev/null || echo "")"
          current_scan_trigger="$(jq -r '.trigger // "manual"' "$SCAN_STATUS" 2>/dev/null || echo manual)"
          current_scan_elapsed="$(jq -r '.elapsed // 0' "$SCAN_STATUS" 2>/dev/null || echo 0)"
          current_scan_timeout="$(jq -r '.timeout // 180' "$SCAN_STATUS" 2>/dev/null || echo 180)"
          jq -n \
            --arg jobId "$current_scan_job_id" \
            --arg status "already_running" \
            --arg trigger "$current_scan_trigger" \
            --arg elapsed "$current_scan_elapsed" \
            --arg timeout "$current_scan_timeout" \
            --arg port "${FM170_PORT_B:-/dev/ttyUSB1}" \
            '{ok:true,status:$status,jobId:$jobId,trigger:$trigger,elapsed:($elapsed|tonumber),timeout:($timeout|tonumber),port:$port}'
          exit 0
        fi
      fi
    fi

    if ! daemon_running; then
      json_error "AT scheduler is not running"
      exit 0
    fi

    job_id="fm170-$(date +%s)-$$-$RANDOM-$RANDOM"
    started_text="$(date '+%Y-%m-%d %H:%M:%S')"
    started_epoch="$(date +%s)"
    jq -n \
      --arg jobId "$job_id" \
      --arg trigger "manual" \
      --arg timeout "$SCAN_TIMEOUT" \
      --arg attemptTimeout "$SCAN_ATTEMPT_TIMEOUT" \
      --arg maxAttempts "$SCAN_MAX_ATTEMPTS" \
      --arg createdAt "$started_text" \
      '{jobId:$jobId,trigger:$trigger,timeout:($timeout|tonumber),attemptTimeout:($attemptTimeout|tonumber),maxAttempts:($maxAttempts|tonumber),createdAt:$createdAt}' \
      > "$SCAN_REQUEST.tmp"
    mv "$SCAN_REQUEST.tmp" "$SCAN_REQUEST"

    jq -n \
      --arg jobId "$job_id" \
      --arg status "starting" \
      --arg trigger "manual" \
      --arg startedAt "$started_text" \
      --arg timeout "$SCAN_TIMEOUT" \
      --arg attemptTimeout "$SCAN_ATTEMPT_TIMEOUT" \
      --arg maxAttempts "$SCAN_MAX_ATTEMPTS" \
      --arg retryDelay "$SCAN_RETRY_DELAY" \
      --arg epoch "$started_epoch" \
      --arg port "${FM170_PORT_B:-/dev/ttyUSB1}" \
      '{ok:true,jobId:$jobId,status:$status,trigger:$trigger,startedAt:$startedAt,elapsed:0,finishedAt:null,resultCount:0,error:"",timeout:($timeout|tonumber),attemptTimeout:($attemptTimeout|tonumber),retryDelay:($retryDelay|tonumber),maxAttempts:($maxAttempts|tonumber),attempts:1,port:$port,updatedAt:$startedAt,epoch:($epoch|tonumber),raw:""}' \
      > "$SCAN_STATUS.tmp"
    mv "$SCAN_STATUS.tmp" "$SCAN_STATUS"

    jq -n \
      --arg jobId "$job_id" \
      --arg trigger "manual" \
      --arg startedAt "$started_text" \
      --arg timeout "$SCAN_TIMEOUT" \
      --arg port "${FM170_PORT_B:-/dev/ttyUSB1}" \
      '{ok:true,jobId:$jobId,status:"running",trigger:$trigger,startedAt:$startedAt,elapsed:0,timeout:($timeout|tonumber),port:$port}'
  ) 9>"$SCAN_START_LOCK"
}


sms_status_payload() {
  SMS_CACHE="${FM170_STATE_DIR:-/tmp/fm170}/sms_messages.json"
  if [ -f "$SMS_CACHE" ] && [ -s "$SMS_CACHE" ]; then
    messages="$(cat "$SMS_CACHE" 2>/dev/null)"
    # 仅当缓存是合法 JSON 数组时使用；否则视为空（避免一次失败/半写缓存让整个 SMS API 报错）
    if printf '%s' "$messages" | jq -e 'type=="array"' >/dev/null 2>&1; then
      unread="$(printf '%s' "$messages" | jq '[.[] | select(.status=="REC UNREAD")] | length' 2>/dev/null || echo 0)"
      jq -n --argjson u "$unread" --argjson m "$messages" '{ok:true,unread:$u,messages:$m}'
    else
      jq -n '{ok:true,unread:0,messages:[]}'
    fi
  else
    jq -n '{ok:true,unread:0,messages:[]}'
  fi
}


case "$QUERY_STRING" in
  *action=ping*)
    jq -n --arg now "$(date '+%Y-%m-%d %H:%M:%S')" '{ok:true,action:"ping",now:$now}' | send_json
    ;;
  *action=cellscan_status*|*action=scan_status*)
    cellscan_status_payload | send_json
    ;;
  *action=cellscan_result*)
    cellscan_result_payload | send_json
    ;;
  *action=cellscan_start*|*action=scan_start*)
    require_auth
    cellscan_start | send_json
    ;;
  *action=scheduler_status*|*action=port_status*)
    scheduler_status_payload | send_json
    ;;
  *action=autoscan*)
    jq -n '{ok:true,enabled:false}' | send_json
    ;;

  *action=sms_status*|*action=sms_list*)
    sms_status_payload | send_json
    ;;
  *action=sms_read*)
    query_param index
    IDX="$(urldecode "$query_value")"
    case "$IDX" in ''|*[!0-9]*) json_error "index required" | send_json;; esac
    OUT="$(/usr/sbin/fm170_sms_check.sh read "$IDX" 2>/dev/null)"
    jq -n --arg raw "$OUT" --arg index "$IDX" '{ok:true,index:$index,raw:$raw}' | send_json
    ;;
  *action=sms_delete*)
    query_param index
    IDX="$(urldecode "$query_value")"
    case "$IDX" in ''|*[!0-9]*) json_error "index required" | send_json;; esac
    /usr/sbin/fm170_sms_check.sh delete "$IDX" >/dev/null 2>&1
    sms_status_payload | send_json
    ;;
  *action=sms_delete_all*)
    /usr/sbin/fm170_sms_check.sh delete_all >/dev/null 2>&1
    sms_status_payload | send_json
    ;;
  *action=sms_refresh*)
    /usr/sbin/fm170_sms_check.sh poll >/dev/null 2>&1
    sms_status_payload | send_json
    ;;
  *action=status*|*)
    status_payload | send_json
    ;;
esac
