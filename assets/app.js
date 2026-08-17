/* ============================================================
 * FM170 WebUI — 统一前端（无框架单文件应用）
 * 功能逻辑与后端 API 完全兼容：状态轮询 / 邻区扫描 / 小区锁定 /
 * 网络模式 / 频段 / PLMN / GTCELLINFO / 短信 / 拨号 / AT 指令
 * 无登录（后端不再要求控制会话）、无 Mock 模式。
 * ============================================================ */
'use strict';

/* ================= 工具 ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const escAttr = esc;
const num = (e, fb = null) => { if (e === undefined || e === '' || e === null) return fb; const n = Number(e); return Number.isFinite(n) ? n : fb; };
const stripQuotes = s => String(s ?? '').replace(/^"|"$/g, '').trim();
const splitLines = s => String(s ?? '').split(/\r\n|\r|\n/);
const lineStarts = (raw, prefix) => { const l = splitLines(raw).find(x => x.trim().startsWith(prefix)); return l ? l.trim() : ''; };
const splitAfter = (s, prefix) => s.startsWith(prefix) ? s.slice(s.indexOf(prefix) + prefix.length).split(',').map(x => x.trim()) : [];
const hexNum = s => { const t = String(s ?? '').trim(); return !t || !/^[0-9a-fA-F]+$/.test(t) ? null : parseInt(t, 16); };
const hexOrDec = s => { const t = String(s ?? '').trim(); return !t || !/^[0-9a-fA-F]+$/.test(t) ? null : (/[a-fA-F]/.test(t) ? parseInt(t, 16) : Number(t)); };

/* 频段名：NR n78 / LTE B3 / UMTS U1 */
const bandName = (rat, b) => rat === 'NR' ? (b >= 5000 ? `n${b - 5000}` : b >= 500 ? `n${b - 500}` : `n${b}`) : b >= 100 ? `B${b - 100}` : `B${b}`;
const lteBw = e => ({6:1.4,15:3,25:5,50:10,75:15,100:20})[e] ?? e;
const modulation = e => ({0:'BPSK',1:'QPSK',2:'16QAM',3:'64QAM',4:'256QAM',5:'1024QAM',6:'UNKNOWN'})[e] ?? 'UNKNOWN';
const regText = v => (v === 1 || v === 5) ? '已注册' : '未注册';
const isReg = v => v === 1 || v === 5;
const toneRsrp = v => v >= -85 ? 'good' : v >= -105 ? 'warn' : 'bad';
const toneSignal = (v, good, warn) => v === null ? 'neutral' : (v >= good ? 'good' : v >= warn ? 'warn' : 'bad');
const pciOf = e => { const n = Number(e); return Number.isFinite(n) ? n : null; };

/* 网络模式名（GTACT 首字段归一化显示） */
const modeName = id => ({17:'全模式',20:'全模式',14:'单 5G',16:'单 5G',2:'单 4G',3:'单 4G',4:'单 4G',10:'全模式'})[id] ?? '全模式';

/* 运营商解析（与旧前端一致） */
function resolveOperator(o) {
  let code = '', mcc = 0, mnc = 0;
  try {
    if (o == null) return '未知运营商';
    if (typeof o === 'string') code = String(o).trim();
    else { code = String(o.operator || o.operatorCode || '').trim(); mcc = o.mcc || 0; mnc = o.mnc || 0; }
  } catch (_) { return '未知运营商'; }
  const codeMap = {'CHN-CT':'中国电信',CHNCT:'中国电信','CHN-TELECOM':'中国电信','CHN-MOBILE':'中国移动',CHNCMCC:'中国移动','CHN-UNICOM':'中国联通',CHNUNICOM:'中国联通'};
  const ck = code.toUpperCase().replace(/[^A-Z]/g, '');
  if (ck && codeMap[ck]) return codeMap[ck];
  if (!mcc && /^\d{3,6}$/.test(code)) { mcc = Number(code.slice(0, 3)); mnc = code.length > 3 ? Number(code.slice(3)) : 0; }
  if (mcc) {
    let mncs = String(mnc == null ? '' : mnc); if (mncs.length === 1) mncs = '0' + mncs;
    const key = String(Number(mcc)) + mncs;
    const m = [['46011','中国电信'],['46020','中国电信'],['46003','中国电信'],['46005','中国电信'],['46001','中国联通'],['46006','中国联通'],['46009','中国联通'],['46010','中国联通'],['46000','中国移动'],['46002','中国移动'],['46004','中国移动'],['46007','中国移动'],['46008','中国移动']];
    for (const x of m) if (key.indexOf(x[0]) === 0) return x[1];
    if (String(mcc) === '460') return '中国运营商';
  }
  return '未知运营商';
}

/* 时间 */
const fmtSmsTime = s => {
  if (!s) return '';
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{2}),(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return s;
  return `${2000 + +m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
};
const smsTimeNum = s => {
  if (!s) return -1;
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{2}),(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return -1;
  return Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
};
const epochOf = j => {
  try {
    const m = /^fm170-(\d{9,})/i.exec(String(j));
    if (m) return parseInt(m[1], 10);
    const d = Date.parse(String(j).replace(' ', 'T'));
    return isFinite(d) ? Math.floor(d / 1000) : 0;
  } catch (_) { return 0; }
};
const agoText = ep => {
  if (!(ep && ep > 0)) return '';
  const age = Math.max(0, Math.floor(Date.now() / 1000 - ep));
  if (age < 60) return '刚刚';
  const m = Math.floor(age / 60);
  if (m < 60) return `${m} 分钟前`;
  return `${Math.floor(m / 60)} 小时前`;
};
const nowText = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/* ================= 图标（内联 SVG，24 视图框，stroke 风格） =================
 * 默认 24×24（无 width/height 时浏览器会按 300×150 撑开布局）；
 * 具体场景尺寸由 design-tokens.css 中的图标规范统一覆盖。
 */
const ic = (paths, fill = false) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const I = {
  home: ic('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
  layers: ic('<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>'),
  radar: ic('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.6"/><path d="m18 6-4.2 4.2"/>'),
  sms: ic('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  dial: ic('<rect x="4" y="2.5" width="16" height="19" rx="3"/><path d="M9.5 18h5"/>'),
  gear: ic('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"/>'),
  signal: ic('<path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 4v16"/>'),
  net: ic('<circle cx="5" cy="12" r="2.6"/><circle cx="12" cy="12" r="2.6"/><circle cx="19" cy="12" r="2.6"/><path d="M7.4 10.4 9.8 8.4M16.2 8.4l2.4 2M7.4 13.6l2.4 2M16.2 15.6l2.4-2"/>'),
  cell: ic('<rect x="4" y="8" width="16" height="8" rx="2"/><path d="M4 10.5h16M9 8v8M15 8v8"/>'),
  wave: ic('<path d="M3 12a9 9 0 0 1 18 0"/><path d="M6 12a6 6 0 0 1 12 0"/><path d="M9.5 12a2.5 2.5 0 0 1 5 0"/>'),
  db: ic('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>'),
  chip: ic('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>'),
  refresh: ic('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),
  search: ic('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  arrow: ic('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'),
  x: ic('<path d="M18 6 6 18M6 6l12 12"/>'),
  info: ic('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11 12h1v4h1"/>'),
  warn: ic('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  lock: ic('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  unlock: ic('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.7-1.6"/>'),
  check: ic('<path d="M20 6 9 17l-5-5"/>'),
  bolt: ic('<path d="M13 2 3 14h7l-1 8 11-13h-7l1-7Z"/>'),
  key: ic('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 8.8-8.8"/><path d="m16 5 3 3"/>'),
  plug: ic('<path d="M9 2v6M15 2v6"/><path d="M6 8h12v4a6 6 0 0 1-12 0V8Z"/><path d="M12 18v4"/>'),
  sim: ic('<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M9 7h6M9 11h6M9 15h6"/>'),
  chev: ic('<path d="m6 9 6 6 6-6"/>'),
  dot: ic(''),
  clock: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  play: ic('<path d="M7 4.5v15l12-7.5-12-7.5Z"/>'),
  stop: ic('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  trash: ic('<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>'),
  phone: ic('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.27a2 2 0 0 1 2.1-.45c.9.34 1.84.57 2.8.7a2 2 0 0 1 1.7 2Z"/>'),
  info2: ic('<circle cx="12" cy="12" r="9"/><path d="M12 16v-5"/><path d="M12 8h.01"/>'),
  shield: ic('<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z"/>'),
  activity: ic('<path d="M22 12h-2.5a2 2 0 0 0-1.9 1.4l-2.1 7.5a.3.3 0 0 1-.6 0l-3.2-12a.3.3 0 0 0-.6 0l-2 7.4a2 2 0 0 1-1.9 1.4H2"/>'),
  route: ic('<circle cx="5" cy="19" r="2.6"/><circle cx="19" cy="5" r="2.6"/><path d="M7.5 19H16a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h8.5"/>'),
  gauge: ic('<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>'),
  globe: ic('<circle cx="12" cy="12" r="9"/><path d="M2.5 12h19M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18"/>'),
  cpu: ic('<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>'),
};

/* ================= Toast ================= */
const S_toasts = [];
let toastId = 0;
function toast(msg, tone = 'neutral') {
  const id = ++toastId;
  S_toasts.push({ id, msg, tone });
  renderToasts();
  setTimeout(() => { const i = S_toasts.findIndex(t => t.id === id); if (i >= 0) { S_toasts.splice(i, 1); renderToasts(); } }, 3600);
}
function renderToasts() {
  patch($('#toasts'), S_toasts.map(t => `<div class="toast ${t.tone}">${esc(t.msg)}</div>`).join(''));
}

/* ================= API（无登录） ================= */
const API = '/cgi-bin/fm170_api.cgi';
const CTRL = '/cgi-bin/fm170_control.cgi';
const DIAL = '/cgi-bin/fm170_dial.cgi';

async function apiGet(url, timeout = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ac.signal });
    let d;
    try { d = await r.json(); } catch (_) { throw new Error(`HTTP ${r.status}`); }
    if (!r.ok || !d || d.ok === false) throw new Error(String(d?.error || `接口返回错误 (HTTP ${r.status})`));
    return d;
  } finally { clearTimeout(t); }
}
async function apiPost(url, timeout = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { method: 'POST', cache: 'no-store', signal: ac.signal });
    let d;
    try { d = await r.json(); } catch (_) { throw new Error(`HTTP ${r.status}`); }
    if (!r.ok || !d || d.ok === false) throw new Error(String(d?.error || `接口返回错误 (HTTP ${r.status})`));
    return d;
  } finally { clearTimeout(t); }
}
const qs = (obj) => new URLSearchParams(Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v ?? '')]))).toString();
const ctrl = (action, params = {}) => apiGet(`${CTRL}?action=${action}&${qs({ ...params, ts: Date.now() })}`);
const dial = (action, params = {}) => apiGet(`${DIAL}?action=${action}&${qs({ ...params, ts: Date.now() })}`);

/* ================= 状态解析（status.json raw AT → 结构化） ================= */
const emptyServing = () => ({ rat: 'NR', mode: 'SA', operator: '', mcc: 0, mnc: 0, band: '--', bandwidth: 0, pci: 0, arfcn: 0, tac: 0, cellId: '--', scs: 0 });
const emptyCarrier = () => ({ pcc: { rat: 'NR', band: '--', pci: 0, arfcn: 0, dlBandwidth: 0, dlMimo: null, ulMimo: null, dlModulation: '--', ulModulation: '--', rsrp: null }, sccs: [], totalBandwidth: 0, activeSccCount: 0 });
const emptySession = () => ({ apn: '', pdpType: 'IP', cid: 0, ipv4: '', gateway: '', dns: [] });
const emptyCellDetail = () => ({ modeEnabled: false, ssbBeamId: 0, cqi: 0, power: 0, rank: '--', dlMcs: 0, ulMcs: 0, txQci: 0, rxQci: 0 });
const emptySim = () => ({ active: 0, sub: '', sysMode: '' });
const emptyReg = () => ({ lte: 0, nr: 0, cgreg: 0, cemode: 0, coopsAct: 0, roaming: false, plmnLocked: false });
const emptyLock = () => ({ enabled: false, rat: 'LTE', type: 'pci', arfcn: null, pci: null, scs: null, band: null });

/* 信号指标（CESQ） */
function parseSignal(raw, rat) {
  const n = splitAfter(lineStarts(raw, '+CESQ:'), '+CESQ:');
  const nrRsrp = num(n[7]), nrRsrq = num(n[6]), nrSinr = num(n[8]), lteRsrp = num(n[5]), lteRsrq = num(n[4]);
  if (rat === 'NR' && nrRsrp !== null && nrRsrp < 255) {
    const rsrp = nrRsrp - 156;
    const rsrq = nrRsrq !== null && nrRsrq < 255 ? Number((nrRsrq * 0.5 - 43).toFixed(1)) : null;
    const sinr = nrSinr !== null && nrSinr < 255 ? Number((nrSinr * 0.5 - 23).toFixed(1)) : null;
    return [
      { label: 'RSRP', value: rsrp, unit: 'dBm', min: -140, max: -40, tone: toneRsrp(rsrp), detail: 'NR ss_rsrp' },
      { label: 'RSRQ', value: rsrq, unit: 'dB', min: -20, max: -3, tone: toneSignal(rsrq, -10, -15), detail: 'NR ss_rsrq' },
      { label: 'SINR', value: sinr, unit: 'dB', min: -5, max: 30, tone: toneSignal(sinr, 15, 5), detail: 'NR ss_sinr' },
      { label: 'RSSI', value: null, unit: 'dBm', min: -120, max: -40, tone: 'neutral', detail: '+CSQ 返回 99,99' },
    ];
  }
  if (rat === 'LTE' && lteRsrp !== null && lteRsrp < 255) {
    const rsrp = lteRsrp - 140;
    const rsrq = lteRsrq !== null && lteRsrq < 255 ? Number((lteRsrq * 0.5 - 19.5).toFixed(1)) : null;
    return [
      { label: 'RSRP', value: rsrp, unit: 'dBm', min: -140, max: -40, tone: toneRsrp(rsrp), detail: 'LTE rsrp' },
      { label: 'RSRQ', value: rsrq, unit: 'dB', min: -20, max: -3, tone: toneSignal(rsrq, -10, -15), detail: 'LTE rsrq' },
      { label: 'SINR', value: null, unit: 'dB', min: -5, max: 30, tone: 'neutral', detail: 'LTE 无 ss_sinr' },
      { label: 'RSSI', value: null, unit: 'dBm', min: -120, max: -40, tone: 'neutral', detail: '+CSQ 返回 99,99' },
    ];
  }
  return [
    { label: 'RSRP', value: null, unit: 'dBm', min: -140, max: -40, tone: 'neutral', detail: 'CESQ 未返回有效值' },
    { label: 'RSRQ', value: null, unit: 'dB', min: -20, max: -3, tone: 'neutral', detail: 'CESQ 未返回有效值' },
    { label: 'SINR', value: null, unit: 'dB', min: -5, max: 30, tone: 'neutral', detail: 'CESQ 未返回有效值' },
    { label: 'RSSI', value: null, unit: 'dBm', min: -120, max: -40, tone: 'neutral', detail: '+CSQ 返回 99,99' },
  ];
}

/* 服务小区（GTCCINFO 的 Service cell 段） */
function parseServing(raw, copsName, copsAct) {
  const lines = splitLines(raw);
  let l = '';
  for (let i = 0; i < lines.length - 1; i++) if (/service cell:/i.test(lines[i])) { l = lines[i + 1].trim(); break; }
  if (!l) return emptyServing();
  const f = l.split(',');
  if (f.length < 10) return emptyServing();
  const rat = Number(f[1]) === 9 ? 'NR' : 'LTE';
  const bandRaw = num(f[8]), bw = num(f[9]), pci = hexNum(f[7]), arfcn = hexNum(f[6]);
  return {
    rat,
    mode: rat === 'NR' ? (copsAct === 13 ? 'NSA' : 'SA') : 'LTE',
    operator: copsName,
    mcc: num(f[2]) ?? 0,
    mnc: num(f[3]) ?? 0,
    band: Number.isFinite(bandRaw) && bandRaw > 0 ? bandName(rat, bandRaw) : '--',
    bandwidth: Number.isFinite(bw) && bw > 0 ? bw : 0,
    pci: pci ?? 0,
    arfcn: arfcn ?? 0,
    tac: hexOrDec(f[4]) ?? 0,
    cellId: String(hexOrDec(f[5]) ?? 0),
    scs: rat === 'NR' ? 30 : 15,
  };
}

/* 载波聚合（GTCAINFO） */
function parseCarrier(raw) {
  const pccLine = lineStarts(raw, 'PCC:');
  if (!pccLine) return emptyCarrier();
  const n = splitAfter(pccLine, 'PCC:');
  const band0 = num(n[0]);
  if (band0 === null) return emptyCarrier();
  const rat = band0 >= 500 ? 'NR' : 'LTE';
  const pcc = {
    rat,
    band: bandName(rat, band0),
    pci: num(n[1]) ?? 0,
    arfcn: num(n[2]) ?? 0,
    dlBandwidth: rat === 'NR' ? (Number(n[3]) === 0 ? 5 : num(n[3]) ?? 0) : lteBw(num(n[3]) ?? 0),
    dlMimo: num(n[4]),
    ulMimo: num(n[5]),
    dlModulation: modulation(num(n[6]) ?? 6),
    ulModulation: modulation(num(n[7]) ?? 6),
    rsrp: n[8] ? -Math.abs(num(n[8]) ?? 0) : null,
  };
  const sccs = [];
  for (const line of splitLines(raw)) {
    const m = line.trim().match(/^SCC\d+:\s*(.+)$/);
    if (!m) continue;
    const o = m[1].split(',').map(x => x.trim());
    const vk = num(o[2]), st = num(o[0]);
    const srat = vk !== null && vk >= 500 ? 'NR' : 'LTE';
    sccs.push({
      rat: srat,
      band: bandName(srat, vk ?? 0),
      pci: num(o[3]) ?? 0,
      arfcn: num(o[4]) ?? 0,
      dlBandwidth: srat === 'NR' ? (Number(o[5]) === 0 ? 5 : num(o[5]) ?? 0) : lteBw(num(o[5]) ?? 0),
      dlMimo: num(o[7]),
      ulMimo: num(o[8]),
      dlModulation: modulation(num(o[9]) ?? 6),
      ulModulation: modulation(num(o[10]) ?? 6),
      rsrp: o[11] ? -Math.abs(num(o[11]) ?? 0) : null,
      state: st === 2 ? 'active' : st === 1 ? 'configured' : undefined,
    });
  }
  const active = sccs.filter(s => s.state === 'active');
  return { pcc, sccs, totalBandwidth: pcc.dlBandwidth + active.reduce((a, s) => a + s.dlBandwidth, 0), activeSccCount: active.length };
}

/* 允许频段（GTACT） */
function parseAllowedBands(raw) {
  const t = splitAfter(lineStarts(raw, '+GTACT:'), '+GTACT:');
  const r = { umts: [], lte: [], nr: [] };
  for (const s of t.slice(3)) {
    const v = num(s);
    if (v !== null) (v >= 500 ? r.nr : v >= 100 ? r.lte : r.umts).push(v >= 500 ? (v >= 5000 ? v - 5000 : v - 500) : v >= 100 ? v - 100 : v);
  }
  return r;
}

/* 可用频段（GTACT=? 的括号组） */
const AVAILABLE_DEFAULTS = { umts: [1, 5, 8], lte: [1, 3, 5, 7, 8, 20, 28, 32, 38, 40, 41, 42, 43], nr: [1, 3, 5, 7, 8, 20, 28, 38, 40, 41, 75, 76, 77, 78] };
function parseAvailableBands(raw) {
  const line = lineStarts(raw, '+GTACT:').match(/^\+GTACT:\s*(.+)$/);
  if (!line) return null;
  const groups = [];
  const re = /\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(line[1])) !== null) groups.push(m[1].split(',').map(x => x.trim()).filter(Boolean));
  if (groups.length < 9) return null;
  const norm = arr => arr.map(x => Number(x)).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    umts: norm(groups[4]),
    lte: norm(groups[5]).map(x => x - 100),
    nr: norm(groups[8]).map(x => x >= 5000 ? x - 5000 : x - 500),
  };
}

/* 注册状态（CEREG / C5GREG / CGREG / CEMODE / ROAMCFG / PLMNLOCK） */
function parseRegistration(raw) {
  const r = emptyReg();
  const P = { CEREG: '+CEREG:', C5GREG: '+C5GREG:', CGREG: '+CGREG:', CEMODE: '+CEMODE:', ROAMCFG: '+GTROAMCFG:', PLMNLOCK: '+GTPLMNLOCK:' };
  const g = key => lineStarts(raw[key] ?? '', P[key]);
  r.lte = num(splitAfter(g('CEREG'), P.CEREG)[1]) ?? 0;
  r.nr = num(splitAfter(g('C5GREG'), P.C5GREG)[1]) ?? 0;
  r.cgreg = num(splitAfter(g('CGREG'), P.CGREG)[1]) ?? 0;
  r.cemode = num(splitAfter(g('CEMODE'), P.CEMODE)[0]) ?? 0;
  r.roaming = r.lte === 5 || r.nr === 5 || num(splitAfter(g('ROAMCFG'), P.ROAMCFG)[1]) === 1;
  r.plmnLocked = num(splitAfter(g('PLMNLOCK'), P.PLMNLOCK)[0]) === 1;
  return r;
}

/* SIM（GTDUALSIM） */
function parseSim(raw) {
  const t = splitAfter(lineStarts(raw, '+GTDUALSIM:'), '+GTDUALSIM:');
  const n = num(t[0]);
  return n === null ? emptySim() : { active: n, sub: stripQuotes(t[1]) || '--', sysMode: stripQuotes(t[2]) || '--' };
}

/* APN 上下文（CGDCONT） */
function parseApnContexts(raw) {
  const out = [];
  for (const l of splitLines(raw)) {
    if (!l.trim().startsWith('+CGDCONT:')) continue;
    const i = splitAfter(l, '+CGDCONT:');
    const cid = num(i[0]), apn = stripQuotes(i[2]);
    if (cid === null || !apn) continue;
    out.push({ cid, pdpType: stripQuotes(i[1]), apn });
  }
  return out;
}
const maskBits = arr => arr.reduce((t, n) => t + Math.max(0, n.toString(2).split('1').length - 1), 0);

/* 数据会话（CGCONTRDP） */
function parseDataSession(raw, contexts) {
  for (const l of splitLines(raw)) {
    if (!l.trim().startsWith('+CGCONTRDP:')) continue;
    const u = splitAfter(l, '+CGCONTRDP:');
    const ipRaw = stripQuotes(u[3]);
    const parts = ipRaw.split('.').map(Number);
    if (!ipRaw || parts.length !== 8 || parts.slice(0, 4).some(k => !Number.isFinite(k))) continue;
    const cid = num(u[0]);
    const ctx = contexts.find(c => c.cid === cid);
    const gw = stripQuotes(u[4]);
    const dns = [stripQuotes(u[5]), stripQuotes(u[6])].filter(x => x && x !== '0.0.0.0');
    return {
      apn: stripQuotes(u[2]) || ctx?.apn || '--',
      pdpType: ctx?.pdpType || 'IP',
      cid: cid ?? 0,
      ipv4: `${parts.slice(0, 4).join('.')}/${maskBits(parts.slice(4, 8))}`,
      gateway: gw && gw !== '0.0.0.0' ? gw : '--',
      dns,
    };
  }
  return emptySession();
}

/* 无线详情（GTCELLINFO） */
function parseCellDetail(raw) {
  const d = emptyCellDetail();
  d.modeEnabled = num(splitAfter(lineStarts(raw, '+GTCELLINFO:'), '+GTCELLINFO:')[0]) === 1;
  for (const l of splitLines(raw)) {
    const m = l.trim().match(/^([A-Za-z0-9_]+):\s*(.+)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'ssb_beamid') d.ssbBeamId = Number(v) || 0;
    if (k === 'nr_cqi' || k === 'cqi') d.cqi = Number(v) || 0;
    if (k === 'nr_power' || k === 'power') d.power = Number(v) || 0;
    if (k === 'nr_rank' || k === 'rank') d.rank = v;
    if (k === 'nr_dlmcs' || k === 'dlmcs') d.dlMcs = Number(v) || 0;
    if (k === 'nr_ulmcs' || k === 'ulmcs') d.ulMcs = Number(v) || 0;
    if (k === 'tx_5g_qci' || k === 'tx_lte_qci') d.txQci = Number(v) || 0;
    if (k === 'rx_5g_qci' || k === 'rx_lte_qci') d.rxQci = Number(v) || 0;
  }
  return d;
}

/* 小区锁定（GTCELLLOCK） */
function parseLock(raw) {
  const t = splitAfter(lineStarts(raw, '+GTCELLLOCK:'), '+GTCELLLOCK:');
  return {
    enabled: num(t[0]) === 1,
    rat: num(t[1]) === 1 ? 'NR' : 'LTE',
    type: num(t[2]) === 1 ? 'frequency' : 'pci',
    arfcn: num(t[3]),
    pci: num(t[4]),
    scs: num(t[5]),
    band: num(t[6]),
  };
}

/* 漫游（GTROAMCFG） */
function parseRoaming(raw) {
  const t = splitAfter(lineStarts(raw, '+GTROAMCFG:'), '+GTROAMCFG:');
  return { allowed: num(t[0]) === 1, roaming: num(t[1]) === 1 };
}

/* 邻区解析（scan raw → 结构化） */
function parseNeighbors(raw, serving) {
  const out = [];
  for (const l of splitLines(raw)) {
    const m = l.match(/^\+GTCELLSCAN:\s*(\d+),(.+)$/);
    if (!m || /no sib1/i.test(m[2])) continue;
    const k = m[2].split(',');
    if (k.length < 10) continue;
    const rat = Number(m[1]) === 5 ? 'NR' : 'LTE';
    const band = num(k[8]);
    out.push({
      rat,
      band: bandName(rat, band ?? 0),
      pci: hexNum(k[3]) ?? 0,
      rsrp: num(k[6]),
      rsrq: num(k[7]),
      srxlev: num(k[9]) ?? 0,
      squal: num(k[10]) ?? 0,
      arfcn: hexNum(k[2]) ?? 0,
      tac: hexNum(k[4]) ?? 0,
      cellId: String(hexNum(k[5]) ?? 0),
      mcc: num(k[0]) ?? 0,
      mnc: num(k[1]) ?? 0,
      serving: serving && pciOf(serving.pci) === pciOf(hexNum(k[3])) && serving.arfcn === hexNum(k[2]) && serving.rat === rat,
    });
  }
  return out;
}

/* ================= 全局状态 ================= */
const S = {
  connected: false,           // 是否有可展示的状态数据（真实请求或缓存）
  statusError: '',
  updatedAt: '',
  statusPort: '/dev/ttyUSB2', controlPort: '/dev/ttyUSB1',
  model: 'FM170-EAU', firmware: '',
  operator: '', networkModeLabel: '', networkModeId: 0,
  signal: { metrics: [] },
  registration: emptyReg(),
  serving: emptyServing(),
  carrier: emptyCarrier(),
  allowedBands: { umts: [], lte: [], nr: [] },
  availableBands: { ...AVAILABLE_DEFAULTS },
  cellLock: emptyLock(),
  sim: emptySim(),
  apnContexts: [],
  roaming: { allowed: false, roaming: false },
  cellDetail: emptyCellDetail(),
  dataSession: emptySession(),
  // 扫描
  scan: { ok: false, jobId: '', status: 'idle', trigger: 'manual', startedAt: null, elapsed: 0, finishedAt: null, resultCount: 0, error: '', timeout: 120, attempts: 0, maxAttempts: 2, port: '/dev/ttyUSB1', epoch: 0, updatedAt: '' },
  scanResult: { ok: false, status: 'idle', jobId: '', startedAt: '', finishedAt: '', duration: 0, resultCount: 0, raw: '', cells: [], parserError: '', timestamp: '', scanId: '', scannedAt: '', scanEpoch: 0 },
  scanBusy: false,
  // 短信
  sms: { messages: [], unread: 0, busy: false },
  // 拨号
  dial: { data: null, busy: false },
  // UI
  route: 'dashboard',
  filters: { q: '', rat: 'all', band: 'all', rsrp: null, sort: 'rsrp' },
  selected: [],
  manualOpen: false,
  manual: { rat: 'NR', type: 'pci', arfcn: 633984, pci: 246, scs: 30, band: 78 },
  pendingLockState: '',
  scanTick: 0,
  at: { preset: '', out: '等待执行…', busy: false },
};

function statusConnected() { return S.connected && (isReg(S.registration.lte) || isReg(S.registration.nr) || isReg(S.registration.cgreg)); }
function opName() {
  const sv = S.serving;
  return sv.mcc && sv.mnc ? resolveOperator({ mcc: sv.mcc, mnc: sv.mnc }) : resolveOperator(S.operator);
}
const viewEl = () => $('#view');
const currentViewName = () => { const v = viewEl() && viewEl().querySelector('.view'); return v ? v.dataset.view : ''; };

/* ================= 按需采集：租约 + 状态获取 =================
 * 调度器只在租约有效时执行状态 AT 采集：
 *   - 页面加载调用 ui_open，之后每 20s 续租，pagehide 时 ui_close
 *   - 状态数据默认展示 localStorage 缓存；点“手动刷新”才重新读取完整状态
 *   - 视图切换时若距上次真实获取超过 20s，也自动补一次（保证进入页面数据较新）
 */
const LEASE_KEY = 'fm170_status_lease_v1';
const CACHE_KEY = 'fm170_status_cache_v1';
let leaseTimer = 0, lastFreshAt = 0, statusBusy = false, statusRetry = 0;

function lease(act) { fetch(`${API}?action=${act}&ts=${Date.now()}`, { cache: 'no-store', keepalive: true }).catch(() => {}); }
function startLease() {
  lease('ui_open');
  clearInterval(leaseTimer);
  leaseTimer = setInterval(() => lease('ui_open'), 20000);
  window.addEventListener('pagehide', () => { clearInterval(leaseTimer); lease('ui_close'); }, { once: true });
}

function readCache() {
  try { const s = localStorage.getItem(CACHE_KEY); return s ? JSON.parse(s) : null; } catch (_) { return null; }
}
function writeCache(data) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (_) {} }

function applyStatus(data) {
  const raw = data.raw || {};
  const cops = splitAfter(lineStarts(raw.COPS, '+COPS:'), '+COPS:');
  const copsName = stripQuotes(cops[2]);
  const copsAct = num(cops[cops.length - 1]) ?? 0;
  const gtactLine = lineStarts(raw.GTACT, '+GTACT:');
  const reg = parseRegistration(raw);
  const connected = isReg(reg.lte) || isReg(reg.nr) || isReg(reg.cgreg);
  const serving = connected ? parseServing(raw.GTCCINFO, copsName, copsAct) : emptyServing();
  const signal = connected ? parseSignal(raw.CESQ, serving.rat) : [];
  const available = connected ? parseAvailableBands(raw.GTACTTEST) : null;
  const allowed = parseAllowedBands(raw.GTACT);
  const contexts = parseApnContexts(raw.CGDCONT);

  S.updatedAt = data.updatedAt || nowText();
  S.statusPort = data.statusPort || data.port || S.statusPort;
  S.controlPort = data.controlPort || S.controlPort;
  S.model = stripQuotes(splitAfter(lineStarts(raw.CGMM, '+CGMM:'), '+CGMM:')[0]) || S.model;
  S.firmware = stripQuotes(splitAfter(lineStarts(raw.CGMR, '+CGMR:'), '+CGMR:')[0]) || S.firmware;
  S.operator = connected ? ((serving.mcc || serving.mnc) ? (resolveOperator({ mcc: serving.mcc, mnc: serving.mnc }) || copsName) : copsName) : '';
  S.networkModeLabel = connected && gtactLine ? modeName(num(splitAfter(gtactLine, '+GTACT:')[0])) : '';
  S.networkModeId = connected && gtactLine ? (num(splitAfter(gtactLine, '+GTACT:')[0]) ?? 0) : 0;
  S.signal.metrics = connected ? signal : [];
  S.registration = reg;
  S.serving = serving;
  S.carrier = connected ? parseCarrier(raw.GTCAINFO) : emptyCarrier();
  S.allowedBands = connected && (allowed.umts.length || allowed.lte.length || allowed.nr.length) ? allowed : { umts: [], lte: [], nr: [] };
  S.availableBands = connected && available ? available : { ...AVAILABLE_DEFAULTS };
  S.cellLock = connected ? parseLock(raw.CELLLOCK) : emptyLock();
  S.sim = connected ? parseSim(raw.DUALSIM) : emptySim();
  S.apnContexts = connected && contexts.length ? contexts : [];
  S.roaming = connected ? parseRoaming(raw.ROAMCFG) : { allowed: false, roaming: false };
  S.cellDetail = connected ? parseCellDetail(raw.GTCELLINFO) : emptyCellDetail();
  S.dataSession = connected ? parseDataSession(raw.CGCONTRDP, contexts) : emptySession();
}

function loadStatus(force) {
  if (statusBusy) return;
  const fresh = Date.now() - lastFreshAt <= 20000;
  if (!force && fresh && S.connected) return;
  statusBusy = true;
  const hadData = S.connected;
  // 先展示缓存，避免白屏/离线闪烁
  if (!hadData) {
    const cached = readCache();
    if (cached && cached.raw) { applyStatus(cached); S.connected = true; renderAll(); }
  }
  apiGet(`${API}?action=status&ts=${Date.now()}`, 10000)
    .then(d => {
      if (!d || !d.raw) throw new Error(d?.error || '状态数据暂不可用');
      applyStatus(d);
      if (d.fresh !== false) {
        // 新鲜数据：写缓存、结束重试
        writeCache(d);
        lastFreshAt = Date.now();
        statusRetry = 0;
        if (!S.connected) toast('已连接状态接口', 'good');
        S.connected = true;
        S.statusError = '';
        renderAll();
      } else {
        // 数据偏旧（按需采集唤醒初期）：照常展示，后台自动重试直到新鲜
        S.connected = true;
        renderAll();
        if (statusRetry < 5) {
          statusRetry++;
          setTimeout(() => { statusBusy = false; loadStatus(true); }, 2000);
          return;
        }
        statusRetry = 0;
        toast('状态数据偏旧，已展示最近一次结果', 'warn');
      }
    })
    .catch(e => {
      S.statusError = e.message || String(e);
      // 按需采集下调度器可能刚被 ui_open 唤醒、数据尚未就绪 -> 短暂自动重试
      if (statusRetry < 5) {
        statusRetry++;
        setTimeout(() => { statusBusy = false; loadStatus(true); }, 2000);
        return;
      }
      statusRetry = 0;
      if (!S.connected) { S.connected = false; toast('状态接口不可用', 'warn'); }
      else toast('状态刷新失败，继续展示缓存数据', 'warn');
      renderAll();
    })
    .finally(() => { statusBusy = false; });
}

/* ================= 扫描轮询 ================= */
const SCAN_FAST = 1500, SCAN_MAX_BACKOFF = 15000;
let scanTimer = 0, scanLoopOn = false, scanBackoff = SCAN_FAST;

function scanActive() { return S.scan.status === 'starting' || S.scan.status === 'running'; }

async function pollScan() {
  const st = await apiGet(`${API}?action=cellscan_status&ts=${Date.now()}`);
  S.scan.ok = !!st.ok;
  S.scan.status = st.status || S.scan.status;
  if (st.trigger !== undefined) S.scan.trigger = st.trigger === 'auto' ? 'auto' : 'manual';
  if (st.jobId !== undefined) S.scan.jobId = st.jobId;
  if (st.startedAt !== undefined) S.scan.startedAt = st.startedAt;
  if (st.finishedAt !== undefined) S.scan.finishedAt = st.finishedAt;
  S.scan.elapsed = Number.isFinite(Number(st.elapsed)) ? Number(st.elapsed) : 0;
  if (st.resultCount !== undefined) S.scan.resultCount = Number(st.resultCount);
  if (st.attempts !== undefined) S.scan.attempts = Number(st.attempts);
  if (st.maxAttempts !== undefined) S.scan.maxAttempts = Number(st.maxAttempts);
  if (st.error !== undefined) S.scan.error = st.error;
  const to = Number(st.timeout);
  S.scan.timeout = Number.isFinite(to) && to > 0 ? to : 120;
  if (st.port !== undefined) S.scan.port = st.port;
  if (st.epoch !== undefined) S.scan.epoch = Number(st.epoch);
  S.scan.updatedAt = st.updatedAt || S.scan.updatedAt;
  if (['completed', 'timeout', 'failed'].includes(S.scan.status)) await maybeFetchScanResult();
  renderAll();
  return st;
}

async function maybeFetchScanResult() {
  try {
    const t = await apiGet(`${API}?action=cellscan_result&ts=${Date.now()}`);
    if (!t || t.status !== 'completed') {
      if (!S.scanResult.cells.length) S.scanResult = { ...S.scanResult, status: 'idle', cells: [], resultCount: 0 };
      return;
    }
    const cells = Array.isArray(t.cells) ? t.cells : [];
    const rawCells = parseNeighbors(t.raw || '', S.serving);
    const newEpoch = epochOf(t.jobId) || epochOf(t.finishedAt) || 0;
    if (newEpoch > 0 && newEpoch < S.scanResult.scanEpoch) return;
    let list = cells.map(g => {
      const m = rawCells.find(c => pciOf(c.pci) === pciOf(g.pci) && c.rat === g.rat);
      const op = (g.mcc || g.mnc) ? resolveOperator({ mcc: g.mcc, mnc: g.mnc }) : undefined;
      return {
        ...g,
        band: /^[BbNn]\d+$/.test(g.band || '') ? g.band : bandName(g.rat, Number(g.band)),
        arfcn: m?.arfcn ?? g.arfcn,
        serving: m ? m.serving : undefined,
        opName: op && op !== '未知运营商' ? op : undefined,
      };
    });
    if (!list.length) list = rawCells;
    const dur = Number(t.duration), cnt = Number(t.resultCount);
    S.scanResult = {
      ok: !!t.ok, status: 'completed',
      jobId: t.jobId || S.scanResult.jobId,
      startedAt: t.startedAt || S.scanResult.startedAt,
      finishedAt: t.finishedAt || S.scanResult.finishedAt,
      duration: Number.isFinite(dur) ? dur : 0,
      resultCount: Number.isFinite(cnt) ? cnt : list.length,
      raw: t.raw || '',
      cells: list,
      parserError: t.parserError || '',
      timestamp: t.timestamp || t.finishedAt,
      scanId: t.jobId || S.scanResult.scanId || '',
      scannedAt: t.finishedAt || S.scanResult.scannedAt || '',
      scanEpoch: newEpoch,
    };
  } catch (_) {}
}

function scanTickLoop() {
  if (scanLoopOn) return;
  scanLoopOn = true;
  const tick = async () => {
    try { await pollScan(); scanBackoff = SCAN_FAST; }
    catch (_) { scanBackoff = Math.min(scanBackoff * 2, SCAN_MAX_BACKOFF); }
    // 离开邻区页且扫描已结束 -> 停止轮询；扫描中 1.5s 快刷，空闲/完成 5s 慢刷
    if (!scanActive() && currentViewName() !== 'neighbors') { stopScanLoop(); return; }
    scanTimer = setTimeout(tick, scanActive() ? SCAN_FAST : 5000);
  };
  scanTimer = setTimeout(tick, 300);
}
function stopScanLoop() { scanLoopOn = false; clearTimeout(scanTimer); }

async function startScan() {
  if (scanActive()) { toast('扫描正在进行中，本次请求将使用当前扫描结果', 'warn'); return; }
  if (S.scanBusy) return;
  S.scanBusy = true;
  try {
    const s = await apiPost(`${API}?action=cellscan_start&ts=${Date.now()}`, 30000);
    if (s.status === 'already_running') {
      S.scan.status = 'running';
      await pollScan();
      toast('扫描正在进行中，本次请求将使用当前扫描结果', 'warn');
      scanTickLoop();
      return;
    }
    S.scan = {
      ok: true, jobId: String(s.jobId || ''), status: 'running', trigger: s.trigger === 'auto' ? 'auto' : 'manual',
      startedAt: s.startedAt ? String(s.startedAt) : null, elapsed: 0, finishedAt: null, resultCount: 0,
      error: '', timeout: Number.isFinite(Number(s.timeout)) && Number(s.timeout) > 0 ? Number(s.timeout) : 120,
      attempts: 1, maxAttempts: 2, port: String(s.port || '/dev/ttyUSB1'), epoch: 0, updatedAt: nowText(),
    };
    toast('扫描已提交到 Port B 后台任务', 'good');
    renderAll();
    scanTickLoop();
  } catch (e) { toast(e.message || '扫描提交失败', 'warn'); }
  finally { S.scanBusy = false; }
}
function refreshScanNow() { pollScan().catch(e => toast(e.message || '扫描状态刷新失败', 'warn')); }

/* ================= 控制操作（免登录） ================= */
async function doCellLock(p) {
  const d = await ctrl('cell_lock', {
    rat: p.rat === 'NR' ? 1 : 0,
    type: p.type === 'frequency' ? 1 : 0,
    arfcn: p.arfcn, pci: p.pci,
    scs: p.scs,
    band: p.rat === 'NR' ? encodeBand(p.band) : 0,
  });
  if (d.ok === false) throw new Error(d.error || '小区锁定失败');
  return d;
}
async function doCellUnlock() { return ctrl('cell_unlock'); }
async function doMultiLock(p) { return ctrl('multi_cell_lock', { rat: p.rat, count: p.count, pairs: p.pairs }); }
async function doNetworkMode(mode) { return ctrl('network_mode', { mode }); }
async function doBandLock(bands, rat) { return ctrl('band_lock', { bands, rat: rat || '' }); }
async function doPlmnLock(on) { return ctrl('plmn_lock', { enabled: on ? 1 : 0, plmn: '46011' }); }
async function doCellInfoMode(on) { return ctrl('cellinfo_mode', { enabled: on ? 1 : 0 }); }
async function doRestart() { return ctrl('restart', { confirm: 1 }); }
async function doFreeAt(cmd) {
  const d = await apiGet(`${CTRL}?action=at&cmd=${encodeURIComponent(cmd)}&ts=${Date.now()}`, 20000);
  if (d.ok === false) throw new Error(d.error || 'AT 指令执行失败');
  return d.raw ?? '';
}
const encodeBand = b => (b >= 500 && b <= 50512) ? b : (b >= 100 ? 50000 + b : b >= 10 ? 5000 + b : 500 + b);

/* 锁定命令预览（与旧前端一致） */
const lockCmd = p => {
  if (p.rat === 'NR') {
    const scs = p.scs === 1 ? 1 : 0;
    const b = encodeBand(p.band);
    return p.type === 'pci' ? `AT+GTCELLLOCK=1,1,0,${p.arfcn},${p.pci},${scs},${b}` : `AT+GTCELLLOCK=1,1,1,${p.arfcn},,${scs}`;
  }
  return p.type === 'pci' ? `AT+GTCELLLOCK=1,0,0,${p.arfcn},${p.pci}` : `AT+GTCELLLOCK=1,0,1,${p.arfcn}`;
};
const multiLockCmd = list => {
  if (!list.length) return '';
  const rat = list[0].rat;
  if (!list.every(c => c.rat === rat)) return '';
  const r = rat === 'NR' ? 1 : 0;
  return `AT+GTFREQLOCK=${r},${list.length},${list.map(c => `${c.arfcn},${c.pci}`).join(',')}`;
};

/* ================= 渲染调度 ================= */
let renderRAF = 0;
function scheduleRender() {
  if (renderRAF) return;
  renderRAF = requestAnimationFrame(() => { renderRAF = 0; renderAll(); });
}
function renderAll() {
  updateShell();
  const v = currentView();
  if (v) v.update();
}

/* ================= 页面骨架（shell） ================= */
const NAV = [
  { id: 'dashboard', label: '首页', icon: 'home' },
  { id: 'carrier', label: '载波', icon: 'layers' },
  { id: 'neighbors', label: '邻区', icon: 'radar' },
  { id: 'sms', label: '短信', icon: 'sms' },
  { id: 'dial', label: '拨号', icon: 'dial' },
  { id: 'settings', label: '设置', icon: 'gear' },
];

function shellHTML() {
  const ok = statusConnected();
  const pill = ok ? '<span class="pill good">已连接</span>' : S.connected ? '<span class="pill warn">未连接</span>' : '<span class="pill warn">接口离线</span>';
  const nav = NAV.map(n => `<a class="nav-link${S.route === n.id ? ' active' : ''}" href="#/${n.id}" data-nav="${n.id}">${I[n.icon]}<span>${n.label}</span></a>`).join('');
  const mobile = NAV.map(n => `<a class="mobile-link${S.route === n.id ? ' active' : ''}" href="#/${n.id}" data-nav="${n.id}">${I[n.icon]}<span>${n.label}</span></a>`).join('');
  return `
  <div class="app">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">${I.shield}</div>
      <div>
        <div class="brand-name">FM170 WebUI</div>
        <div class="brand-sub">5G 模块管理</div>
      </div>
    </div>
    <nav class="nav">${nav}</nav>
    <div class="sidebar-foot">
      <div class="sb-modem"><span class="sb-name">${esc(S.model)}</span>${pill}</div>
      <div class="sb-ports"><span>状态口 ${esc(S.statusPort.replace('/dev/', ''))}</span><span>控制口 ${esc(S.controlPort.replace('/dev/', ''))}</span></div>
    </div>
  </aside>
  <div class="main">
    <header class="topbar">
      <div class="tb-left">
        <div class="tb-model">${esc(S.model)}</div>
        <div class="tb-ports" title="${esc(S.statusPort)} / ${esc(S.controlPort)}">${esc(S.statusPort)} / ${esc(S.controlPort)}</div>
      </div>
      <div class="tb-right">
        ${pill}
        <span class="pill">${S.updatedAt ? '更新于 ' + esc(S.updatedAt.slice(11, 16)) : '尚未读取'}</span>
        <button class="btn is-primary sm" type="button" data-act="manual-refresh" title="重新读取模块状态">${I.refresh}<span>手动刷新</span></button>
      </div>
    </header>
    <main class="page"><div id="view"></div></main>
  </div>
  <nav class="mobile-bar" aria-label="主导航">${mobile}</nav>
  </div>
  <div class="toasts" id="toasts"></div>
  `;
}
function updateShell() {
  const app = $('#app');
  if (!app) return;
  if (!app.querySelector('.sidebar')) { app.innerHTML = shellHTML(); renderToasts(); return; }
  const ok = statusConnected();
  const pillTxt = ok ? '已连接' : (S.connected ? '未连接' : '接口离线');
  const tone = ok ? 'good' : 'warn';
  const pills = document.querySelectorAll('.sb-modem .pill, .tb-right .pill');
  pills.forEach(el => {
    if (el.className !== `pill ${tone}`) el.className = `pill ${tone}`;
    if (el.textContent !== pillTxt) el.textContent = pillTxt;
  });
  const clock = document.querySelectorAll('.tb-right .pill')[1];
  if (clock) { const t = S.updatedAt ? '更新于 ' + S.updatedAt.slice(11, 16) : '尚未读取'; if (clock.textContent !== t) clock.textContent = t; }
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === S.route));
}

/* ================= 视图工具 ================= */
/* patch：内容级 diff 更新，避免整块 innerHTML 重复写入导致闪烁/焦点丢失 */
const _patchCache = new WeakMap();
function patch(el, html) {
  if (!el) return;
  if (_patchCache.get(el) === html) return;
  _patchCache.set(el, html);
  el.innerHTML = html;
}
/* 文本更新：仅变化时写入，避免无意义 DOM 操作 */
function setText(el, txt) {
  if (!el || el.textContent === txt) return;
  el.textContent = txt;
}
function focusTyping() {
  const ae = document.activeElement;
  return ae && ['INPUT', 'TEXTAREA'].includes(ae.tagName);
}
/* 空状态统一组件（图标上限 96px，flex 居中，不撑高布局） */
function emptyState({ icon = '', title = '暂无数据', hint = '' } = {}) {
  return `<div class="empty-state">
    <div class="es-ic">${icon || I.info2}</div>
    ${title ? `<div class="es-title">${esc(title)}</div>` : ''}
    ${hint ? `<div class="es-hint">${esc(hint)}</div>` : ''}
  </div>`;
}
function pill(tone, label) { return `<span class="pill ${tone}">${esc(label)}</span>`; }
function metricHtml(m) {
  const tone = m.accent || '';
  return `<div class="metric ${tone}"><div class="metric-lb">${esc(m.label)}</div><div class="metric-val">${m.value === null || m.value === '' ? '--' : esc(m.value)}</div>${m.detail ? `<div class="metric-dt">${esc(m.detail)}</div>` : ''}</div>`;
}
function metricGrid(ms, cls = '') { return `<div class="mgrid ${cls}">${ms.map(metricHtml).join('')}</div>`; }
function card(opts, body, extra = '') {
  const actions = opts.actions ? `<div class="card-actions">${opts.actions}</div>` : '';
  return `<section class="card ${opts.cls || ''}">
    <div class="card-hd">
      <div class="card-tt">${opts.eyebrow ? `<div class="card-eyebrow">${esc(opts.eyebrow)}</div>` : ''}<h3 class="card-title">${esc(opts.title)}</h3></div>
      ${actions}
    </div>
    <div class="card-bd">${body}</div>
    ${extra}
  </section>`;
}

/* ================= 视图：首页 ================= */
const Dashboard = {
  html() {
    return `<div class="view" data-view="dashboard">
      <div class="hero" id="dash-hero"></div>
      <div class="bento" id="dash-grid"></div>
    </div>`;
  },
  update() {
    const ok = statusConnected();
    const sv = S.serving;
    const hero = $('#dash-hero');
    if (hero) {
      const line = ok ? `${esc(opName())} · ${sv.mode} · ${sv.band}` : '暂无实时数据';
      patch(hero, `
        <div class="hero-copy">
          <div class="hero-kicker">5G 模块总览</div>
          <div class="hero-title">${esc(S.model)}</div>
          <div class="hero-line">${line}</div>
        </div>
        <div class="hero-side">
          ${pill('neutral', S.updatedAt ? '更新于 ' + esc(S.updatedAt.slice(11, 16)) : '尚未读取')}
          ${ok ? pill('good', '已连接') : pill('warn', S.connected ? '未连接' : '接口离线')}
          <div class="hero-band">${ok ? esc(sv.band) : '--'}</div>
          <div class="hero-bw">${ok ? `${sv.bandwidth} MHz` : '--'}</div>
        </div>`);
    }
    const grid = $('#dash-grid');
    if (!grid) return;
    const scc = S.carrier.activeSccCount, sccTotal = S.carrier.sccs.length;
    const caNote = ok ? (sccTotal ? (scc > 0 ? `${scc} 个 SCC 正在聚合，网络持续调度。` : `${sccTotal} 个 SCC 已配置但未激活，由网络调度决定。`) : '模块当前未上报已激活的 SCC。') : '模块未连接或未返回 GTCAINFO。';
    const dt = (v) => ok ? v : '--';
    const detail = v => S.cellDetail.modeEnabled ? v : null;
    patch(grid, `
      ${card({ title: '信号', eyebrow: `${esc(S.statusPort.replace('/dev/',''))} · AT+CESQ`, cls: 'sig', actions: ok ? pill('good', '良好') : pill('neutral', '不可用') },
        `<div class="sbars">${S.signal.metrics.map(m => {
          const pct = m.value === null ? 0 : Math.min(100, Math.max(0, (m.value - m.min) / (m.max - m.min) * 100));
          return `<div class="sbar tone-${m.tone}">
            <div class="sbar-meta"><span class="sbar-lb">${m.label}</span><span class="sbar-val">${m.value !== null ? m.value + ' ' + m.unit : '--'}</span></div>
            <div class="sbar-track"><span class="sbar-fill" style="width:${pct}%"></span></div>
            <div class="sbar-dt">${m.detail}</div>
          </div>`;
        }).join('')}</div>`)}
      ${card({ title: '网络', eyebrow: '注册状态' },
        `<div class="net-hero">
          <div class="net-mode">${ok ? esc(sv.mode) : '--'}</div>
          <div class="net-sub">${ok ? `${esc(sv.band)} · ${sv.bandwidth} MHz` : '--'}</div>
          <div class="net-sub">${ok ? `PCI ${sv.pci}` : '--'}</div>
        </div>` + metricGrid([
          { label: '运营商', value: opName() },
          { label: 'LTE', value: ok ? regText(S.registration.lte) : '--', accent: ok ? (S.registration.lte === 1 || S.registration.lte === 5 ? 'good' : 'bad') : '' },
          { label: 'NR', value: ok ? regText(S.registration.nr) : '--', accent: ok ? (S.registration.nr === 1 || S.registration.nr === 5 ? 'good' : 'bad') : '' },
        ]))}
      ${card({ title: '载波聚合', eyebrow: `${esc(S.statusPort.replace('/dev/',''))} · AT+GTCAINFO`, actions: ok ? pill('neutral', `${S.carrier.activeSccCount} 个 SCC`) : pill('warn', '接口离线') },
        `<div class="ca-overview">
          <div class="ca-total">${ok ? `${S.carrier.totalBandwidth}` : '--'}<small> MHz</small></div>
          <div class="ca-pcc"><span>PCC</span><strong>${ok ? esc(S.carrier.pcc.band) : '--'}</strong></div>
        </div>
        <div class="ca-note">${esc(caNote)}</div>`)}
      ${card({ title: '小区', eyebrow: '服务小区' },
        `<div class="cell-hero">
          <div class="cell-band">${ok ? esc(sv.band) : '--'}</div>
          <div class="cell-pci">${ok ? `PCI ${sv.pci}` : '--'}</div>
        </div>` + metricGrid([
          { label: 'ARFCN', value: dt(sv.arfcn) },
          { label: '带宽', value: ok ? `${sv.bandwidth} MHz` : '--' },
          { label: 'TAC', value: dt(sv.tac) },
          { label: '小区 ID', value: dt(sv.cellId), detail: '十进制' },
        ]))}
      ${card({ title: '数据会话', eyebrow: 'QMI 数据通道' },
        `<div class="session-route">
          <span class="dot ${S.dataSession.ipv4 ? 'good' : 'neutral'}"></span>
          <span>${esc(S.dataSession.ipv4 ? S.dataSession.apn : '未建立数据会话')}</span>
          <span>${esc(S.dataSession.ipv4 || '无 IP')}</span>
        </div>` + metricGrid([
          { label: '网关', value: S.dataSession.gateway || '--' },
          { label: 'DNS 1', value: S.dataSession.dns[0] || '--' },
        ]))}
      ${card({ title: '模块', eyebrow: 'ATI / GTCELLINFO' },
        `<div class="module-grid">` + metricGrid([
          { label: '固件', value: S.firmware || '--' },
          { label: 'CQI', value: detail(S.cellDetail.cqi), detail: 'NR' },
          { label: '秩', value: detail(S.cellDetail.rank) },
          { label: '波束 ID', value: detail(S.cellDetail.ssbBeamId) },
          { label: '下行 MCS', value: detail(S.cellDetail.dlMcs) },
          { label: '上行 MCS', value: detail(S.cellDetail.ulMcs) },
        ]) + `</div>
        <div class="chip-row">
          <span class="chip good">${ok ? esc(sv.band) : '--'}</span>
          <span class="chip">${S.allowedBands.umts.length || S.allowedBands.lte.length || S.allowedBands.nr.length ? '允许 ' + ['umts','lte','nr'].filter(k => S.allowedBands[k].length).map(k => k.toUpperCase()).join(' / ') + ' 频段' : '允许频段'}</span>
        </div>`)}
    `);
  },
};

/* ================= 视图：载波 ================= */
const Carrier = {
  html() {
    return `<div class="view" data-view="carrier">
      <div class="view-head">
        <div class="view-title"><div class="view-kicker">当前载波聚合</div><h1>载波</h1></div>
        <div class="view-actions" id="car-head-acts"></div>
      </div>
      <div class="grid-2">
        <div id="car-ca"></div>
        <div id="car-bands"></div>
      </div>
    </div>`;
  },
  update() {
    const ok = statusConnected();
    const acts = $('#car-head-acts');
    if (acts) {
      const n = ok ? (S.carrier.sccs.length ? `${S.carrier.activeSccCount} 个活跃 SCC / ${S.carrier.sccs.length} 个已上报` : '仅 PCC') : '接口离线';
      patch(acts, `${pill('neutral', S.updatedAt ? '更新于 ' + esc(S.updatedAt.slice(11, 16)) : '尚未读取')} ${ok ? (S.carrier.activeSccCount > 0 ? pill('good', n) : pill('neutral', n)) : pill('warn', n)}`);
    }
    const ca = $('#car-ca');
    if (ca) {
      const pcc = S.carrier.pcc;
      const sccs = S.carrier.sccs;
      const sccHtml = sccs.length ? `<div class="sccs">${sccs.map((s, i) => `
        <div class="scc">
          <div class="scc-hd"><span>SCC ${i + 1}</span><span class="scc-band">${esc(s.band)}</span></div>
          ${metricGrid([
            { label: '状态', value: s.state === 'active' ? '激活' : '已配置', accent: s.state === 'active' ? 'good' : '' },
            { label: 'PCI', value: s.pci },
            { label: 'ARFCN', value: s.arfcn },
            { label: '下行带宽', value: `${s.dlBandwidth} MHz` },
            { label: '下行 MIMO', value: s.dlMimo },
            { label: '上行 MIMO', value: s.ulMimo },
            { label: '下行调制', value: s.dlModulation },
            { label: '上行调制', value: s.ulModulation },
            { label: 'RSRP', value: s.rsrp, detail: '实测 dBm' },
          ])}
        </div>`).join('')}</div>
        <div class="ca-total-row"><span>下行总带宽</span><strong>${ok ? `${S.carrier.totalBandwidth} MHz` : '--'}</strong></div>`
        : `<div class="empty">${ok ? '未上报 SCC（CA 由网络自动启用）' : '模块未连接或未返回 GTCAINFO。'}</div>`;
      patch(ca, card({ title: '当前载波聚合', eyebrow: `${esc(S.statusPort.replace('/dev/',''))} · AT+GTCAINFO` },
        `<div class="ca-overview">
          <div class="ca-total">${ok ? S.carrier.totalBandwidth : '--'}<small> MHz</small></div>
          <div class="ca-pcc"><span>PCC</span><strong>${ok ? esc(pcc.band) : '--'}</strong></div>
        </div>
        <div class="ca-pcc-detail">${metricGrid([
          { label: 'PCI', value: ok ? pcc.pci : '--' },
          { label: 'ARFCN', value: ok ? pcc.arfcn : '--' },
          { label: '下行带宽', value: ok ? `${pcc.dlBandwidth} MHz` : '--' },
          { label: '下行 MIMO', value: ok ? pcc.dlMimo : '--' },
          { label: '上行 MIMO', value: ok ? pcc.ulMimo : '--' },
          { label: '下行调制', value: ok ? pcc.dlModulation : '--' },
          { label: '上行调制', value: ok ? pcc.ulModulation : '--' },
          { label: 'RSRP', value: ok ? pcc.rsrp : '--', detail: '实测 dBm' },
        ])}</div>` + sccHtml));
    }
    const bands = $('#car-bands');
    if (bands) {
      const mk = (name, list) => `<div class="band-sec">
        <div class="band-sec-hd"><span>${name}</span><span class="band-sec-cnt">${list.length} 个频段</span></div>
        <div class="chips">${list.length ? list.map(b => `<span class="chip">${esc(bandName(name, b))}</span>`).join('') : '<span class="chip">--</span>'}</div>
      </div>`;
      patch(bands, card({ title: '允许频段', eyebrow: `${esc(S.statusPort.replace('/dev/',''))} · AT+GTACT?`, actions: pill('neutral', '独立于 CA') },
        `<div class="bands">${mk('UMTS', S.allowedBands.umts)}${mk('LTE', S.allowedBands.lte)}${mk('NR', S.allowedBands.nr)}</div>
        <div class="hint" style="margin-top:12px">${I.info}<span>允许频段仅限制模块可用范围，PCC/SCC 组合由网络决定。</span></div>`));
    }
  },
};

/* ================= 视图：邻区 ================= */
let neighTimer = 0;
const cellKey = c => `${c.arfcn}-${c.pci}-${c.tac}-${c.cellId}`;
const plmnOf = c => (!c.mcc && !c.mnc) ? '' : `${String(c.mcc).padStart(3, '0')}${String(c.mnc).padStart(2, '0')}`;
const lockDesc = () => {
  const a = S.cellLock;
  if (!a || !a.enabled) return null;
  return a.type === 'frequency' ? `${a.rat} 锁频 · ARFCN ${a.arfcn ?? '--'}` : `${a.rat} 锁 PCI ${a.pci ?? '--'}`;
};
const lockStateText = () => {
  const a = S.cellLock, sv = S.serving;
  try {
    if (!a || !a.enabled) return '锁定配置未启用';
    if (!sv || !sv.arfcn) return (lockDesc() || '') + ' · 待定';
    const m = a.rat === sv.rat && a.arfcn === sv.arfcn && pciOf(a.pci) === pciOf(sv.pci);
    return '锁定配置已启用 · ' + (m ? '当前已驻留目标' : '当前未驻留目标');
  } catch (_) { return lockDesc() || ''; }
};
const cellLocked = c => {
  const a = S.cellLock;
  return a.enabled ? (a.type === 'frequency' ? a.rat === c.rat && a.arfcn === c.arfcn : a.rat === c.rat && a.arfcn === c.arfcn && pciOf(a.pci) === pciOf(c.pci)) : false;
};
const neighborToLock = c => {
  const b = Number(String(c.band).replace(/^[BbNn]/, ''));
  return { rat: c.rat, type: 'pci', arfcn: c.arfcn, pci: c.pci, scs: c.rat === 'NR' ? 1 : 0, band: Number.isFinite(b) ? b : 0 };
};

function filteredCells() {
  const { q, rat, band, rsrp, sort } = S.filters;
  const y = q.trim().toLowerCase();
  let fl = S.scanResult.cells.filter(f =>
    (rat !== 'all' && f.rat !== rat) || (band !== 'all' && f.band !== band) || (rsrp !== null && (f.rsrp === null || f.rsrp < rsrp))
      ? false
      : y ? f.band.toLowerCase().includes(y) || String(f.pci).includes(y) || String(f.arfcn).includes(y) || String(f.cellId).includes(y) || plmnOf(f).toLowerCase().includes(y) : true);
  const seen = {}, out = [];
  for (const c of fl) {
    const k = `${c.rat}|${c.band}|${c.arfcn ?? ''}|${c.pci ?? ''}`;
    if (seen[k]) { if (c.serving && !seen[k].serving) { const i = out.indexOf(seen[k]); if (i >= 0) out[i] = c; seen[k] = c; } continue; }
    seen[k] = c; out.push(c);
  }
  return out.sort((a, b) => {
    const r = (b.serving ? 1 : 0) - (a.serving ? 1 : 0);
    if (r) return r;
    if (sort === 'rsrp') return (b.rsrp ?? -999) - (a.rsrp ?? -999);
    if (sort === 'band') return a.band.localeCompare(b.band);
    return a.pci - b.pci;
  });
}
function bandOptions() { return Array.from(new Set(S.scanResult.cells.map(c => c.band))).sort((a, b) => a.localeCompare(b)); }

const Neighbors = {
  html() {
    return `<div class="view" data-view="neighbors">
      <div class="view-head">
        <div class="view-title"><div class="view-kicker">附近小区扫描</div><h1>邻区</h1>
          <div class="view-count">发现 <span id="nz-count">0</span> 个小区</div></div>
        <div class="view-actions" id="nz-head-acts"></div>
      </div>
      <div class="nz-grid">
        <div class="card nz-scan">
          <div class="card-hd">
            <div class="card-tt"><div class="card-eyebrow">${esc(S.controlPort.replace('/dev/',''))} · AT+GTCELLSCAN</div><h3 class="card-title">小区扫描</h3></div>
            <div class="card-actions">
              <label class="selectwrap">${I.net}<select data-act="scan-rat"><option value="all">4G / 5G</option><option value="LTE">LTE</option><option value="NR">5G NR</option></select></label>
              <button class="btn is-primary" type="button" data-act="scan-start">${I.refresh}<span>重新扫描</span></button>
            </div>
          </div>
          <div class="card-bd"><div id="nz-scan"></div></div>
        </div>
        <div class="card nz-svc md">
          <div class="card-hd"><div class="card-tt"><div class="card-eyebrow">服务小区</div><h3 class="card-title">当前服务小区</h3></div></div>
          <div class="card-bd" id="nz-svc"></div>
        </div>
        <div class="card nz-list lg">
          <div class="card-hd">
            <div class="card-tt"><div class="card-eyebrow">Port B · GTCELLSCAN 结果</div><h3 class="card-title">扫描结果</h3></div>
            <div class="card-actions"><button class="ibtn" type="button" data-act="scan-refresh" title="刷新扫描状态">${I.refresh}</button></div>
          </div>
          <div class="card-bd">
            <div id="nz-filters" class="toolbar"></div>
            <div id="nz-list"></div>
          </div>
        </div>
        <div class="card nz-lock md">
          <div class="card-hd"><div class="card-tt"><div class="card-eyebrow">GTCELLLOCK / GTFREQLOCK</div><h3 class="card-title">小区锁定</h3></div></div>
          <div class="card-bd" id="nz-lock"></div>
        </div>
      </div>
    </div>`;
  },
  mount() {
    refreshScanNow();
    if (!scanLoopOn) { scanBackoff = SCAN_FAST; scanTickLoop(); }
    // 1s 计时：仅局部更新扫描耗时文本，不整页重绘
    neighTimer = setInterval(() => {
      const e = $('#nz-elapsed');
      if (e && scanActive()) setText(e, scanElapsed());
    }, 1000);
  },
  unmount() {
    clearInterval(neighTimer);
    neighTimer = 0;
    if (!scanActive()) stopScanLoop();
  },
  update() {
    if (currentViewName() !== 'neighbors') return;
    const cnt = $('#nz-count'); if (cnt) setText(cnt, String(S.scanResult.cells.length));
    const acts = $('#nz-head-acts');
    if (acts) patch(acts, `${pill('neutral', S.updatedAt ? '更新于 ' + esc(S.updatedAt.slice(11, 16)) : '尚未读取')}${S.scanResult.finishedAt ? ' ' + pill('neutral', '上次扫描 ' + esc(agoText(S.scanResult.scanEpoch) || S.scanResult.finishedAt)) : ''}`);
    this.updateScan();
    this.updateFilters();
    this.updateSvc();
    this.updateList();
    this.updateLock();
  },
  updateScan() {
    const el = $('#nz-scan'); if (!el) return;
    const st = S.scan.status;
    const lteN = S.scanResult.cells.filter(c => c.rat === 'LTE').length;
    const nrN = S.scanResult.cells.filter(c => c.rat === 'NR').length;
    const extra = S.scanResult.cells.length ? `LTE ${lteN} · NR ${nrN}` : '';
    let html = '';
    if (scanActive()) {
      html = `<div class="scan-status"><span class="spinner"></span>
        <div class="scan-st-copy"><strong>${S.scanResult.resultCount > 0 ? '正在后台更新' : '正在扫描'}</strong>
        <span><span id="nz-elapsed">${scanElapsed()}</span> · 最长等待 ${S.scan.timeout} 秒</span></div>
        <span class="ind-track"></span>
        <div class="scan-extra">${esc(extra)}</div></div>`;
    } else if (st === 'completed') {
      html = `<div class="scan-status"><span class="dot good"></span>
        <div class="scan-st-copy"><strong>扫描完成</strong>
        <span>耗时 ${S.scanResult.duration} 秒 · 总小区 ${S.scanResult.resultCount} 个${S.scanResult.parserError ? ' · 解析告警：' + esc(S.scanResult.parserError) : ''}</span></div>
        <div class="scan-extra">${esc(extra)}</div></div>`;
    } else if (st === 'failed' || st === 'timeout') {
      const hasOld = S.scanResult.resultCount > 0;
      html = `<div class="scan-status"><span class="dot warn"></span>
        <div class="scan-st-copy"><strong>${st === 'timeout' ? '扫描超时' : '扫描失败'}</strong>
        <span>${esc(S.scan.error || '')}</span>
        <span>串口 ${esc(S.scan.port || '--')} · ${hasOld ? '已保留上次扫描结果（' + esc(S.scanResult.finishedAt || '') + '）。' : '暂无历史结果。'}</span>
        <span>可点击“重新扫描”重试；若持续失败，请在设置页重启模组后重试。</span></div></div>`;
    } else {
      html = `<div class="scan-status"><span class="dot neutral"></span>
        <div class="scan-st-copy"><strong>当前没有进行中的扫描</strong>
        <span>点击“重新扫描”才会启动一次扫描（不再自动触发）。</span></div>
        <div class="scan-extra">${esc(extra)}</div></div>`;
    }
    patch(el, html);
  },
  updateFilters() {
    const el = $('#nz-filters'); if (!el || focusTyping()) return;
    const f = S.filters;
    const bands = bandOptions();
    const clear = f.q || f.band !== 'all' || f.rsrp !== null || f.rat !== 'all';
    patch(el, `
      <label class="search">${I.search}<input type="search" data-act="filter-q" placeholder="Band、PCI、ARFCN、PLMN" value="${escAttr(f.q)}"></label>
      <label class="selectwrap">${I.arrow}<select data-act="filter-band">
        <option value="all">全部 Band</option>${bands.map(b => `<option value="${escAttr(b)}">${esc(b)}</option>`).join('')}</select></label>
      <label class="selectwrap">${I.arrow}<select data-act="filter-rsrp">
        <option value="">全部信号</option><option value="-85">RSRP 大于 -85</option><option value="-95">RSRP 大于 -95</option><option value="-105">RSRP 大于 -105</option>
      </select></label>
      <label class="selectwrap">${I.arrow}<select data-act="filter-sort">
        <option value="rsrp">RSRP</option><option value="band">Band</option><option value="pci">PCI</option>
      </select></label>
      ${clear ? `<button class="btn sm is-ghost" type="button" data-act="filter-clear">清除筛选</button>` : ''}`);
    const selBand = el.querySelector('[data-act="filter-band"]'); if (selBand) selBand.value = f.band;
    const selRsrp = el.querySelector('[data-act="filter-rsrp"]'); if (selRsrp) selRsrp.value = f.rsrp === null ? '' : String(f.rsrp);
    const selSort = el.querySelector('[data-act="filter-sort"]'); if (selSort) selSort.value = f.sort;
    const selRat = document.querySelector('[data-act="scan-rat"]'); if (selRat) selRat.value = f.rat;
  },
  updateSvc() {
    const el = $('#nz-svc'); if (!el) return;
    const ok = statusConnected(), sv = S.serving;
    const rsrp = S.signal.metrics[0], rsrq = S.signal.metrics[1], sinr = S.signal.metrics[2];
    patch(el, `<div class="svc">
      <div class="svc-hd"><span>${esc(opName())}</span>${ok ? pill('good', sv.rat === 'NR' ? '5G NR' : 'LTE') : pill('warn', '--')}</div>
      <div class="svc-id"><span class="svc-band">${ok ? esc(sv.band) : '--'}</span>
        <span class="svc-arfcn">${ok ? (sv.rat === 'NR' ? 'NR-ARFCN ' : 'EARFCN ') + sv.arfcn : '--'}</span>
        <span class="svc-pci">${ok ? 'PCI ' + sv.pci : '--'}</span></div>
      <div class="svc-sig">${metricHtml({ label: 'RSRP', value: rsrp?.value ?? null, detail: 'dBm', accent: rsrp?.tone || '' })}
        ${metricHtml({ label: 'RSRQ', value: rsrq?.value ?? null, detail: 'dB', accent: rsrq?.tone || '' })}
        ${metricHtml({ label: 'SINR', value: sinr?.value ?? null, detail: 'dB', accent: sinr?.tone || '' })}</div>
      <div class="svc-acts">
        <button class="btn sm is-primary" type="button" data-act="svc-lock">锁定当前小区</button>
        <button class="btn sm is-warn" type="button" data-act="svc-unlock">解锁小区</button>
        <span class="svc-state">${esc(lockStateText())}</span>
      </div>
    </div>`);
  },
  updateList() {
    const el = $('#nz-list'); if (!el) return;
    const list = filteredCells();
    const lteN = S.scanResult.cells.filter(c => c.rat === 'LTE').length;
    const nrN = S.scanResult.cells.filter(c => c.rat === 'NR').length;
    if (!list.length) {
      const has = S.scanResult.cells.length > 0;
      patch(el, emptyState({
        icon: I.radar,
        title: has ? '无匹配小区' : '暂无扫描结果',
        hint: has ? '当前筛选条件下没有小区，请调整筛选条件。' : '点击“重新扫描”获取附近小区列表。',
      }));
      return;
    }
    patch(el, `<div class="neighbors">${list.map(c => {
      const key = cellKey(c);
      const selected = S.selected.includes(key);
      const locked = S.selected.length === 0 && cellLocked(c);
      const op = c.opName || (c.mcc || c.mnc ? ((resolveOperator({ mcc: c.mcc, mnc: c.mnc }) !== '未知运营商') ? resolveOperator({ mcc: c.mcc, mnc: c.mnc }) : '--') : '--');
      const detailOpen = S.det === key;
      return `<article class="nrow${selected ? ' selected' : ''}${locked ? ' locked' : ''}" data-act="row" data-key="${escAttr(key)}" tabindex="0" role="button">
        <div class="nrow-l1">
          <span class="nrow-op">${esc(op)}</span>
          <span class="nrow-band">${esc(c.band)}</span>
          <span class="nrow-arfcn">${c.rat === 'NR' ? 'NR-ARFCN' : 'EARFCN'} ${c.arfcn} · PCI ${c.pci}</span>
          <span class="nrow-tags">${c.serving ? '<span class="tag good">服务中</span>' : ''}${selected ? '<span class="tag good">已选</span>' : ''}${locked ? '<span class="tag good">已锁定</span>' : ''}</span>
        </div>
        <div class="nrow-acts">
          <button class="btn sm is-primary" type="button" data-act="row-lock" data-key="${escAttr(key)}">锁定</button>
          <button class="ibtn" type="button" data-act="row-det" data-key="${escAttr(key)}" title="展开详情">${I.chev}</button>
        </div>
        <div class="nrow-l2">
          ${metricHtml({ label: 'RSRP', value: c.rsrp, detail: 'dBm', accent: c.rsrp == null ? '' : (c.rsrp >= -85 ? 'good' : c.rsrp >= -105 ? 'warn' : 'bad') })}
          ${metricHtml({ label: 'RSRQ', value: c.rsrq, detail: 'dB', accent: c.rsrq == null ? '' : (c.rsrq >= -10 ? 'good' : c.rsrq >= -15 ? 'warn' : 'bad') })}
          ${metricHtml({ label: 'SINR', value: c.sinr ?? null, detail: 'dB', accent: c.sinr == null ? '' : (c.sinr >= 15 ? 'good' : c.sinr >= 5 ? 'warn' : 'bad') })}
        </div>
        ${detailOpen ? `<div class="nrow-det">${metricGrid([
          { label: '运营商', value: op },
          { label: '网络', value: c.rat },
          { label: 'Band', value: c.band },
          { label: '频点', value: c.arfcn, detail: c.rat === 'NR' ? 'NR-ARFCN' : 'EARFCN' },
          { label: 'PCI', value: c.pci },
          { label: 'PLMN', value: c.mcc ? `${c.mcc}${c.mnc != null && c.mnc < 10 ? '0' + c.mnc : c.mnc || ''}` : (c.plmn || '--') },
          { label: 'TAC', value: c.tac },
          { label: 'Cell ID', value: c.cellId },
          { label: 'RSRP', value: c.rsrp, detail: 'dBm' },
          { label: 'RSRQ', value: c.rsrq, detail: 'dB' },
          { label: 'SRXLEV', value: c.srxlev },
          { label: 'SQUAL', value: c.squal },
        ])}</div>` : ''}
      </article>`;
    }).join('')}</div>
    <div class="list-meta">LTE ${lteN} 个 · NR ${nrN} 个</div>`);
  },
  updateLock() {
    const el = $('#nz-lock'); if (!el || focusTyping()) return;
    const sel = S.selected.map(k => S.scanResult.cells.find(c => cellKey(c) === k)).filter(Boolean);
    const it = (() => {
      if (sel.length) return sel.map(c => `${c.rat} ${c.band} · PCI ${c.pci}`).join('、');
      const d = lockDesc(); if (d) return d;
      return null;
    })();
    const lockTone = it ? 'good' : 'neutral';
    const lockLabel = it ? '锁定配置:已启用' : (S.pendingLockState ? '待确认' : '锁定配置:未启用');
    const multi = sel.length > 1;
    const hint = !sel.length ? '从下方列表选择一个小区，再点击锁定。' : `已选 ${sel.length} 个小区：${sel.slice(0, 3).map(c => `${c.band} · PCI ${c.pci}`).join('、')}${sel.length > 3 ? ` 等 ${sel.length} 个` : ''}`;
    const btnLabel = sel.length > 1 ? `锁定 ${sel.length} 个小区` : '锁定所选小区';
    const disabled = S.scanBusy || !it || multi;
    const previews = [];
    if (sel.length === 1) previews.push({ cls: '', cmd: lockCmd(neighborToLock(sel[0])) });
    if (multi) previews.push({ cls: 'good', cmd: multiLockCmd(sel), note: '多小区锁定仅支持单小区，请逐一定位。' });
    const manCmd = lockCmd({ ...S.manual, scs: S.manual.scs === 30 ? 1 : 0 });
    patch(el, `<div class="lockbar">
      <div class="lockbar-hd">
        <div class="lockbar-tt">${I.lock}<span>小区锁定</span>${pill(lockTone, lockLabel)}</div>
        <div class="lockbar-acts">
          <button class="btn is-primary" type="button" data-act="lock-apply" ${disabled ? 'disabled' : ''}>${I.lock}<span>${btnLabel}</span></button>
          ${sel.length ? '<button class="btn is-ghost" type="button" data-act="lock-clear">清空选择</button>' : ''}
          <button class="btn is-warn" type="button" data-act="lock-unlock" ${!it ? 'disabled' : ''}>解锁</button>
          <button class="btn is-ghost" type="button" data-act="lock-manual">${I.gear}<span>手动输入</span></button>
        </div>
      </div>
      <span class="lockbar-hint">${esc(hint)}</span>
      ${previews.map(p => `<div class="preview ${p.cls}"><div class="preview-lb">命令预览</div><code>${esc(p.cmd)}</code>${p.note ? `<div class="preview-note">${I.info}<span>${esc(p.note)}</span></div>` : ''}</div>`).join('')}
      ${S.manualOpen ? `<div class="manual-lock">
        <div class="lock-form">
          <label class="field"><span>制式</span><select class="in" data-act="man-rat"><option value="NR">NR</option><option value="LTE">LTE</option></select></label>
          <label class="field"><span>锁定类型</span><select class="in" data-act="man-type"><option value="pci">PCI + 频点</option><option value="frequency">仅频点</option></select></label>
          <label class="field"><span>ARFCN 频点</span><input class="in" type="number" data-act="man-arfcn"></label>
          <label class="field"><span>PCI</span><input class="in" type="number" data-act="man-pci"></label>
          <label class="field"><span>SCS</span><select class="in" data-act="man-scs"><option value="30">30 kHz</option><option value="15">15 kHz</option></select></label>
          <label class="field"><span>Band</span><input class="in" type="number" data-act="man-band"></label>
        </div>
        <div class="lock-acts">
          <button class="btn is-primary" type="button" data-act="man-lock" ${S.scanBusy ? 'disabled' : ''}>${I.lock}<span>锁定</span></button>
          <div class="preview" style="flex:1"><div class="preview-lb">命令预览</div><code id="man-preview">${esc(manCmd)}</code></div>
        </div>
      </div>` : ''}
    </div>`);
    const m = S.manual;
    const r = el.querySelector('[data-act="man-rat"]'); if (r) r.value = m.rat;
    const t = el.querySelector('[data-act="man-type"]'); if (t) t.value = m.type;
    const af = el.querySelector('[data-act="man-arfcn"]'); if (af) af.value = m.arfcn;
    const pc = el.querySelector('[data-act="man-pci"]'); if (pc) pc.value = m.pci;
    const sc = el.querySelector('[data-act="man-scs"]'); if (sc) sc.value = String(m.scs);
    const bd = el.querySelector('[data-act="man-band"]'); if (bd) bd.value = m.band;
  },
};

function scanElapsed() {
  let y = 0;
  const cap = S.scan.timeout > 0 ? S.scan.timeout : 120;
  if (scanActive() && S.scan.startedAt) {
    const a = Date.parse(String(S.scan.startedAt).replace(' ', 'T'));
    if (Number.isFinite(a)) y = Math.floor((Date.now() - a) / 1000);
  }
  return `已运行 ${Math.max(0, Math.min(y, cap + 30))} 秒`;
}

/* ================= 视图：短信 ================= */
let smsTimer = 0;
const isUnread = s => ['REC UNREAD', '未读', 'UNREAD'].includes(String(s || '').toUpperCase());
const Sms = {
  html() {
    return `<div class="view" data-view="sms">
      <div class="view-head">
        <div class="view-title"><div class="view-kicker">模组收件箱</div><h1>短信 <span class="unread-badge" id="sms-unread">0</span></h1></div>
        <div class="view-actions">
          <button class="btn is-primary" type="button" data-act="sms-refresh">${I.refresh}<span>刷新短信</span></button>
          <button class="btn is-ghost" type="button" data-act="manual-refresh">${I.clock}<span>刷新状态</span></button>
          <button class="btn is-danger" type="button" data-act="sms-delall">${I.trash}<span>全部删除</span></button>
        </div>
      </div>
      <div id="sms-state"></div>
      <div id="sms-list" class="sms-list"></div>
    </div>`;
  },
  mount() { loadSms('auto'); if (!smsTimer) smsTimer = setInterval(() => loadSms(false), 30000); },
  unmount() { clearInterval(smsTimer); smsTimer = 0; },
  update() { this.updateList(); },
  updateList() {
    const el = $('#sms-list'); if (!el) return;
    const unread = $('#sms-unread'); if (unread) unread.textContent = String(S.sms.unread);
    if (!Array.isArray(S.sms.messages) || !S.sms.messages.length) {
      patch(el, emptyState({ icon: I.sms, title: '暂无短信' }));
      return;
    }
    const arr = [...S.sms.messages].sort((a, b) => (smsTimeNum(b.datetime) - smsTimeNum(a.datetime)) || String(a.index).localeCompare(String(b.index)));
    patch(el, arr.map(m => {
      const un = isUnread(m.status);
      const t = fmtSmsTime(m.datetime);
      const open = S.smsOpen === String(m.index);
      return `<div class="sms-item${un ? ' unread' : ''}" data-act="sms-item" data-i="${escAttr(m.index)}">
        <div class="sms-hd">
          <span class="sms-sender">${esc(m.sender || '--')}</span>
          <span class="sms-st ${un ? 'unread' : 'read'}">${un ? '未读' : '已读'}</span>
          <span class="sms-time">${esc(t)}</span>
        </div>
        <div class="sms-prev">${esc((m.text || '').split('\n')[0])}</div>
        ${open ? `<div class="sms-body">
          <div class="sms-row"><span class="k">发件人</span><span class="v">${esc(m.sender || '--')}</span></div>
          <div class="sms-row"><span class="k">时间</span><span class="v">${esc(t)}</span></div>
          <div class="sms-row"><span class="k">状态</span><span class="v">${un ? '未读' : '已读'}</span></div>
          <div class="sms-row"><span class="k">内容</span><div class="v">${esc(m.text || '--')}</div></div>
          <button class="btn sm is-danger sms-del" type="button" data-act="sms-del" data-i="${escAttr(m.index)}">删除</button>
        </div>` : ''}
      </div>`;
    }).join(''));
  },
};
async function loadSms(refresh) {
  if (S.sms.busy) return;
  // 打开页面时：先读缓存，缓存为空则自动触发一次真实刷新（“打开即有短信”）
  if (refresh === 'auto') {
    S.sms.busy = true;
    try {
      const d = await apiGet(`${API}?action=sms_status&ts=${Date.now()}`);
      S.sms.messages = Array.isArray(d.messages) ? d.messages : [];
      S.sms.unread = Number(d.unread) || 0;
      renderAll();
      if (S.sms.messages.length) return;
    } catch (_) { /* 忽略缓存读取失败，走真实刷新 */ }
    finally { S.sms.busy = false; }
    setStateMsg('正在读取短信…', '');
    return loadSms(true);
  }
  S.sms.busy = true;
  try {
    const act = refresh ? 'sms_refresh' : 'sms_status';
    // tom_modem 读取较慢，放宽超时到 60s
    const d = await apiGet(`${API}?action=${act}&ts=${Date.now()}`, 60000);
    S.sms.messages = Array.isArray(d.messages) ? d.messages : [];
    S.sms.unread = Number(d.unread) || 0;
    setStateMsg('', '');
    if (refresh) { setStateMsg('刷新完成', 'good'); setTimeout(() => setStateMsg('', ''), 2500); }
    renderAll();
  } catch (e) {
    setStateMsg('短信服务暂时不可用', 'error');
    S.sms.messages = []; renderAll();
  } finally { S.sms.busy = false; }
}
async function delSms(i) {
  if (!confirm(`确定删除短信 #${i} ？`)) return;
  try {
    const d = await apiGet(`${API}?action=sms_delete&index=${encodeURIComponent(i)}&ts=${Date.now()}`);
    S.sms.messages = Array.isArray(d.messages) ? d.messages : S.sms.messages.filter(m => String(m.index) !== String(i));
    S.sms.unread = Number(d.unread) || 0;
    setStateMsg('短信已删除', 'good');
    setTimeout(() => setStateMsg('', ''), 2000);
    renderAll();
  } catch (_) { setStateMsg('删除失败，请稍后重试', 'error'); }
}
async function delAllSms() {
  if (!confirm('确定删除全部短信？（模组存储将彻底清空，不可恢复）')) return;
  try {
    const d = await apiGet(`${API}?action=sms_delete_all&ts=${Date.now()}`);
    S.sms.messages = Array.isArray(d.messages) ? d.messages : [];
    S.sms.unread = 0;
    setStateMsg('已删除全部短信', 'good');
    setTimeout(() => setStateMsg('', ''), 2500);
    renderAll();
  } catch (_) { setStateMsg('删除失败，请稍后重试', 'error'); }
}
function setStateMsg(msg, cls) {
  const el = $('#sms-state'); if (!el) return;
  if (!msg) { patch(el, ''); return; }
  patch(el, `<div class="state-msg ${cls}">${esc(msg)}</div>`);
}

/* ================= 视图：拨号 ================= */
let dialTimer = 0;
const Dial = {
  html() {
    return `<div class="view" data-view="dial">
      <div class="view-head">
        <div class="view-title"><div class="view-kicker">独立 QMI 拨号</div><h1>拨号</h1></div>
        <div class="view-actions"><button class="btn is-ghost" type="button" data-act="dial-refresh">${I.refresh}<span>刷新状态</span></button></div>
      </div>
      <div id="dial-status"></div>
      <div class="action-row">
        <button class="btn is-primary" type="button" data-act="dial-start">${I.play}<span>打开拨号</span></button>
        <button class="btn is-danger" type="button" data-act="dial-stop">${I.stop}<span>关闭拨号</span></button>
        <label class="field" style="flex:1;min-width:200px">
          <span>APN（留空=自动）</span>
          <input class="in" id="dial-apn" type="text" value="auto" placeholder="auto">
        </label>
      </div>
      <div class="action-row">
        <button class="btn is-danger" type="button" data-act="dial-qstop">${I.bolt}<span>彻底停止 qmodem</span></button>
      </div>
      <div class="action-row">
        <button class="btn is-danger" type="button" data-act="dial-sched-stop">关闭串口调度器</button>
        <button class="btn is-primary" type="button" data-act="dial-sched-start">打开串口调度器</button>
      </div>
      <div id="dial-state"></div>
      <div id="dial-info"></div>
      <div class="card" style="margin-top:14px">
        <div class="card-hd"><div class="card-tt"><div class="card-eyebrow">通过串口调度器执行</div><h3 class="card-title">常用 AT 指令</h3></div></div>
        <div class="card-bd">
          <div class="at-item"><span class="at-lb">查询小区</span><span class="at-cmd">AT+GTCCINFO?</span><button class="btn sm is-primary" type="button" data-act="dial-at" data-cmd="AT+GTCCINFO?">查询</button></div>
          <div class="at-item"><span class="at-lb">锁小区状态</span><span class="at-cmd">AT+GTCELLLOCK?</span><button class="btn sm is-primary" type="button" data-act="dial-at" data-cmd="AT+GTCELLLOCK?">查询</button></div>
          <div class="at-item"><span class="at-lb">复位模组</span><span class="at-cmd">AT+CFUN=15</span><button class="btn sm is-warn" type="button" data-act="dial-at" data-cmd="AT+CFUN=15">复位</button></div>
          <div class="hint" style="margin:10px 0 8px">${I.warn}<span>复位模组会重新读卡，可能短暂断网，请谨慎操作。</span></div>
          <textarea class="in" id="dial-atout" readonly placeholder="AT 指令执行结果将显示在这里"></textarea>
        </div>
      </div>
      <div class="hint" style="margin-top:14px">${I.info}<span>打开拨号：启动 QMI 拨号，自动获取 APN 与 IP。关闭后不会自动重连，需手动再打开。AT 指令无需登录，点击即可查询。</span></div>
    </div>`;
  },
  mount() { loadDial(); if (!dialTimer) dialTimer = setInterval(loadDial, 5000); },
  unmount() { clearInterval(dialTimer); dialTimer = 0; },
  update() { loadDialSoft(); },
};
let dialBusy = false, lastDialSig = '';
async function loadDial() { await loadDialSoft(); }
async function loadDialSoft() {
  if (dialBusy) return;
  dialBusy = true;
  try {
    const d = await apiGet(`${DIAL}?action=ppp_status&ts=${Date.now()}`, 8000);
    renderDial(d);
  } catch (_) { dialBusy = false; /* 静默，保留上次状态 */ return; }
  dialBusy = false;
}
function renderDial(d) {
  S.dial.data = d;
  const on = !!(d && d.dialing);
  const hasIp = !!(d && d.ipv4);
  const box = $('#dial-status');
  if (box) {
    let title, sub;
    if (!d) { title = '未知'; sub = '状态获取失败'; }
    else if (on && hasIp) { title = '已拨号'; sub = `数据连接处于活动状态，IP: ${d.ipv4}`; }
    else if (on) { title = '已拨号（等待获取 IP）'; sub = '拨号进程已启动，正在等待运营商分配 IP...'; }
    else { title = '未拨号'; sub = '数据连接未开启'; }
    patch(box, `<div class="dial-status">
      <span class="dial-dot ${on ? 'on' : 'off'}"></span>
      <div><div class="dial-tt">${esc(title)}</div><div class="dial-sub">${esc(sub)}</div></div>
    </div>`);
  }
  const info = $('#dial-info');
  if (info) {
    patch(info, `<div class="card"><div class="card-hd"><div class="card-tt"><h3 class="card-title">连接信息</h3></div></div><div class="card-bd">${metricGrid([
      { label: '拨号进程', value: d?.pid || '--' },
      { label: '网络接口', value: d?.netcard || '--' },
      { label: 'IPv4 地址', value: hasIp ? d.ipv4 : (on ? '等待获取 IP...' : '--') },
    ])}</div></div>`);
  }
}
function dialMsg(msg, cls) {
  const el = $('#dial-state'); if (!el) return;
  if (!msg) { patch(el, ''); return; }
  patch(el, `<div class="state-msg ${cls || ''}">${esc(msg)}</div>`);
}
async function dialStart() {
  const btn = document.querySelector('[data-act="dial-start"]'); if (btn) btn.disabled = true;
  dialMsg('正在打开拨号...');
  try {
    const apn = ($('#dial-apn')?.value || '').trim() || 'auto';
    const d = await dial('ppp_start', { apn });
    if (d.ok === false) throw new Error(d.error || '拨号启动失败');
    dialMsg(d.message || '拨号已启动', 'good');
    setTimeout(loadDial, 1800);
  } catch (e) { dialMsg(e.message || '拨号启动失败', 'error'); }
  finally { if (btn) btn.disabled = false; }
}
async function dialStop() {
  dialMsg('正在关闭拨号...');
  try {
    const d = await dial('ppp_stop');
    if (d.ok === false) throw new Error(d.error || '拨号关闭失败');
    dialMsg(d.message || '拨号已关闭', 'good');
    setTimeout(loadDial, 1500);
  } catch (e) { dialMsg(e.message || '拨号关闭失败', 'error'); }
}
async function dialQmodemStop() {
  if (!confirm('确定彻底停止 qmodem 拨号？\n将执行 hang + enable_dial=0 + 禁自启，会断开蜂窝网络。')) return;
  dialMsg('正在停止 qmodem 拨号...');
  try {
    const d = await dial('qmodem_stop');
    if (d.ok === false) throw new Error(d.error || '停止失败');
    dialMsg(d.message || '已停止', 'good');
  } catch (e) { dialMsg(e.message || '停止失败', 'error'); }
  setTimeout(loadDial, 1500);
}
async function dialSchedStop() {
  if (!confirm('关闭串口调度器？将停止 fm170_scheduler，WebUI 状态/扫描停止刷新。')) return;
  dialMsg('正在关闭串口调度器...');
  try {
    const d = await dial('scheduler_stop');
    if (d.ok === false) throw new Error(d.error || '关闭失败');
    dialMsg(d.message || '已关闭', 'good');
  } catch (e) { dialMsg(e.message || '关闭失败', 'error'); }
}
async function dialSchedStart() {
  dialMsg('正在打开串口调度器...');
  try {
    const d = await dial('scheduler_start');
    if (d.ok === false) throw new Error(d.error || '打开失败');
    dialMsg(d.message || '已启动', 'good');
  } catch (e) { dialMsg(e.message || '打开失败', 'error'); }
}
function dialAtOut(txt) { const el = $('#dial-atout'); if (el) el.value = txt; }
async function dialAt(cmd, label) {
  dialMsg(`正在执行 ${label}...`);
  try {
    const d = await dial('at', { cmd });
    if (d.ok === false) throw new Error(d.error || label + ' 执行失败');
    dialAtOut(`◆ ${label}\n${String(d.raw || '').replace(/\r/g, '').trim()}\n`);
    dialMsg(label + ' 执行成功', 'good');
  } catch (e) { dialMsg(e.message || label + ' 失败', 'error'); }
}

/* ================= 视图：设置 ================= */
const MODES = [
  { id: '17', label: '全模式', short: 'GTACT 17 · 自动选网' },
  { id: '14', label: '单 5G', short: 'GTACT 14 · 仅 5G NR' },
  { id: '2', label: '单 4G', short: 'GTACT 2 · 仅 LTE' },
];
const modeLabelOf = id => MODES.find(m => m.id === String(id))?.label || String(id);
const modeAllows = (rat) => {
  const id = Number(S.bandPendingMode ?? (S.networkModeId || 20));
  if (rat === 'nr') return [10, 14, 16, 17, 20].includes(id);
  if (rat === 'lte') return [2, 3, 4, 10, 17, 20].includes(id);
  return [2, 4, 10, 16, 20].includes(id);
};
const AT_PRESETS = [
  ['通用', [
    ['ATI', '模组信息'], ['AT+CGMM', '模块型号'], ['AT+CGMR', '固件版本'],
    ['AT+CGSN', '模组 IMEI'], ['AT+GSN', '模组 IMEI'], ['AT+CPIN?', 'SIM 卡状态'],
    ['AT+CBC', '电压/电池'], ['AT+CSQ', '信号强度'], ['AT+CESQ', '扩展信号质量'],
    ['AT+COPS?', '运营商'], ['AT+CEREG?', 'LTE 注册'], ['AT+C5GREG?', '5G 注册'],
    ['AT+CGREG?', 'GPRS 注册'], ['AT+CGDCONT?', 'PDP/APN'], ['AT+CGPADDR', 'PDP 地址'],
    ['AT+CGCONTRDP', '地址/DNS'], ['AT+CFUN?', '功能状态'], ['AT+CFUN=0', '最小功能'],
    ['AT+CFUN=1', '全功能'], ['AT+CFUN=1,1', '重启模组'], ['AT+CFUN=15', '重新注册网络'],
  ]],
  ['广和通 · 查询', [
    ['AT+GTDUALSIM?', '双卡状态'], ['AT+PSRAT?', '当前网络类型'],
    ['AT+GTCCINFO?', '服务小区'], ['AT+GTCAINFO?', '载波聚合'], ['AT+GTCELLINFO?', '小区详情'],
    ['AT+GTCELLLOCK?', '小区锁定'], ['AT+GTPLMNLOCK?', 'PLMN 锁定'], ['AT+GTACT?', '网络模式'],
    ['AT+GTROAMCFG?', '漫游配置'], ['AT+GTUSBMODE?', '端口模式'], ['AT+GTSN=0,7', '模组 IMEI'],
    ['AT+MTSM=1,6', 'BBIC 温度'], ['AT+MTSM=1,7', '射频温度'], ['AT+GTSENRDTEMP=0', '温度'],
    ['AT+GTSTATIS?', '统计信息'], ['AT+GTLADC', 'ADC 读取'],
  ]],
  ['广和通 · 控制', [
    ['AT+GTDUALSIM=0', '切卡 1'], ['AT+GTDUALSIM=1', '切卡 2'],
    ['AT+GTACT=2', '锁 4G'], ['AT+GTACT=14', '锁 5G'], ['AT+GTACT=20', '自动网络'],
    ['AT+GTUSBMODE=32', 'QMI 模式'], ['AT+GTUSBMODE=18', 'ECM 模式'],
    ['AT+GTUSBMODE=30', 'MBIM 模式'], ['AT+GTUSBMODE=24', 'RNDIS 模式'],
    ['AT+GTRNDIS=1,1', 'ECM 手动拨号'], ['AT+GTRNDIS=0,1', 'ECM 拨号断开'],
    ['AT+CGACT=1,3', '手动拨号 (cid3)'], ['AT+CGACT=0,3', '停止拨号'],
    ['AT+GTFCCLOCKMODE=0', '解锁 FCC'], ['AT+GTESIMCFG=0,0,0', '解除 eSIM 锁定'],
    ['AT+GTTHERMAL=0', '解除温控'], ['AT+GTCSQNREN=1', 'NR 信号上报'],
  ]],
];

const Settings = {
  html() {
    return `<div class="view" data-view="settings">
      <div class="view-head">
        <div class="view-title"><div class="view-kicker">控制操作</div><h1>设置</h1></div>
        <div class="view-actions" id="set-head-acts"></div>
      </div>
      <div class="set-grid">
        <div id="set-mode" class="set-mode"></div>
        <div id="set-bands" class="set-bands"></div>
        <div id="set-sim" class="set-sim"></div>
        <div id="set-adv" class="set-adv"></div>
        <div id="set-at" class="set-at"></div>
      </div>
    </div>`;
  },
  update() {
    if (currentViewName() !== 'settings') return;
    const acts = $('#set-head-acts');
    if (acts) patch(acts, `${pill('neutral', S.updatedAt ? '更新于 ' + esc(S.updatedAt.slice(11, 16)) : '尚未读取')} ${pill('neutral', `${esc(S.statusPort.replace('/dev/',''))} · ${esc(S.controlPort.replace('/dev/',''))}`)}`);
    this.updateMode();
    this.updateBands();
    this.updateSim();
    this.updateAdv();
    this.updateAt();
  },
  updateMode() {
    const el = $('#set-mode'); if (!el) return;
    const selectedId = S.bandPendingMode ?? String(S.networkModeId || 20);
    // 命中的模式：数字相同或归一化名称相同（查询返回 20 时对应“全模式”）
    const isSel = id => selectedId === id || (S.networkModeLabel !== '' && S.networkModeLabel === modeLabelOf(id));
    patch(el, card({ title: '网络模式', eyebrow: `${esc(S.statusPort.replace('/dev/',''))} · AT+GTACT` },
      `<div class="mode-list">${MODES.map(m => `
        <button class="mode-opt${isSel(m.id) ? ' selected' : ''}" type="button" data-act="mode-set" data-mode="${m.id}">
          <span class="mode-radio">${isSel(m.id) ? I.check : ''}</span>
          <span><strong>${m.label}</strong><small>${m.short}</small></span>
        </button>`).join('')}</div>
        <div class="hint" style="margin-top:13px">${I.info}<span>这里的选项只在明确手动点击时才发送命令；网络模式切换可能短暂断网。</span></div>`));
  },
  updateBands() {
    const el = $('#set-bands'); if (!el || focusTyping()) return;
    const dirty = S.bandDirty;
    if (!dirty) S.bandSel = { umts: [...S.allowedBands.umts], lte: [...S.allowedBands.lte], nr: [...S.allowedBands.nr] };
    const sel = S.bandSel || { umts: [], lte: [], nr: [] };
    const sec = (name, list, key) => `
      <div class="band-sec">
        <div class="band-sec-hd"><span>${name}</span><span class="band-sec-cnt">${sel[key].length} 个频段</span></div>
        <div class="band-toggles">${(list || []).map(b => `
          <label class="btoggle${modeAllows(key) ? '' : ' disabled'}">
            <input type="checkbox" data-act="band-toggle" data-key="${key}" data-band="${b}" ${sel[key].includes(b) ? 'checked' : ''} ${modeAllows(key) ? '' : 'disabled'}>
            <span>${esc(bandName(name, b))}</span>
          </label>`).join('') || '<span class="chip">--</span>'}
        </div>
      </div>`;
    patch(el, card({ title: '锁频段', eyebrow: `${esc(S.statusPort.replace('/dev/',''))} · AT+GTACT`, actions: `
        <button class="btn sm is-ghost" type="button" data-act="band-all">全选</button>
        <button class="btn sm is-ghost" type="button" data-act="band-none">全不选</button>
        <button class="btn sm is-primary" type="button" data-act="band-apply">${I.check}<span>应用</span></button>` },
      `<div class="bands">${sec('UMTS', S.availableBands.umts, 'umts')}${sec('LTE', S.availableBands.lte, 'lte')}${sec('NR', S.availableBands.nr, 'nr')}</div>
      <div class="hint" style="margin-top:12px">${I.info}<span>可勾选列表来自实机 AT+GTACT=?；应用后仅发送频段配置，不会切换网络模式。</span></div>`));
  },
  updateSim() {
    const el = $('#set-sim'); if (!el) return;
    const ds = S.dataSession;
    const apns = S.apnContexts.map(c => c.apn).join(' / ');
    patch(el, card({ title: 'SIM 与数据', eyebrow: `${esc(S.statusPort.replace('/dev/',''))} · AT+GTDUALSIM / AT+CGCONTRDP` },
      metricGrid([
        { label: 'SIM 卡', value: S.sim.sub ? `${S.sim.sub} · SIM ${S.sim.active + 1}` : '--', detail: S.sim.sub ? 'GTDUALSIM' : undefined },
        { label: 'APN 列表', value: apns || '--', detail: S.apnContexts.length ? `${S.apnContexts.length} 个上下文` : undefined },
        { label: '活动承载', value: ds.cid || ds.pdpType ? `cid ${ds.cid} · ${ds.pdpType}` : '--', detail: ds.apn || undefined },
        { label: 'IPv4', value: ds.ipv4 || '--' },
        { label: '网关', value: ds.gateway || '--' },
        { label: 'DNS', value: ds.dns.join(' · ') || '--' },
      ])));
  },
  updateAdv() {
    const el = $('#set-adv'); if (!el) return;
    const plmnOn = S.registration.plmnLocked;
    const cellInfoOn = S.cellDetail.modeEnabled;
    patch(el, card({ title: '高级设置', eyebrow: '维护操作' },
      `<div class="toggle-row"><span><strong>锁定 PLMN</strong><small>46011 · CHN-CT</small></span><input class="switch" type="checkbox" data-act="plmn-toggle" ${plmnOn ? 'checked' : ''}></div>
       <div class="divider"></div>
       <div class="toggle-row"><span><strong>GTCELLINFO</strong><small>详细无线指标</small></span><input class="switch" type="checkbox" data-act="cellinfo-toggle" ${cellInfoOn ? 'checked' : ''}></div>
       <div class="divider"></div>
       <div class="mgrid">${metricGrid([
         { label: '漫游拨号', value: S.roaming.allowed ? '允许' : '禁止', accent: 'good' },
         { label: '当前漫游', value: S.roaming.roaming ? '漫游中' : '未漫游', accent: 'good' },
       ])}</div>
       <div class="divider"></div>
       <div class="control-actions">
         <button class="btn is-ghost" type="button" data-act="mod-reconnect">${I.refresh}<span>重连</span></button>
         <button class="btn is-danger" type="button" data-act="mod-restart">${I.bolt}<span>重启</span></button>
       </div>
       <div class="hint" style="margin:12px 0">${I.warn}<span>重启模组会短期断网；当前拨号由 qmodem/QMI 管理。</span></div>
       <div class="divider"></div>
       <div class="ports">
         <div class="port"><span class="port-role">Port A</span><strong>${esc(S.statusPort)}</strong><span>实时状态 + 控制 · GTCCINFO / GTCAINFO / GTCELLLOCK</span></div>
         <div class="port"><span class="port-role">Port B</span><strong>${esc(S.controlPort)}</strong><span>长任务专用 · GTCELLSCAN · SMS</span></div>
         <div class="port"><span class="port-role">QMI</span><strong>/dev/cdc-wdm0</strong><span>数据口 · quectel-CM / fm170_dial</span></div>
       </div>`));
  },
  updateAt() {
    const el = $('#set-at'); if (!el || focusTyping()) return;
    patch(el, card({ title: 'AT 控制', eyebrow: '经串口调度器队列串行执行' },
      `<div class="hint good" style="margin-bottom:10px">${I.bolt}<span>常用指令下拉选择，或输入任意单行 AT 指令（最多 256 字符）。输出为模块原生回显。</span></div>
      <div class="at-row">
        <select class="in" data-act="at-preset" style="flex:1;min-width:170px">
          <option value="">选择常用 AT 指令…</option>
          ${AT_PRESETS.map(g => `<optgroup label="${esc(g[0])}">${g[1].map(p => `<option value="${escAttr(p[0])}">${esc(p[0])} — ${esc(p[1])}</option>`).join('')}</optgroup>`).join('')}
        </select>
        <input class="in" data-act="at-input" style="flex:2;min-width:170px" placeholder="或输入任意单行 AT 指令，例如 AT+CSQ">
        <button class="btn is-primary" type="button" data-act="at-send">${I.bolt}<span>发送</span></button>
      </div>
      <pre class="at-out" id="at-out">${esc(S.at.out)}</pre>`));
  },
};

/* ================= 设置页动作 ================= */
async function setMode(mode) {
  const label = modeLabelOf(mode);
  if (!confirm(`确认切换网络模式到 ${label}？会短暂断网。`)) return;
  S.bandPendingMode = mode;
  if (mode === '2') { S.bandSel.nr = []; S.bandSel.umts = []; }
  if (mode === '14') { S.bandSel.lte = []; S.bandSel.umts = []; }
  try {
    await doNetworkMode(mode);
    toast('已发送网络模式切换命令，切换过程可能短暂断网', 'warn');
    S.bandPendingMode = null;
    loadStatus(true);
  } catch (e) {
    S.bandPendingMode = null;
    toast(e.message || '控制命令失败', 'bad');
    loadStatus(true);
  }
}
async function applyBands() {
  const sel = S.bandSel;
  const mid = Number(S.networkModeId || 0);
  const list = [...(modeAllows('umts') ? sel.umts : []), ...(modeAllows('lte') ? sel.lte.map(b => 100 + b) : []), ...(modeAllows('nr') ? sel.nr.map(encodeBand) : [])];
  if (mid === 2 && sel.nr.length) { toast('单4G模式不能锁定NR频段', 'warn'); return; }
  if (mid === 14 && sel.lte.length) { toast('单5G模式不能锁定LTE频段', 'warn'); return; }
  if (!list.length) { toast('请至少保留一个当前模式允许的频段', 'warn'); return; }
  if (!confirm('根据当前网络模式发送 AT+GTACT=<rat>,,,<bands>，会短暂断网。')) return;
  try {
    await doBandLock(list.join(','), S.networkModeId || '');
    S.allowedBands = { umts: modeAllows('umts') ? [...sel.umts] : [], lte: modeAllows('lte') ? [...sel.lte] : [], nr: modeAllows('nr') ? [...sel.nr] : [] };
    S.bandDirty = false;
    toast('已发送允许频段配置命令，未改变网络模式', 'good');
    loadStatus(true);
  } catch (e) {
    S.bandDirty = false;
    toast(e.message || '控制命令失败', 'bad');
  }
}
function toggleBand(key, b, on) {
  S.bandDirty = true;
  const set = new Set(S.bandSel[key] || []);
  on ? set.add(b) : set.delete(b);
  S.bandSel[key] = Array.from(set).sort((a, b) => a - b);
  renderAll();
}
function bandsSelectAll() {
  ['umts', 'lte', 'nr'].forEach(k => { if (modeAllows(k) && S.availableBands[k]) S.bandSel[k] = [...S.availableBands[k]]; });
  S.bandDirty = true;
  toast('已全选当前模式可用频段', 'good');
  renderAll();
}
function bandsSelectNone() {
  ['umts', 'lte', 'nr'].forEach(k => { S.bandSel[k] = []; });
  S.bandDirty = true;
  toast('已清空全部频段勾选', 'good');
  renderAll();
}
async function togglePlmn(on) {
  if (!confirm(on ? '确认锁定 PLMN 46011？锁定后模块可能优先驻留中国电信网络。' : '确认解除 PLMN 锁定？')) return;
  try {
    await doPlmnLock(on);
    toast(on ? '已发送 PLMN 锁定命令' : '已发送 PLMN 解锁命令', 'good');
    loadStatus(true);
  } catch (e) { toast(e.message || '控制命令失败', 'bad'); }
}
async function toggleCellInfo(on) {
  try {
    await doCellInfoMode(on);
    toast(`已发送 GTCELLINFO ${on ? '启用' : '停用'} 命令`, 'good');
    loadStatus(true);
  } catch (e) { toast(e.message || '控制命令失败', 'bad'); }
}
async function restartModem() {
  if (!confirm('确认重启 5G 模组？会短暂断网。')) return;
  try { await doRestart(); toast('已发送重启命令，等待模块恢复', 'warn'); }
  catch (e) { toast(e.message || '控制命令失败', 'bad'); }
}
function reconnectModem() { toast('QMI 拨号重连由 qmodem 管理，WebUI 不直接操作', 'warn'); }

/* ================= 邻区锁定动作 ================= */
async function lockSelectedCells() {
  const sel = S.selected.map(k => S.scanResult.cells.find(c => cellKey(c) === k)).filter(Boolean);
  if (!sel.length) return;
  if (sel.length > 1) { toast('多小区锁定仅支持单小区，请逐一定位', 'warn'); return; }
  const p = neighborToLock(sel[0]);
  try {
    await doCellLock(p);
    S.pendingLockState = 'lock';
    S.selected = [];
    toast('已发送小区锁定命令，等待真机确认', 'good');
    loadStatus(true);
  } catch (e) { toast(e.message || '控制命令失败', 'bad'); }
}
async function unlockCells() {
  try {
    await doCellUnlock();
    S.pendingLockState = 'unlock';
    S.selected = [];
    toast('已发送小区解锁命令，等待真机确认', 'good');
    loadStatus(true);
  } catch (e) { toast(e.message || '控制命令失败', 'bad'); }
}
async function lockManual() {
  const m = S.manual;
  if (m.rat === 'NR' && m.type === 'frequency') { toast('FM170 固件仅支持 NR PCI 锁频', 'warn'); return; }
  const p = { rat: m.rat, type: m.type, arfcn: m.arfcn, pci: m.pci, scs: m.scs === 30 ? 1 : 0, band: m.band };
  try {
    await doCellLock(p);
    S.pendingLockState = 'lock';
    toast('已发送小区锁定命令，等待真机确认', 'good');
    loadStatus(true);
  } catch (e) { toast(e.message || '控制命令失败', 'bad'); }
}
async function lockServingCell() {
  const sv = S.serving;
  if (!sv.arfcn) { toast('当前没有可用的服务小区信息', 'warn'); return; }
  const p = neighborToLock({ rat: sv.rat, band: sv.band, arfcn: sv.arfcn, pci: sv.pci, tac: sv.tac, cellId: sv.cellId });
  try {
    await doCellLock(p);
    S.pendingLockState = 'lock';
    toast('已发送小区锁定命令，等待真机确认', 'good');
    loadStatus(true);
  } catch (e) { toast(e.message || '控制命令失败', 'bad'); }
}

/* ================= AT 面板 ================= */
async function sendAt() {
  const input = document.querySelector('[data-act="at-input"]');
  const cmd = (input?.value || '').trim();
  if (!/^AT/i.test(cmd) || /[\r\n&|;`$()]/.test(cmd)) {
    S.at.out = '请输入以 AT 开头的单行指令（不允许换行及 & | ; ` $ ( ) 字符）';
    renderAll(); return;
  }
  S.at.out = '执行中…';
  renderAll();
  try {
    const raw = await doFreeAt(cmd);
    S.at.out = raw || '（无返回）';
  } catch (e) { S.at.out = e.message || '执行失败'; }
  renderAll();
}

/* ================= 事件委托 ================= */
function toggleSelect(key) {
  S.selected = S.selected.includes(key) ? S.selected.filter(k => k !== key) : [...S.selected, key];
  renderAll();
}
function bindEvents() {
  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;

    switch (act) {
      // 全局
      case 'manual-refresh': {
        lease('ui_refresh');
        loadStatus(true);
        break;
      }
      // 邻区
      case 'scan-start': startScan(); break;
      case 'scan-refresh': refreshScanNow(); break;
      case 'scan-rat': { S.filters.rat = el.value; renderAll(); break; }
      case 'filter-band': { S.filters.band = el.value; renderAll(); break; }
      case 'filter-rsrp': { S.filters.rsrp = el.value === '' ? null : Number(el.value); renderAll(); break; }
      case 'filter-sort': { S.filters.sort = el.value; renderAll(); break; }
      case 'filter-q': { S.filters.q = el.value; renderAll(); break; }
      case 'filter-clear': { S.filters = { q: '', rat: 'all', band: 'all', rsrp: null, sort: 'rsrp' }; renderAll(); break; }
      case 'row': { const f = ev.target.closest('.nrow'); if (f) toggleSelect(f.dataset.key); break; }
      case 'row-lock': {
        ev.stopPropagation();
        S.selected = [el.dataset.key];
        await lockSelectedCells();
        break;
      }
      case 'row-det': {
        ev.stopPropagation();
        const k = el.dataset.key;
        S.det = S.det === k ? null : k;
        renderAll();
        break;
      }
      case 'svc-lock': await lockServingCell(); break;
      case 'svc-unlock': await unlockCells(); break;
      case 'lock-apply': await lockSelectedCells(); break;
      case 'lock-clear': { S.selected = []; S.det = null; renderAll(); break; }
      case 'lock-unlock': await unlockCells(); break;
      case 'lock-manual': { S.manualOpen = !S.manualOpen; renderAll(); break; }
      case 'man-lock': await lockManual(); break;
      // 短信
      case 'sms-refresh': { loadSms(true); break; }
      case 'sms-item': {
        const i = el.dataset.i;
        S.smsOpen = S.smsOpen === i ? null : i;
        renderAll();
        break;
      }
      case 'sms-del': { ev.stopPropagation(); await delSms(el.dataset.i); break; }
      case 'sms-delall': await delAllSms(); break;
      // 拨号
      case 'dial-refresh': loadDial(); break;
      case 'dial-start': await dialStart(); break;
      case 'dial-stop': await dialStop(); break;
      case 'dial-qstop': await dialQmodemStop(); break;
      case 'dial-sched-stop': await dialSchedStop(); break;
      case 'dial-sched-start': await dialSchedStart(); break;
      case 'dial-at': {
        const cmd = el.dataset.cmd;
        const label = cmd === 'AT+CFUN=15' ? '复位模组 (AT+CFUN=15)' : (cmd === 'AT+GTCCINFO?' ? '当前小区 (AT+GTCCINFO?)' : '锁小区状态 (AT+GTCELLLOCK?)');
        if (cmd === 'AT+CFUN=15' && !confirm('确定执行 AT+CFUN=15 复位模组？\n会重新读卡，可能短暂断网。')) return;
        await dialAt(cmd, label);
        break;
      }
      // 设置
      case 'mode-set': await setMode(el.dataset.mode); break;
      case 'band-all': bandsSelectAll(); break;
      case 'band-none': bandsSelectNone(); break;
      case 'band-apply': await applyBands(); break;
      case 'plmn-toggle': await togglePlmn(el.checked); break;
      case 'cellinfo-toggle': await toggleCellInfo(el.checked); break;
      case 'mod-reconnect': reconnectModem(); break;
      case 'mod-restart': await restartModem(); break;
      case 'at-send': await sendAt(); break;
    }
  });

  document.addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    switch (act) {
      case 'band-toggle': {
        toggleBand(el.dataset.key, Number(el.dataset.band), el.checked);
        break;
      }
      case 'at-preset': {
        const input = document.querySelector('[data-act="at-input"]');
        if (input) input.value = el.value;
        break;
      }
      case 'man-rat': { S.manual.rat = el.value; if (el.value === 'NR' && S.manual.type === 'frequency') S.manual.type = 'pci'; renderAll(); break; }
      case 'man-type': { S.manual.type = el.value; renderAll(); break; }
      case 'man-scs': { S.manual.scs = Number(el.value); renderAll(); break; }
    }
  });

  document.addEventListener('input', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    switch (el.dataset.act) {
      case 'man-arfcn': S.manual.arfcn = Number(el.value); break;
      case 'man-pci': S.manual.pci = Number(el.value); break;
      case 'man-band': S.manual.band = Number(el.value); break;
      default: return;
    }
    const pre = $('#man-preview');
    if (pre) pre.textContent = lockCmd({ ...S.manual, scs: S.manual.scs === 30 ? 1 : 0 });
  });

  document.addEventListener('keydown', (ev) => {
    const el = ev.target.closest('.nrow[data-act="row"]');
    if (el && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); toggleSelect(el.dataset.key); }
  });
}

/* ================= 路由 ================= */
const ROUTES = { dashboard: Dashboard, carrier: Carrier, neighbors: Neighbors, sms: Sms, dial: Dial, settings: Settings };
const routeKeys = Object.keys(ROUTES);
function currentView() { return ROUTES[S.route] || Dashboard; }

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  S.route = routeKeys.includes(h) ? h : 'dashboard';
}
let activeView = null;
function mountRoute() {
  const v = currentView();
  if (activeView && activeView.unmount) activeView.unmount();
  activeView = v;
  const el = viewEl();
  if (el) el.innerHTML = v.html();
  v.update();
  if (v.mount) v.mount();
}
window.addEventListener('hashchange', () => {
  parseHash();
  updateShell();
  mountRoute();
});

/* ================= 启动 ================= */
function boot() {
  const app = $('#app');
  if (!app) return;
  app.innerHTML = shellHTML();
  renderToasts();
  bindEvents();
  parseHash();
  updateShell();
  mountRoute();
  startLease();
  loadStatus(true);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();