#!/bin/sh

STATE_DIR="${FM170_STATE_DIR:-/tmp/fm170}"
CTRL_QUEUE="$STATE_DIR/control"
SCAN_STATUS="$STATE_DIR/cellscan_status.json"
PORTS_FILE="$STATE_DIR/ports.json"
DAEMON_PID_FILE="/var/run/fm170_scheduler.pid"

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

session_login() {
  username="$1"
  password="$2"
  login_json="$(jq -nc --arg username "$username" --arg password "$password" '{username:$username,password:$password,timeout:3600}')"
  login_out="$(ubus call session login "$login_json" 2>/dev/null)"
  sid="$(printf '%s' "$login_out" | jq -r '.ubus_rpc_session // ""' 2>/dev/null)"
  [ -z "$sid" ] && return 1
  token="fm170-$(date +%s)-$$-$RANDOM-$RANDOM"
  ubus call session set "{\"ubus_rpc_session\":\"$sid\",\"values\":{\"token\":\"$token\"}}" >/dev/null 2>&1
  printf '%s' "$sid"
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

# FM170 WebUI 控制接口不启用 LuCI/session 登录；访问控制交给路由器局域网和防火墙。
# 保留函数名以兼容已有调用方，但不再要求 sid，也不再弹出控制登录。
require_auth() {
  SID=""
  return 0
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

scan_is_active() {
  [ -f "$SCAN_STATUS" ] || return 1
  current_scan_status="$(jq -r '.status // "idle"' "$SCAN_STATUS" 2>/dev/null || echo idle)"
  case "$current_scan_status" in
    starting|running) return 0 ;;
  esac
  return 1
}

command_conflicts_with_scan() {
  cmd="$1"
  case "$cmd" in
    AT+GTCELLLOCK=*|AT+GTFREQLOCK=*|AT+GTACT=*|AT+GTPLMNLOCK=*|AT+CFUN=*) return 0 ;;
  esac
  return 1
}

submit_control_request() {
  command="$1"
  timeout_seconds="$2"
  action="$3"
  request_id="fm170-$(date +%s)-$$-$RANDOM-$RANDOM"
  response_file="$CTRL_QUEUE/resp-$request_id.json"
  request_file="$CTRL_QUEUE/req-$request_id.json"
  mkdir -p "$CTRL_QUEUE"
  jq -n \
    --arg command "$command" \
    --arg timeout "$timeout_seconds" \
    --arg responseFile "$response_file" \
    --arg action "$action" \
    --arg createdAt "$(date '+%Y-%m-%d %H:%M:%S')" \
    '{command:$command,timeout:($timeout|tonumber),responseFile:$responseFile,action:$action,createdAt:$createdAt}' \
    > "$request_file"

  deadline=$(( $(date +%s) + timeout_seconds + 10 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if [ -f "$response_file" ]; then
      cat "$response_file"
      return 0
    fi
    sleep 1
  done
  json_error "AT scheduler did not respond"
}

send_control() {
  command="$1"
  timeout_seconds="${2:-8}"
  retry_command="${3:-}"

  if ! daemon_running; then
    json_error "AT scheduler is not running"
    return 0
  fi
  if command_conflicts_with_scan "$command" && scan_is_active; then
    json_error "小区扫描进行中，请等待扫描完成后再修改网络配置。"
    return 0
  fi

  first_response="$(submit_control_request "$command" "$timeout_seconds" "control")"
  case "$first_response" in
    *'"ok":false'*)
      if [ -n "$retry_command" ] && printf '%s' "$first_response" | grep -q 'AT returned ERROR'; then
        second_response="$(submit_control_request "$retry_command" "$timeout_seconds" "control_retry")"
        jq -n \
          --argjson first "$first_response" \
          --argjson second "$second_response" \
          --arg retryCommand "$retry_command" \
          '{ok:$second.ok,command:$first.command,raw:$second.raw,retried:true,attempts:2,retryCommand:$retryCommand,retryRaw:$first.raw}'
        return 0
      fi
      printf '%s' "$first_response"
      return 0
      ;;
  esac
  printf '%s' "$first_response"
}

numeric_param() {
  key="$1"
  query_param "$key"
  PARAM_VALUE="$(urldecode "$query_value")"
  case "$PARAM_VALUE" in
    ''|*[!0-9]*) return 1 ;;
  esac
  return 0
}

string_param() {
  key="$1"
  query_param "$key"
  PARAM_VALUE="$(urldecode "$query_value")"
  return 0
}


# 锁/解锁命令公共执行：发命令 -> CFUN=15 生效 -> 回读验证 GTCELLLOCK。
# CFUN=15 让锁/解锁真正生效(重新注册)，否则锁不生效。
exec_lock_cfun() {
  cmd="$1"
  resp="$(send_control "$cmd" 8)"
  ok_flag="$(printf '%s' "$resp" | jq -r '.ok' 2>/dev/null)"
  if [ "$ok_flag" != "true" ]; then
    printf '%s' "$resp"
    return 1
  fi
  # 锁/解锁后必须 CFUN=15 重新注册才真正生效
  cfun="$(send_control "AT+CFUN=15" 20)"
  cfun_ok="$(printf '%s' "$cfun" | jq -r '.ok' 2>/dev/null)"
  # 回读验证 GTCELLLOCK 配置
  verify="$(send_control "AT+GTCELLLOCK?" 6)"
  if [ "$cfun_ok" = "true" ]; then
    printf '%s' "$verify"
  else
    # CFUN 未确认OK也尽力返回验证(不因CFUN卡住而丢结果)
    printf '%s' "$verify"
  fi
  return 0
}

do_cell_lock() {
  # 依据 Fibocom FM160/FG160 AT 手册 V1.3 §5.16 +GTCELLLOCK
  #   AT+GTCELLLOCK=<mode>[,<rat>,<type>,<earfcn>[,<PCI>][,<scs>][,<nrband>]]
  #   mode: 0=关 1=开 ; rat: 0=LTE 1=NR ; type: 0=锁PCI 1=锁频点
  #   LTE 锁PCI:  AT+GTCELLLOCK=1,0,0,<EARFCN>,<PCI>
  #   LTE 锁频:   AT+GTCELLLOCK=1,0,1,<EARFCN>
  #   NR 锁PCI:   AT+GTCELLLOCK=1,1,0,<NRARFCN>,<PCI>,<SCS>,<NRBAND>
  #   NR 锁频:    AT+GTCELLLOCK=1,1,1,<NRARFCN>,,<SCS>   （PCI 为空必须保留占位，且不追加 nrband）
  numeric_param rat || { json_error "rat parameter is invalid"; return; }
  RAT="$PARAM_VALUE"
  numeric_param type || { json_error "type parameter is invalid"; return; }
  TYPE="$PARAM_VALUE"
  numeric_param arfcn || { json_error "arfcn parameter is invalid"; return; }
  ARFCN="$PARAM_VALUE"
  numeric_param pci || { json_error "pci parameter is invalid"; return; }
  PCI="$PARAM_VALUE"
  numeric_param scs || { json_error "scs parameter is invalid"; return; }
  SCS="$PARAM_VALUE"
  numeric_param band || { json_error "band parameter is invalid"; return; }
  BAND="$PARAM_VALUE"

  case "$RAT" in
    0|1) ;;
    *) json_error "rat supports 0=LTE / 1=NR"; return ;;
  esac
  case "$TYPE" in
    0|1) ;;
    *) json_error "type supports 0=PCI / 1=frequency"; return ;;
  esac

  CMD=""
  if [ "$RAT" = "1" ]; then
    # NR
    case "$SCS" in
      0|1) ;;
      *) json_error "scs for NR 0=15kHz / 1=30kHz"; return ;;
    esac
    # 将普通 NR band 数字转换为手册定义的 nrband 编码
    #   band<10 -> 500+band ; 10<=band<100 -> 5000+band ; band>=100 -> 50000+band
    if [ "$BAND" -lt 500 ]; then
      if [ "$BAND" -ge 100 ]; then
        BAND=$((50000 + BAND))
      elif [ "$BAND" -ge 10 ]; then
        BAND=$((5000 + BAND))
      else
        BAND=$((500 + BAND))
      fi
    fi
    if [ "$TYPE" = "1" ]; then
      # NR 锁频点：PCI 为空必须保留占位，末尾只到 <scs>，不追加 nrband（实测追加 nrband 会 ERROR）
      CMD="AT+GTCELLLOCK=1,1,1,$ARFCN,,$SCS"
    else
      # NR 锁 PCI
      CMD="AT+GTCELLLOCK=1,1,0,$ARFCN,$PCI,$SCS,$BAND"
    fi
  else
    # LTE
    if [ "$TYPE" = "1" ]; then
      CMD="AT+GTCELLLOCK=1,0,1,$ARFCN"
    else
      CMD="AT+GTCELLLOCK=1,0,0,$ARFCN,$PCI"
    fi
  fi

  # 执行锁命令 + CFUN=15 生效 + 回读验证（exec_lock_cfun 内部处理）
  exec_lock_cfun "$CMD"
}
do_cell_unlock() {
  # 统一解锁：AT+GTCELLLOCK=0 + CFUN=15
  exec_lock_cfun "AT+GTCELLLOCK=0"
}

do_multi_cell_lock() {
  numeric_param rat || { json_error "rat parameter is invalid"; return; }
  RAT="$PARAM_VALUE"
  numeric_param count || { json_error "count parameter is invalid"; return; }
  COUNT="$PARAM_VALUE"
  string_param pairs
  PAIRS="$PARAM_VALUE"
  case "$PAIRS" in
    ''|*[!0-9,]*) json_error "pairs parameter is invalid"; return ;;
  esac
  case "$RAT" in
    0|1) ;;
    *) json_error "rat supports 0=LTE / 1=NR"; return ;;
  esac
  exec_lock_cfun "AT+GTFREQLOCK=$RAT,$COUNT,$PAIRS"
}

do_multi_cell_unlock() {
  # 按统一要求：多区解锁也用 AT+GTCELLLOCK=0 + CFUN=15
  exec_lock_cfun "AT+GTCELLLOCK=0"
}

do_network_mode() {
  string_param mode
  MODE="$PARAM_VALUE"
  case "$MODE" in
    2|3|4|10|14|16|17|20) ;;
    *) json_error "mode supports 2/3/4/10/14/16/17/20"; return ;;
  esac
  # 全模式: 强制准确发送字面量 AT+GTACT=10 (查询显示20是模组固件归一化, 发送仍是10)
  if [ "$MODE" = "10" ]; then
    send_control "AT+GTACT=10" 12
  else
    send_control "AT+GTACT=$MODE" 12
  fi
}

do_band_lock() {
  string_param bands
  BANDS="$PARAM_VALUE"
  case "$BANDS" in
    ''|*[!0-9,]*) json_error "bands parameter is invalid"; return ;;
  esac
  string_param rat
  RAT="$PARAM_VALUE"
  case "$RAT" in
    ''|2|3|4|10|14|16|17|20) ;;
    *) json_error "rat parameter is invalid"; return ;;
  esac
  # FM160 要求 GTACT 带 RAT，纯 "AT+GTACT=,,,<bands>" 会返回 ERROR；带当前 RAT 才能生效
  if [ -n "$RAT" ]; then
    send_control "AT+GTACT=$RAT,,,$BANDS" 12
  else
    send_control "AT+GTACT=,,,$BANDS" 12
  fi
}

do_plmn_lock() {
  numeric_param enabled || { json_error "enabled parameter is invalid"; return; }
  ENABLED="$PARAM_VALUE"
  string_param plmn
  PLMN="$PARAM_VALUE"
  case "$ENABLED" in
    0|1) ;;
    *) json_error "enabled supports 0 / 1"; return ;;
  esac
  if [ "$ENABLED" = "1" ]; then
    if [ -z "$PLMN" ]; then
      PLMN="46011"
    fi
    case "$PLMN" in
      ''|*[!0-9]*) json_error "PLMN parameter is invalid"; return ;;
    esac
    CMD="AT+GTPLMNLOCK=1,\"$PLMN\""
  else
    CMD="AT+GTPLMNLOCK=0"
  fi
  send_control "$CMD" 8
}

do_cellinfo_mode() {
  numeric_param enabled || { json_error "enabled parameter is invalid"; return; }
  ENABLED="$PARAM_VALUE"
  case "$ENABLED" in
    0|1) ;;
    *) json_error "enabled supports 0 / 1"; return ;;
  esac
  send_control "AT+GTCELLINFO=$ENABLED" 8
}

do_restart() {
  string_param confirm
  CONFIRM="$PARAM_VALUE"
  if [ "$CONFIRM" != "1" ]; then
    json_error "restart requires confirm=1"
    return
  fi
  send_control "AT+CFUN=1,1" 20
}

do_at() {
  string_param cmd
  AT_CMD="$PARAM_VALUE"
  # 允许任意单行 AT 指令，禁止 shell/多行注入；实际执行仍由 scheduler 串口队列完成
  case "$AT_CMD" in
    AT*|at*) ;;
    *) json_error "AT 指令必须以 AT 开头"; return ;;
  esac
  if printf '%s' "$AT_CMD" | grep -q '[[:cntrl:]&|;`$()]'; then
    json_error "AT 指令包含非法字符"
    return
  fi
  if [ "${#AT_CMD}" -gt 256 ]; then
    json_error "AT 指令过长（最多 256 字符）"
    return
  fi
  resp="$(send_control "$AT_CMD" "${AT_TIMEOUT:-12}")"
  jq -n --arg cmd "$AT_CMD" --argjson r "$resp" '{ok:($r.ok // false),command:$cmd,raw:($r.raw // ""),error:($r.error // "")} '
}

do_query() {
  string_param query
  QUERY="$PARAM_VALUE"
  case "$QUERY" in
    celllock) CMD="AT+GTCELLLOCK?" ;;
    gtact) CMD="AT+GTACT?" ;;
    plmnlock) CMD="AT+GTPLMNLOCK?" ;;
    cellinfo) CMD="AT+GTCELLINFO?" ;;
    rat) CMD="AT+GTRAT?" ;;
    cgreg) CMD="AT+CGREG?" ;;
    cereg) CMD="AT+CEREG?" ;;
    c5greg) CMD="AT+C5GREG?" ;;
    cops) CMD="AT+COPS?" ;;
    cesq) CMD="AT+CESQ" ;;
    gmm) CMD="AT+CGMM?" ;;
    gmr) CMD="AT+CGMR?" ;;
    gtccinfo) CMD="AT+GTCCINFO?" ;;
    gtca) CMD="AT+GTCAINFO?" ;;
    cfun15) CMD="AT+CFUN=15" ;;
    cfun15_query) CMD="AT+CFUN?" ;;
    *) json_error "query parameter is invalid"; return ;;
  esac
  if [ "$QUERY" = "cfun15" ]; then
    send_control "$CMD" 20
  else
    send_control "$CMD" 6
  fi
}


# ===== SMS 接收功能（增量，复用现有 Port A 控制队列）=====
sms_ensure_text() {
  resp="$(send_control "AT+CMGF?" 5)"
  case "$resp" in
    *"AT+CMGF: 0"*)
      send_control "AT+CMGF=1" 5 >/dev/null 2>&1 ;;
  esac
}

# 解析 Text-Mode CMGL/CMGR，输出 index<TAB>number<TAB>datetime<TAB>text（多行正文用字面 \n 连接）
sms_parse_at() {
  printf '%s' "$1" | awk '
    function emit(){ if(have && idx!="") print idx "\t" num "\t" dt "\t" txt; have=0; idx=""; txt="" }
    /^\+CMGL:[ ]*/ { emit(); p=$0; sub(/^\+CMGL:[ ]*/,"",p); n=split(p,a,","); idx=a[1]; gsub(/[ \"]/,"",idx); num=a[3]; gsub(/"/,"",num); dt=a[5] "," a[6]; gsub(/"/,"",dt); have=1; next }
    /^\+CMGR:[ ]*/ { emit(); p=$0; sub(/^\+CMGR:[ ]*/,"",p); n=split(p,a,","); idx=a[1]; gsub(/[ \"]/,"",idx); num=a[3]; gsub(/"/,"",num); dt=a[5] "," a[6]; gsub(/"/,"",dt); have=1; next }
    /^OK$/ { emit(); have=0; next }
    /^ERROR/ { have=0; next }
    /^AT\+/ { next }
    { if(have && idx!=""){ if(txt=="" && $0 ~ /^[ \t]*$/) next; txt = txt (txt==""?"":"\\n") $0 } }
  '
}

do_sms_list() {
  string_param stat
  STAT="${PARAM_VALUE:-ALL}"
  case "$STAT" in
    0|1|2|3|4|ALL|"REC UNREAD"|"REC READ") ;;
    *) json_error "stat parameter is invalid"; return ;;
  esac
  sms_ensure_text
  case "$STAT" in
    0|"REC UNREAD") CMD="AT+CMGL=\"REC UNREAD\"" ;;
    1|"REC READ") CMD="AT+CMGL=\"REC READ\"" ;;
    2) CMD="AT+CMGL=\"STO UNSENT\"" ;;
    3) CMD="AT+CMGL=\"STO SENT\"" ;;
    *) CMD="AT+CMGL=\"ALL\"" ;;
  esac
  resp="$(send_control "$CMD" 10)"
  ok_flag="$(printf '%s' "$resp" | jq -r '.ok')"
  if [ "$ok_flag" != "true" ]; then
    printf '%s' "$resp"
    return
  fi
  raw="$(printf '%s' "$resp" | jq -r '.raw // ""' 2>/dev/null)"
  TMPF="/tmp/fm170_sms_entries.$$"
  sms_parse_at "$raw" > "$TMPF" 2>/dev/null
  msgs="["
  sep=""
  while IFS= read -r entry; do
    [ -z "$entry" ] && continue
    idx="$(printf '%s' "$entry" | cut -f1)"
    num="$(printf '%s' "$entry" | cut -f2)"
    dt="$(printf '%s' "$entry" | cut -f3)"
    text="$(printf '%s' "$entry" | cut -f4-)"
    msgs="$msgs$sep$(jq -nc --arg index "$idx" --arg number "$num" --arg datetime "$dt" --arg text "$text" '{index:$index,number:$number,datetime:$datetime,text:$text,read:false}')"
    sep=","
  done < "$TMPF"
  rm -f "$TMPF"
  msgs="$msgs]"
  jq -n --arg stat "$STAT" --argjson messages "$msgs" --arg raw "$raw" '{ok:true,stat:$stat,messages:$messages,raw:$raw}'
}

do_sms_read() {
  numeric_param index || { json_error "index parameter is invalid"; return; }
  INDEX="$PARAM_VALUE"
  sms_ensure_text
  resp="$(send_control "AT+CMGR=$INDEX" 8)"
  ok_flag="$(printf '%s' "$resp" | jq -r '.ok')"
  if [ "$ok_flag" != "true" ]; then
    printf '%s' "$resp"
    return
  fi
  raw="$(printf '%s' "$resp" | jq -r '.raw // ""' 2>/dev/null)"
  number=""
  datetime=""
  text=""
  TMPF="/tmp/fm170_sms_entries.$$"
  sms_parse_at "$raw" > "$TMPF" 2>/dev/null
  while IFS= read -r entry; do
    [ -z "$entry" ] && continue
    number="$(printf '%s' "$entry" | cut -f2)"
    datetime="$(printf '%s' "$entry" | cut -f3)"
    text="$(printf '%s' "$entry" | cut -f4-)"
  done < "$TMPF"
  rm -f "$TMPF"
  jq -n --arg index "$INDEX" --arg number "$number" --arg datetime "$datetime" --arg text "$text" --arg raw "$raw" '{ok:true,index:$index,number:$number,datetime:$datetime,text:$text,raw:$raw}'
}

do_sms_delete() {
  numeric_param index || { json_error "index parameter is invalid"; return; }
  INDEX="$PARAM_VALUE"
  resp="$(send_control "AT+CMGD=$INDEX" 8)"
  ok_flag="$(printf '%s' "$resp" | jq -r '.ok')"
  if [ "$ok_flag" != "true" ]; then
    printf '%s' "$resp"
    return
  fi
  jq -n --arg index "$INDEX" '{ok:true,index:$index}'
}

do_sms_config() {
  # 尽力设置 CNMI=1,1（新短信存内存并上报通知）。不解析/不删除，失败不影响其它功能。
  resp="$(send_control "AT+CNMI=1,1" 6)"
  jq -n --argjson r "$resp" '{ok:true,raw:($r.raw // "")}'
}

do_sms_probe() {
  # 一次性逐条发送 SMS 能力 AT 命令，记录每条真实 TX/RX（只用现有控制队列）。
  TMPF="/tmp/fm170_sms_probe.$$"
  rm -f "$TMPF"
  probe_one() {
    cmd="$1"
    want_ok="$2"   # 1=期望OK即可算可达; 0=只看原始RX
    tmo="$3"
    resp="$(send_control "$cmd" "$tmo")"
    tx="$(printf '%s' "$cmd")$NL"
    okflag="$(printf '%s' "$resp" | jq -r '.ok')"
    rx="$(printf '%s' "$resp" | jq -r '.raw // ""' 2>/dev/null)"
    case "$rx" in
      *OK*) rxs="OK" ;;
      *ERROR*) rxs="ERROR" ;;
      "") if [ "$okflag" = "true" ]; then rxs="(no raw / ok)"; else rxs="(scheduler no-respond)"; fi ;;
      *) rxs="(raw)" ;;
    esac
    printf '%s	%s	%s
' "$cmd" "$rxs" "$rx" >> "$TMPF"
  }
  probe_one "AT+CMGF=?" 1 5
  probe_one "AT+CMGF?" 1 5
  probe_one "AT+CPMS=?" 1 5
  probe_one "AT+CPMS?" 1 5
  probe_one "AT+CNMI=?" 1 5
  probe_one "AT+CNMI?" 1 5
  probe_one "AT+CSMS=?" 1 5
  probe_one "AT+CSMS?" 1 5
  probe_one "AT+CMGL=?" 1 6
  probe_one "AT+CMGR=?" 1 6
  probe_one "AT+CMGD=?" 1 5
  probe_one "AT+CSCA?" 1 5
  probe_one "AT+CGREG?" 1 5
  probe_one "AT+CEREG?" 1 5
  probe_one "AT+CREG?" 1 5
  probe_one "AT+CMGF=1" 1 5
  jq -n --rawfile probe "$TMPF" --arg rawProbe "$(cat "$TMPF" 2>/dev/null)" '{ok:true,probe:$probe,rawProbe:$rawProbe}'
  rm -f "$TMPF"
}



do_sms_at() {
  string_param cmd
  CMD="$PARAM_VALUE"
  case "$CMD" in
    ""|*AT*) ;;
    AT) ;;
    *) CMD="AT$CMD" ;;
  esac
  timeout="${FM170_SMS_AT_TIMEOUT:-6}"
  if numeric_param timeout; then
    timeout="$PARAM_VALUE"
  fi
  resp="$(send_control "$CMD" "$timeout")"
  jq -n --argjson r "$resp" --arg cmd "$CMD" '{ok:true,cmd:$cmd,raw:($r.raw // ""),err:($r.error // "")}'
}


case "$QUERY_STRING" in
  *action=ping*)
    jq -n --arg now "$(date '+%Y-%m-%d %H:%M:%S')" '{ok:true,action:"ping",now:$now}' | send_json
    ;;
  *action=port_status*|*action=scheduler_status*)
    if [ -f "$PORTS_FILE" ]; then
      cat "$PORTS_FILE" | send_json
    else
      jq -n '{ok:true,A:{state:"disconnected",currentCommand:"",currentJobId:"",port:"/dev/ttyUSB2",startedAt:"",lastActivity:"",lastError:""},B:{state:"disconnected",currentCommand:"",currentJobId:"",port:"/dev/ttyUSB1",startedAt:"",lastActivity:"",lastError:""},updatedAt:""}' | send_json
    fi
    ;;
  *action=login*)
    string_param username
    USERNAME="$PARAM_VALUE"
    string_param password
    PASSWORD="$PARAM_VALUE"
    SID="$(session_login "$USERNAME" "$PASSWORD")"
    if [ -n "$SID" ]; then
      jq -n --arg sid "$SID" '{ok:true,sid:$sid}' | send_json
    else
      json_error "username or password is incorrect" | send_json
    fi
    ;;
  *action=session_check*)
    require_auth
    jq -n --arg sid "$SID" '{ok:true,authenticated:true,sid:$sid}' | send_json
    ;;
  *action=logout*)
    require_auth
    ubus call session destroy "{\"ubus_rpc_session\":\"$SID\"}" >/dev/null 2>&1
    jq -n '{ok:true}' | send_json
    ;;
  *action=cell_lock*)
    require_auth
    do_cell_lock | send_json
    ;;
  *action=cell_unlock*)
    require_auth
    do_cell_unlock | send_json
    ;;
  *action=multi_cell_lock*)
    require_auth
    do_multi_cell_lock | send_json
    ;;
  *action=multi_cell_unlock*)
    require_auth
    do_multi_cell_unlock | send_json
    ;;
  *action=network_mode*)
    require_auth
    do_network_mode | send_json
    ;;
  *action=band_lock*)
    require_auth
    do_band_lock | send_json
    ;;
  *action=plmn_lock*)
    require_auth
    do_plmn_lock | send_json
    ;;
  *action=cellinfo_mode*)
    require_auth
    do_cellinfo_mode | send_json
    ;;
  *action=restart*)
    require_auth
    do_restart | send_json
    ;;
  *action=query*)
    require_auth
    do_query | send_json
    ;;
  *action=at*)
    require_auth
    do_at | send_json
    ;;

  *action=sms_list*)
    require_auth
    do_sms_list | send_json
    ;;
  *action=sms_read*)
    require_auth
    do_sms_read | send_json
    ;;
  *action=sms_delete*)
    require_auth
    do_sms_delete | send_json
    ;;
  *action=sms_config*)
    require_auth
    do_sms_config | send_json
    ;;
  *action=sms_caps*)
    require_auth
    do_sms_probe | send_json
    ;;
  *action=sms_probe*)
    require_auth
    do_sms_probe | send_json
    ;;
  *action=sms_at*)
    require_auth
    do_sms_at | send_json
    ;;

  *)
    json_error "unknown control operation" | send_json
    ;;
esac
