/* FM170 WebUI 本地开发模拟服务器（仅开发用，不部署到路由器）
 * 模拟最新版 /cgi-bin/fm170_api.cgi / fm170_control.cgi / fm170_dial.cgi：
 *   - 无登录（免 sid）
 *   - 按需采集租约 ui_open / ui_refresh / ui_close
 *   - free AT 控制（action=at）
 * 用法: node dev/mock-server.js [port]   (默认 8123)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || 8123);
const ROOT = path.join(__dirname, '..');

/* ---------------- 状态（可变部分） ---------------- */
const state = {
  cellLockEnabled: 0,
  cellLock: '+GTCELLLOCK: 0',
  networkModeId: 20,
  networkModeQuery: '+GTACT: 20,2,1,1,8,103,105,107,108,120,128,132,138,140,141,142,143,501,503,505,507,508,520,528,538,540,541,575,576,577,578',
  allowedBands: [103,105,107,108,120,128,132,138,140,141,142,143,501,503,505,507,508,520,528,538,540,541,575,576,577,578],
  plmnLock: '+GTPLMNLOCK: 0',
  cellinfoEnabled: '+GTCELLINFO: 1',
  scanRunning: false,
  scanStatus: 'idle',
  scanResult: null,
  sms: [],
  dial: { dialing: false, pid: '', netcard: 'wwan0', ipv4: '' },
  lease: 0,
};

/* ---------------- 原始 AT 数据（模拟真机） ---------------- */
function rawAT() {
  const modes = {
    20: [2,3,4,10,14,16,17,20].join(','),
    14: [10,14,16,17,20].join(','),
    2: [2,3,4,10,17,20].join(','),
  };
  const nrBands = state.allowedBands.filter(b => b >= 500).join(',');
  const lteBands = state.allowedBands.filter(b => b < 500).join(',');
  return {
    CGMM: '+CGMM: "FM170-EAU"',
    CGMR: '+CGMR: "89628.1000.00.01.02.08"',
    GTACT: `+GTACT: ${state.networkModeQuery.split(': ')[1]}`,
    GTACTTEST: `+GTACT: (${modes[state.networkModeId] || modes[20]}),(0,1),(0,1),(0,1),(1,5,8),(101,103,105,107,108,120,128,132,138,140,141,142,143),(1,2,3),(1),(501,503,505,507,508,520,528,538,540,541,575,576,577,578)`,
    CEREG: '+CEREG: 2,1,"B018","0E62AE91",11',
    C5GREG: '+C5GREG: 2,1,"B018","0E62AE91",11',
    CGREG: '+CGREG: 2,1',
    CEMODE: '+CEMODE: 2',
    COPS: '+COPS: 0,0,"CHN-CT",11',
    CESQ: '+CESQ: 99,99,255,255,39,70,65,86,78',
    GTCCINFO: [
      'Neighbor cells:\r\n1,0,460,11,B018,0E62AE91,6272D0,0F6,78,100,1,30,63\r\n2,9,460,11,B018,0E62AE91,6272D0,0F6,78,100,1,30,63\r\nService cell:\r\n1,9,460,11,B018,0E62AE91,6272D0,0F6,78,100,1,30,63',
    ].join('\r\n'),
    GTCAINFO: 'PCC: 5078,246,6272D0,100,1,1,1,3,69\r\nSCC1: 2,1,5078,246,6272D0,100,1,1,1,3,69\r\nSCC2: 1,1,5078,246,6272D0,50,1,1,2,3,75',
    GTCELLINFO: '+GTCELLINFO: 1\r\nssb_beamid: 3\r\nnr_cqi: 13\r\nnr_power: 14\r\nnr_rank: RANK2\r\nnr_dlmcs: 18\r\nnr_ulmcs: 26\r\ntx_5g_qci: 6\r\nrx_5g_qci: 6',
    CELLLOCK: state.cellLock,
    PLMNLOCK: state.plmnLock,
    ROAMCFG: '+GTROAMCFG: 1,0',
    DUALSIM: '+GTDUALSIM: 0,"SUB1","L"',
    CGDCONT: '+CGDCONT: 1,"IP","auto","0.0.0.0",0,0,0,0\r\n+CGDCONT: 2,"IPV4V6","IMS","0.0.0.0",0,0,0,0\r\n+CGDCONT: 3,"IPV4V6","ctwap","0.0.0.0",0,0,0,0',
    CGCONTRDP: '+CGCONTRDP: 1,5,"auto","100.23.67.27.255.255.255.248","100.23.67.28","219.146.1.66","219.147.1.66"',
  };
}

/* ---------------- cellscan 结果 ---------------- */
function makeCells() {
  return [
    { rat:'NR', mcc:460, mnc:11, band:'78', pci:246, arfcn:6450000, rsrp:-70, rsrq:-10, srxlev:45, squal:42, tac:45064, cellId:239596177, plmn:'' },
    { rat:'NR', mcc:460, mnc:11, band:'78', pci:250, arfcn:6450264, rsrp:-84, rsrq:-11, srxlev:38, squal:35, tac:45064, cellId:239596180, plmn:'' },
    { rat:'NR', mcc:460, mnc:11, band:'78', pci:232, arfcn:6450024, rsrp:-96, rsrq:-13, srxlev:22, squal:18, tac:45064, cellId:239596172, plmn:'' },
    { rat:'NR', mcc:460, mnc:0, band:'1', pci:101, arfcn:422000, rsrp:-102, rsrq:-15, srxlev:14, squal:10, tac:45221, cellId:31107523, plmn:'' },
    { rat:'LTE', mcc:460, mnc:11, band:'3', pci:301, arfcn:1650, rsrp:-88, rsrq:-9, srxlev:30, squal:0, tac:45064, cellId:239596177, plmn:'' },
    { rat:'LTE', mcc:460, mnc:11, band:'40', pci:17, arfcn:39250, rsrp:-78, rsrq:-8, srxlev:52, squal:0, tac:45064, cellId:239596181, plmn:'' },
  ];
}
function scanRaw() {
  return makeCells().map(c =>
    `+GTCELLSCAN: ${c.rat==='NR'?5:4},${c.mcc},${c.mnc},${c.arfcn.toString(16).toUpperCase()},${c.pci.toString(16).toUpperCase()},${c.tac.toString(16).toUpperCase()},${c.cellId.toString(16).toUpperCase()},${c.rsrp},${c.rsrq},${c.band},${c.srxlev},${c.squal}`
  ).join('\r\n');
}
function scanResultPayload() {
  const cells = state.scanResult ? makeCells() : [];
  return {
    ok: true, status: 'completed', jobId: 'fm170-1750000000-1-11-22', startedAt: '2026-08-16 12:00:00',
    finishedAt: '2026-08-16 12:01:53', duration: 53, resultCount: cells.length,
    raw: scanRaw(), cells, parserError: '', timestamp: '2026-08-16 12:01:53', epoch: 1750000000,
  };
}
function scanStatusPayload() {
  const st = state.scanStatus;
  if (st === 'running') {
    return { ok:true, jobId:'fm170-1750000000-1-11-22', status:'running', trigger:'manual', startedAt:'2026-08-16 12:00:00', elapsed: Math.floor((Date.now()-state.scanStarted)/1000), finishedAt:null, resultCount:0, error:'', timeout:120, attemptTimeout:90, retryDelay:5, attempts:1, maxAttempts:2, port:'/dev/ttyUSB1', updatedAt:now(), epoch: Math.floor(state.scanStarted/1000), raw:'' };
  }
  if (st === 'completed') {
    const cells = state.scanResult ? makeCells() : [];
    return { ok:true, jobId:'fm170-1750000000-1-11-22', status:'completed', trigger:'manual', startedAt:'2026-08-16 12:00:00', elapsed:53, finishedAt:'2026-08-16 12:01:53', resultCount: cells.length, error:'', timeout:120, attemptTimeout:90, retryDelay:5, attempts:1, maxAttempts:2, port:'/dev/ttyUSB1', updatedAt:now(), epoch: 1750001620, raw:'' };
  }
  return { ok:true, jobId:'', status:'idle', trigger:'manual', startedAt:null, elapsed:0, finishedAt:null, resultCount: state.scanResult?makeCells().length:0, error:'', timeout:120, attemptTimeout:90, retryDelay:5, attempts:0, maxAttempts:2, port:'/dev/ttyUSB1', updatedAt:now(), epoch: 0, raw:'' };
}
function now() { return new Date().toISOString().slice(0,19).replace('T',' '); }

/* ---------------- 短信 ---------------- */
function seedSms() {
  state.sms = [
    { index:'1', sender:'10086', datetime:'26/08/15,10:24:32+32', status:'REC UNREAD', text:'【中国移动】您本月已使用流量 52.3GB，剩余 147.7GB。' },
    { index:'2', sender:'95555', datetime:'26/08/14,18:03:11+32', status:'REC READ', text:'招商银行：您尾号8888的账户于08月14日18:02发生一笔网上支付人民币 12.00 元。' },
    { index:'3', sender:'106508886', datetime:'26/08/12,09:15:47+32', status:'REC READ', text:'【验证码】您的验证码为 246810，5分钟内有效。请勿泄露给他人。' },
  ];
}
seedSms();

/* ---------------- HTTP 工具 ---------------- */
function json(res, obj, status=200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function qs(u) {
  const p = new URL(u, 'http://x');
  return Object.fromEntries(p.searchParams.entries());
}

/* ---------------- 路由 ---------------- */
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const q = qs(req.url);
  console.log(`[${new Date().toISOString().slice(11,19)}] ${req.method} ${url} ${req.url.slice(0,80)}`);

  if (url === '/cgi-bin/fm170_api.cgi') {
    switch (true) {
      case q.action === 'ui_open':
      case q.action === 'ui_refresh':
        state.lease = Date.now();
        return json(res, { ok:true, active:true, leaseSeconds:45 });
      case q.action === 'ui_close':
        state.lease = 0;
        return json(res, { ok:true, active:false });
      case q.action === 'status' || !q.action:
        return json(res, {
          ok:true, fresh:true, source:'scheduler', phase:'running', message:'',
          updatedAt: now(), cachedAt: now(), epoch: Math.floor(Date.now()/1000),
          port:'/dev/ttyUSB2', statusPort:'/dev/ttyUSB2', controlPort:'/dev/ttyUSB1',
          raw: rawAT(),
        });
      case q.action === 'cellscan_status' || q.action === 'scan_status':
        return json(res, scanStatusPayload());
      case q.action === 'cellscan_result':
        return json(res, scanResultPayload());
      case q.action === 'cellscan_start' || q.action === 'scan_start':
        if (state.scanStatus === 'running') {
          return json(res, { ok:true, status:'already_running', jobId:'fm170-1750000000-1-11-22', trigger:'manual', elapsed:5, timeout:120, port:'/dev/ttyUSB1' });
        }
        state.scanStatus = 'running'; state.scanStarted = Date.now(); state.scanResult = null;
        setTimeout(() => { state.scanStatus = 'completed'; state.scanResult = makeCells(); }, 2400);
        return json(res, { ok:true, jobId:'fm170-1750000000-1-11-22', status:'starting', trigger:'manual', startedAt:now(), elapsed:0, finishedAt:null, resultCount:0, error:'', timeout:120, attemptTimeout:90, retryDelay:5, maxAttempts:2, attempts:1, port:'/dev/ttyUSB1', updatedAt:now(), epoch: Math.floor(Date.now()/1000), raw:'' });
      case q.action === 'scheduler_status' || q.action === 'port_status':
        return json(res, { ok:true, A:{state:'connected',currentCommand:'',currentJobId:'',port:'/dev/ttyUSB2',startedAt:'',lastActivity:now(),lastError:''}, B:{state:'connected',currentCommand:'',currentJobId:'',port:'/dev/ttyUSB1',startedAt:'',lastActivity:now(),lastError:''}, updatedAt:now() });
      case q.action === 'autoscan':
        return json(res, { ok:true, enabled:false });
      case q.action === 'sms_status' || q.action === 'sms_list':
        return json(res, { ok:true, unread: state.sms.filter(s=>s.status==='REC UNREAD').length, messages: state.sms });
      case q.action === 'sms_refresh':
        return json(res, { ok:true, unread: state.sms.filter(s=>s.status==='REC UNREAD').length, messages: state.sms });
      case q.action === 'sms_read':
        return json(res, { ok:true, index:q.index, raw:'' });
      case q.action === 'sms_delete':
        state.sms = state.sms.filter(s=>s.index !== q.index);
        return json(res, { ok:true, unread: state.sms.filter(s=>s.status==='REC UNREAD').length, messages: state.sms });
      case q.action === 'sms_delete_all':
        state.sms = [];
        return json(res, { ok:true, unread:0, messages: [] });
      case q.action === 'ping':
        return json(res, { ok:true, action:'ping', now: now() });
      default:
        return json(res, { ok:false, error:'unknown action' });
    }
  }

  if (url === '/cgi-bin/fm170_control.cgi') {
    switch (true) {
      case q.action === 'cell_lock':
        state.cellLockEnabled = 1;
        state.cellLock = `+GTCELLLOCK: 1,${q.rat},${q.type},${q.arfcn},${q.pci||''},${q.scs||''},${q.band||''}`;
        return json(res, { ok:true, command:'AT+GTCELLLOCK=' + state.cellLock.split(': ')[1], raw:'OK', retried:false, attempts:1 });
      case q.action === 'cell_unlock':
      case q.action === 'multi_cell_unlock':
        state.cellLockEnabled = 0; state.cellLock = '+GTCELLLOCK: 0';
        return json(res, { ok:true, command:'AT+GTCELLLOCK=0', raw:'OK', retried:false, attempts:1 });
      case q.action === 'multi_cell_lock':
        state.cellLockEnabled = 1;
        state.cellLock = `+GTCELLLOCK: 1,${q.rat},1,${(q.pairs||'').split(',')[0]}`;
        return json(res, { ok:true, command:'AT+GTFREQLOCK=' + [q.rat,q.count,q.pairs].join(','), raw:'OK', retried:false, attempts:1 });
      case q.action === 'network_mode':
        state.networkModeId = Number(q.mode);
        state.networkModeQuery = `+GTACT: ${q.mode},2,1,1,8,103,105,107,108,120,128,132,138,140,141,142,143,501,503,505,507,508,520,528,538,540,541,575,576,577,578`;
        return json(res, { ok:true, raw:'OK' });
      case q.action === 'band_lock':
        state.allowedBands = (q.bands||'').split(',').filter(Boolean).map(Number);
        const nr = state.allowedBands.filter(b=>b>=500).join(','), lte = state.allowedBands.filter(b=>b<500).join(',');
        state.networkModeQuery = `+GTACT: ${state.networkModeId},2,1,1,8,${lte},${nr}`;
        return json(res, { ok:true, raw:'OK' });
      case q.action === 'plmn_lock':
        state.plmnLock = q.enabled === '1' ? '+GTPLMNLOCK: 1,"46011"' : '+GTPLMNLOCK: 0';
        return json(res, { ok:true, raw:'OK' });
      case q.action === 'cellinfo_mode':
        state.cellinfoEnabled = `+GTCELLINFO: ${q.enabled}`;
        return json(res, { ok:true, raw:'OK' });
      case q.action === 'restart':
        return json(res, { ok:true, raw:'OK' });
      case q.action === 'query':
        return json(res, { ok:true, raw:'OK', command:'AT+' + (q.query||'').toUpperCase() });
      case q.action === 'at':
        if (!/^AT(?:\+.*)?$/i.test(q.cmd||'') || /[\r\n&|;`$()]/.test(q.cmd||'')) {
          return json(res, { ok:false, command:q.cmd, raw:'', error:'AT 指令必须以 AT 开头且不含非法字符' });
        }
        if (/GTCELLSCAN/i.test(q.cmd||'')) {
          return json(res, { ok:true, command:q.cmd, raw:`OK\r\n${scanRaw()}`, error:'' });
        }
        return json(res, { ok:true, command:q.cmd, raw:`${q.cmd}\r\n+AT_ECHO: OK\r\nOK`, error:'' });
      case q.action === 'ping':
        return json(res, { ok:true, action:'ping', now:now() });
      default:
        return json(res, { ok:false, error:'unknown control operation' });
    }
  }

  if (url === '/cgi-bin/fm170_dial.cgi') {
    switch (true) {
      case q.action === 'ppp_status':
        return json(res, { ok:true, dialing:state.dial.dialing, pid:state.dial.pid, netcard:state.dial.netcard, ipv4:state.dial.ipv4 });
      case q.action === 'ppp_start':
        state.dial.dialing = true; state.dial.pid = '12345'; state.dial.ipv4 = '';
        setTimeout(() => { state.dial.ipv4 = '100.23.67.27/29'; }, 1500);
        return json(res, { ok:true, dialing:true, pid:'12345', message:'拨号已启动，等待获取 IP...' });
      case q.action === 'ppp_stop':
        state.dial.dialing = false; state.dial.pid = ''; state.dial.ipv4 = '';
        return json(res, { ok:true, dialing:false, message:'拨号已关闭，不会自动重连' });
      case q.action === 'qmodem_stop':
        state.dial.dialing = false;
        return json(res, { ok:true, message:'qmodem 拨号已停止' });
      case q.action === 'scheduler_stop':
        return json(res, { ok:true, message:'串口调度器已关闭' });
      case q.action === 'scheduler_start':
        return json(res, { ok:true, message:'串口调度器已启动' });
      case q.action === 'at':
        return json(res, { ok:true, cmd:q.cmd, raw:'OK\r\n' });
      default:
        return json(res, { ok:false, error:'unknown dial action' });
    }
  }

  // 静态文件
  let file = path.join(ROOT, url === '/' ? '/index.html' : url);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(file);
    const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control':'no-store' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`FM170 mock server → http://localhost:${PORT}/`));