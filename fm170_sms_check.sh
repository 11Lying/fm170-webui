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
  at "AT+CMGF=1"         # 文本模式
  : > "$SMS_RAW"
  TMPF="$STATE/sms_msgs.$$"
  msgs="["; sep=""
  # 用 UCS2 读取，保证中文短信正文以 UCS2 十六进制返回，再解码为可读中文。
  at 'AT+CSCS="UCS2"'
  # 短信实际可落在 SM(SIM) 或 ME(模块)。两种都读并合并，确保任何存储进来的短信都能在 WebUI 显示。
  # 每个存储用独立局部变量捕获，避免共用全局 $RX 造成跨存储串扰/重复。
  for STORAGE in ME SM; do
    at "AT+CPMS=\"$STORAGE\""            # 切到该存储
    RAW_ONE="$(/usr/sbin/fm170_at.sh "$PORT_B" 5 'AT+CMGL="ALL"' 2>/dev/null)"
    printf '%s' "$RAW_ONE" >> "$SMS_RAW"
    sms_parse "$RAW_ONE" > "$STATE/sms_entries_$$_$STORAGE" 2>/dev/null
    while IFS= read -r entry; do
      [ -z "$entry" ] && continue
      idx="$(printf '%s' "$entry" | cut -f1)"
      num="$(printf '%s' "$entry" | cut -f2)"
      dt="$(printf '%s' "$entry" | cut -f3)"
      text="$(printf '%s' "$entry" | cut -f4-)"
      txt2="$(printf '%s' "$text" | sed 's/\\\\n$//')"
      # UCS2 -> 中文 解码（发件人号码与正文都可能以 UCS2 十六进制呈现）
      num_d="$(printf '%s' "$num" | jq -R -r -f /usr/sbin/fm170_ucs2decode.jq 2>/dev/null || printf '%s' "$num")"
      txt_d="$(printf '%s' "$txt2" | jq -R -r -f /usr/sbin/fm170_ucs2decode.jq 2>/dev/null || printf '%s' "$txt2")"
      st="$(sms_status_of "$idx" "$RAW_ONE")"
      [ -z "$st" ] && st="REC UNREAD"
      # 状态英文 -> 中文，方便前后端/API 直接消费
      case "$st" in
        "REC UNREAD") st="未读";;
        "REC READ") st="已读";;
        "STO UNSENT") st="待发送";;
        "STO SENT") st="已发送";;
      esac
      msgs="$msgs$sep$(jq -nc --arg index "$idx" --arg storage "$STORAGE" --arg status "$st" --arg sender "$num_d" --arg datetime "$dt" --arg text "$txt_d" '{index:$index,storage:$storage,status:$status,sender:$sender,datetime:$datetime,text:$text}')"
      sep=","
    done < "$STATE/sms_entries_$$_$STORAGE"
    rm -f "$STATE/sms_entries_$$_$STORAGE"
  done
  msgs="$msgs]"
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
