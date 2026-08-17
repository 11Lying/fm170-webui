# FM170 WebUI / AT Scheduler

FM170 / FM160 (Fibocom) 5G 模块的 OpenWrt 侧 WebUI 与双串口 AT 调度器。

## 架构

双串口分工：

- **Port A** (ttyUSB2)：实时状态 + 短控制命令
  - `fm170_scheduler --worker-a`
  - status_once() 每 3s 轮询，写 status.json
  - process_control() 处理控制队列
- **Port B** (ttyUSB1)：GTCELLSCAN 长任务 + SMS
  - `fm170_scheduler --worker-b`
  - GTCELLSCAN 经 `fm170_scan_fd` 读取
  - SMS 经 `fm170_sms_check.sh poll`（每 45s）

串口访问统一走 `fm170_at.sh`（socat + flock 全局锁，按端口名隔离）。

## 主流程

```
master (fm170_scheduler)
 ├── worker_a ── Port A ── status + control
 └── worker_b ── Port B ── GTCELLSCAN + SMS

浏览器 → WebUI → CGI/API → status.json / control queue / scan request / SMS API
                  ↓
              Scheduler / worker → Port A / Port B → AT → FM170
```

## 目录

| 文件 | 作用 |
|---|---|
| `fm170_scheduler` | 主调度器（master + worker-a + worker-b），AT 频率分级、仅手动扫描、**自动端口探测** |
| `fm170_at.sh` | 统一串口访问（socat + flock） |
| `fm170_scan_fd` | GTCELLSCAN 串口读取器 |
| `fm170_sms_check.sh` | SMS 检查脚本（**已改为手动刷新**） |
| `fm170_log_trim.sh` | /tmp/fm170 日志体积控制 |
| `fm170_api.cgi` | 状态/扫描/SMS/端口 API |
| `fm170_control.cgi` | 控制链路（网络模式/锁频/锁小区/PLMN/SMS AT） |
| `fm170_dial.cgi` | 独立 QMI 拨号控制器（支持可选手动 APN） |
| `dial.html` | WebUI 独立拨号页面（含 APN 输入框） |
| `fm170_scan.sh` | 命令行扫描请求入口 |
| `index.html` | WebUI 入口 |
| `index-DLZvxu_t.js` | WebUI 前端 bundle（状态/扫描/SMS 页面） |
| `fm170-ux.js` | WebUI 运行时注入脚本 |

## 特性

- AT 查询频率分级：
  - 高频（每 tick≈3s）：`GTACT / CEREG / C5GREG / CESQ / GTCCINFO / GTCELLLOCK`
  - 中频（15s）：`CGREG / COPS / GTCAINFO / GTCELLINFO`
  - 低频（30s）：`CGDCONT / CGCONTRDP / GTPLMNLOCK`
  - 启动一次：`ATE0 / CGMM / CGMR / GTACT=? / CEMODE / GTROAMCFG / GTDUALSIM`
- 无周期性裸 `AT` 探活
- 邻区扫描仅手动触发（无 boot/periodic/stale 自动扫描）
- **自动端口探测**：调度器启动时对 /dev/ttyUSB* 逐个发 AT，自动挑选两个可用串口作为 A(状态/控制)/B(扫描/短信)，抗 USB 重枚举导致的串口漂移
- **短信手动刷新**：不再自动 poll，用户在短信页点"刷新短信"才更新
- **WebUI 按需采集**：调度器仅在 WebUI 租约有效时执行状态 AT 采集；页面关闭/超时后只保留轻量 worker，不再持续占用串口轮询
- **手动刷新**：前端拦截原有状态定时器，只有点击“手动刷新”才重新读取完整状态
- **状态缓存**：最近一次完整 status 响应同时保存在 `/tmp/fm170/status.json` 和浏览器 `localStorage`；无刷新时优先展示缓存，网络暂时失败也不清空页面
- **控制免登录**：移除 WebUI 控制接口的 sid/session 校验，局域网访问边界交给路由器防火墙
- **高级 AT 控制**：支持常用 AT 下拉选择和任意单行 AT 指令，经 control queue 串行执行；返回区仅显示模块原生回显，不显示 JSON 包装，并按终端样式多行换行
- **WebUI 拨号开机自启**：`fm170_webui_dial` 通过 `fm170_dial.cgi?action=ppp_start` 启动，不使用 qmodem 拨号
- status.json schema 兼容（19 个 raw 字段全保留）
- 拨号页 `dial.html` 支持可选 APN（默认 auto，可手填固定 APN）

## 按需采集与开机拨号

- `/tmp/fm170/webui.lease` 是 WebUI 活跃租约，默认 45 秒；前端每 20 秒续租。
- `fm170_scheduler` 只有租约有效时才执行 `status_once()`；租约过期后 worker A 进入 idle，不再访问串口。
- `/cgi-bin/fm170_api.cgi?action=ui_open|ui_refresh|ui_close` 管理租约。
- `fm170_webui_dial` 是开机拨号服务，调用和 WebUI 拨号按钮相同的 `fm170_dial.cgi`，不会调用 qmodem 拨号。
- `socat` 作为 AT 串口访问依赖已安装。

## 部署

将各文件放到对应路径：

```
/usr/sbin/fm170_scheduler
/usr/sbin/fm170_at.sh
/usr/sbin/fm170_scan_fd
/usr/sbin/fm170_sms_check.sh
/www/cgi-bin/fm170_api.cgi
/www/cgi-bin/fm170_control.cgi
/www/cgi-bin/fm170_dial.cgi
/www/cgi-bin/fm170_scan.sh
/www/fm170/index.html
/www/fm170/dial.html
/www/fm170/assets/index-DLZvxu_t.js
/www/fm170/fm170-ux.js
/usr/sbin/fm170_log_trim.sh
```

调度器由 procd 管理（`/etc/init.d/fm170_scheduler`）。

> 仓库内为去敏后的代码，不含任何设备 IP、账号、密码或订阅信息。
