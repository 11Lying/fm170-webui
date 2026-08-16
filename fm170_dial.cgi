#!/bin/sh
# FM170 独立拨号控制器（不依赖 qmodem）
# ppp_start 采用"接管模式"：检测到任何 quectel-CM 先杀掉，再启动自己的
STATE_DIR="${FM170_STATE_DIR:-/tmp/fm170}"
CTRL_QUEUE="$STATE_DIR/control"
PID_FILE="$STATE_DIR/dial.pid"
LOG_FILE="$STATE_DIR/dial.log"
LOCK_FILE="$STATE_DIR/dial.lock"
NETCARD="wwan0"
APN="auto"
PDP="-4"

mkdir -p "$STATE_DIR" 2>/dev/null

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

# 找到当前在跑的 quectel-CM 进程：优先 PID 文件，其次 ps 匹配 quectel-CM-M（用 [q] 技巧排除自身）
get_signal() {
  local p
  # 方法1：PID 文件
  if [ -f "$PID_FILE" ]; then
    p="$(cat "$PID_FILE" 2>/dev/null || echo 0)"
    case "$p" in ''|*[!0-9]*) p=0;; esac
    if [ "$p" -gt 0 ] && kill -0 "$p" 2>/dev/null; then echo "$p"; return 0; fi
  fi
  # 方法2：ps 匹配命令行含 quectel-CM-M（[q] 避免匹配 grep 自身）
  ps w | grep "[q]uectel-CM-M" | awk '{print $1}' | head -1
}

ppp_status() {
  running=0; pid=""
  p="$(get_signal)"
  if [ -n "$p" ]; then running=1; pid="$p"; fi
  ipv4="$(ip -4 addr show "$NETCARD" 2>/dev/null | awk '/inet /{print $2; exit}')"
  jq -n --arg running "$running" --arg pid "$pid" --arg netcard "$NETCARD" --arg ip "$ipv4" \
    '{ok:true,dialing:($running=="1"),pid:$pid,netcard:$netcard,ipv4:$ip}'
}

do_lock() {
  exec 9>"$LOCK_FILE" || return 1
  flock -n 9 || return 1
  return 0
}

# 杀掉所有在跑的 quectel-CM：优先 PID 文件精准杀，其次按进程名
kill_all_dial() {
  # 1. PID 文件精准杀
  if [ -f "$PID_FILE" ]; then
    p="$(cat "$PID_FILE" 2>/dev/null || echo 0)"
    case "$p" in ''|*[!0-9]*) p=0;; esac
    if [ "$p" -gt 0 ]; then
      kill -9 "$p" 2>/dev/null
    fi
  fi
  # 2. 兜底：按进程名精确杀（用 ps+awk，避免 pkill 匹配自身）
  ps w | grep "[q]uectel-CM-M" | awk '{print $1}' | while read p; do
    kill -9 "$p" 2>/dev/null
  done
  sleep 2
  rm -f "$PID_FILE"
  # 释放网卡
  ip addr flush dev "$NETCARD" 2>/dev/null
}

ppp_start() {
  do_lock || { json_error "拨号操作进行中，请稍候"; return; }
  # 可选 APN：默认 auto。只允许字母数字与 ._- 字符，空值回退 auto，防止参数注入。
  query_param apn
  APN_VAL="$(urldecode "$query_value")"
  case "$APN_VAL" in
    '') APN="auto" ;;
    ''|*[!A-Za-z0-9._-]*) json_error "APN 仅允许字母、数字、. _ -"; exec 9>&- 2>/dev/null; return ;;
    *) APN="$APN_VAL" ;;
  esac
  # 先停掉任何已有 quectel-CM（qmodem 或本页的），释放 cdc-wdm0/wwan0
  old_pid="$(get_signal)"
  if [ -n "$old_pid" ]; then
    kill "$old_pid" 2>/dev/null
    kill -9 "$old_pid" 2>/dev/null
    sleep 2
  fi
  # 保险：再清一次残留，避免 cdc-wdm 被占用
  ps w | grep "[q]uectel-CM-M" | awk '{print $1}' | while read p; do kill -9 "$p" 2>/dev/null; done
  sleep 2
  ip addr flush dev "$NETCARD" 2>/dev/null

    # 释放 lock fd，避免 quectel 进程继承导致后续 stop 拿不到锁
  exec 9>&- 2>/dev/null
  # 建立 OpenWrt network 接口，让 netifd/DHCP 接管 wwan0（仿照 qmodem 拨号脚本）
  # 用独立接口名，避免与 qmodem 的 2_1_2 冲突；若接口已存在则不重复建
  iface="wwan_dial"
  if [ -z "$(uci -q get network.$iface)" ]; then
    uci set network.$iface=interface 2>/dev/null
    uci set network.$iface.ifname="$NETCARD" 2>/dev/null
    uci set network.$iface.device="$NETCARD" 2>/dev/null
    uci set network.$iface.proto=dhcp 2>/dev/null
    uci set network.$iface.defaultroute=1 2>/dev/null
    uci set network.$iface.metric=10 2>/dev/null
    uci commit network 2>/dev/null
  fi
  # 启动 quectel-CM，输出重定向到日志（不丢错误），-f 也写一份
  echo "$(date '+%Y-%m-%d %H:%M:%S') 启动拨号 quectel-CM-M $PDP -s $APN -i $NETCARD" >> "$LOG_FILE"
  /usr/bin/quectel-CM-M "$PDP" -s "$APN" -i "$NETCARD" -d -M 10 -f "$LOG_FILE" >>"$LOG_FILE" 2>&1 &
  launcher_pid=$!
  # 让 netifd 接管 wwan0 并 ifup，dhcp 拿 IP
  ifup "$iface" 2>/dev/null

  # 等待 quectel-CM-M 真正起来（用 grep 找主进程，而不是 launcher 父进程）
  pid=""
  for i in 1 2 3 4 5 6 7 8; do
    sleep 1
    pid="$(ps w | grep "[q]uectel-CM-M" | awk '{print $1}' | head -1)"
    if [ -n "$pid" ]; then break; fi
  done

  if [ -n "$pid" ]; then
    echo "$pid" > "$PID_FILE"
    jq -n --arg pid "$pid" '{ok:true,dialing:true,pid:$pid,message:"拨号已启动，等待获取 IP..."}'
  else
    jq -n --arg errortail "$(tail -20 "$LOG_FILE" 2>/dev/null | tr '\n' ' ')" '{ok:false,dialing:false,error:"拨号进程未能启动，日志结尾：'"$errortail"'"}' 
  fi
}

ppp_stop() {
  do_lock || { json_error "拨号操作进行中，请稍候"; return; }
  # 只停拨号进程并清 IP，保留 wwan_dial 网络接口（不清理接口配置）
  kill_all_dial
  ip addr flush dev "$NETCARD" 2>/dev/null
  jq -n '{ok:true,dialing:false,message:"拨号已关闭，不会自动重连"}'
}

# 关闭串口调度器（释放 ttyUSB，避免拨号抢串口）
scheduler_stop() {
  /etc/init.d/fm170_scheduler stop >/dev/null 2>&1
  sleep 2
  # 兜底：确保 scheduler 及 worker 都停掉
  pkill -9 -f "fm170_scheduler" 2>/dev/null
  rm -f /tmp/fm170/scheduler.lock /tmp/fm170/scheduler.pid 2>/dev/null
  jq -n '{ok:true,schedulerStopped:true,message:"串口调度器已关闭，已释放串口"}'
}

# 打开串口调度器
scheduler_start() {
  /etc/init.d/fm170_scheduler start >/dev/null 2>&1
  sleep 3
  if pgrep -f "fm170_scheduler" >/dev/null 2>&1; then
    jq -n '{ok:true,schedulerStarted:true,message:"串口调度器已启动"}'
  else
    jq -n '{ok:true,schedulerStarted:false,message:"串口调度器启动命令已下发（可能稍后生效）"}'
  fi
}

# 彻底停掉 qmodem 拨号：停 procd 拨号实例 + 禁 enable_dial + 禁开机自启
qmodem_stop() {
  (
    # 1. 用 qmodem 自己的机制停拨号（hang）
    /etc/init.d/qmodem_network hang 2_1_2 >/dev/null 2>&1
    # 2. 停整个 qmodem_network 服务
    /etc/init.d/qmodem_network stop >/dev/null 2>&1
    # 3. 禁开机自启
    /etc/init.d/qmodem_network disable >/dev/null 2>&1
    # 4. 关 enable_dial，防止配置加载时自动拨号
    uci set qmodem.main.enable_dial=0
    uci set qmodem.2_1_2.enable_dial=0
    uci commit qmodem >/dev/null 2>&1
    # 5. 补刀：杀掉可能残留的 quectel-CM
    pkill -9 -f "quectel-CM-M" 2>/dev/null
    pkill -9 -f "quectel-CM " 2>/dev/null
    rm -f "$PID_FILE"
    ip addr flush dev "$NETCARD" 2>/dev/null
  ) 2>/dev/null
  jq -n --arg msg "已彻底停止 qmodem 拨号（hang + enable_dial=0 + 禁自启）" '{ok:true,dialing:false,qmodemStopped:true,message:$msg}'
}

# ===== AT 指令执行（走串口调度器管理队列，白名单，无需登录）=====
DAEMON_PID_FILE="/var/run/fm170_scheduler.pid"
SCAN_STATUS_FILE="${FM170_STATE_DIR:-/tmp/fm170}/cellscan_status.json"

daemon_running() {
  [ -f "$DAEMON_PID_FILE" ] || return 1
  dp="$(cat "$DAEMON_PID_FILE" 2>/dev/null || echo 0)"
  case "$dp" in ''|*[!0-9]*) dp=0;; esac
  [ "$dp" -gt 0 ] || return 1
  kill -0 "$dp" 2>/dev/null
}

scan_is_active() {
  [ -f "$SCAN_STATUS_FILE" ] || return 1
  ss="$(jq -r '.status // "idle"' "$SCAN_STATUS_FILE" 2>/dev/null || echo idle)"
  case "$ss" in starting|running) return 0;; esac
  return 1
}

submit_control_request() {
  command="$1"; timeout_seconds="$2"; action="$3"
  request_id="fmd-$(date +%s)-$$-$RANDOM-$RANDOM"
  response_file="$CTRL_QUEUE/resp-$request_id.json"
  request_file="$CTRL_QUEUE/req-$request_id.json"
  mkdir -p "$CTRL_QUEUE"
  jq -n --arg command "$command" --arg timeout "$timeout_seconds" \
    --arg responseFile "$response_file" --arg action "$action" \
    --arg createdAt "$(date '+%Y-%m-%d %H:%M:%S')" \
    '{command:$command,timeout:($timeout|tonumber),responseFile:$responseFile,action:$action,createdAt:$createdAt}' \
    > "$request_file"
  deadline=$(( $(date +%s) + timeout_seconds + 10 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if [ -f "$response_file" ]; then cat "$response_file"; rm -f "$response_file"; return 0; fi
    sleep 0.2
  done
  json_error "AT scheduler did not respond"
}

# action=at&cmd=AT+GTCCINFO?
at_exec() {
  query_param cmd
  AT_CMD="$(urldecode "$query_value")"
  case "$AT_CMD" in
    "AT+GTCCINFO?") AT_CMD="AT+GTCCINFO?"; AT_TIMEOUT=6 ;;
    "AT+GTCELLLOCK?") AT_CMD="AT+GTCELLLOCK?"; AT_TIMEOUT=6 ;;
    "AT+CFUN=15") AT_CMD="AT+CFUN=15"; AT_TIMEOUT=20 ;;
    *) json_error "不支持的 AT 指令（仅允许 GTCCINFO? / GTCELLLOCK? / CFUN=15）"; return ;;
  esac
  if ! daemon_running; then json_error "串口调度器未运行，请先打开调度器"; return; fi
  resp="$(submit_control_request "$AT_CMD" "$AT_TIMEOUT" "dial_at")"
  jq -n --argjson r "$resp" --arg cmd "$AT_CMD" '{ok:$r.ok,command:$cmd,raw:$r.raw}'
}

CASE_MATCH="status"
case "$QUERY_STRING" in
  *action=at*|*action=sendat*) CASE_MATCH="at" ;;
  *action=scheduler_stop*|*action=scheduleroff*) CASE_MATCH="schstop" ;;
  *action=scheduler_start*|*action=scheduleron*) CASE_MATCH="schstart" ;;
  *action=qmodem_stop*|*action=qmodemoff*) CASE_MATCH="qstop" ;;
  *action=ppp_stop*|*action=undial*) CASE_MATCH="stop" ;;
  *action=ppp_start*|*action=dial*) CASE_MATCH="start" ;;
esac
case "$CASE_MATCH" in
  at) at_exec | send_json ;;
  schstop) scheduler_stop | send_json ;;
  schstart) scheduler_start | send_json ;;
  qstop) qmodem_stop | send_json ;;
  stop) ppp_stop | send_json ;;
  start) ppp_start | send_json ;;
  *) ppp_status | send_json ;;
esac
