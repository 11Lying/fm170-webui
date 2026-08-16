#!/bin/sh
# FM170-EAU independent Port B (ttyUSB1) SMS task (invoked once per call).
PORT_B="${SMS_PORT_B:-/dev/ttyUSB1}"
STATE="${SMS_STATE_DIR:-/tmp/fm170}"
SMS_CACHE="$STATE/sms_messages.json"
SMS_RAW="$STATE/sms_raw.txt"
SMS_LOG="$STATE/sms.log"
SMS_PORT_LOCK="$STATE/sms_port.lock"
SCAN_STATUS="$STATE/cellscan_status.json"
SCAN_REQUEST="$STATE/cellscan_request.json"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$SMS_LOG" 2>&1; }

scan_busy() {
  # 1) 已提交扫描请求 -> 忙
  [ -f "$SCAN_REQUEST" ] && return 0
  # 2) scheduler 的 Port B 正在执行 GTCELLSCAN -> 忙
  PORTS_FILE="$STATE/ports.json"
  if [ -f "$PORTS_FILE" ]; then
    bst="$(jq -r '.B.state // ""' "$PORTS_FILE" 2>/dev/null || echo "")"
    case "$bst" in busy) return 0;; esac
  fi
  # 3) 扫描状态为 starting/running -> 忙
  [ -f "$SCAN_STATUS" ] || return 1
  st="$(jq -r '.status // "idle"' "$SCAN_STATUS" 2>/dev/null || echo idle)"
  case "$st" in starting|running) return 0;; esac
  # 4) 保守避让：status 文件刚更新（扫描启动/收尾瞬态），8 秒内不抢
  if command -v stat >/dev/null 2>&1; then
    mt="$(stat -c %Y "$SCAN_STATUS" 2>/dev/null || echo 0)"
    case "$mt" in ''|*[!0-9]*) mt=0;; esac
    if [ "$mt" -gt 0 ]; then
      now="$(date +%s)"
      [ $(( now - mt )) -le 8 ] && return 0
    fi
  fi
  return 1
}

# ---- 串口访问统一走 fm170_at.sh (socat + flock 全局锁, 有序不抢占) ----
NL="
"
at() {
  # 发单条 AT, 通过 fm170_at.sh (内部fLock+socat) 拿到完整响应
  RX="$(/usr/sbin/fm170_at.sh "$PORT_B" 5 "$1" 2>/dev/null)"
  case "$RX" in *OK*) return 0;; *ERROR*) return 1;; esac
  return 1
}

at_batch() {
  # 批量: 一次 socat 会话发多条(换行分隔), 全部响应收进 RX
  RX="$(/usr/sbin/fm170_at.sh "$PORT_B" 6 -m "$1" 2>/dev/null)"
  case "$RX" in *OK*) return 0;; *) return 1;; esac
}

scan_gate() {
  # 扫描进行中让位; 本身不 open 串口, 由 fm170_at.sh 的 flock 保证独占
  if scan_busy; then log "scan active, skip sms"; return 1; fi
  return 0
}

sms_parse() {
  printf '%s' "$1" | awk '
    function emit(){ if(have && idx!="") print idx "\t" num "\t" dt "\t" txt; have=0; idx=""; txt="" }
    {
      gsub(/\r/,"",$0)
    }
    /^\+CMGL:[ ]*$/ { next }
    /^\+CMGL:[ ]*/ {
      emit(); p=$0; sub(/^\+CMGL:[ ]*/,"",p); n=split(p,a,",");
      idx=a[1]; gsub(/[ "]/,"",idx); num=a[3]; gsub(/[ "]/,"",num);
      # 提取 SCTS 时间戳 "YY/MM/DD,HH:MM:SS+ZZ"（段内含逗号，不能用 split 取整段）
      dt="";
      if (match(p, /[0-9][0-9]\/[0-9][0-9]\/[0-9][0-9],[0-9][0-9]:[0-9][0-9]:[0-9][0-9][+-][0-9][0-9]/)) {
        dt=substr(p, RSTART, RLENGTH);
      }
      have=1; next
    }
    /^OK$/ { emit(); have=0; next }
    /^ERROR/ { have=0; next }
    /^AT\+/ { next }
    { if(have && idx!=""){ if(txt=="" && $0 ~ /^[ \t]*$/) next; txt = txt (txt==""?"":"\n") $0 } }
  '
}
sms_status_of() {
  idx="$1"
  raw="$2"
  printf '%s' "$raw" | awk -v i="$idx" '
    /^\+CMGL:[ ]*/ { p=$0; sub(/^\+CMGL:[ ]*/,"",p); n=split(p,a,","); gi=a[1]; gsub(/[ \"]/,"",gi); if(gi==i){ st=a[2]; gsub(/"/,"",st); print st; exit } }
  '
}

poll() {
  scan_gate || return 1
  : > "$SMS_RAW"
  TMPF="$STATE/sms_msgs.$$"
  # 采用与 qmodem 相同的收短信工具 tom_modem（正确处理 PDU 长短信分片 + UCS2 解码）。
  # 输出 JSON 含 content + reference/total/part；再按 reference 分组、part 升序拼接成完整短信文本。
  # sms_at_port 优先取 qmodem 配置的短信口，否则沿用 PORT_B。
  sms_port="${FM170_SMS_PORT:-}"
  [ -z "$sms_port" ] && sms_port="$(uci -q get qmodem.2_1_2.sms_at_port 2>/dev/null || true)"
  [ -z "$sms_port" ] && sms_port="$PORT_B"
  tom_out="$(/usr/bin/tom_modem -d "$sms_port" -o r 2>/dev/null || true)"
  printf '%s' "$tom_out" > "$SMS_RAW"
  # 无有效输出 -> 写空列表（避免崩溃/脏缓存）
  if [ -z "$tom_out" ] || ! printf '%s' "$tom_out" | jq -e '.msg' >/dev/null 2>&1; then
    printf '[]' > "$TMPF"
    mv "$TMPF" "$SMS_CACHE" 2>/dev/null || rm -f "$TMPF"
    log "poll done (no tom_modem output)"
    return 0
  fi
  # 拼接 multipart + 输出兼容 schema：{index,storage,status,sender,datetime,text}
  # 时间戳用 jq strftime(UTC) 转成 "YY/MM/DD,HH:MM:SS"（tom_modem 的 epoch 数值即本地墙钟）。
  msgs="$(printf '%s' "$tom_out" | jq -c '
    .msg
    | group_by(.reference // ("single-" + (.index|tostring)))
    | map(
        if (((.[0].total // 1) > 1) and (.[0].reference? != null)) then
          (sort_by(.part) | { i: .[0].index, s: .[0].sender, t: .[0].timestamp,
                              tx: ( map(.content) | join("") ) })
        else
          { i: .[0].index, s: .[0].sender, t: .[0].timestamp, tx: .[0].content }
        end
      )
    | sort_by(.t)
    | map({ index:(.i|tostring), storage:"SM", status:"已读", sender:.s,
            datetime:(.t | strftime("%y/%m/%d,%H:%M:%S")), text:.tx })
  ' 2>/dev/null || printf '[]')"
  printf '%s' "$msgs" > "$TMPF"
  mv "$TMPF" "$SMS_CACHE" 2>/dev/null || rm -f "$TMPF"
  log "poll done bytes=$(wc -c < "$SMS_CACHE" 2>/dev/null || echo 0)"
  return 0
}



rd() {
  scan_gate || return 1
  at "AT+CMGR=$2"
  printf '%s' "$RX"
}

del() {
  scan_gate || return 1
  # 短信实际落在 ME(模块) 或 SM(SIM)。删除前必须先切到对应存储，否则 CMGD 删错/删不掉。
  # 优先 ME（当前短信主要落在 ME），失败再试 SM。
  at 'AT+CPMS="ME"'
  at "AT+CMGD=$2"; rc="$?"
  if [ "$rc" != "0" ]; then
    at 'AT+CPMS="SM"'
    at "AT+CMGD=$2"; rc="$?"
  fi
  [ "$rc" = "0" ] && poll >/dev/null 2>&1
  return "$rc"
}

delete_all() {
  scan_gate || return 1
  # 彻底删除模组里所有短信（ME 与 SM 两个存储都用 CMGD delflag=4 清空）
  at 'AT+CPMS="ME"'
  at "AT+CMGD=1,4"
  at 'AT+CPMS="SM"'
  at "AT+CMGD=1,4"
  # 重新拉取（此时应为空）
  poll >/dev/null 2>&1
  return 0
}

case "${1:-poll}" in
  poll) poll ;; read) rd "$@" ;; delete|del) del "$@" ;; delete_all|deleteall) delete_all ;; status) scan_gate || exit 1; at 'AT+CMGL="ALL"'; printf '%s' "$RX" ;;
esac
