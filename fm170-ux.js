/* FM170 WebUI 增强脚本（短信 + 拨号导航 + 设置页精简 + 前端展示层优化/紧凑化） */
/* 仅前端展示层：不触碰 bundle / CGI / AT / 串口 / scheduler / 轮询机制 */
(() => {
  const STYLE_ID = 'fm170-ux-style';
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* ============ 导航入口（侧边栏 / 移动端） ============ */
    .nav-entry{display:flex;align-items:center;gap:8px;text-decoration:none;color:var(--muted,#92959d)}
    .nav-entry svg{width:18px;height:18px;flex:0 0 auto}
    .sidebar .nav-entry{width:100%;min-height:40px;padding:9px 12px;border-radius:7px;font-size:14px}
    .sidebar .nav-entry:hover{background:#18181c;color:var(--text,#f5f6f7)}
    .mobile-nav-item.nav-entry{flex-direction:column;gap:3px;padding:4px 2px;border-radius:7px;font-size:10px;font-weight:620;min-width:0;justify-content:center}
    .mobile-nav-item.nav-entry:hover{color:var(--text,#f5f6f7)}

    /* ============ 底部导航：6 项均分、紧凑、安全区域 ============ */
    .mobile-nav{
      grid-template-columns:repeat(6,minmax(0,1fr)) !important;
      min-height:58px !important;
      padding:5px 6px calc(6px + env(safe-area-inset-bottom)) !important;
    }
    .mobile-nav-item{
      gap:3px !important;
      padding:4px 0 !important;
      font-size:10px !important;
      color:#92959d;
      min-width:0;
    }
    .mobile-nav-item svg{width:20px;height:20px}
    .mobile-nav-item.active{color:var(--text,#f5f6f7)}
    .mobile-nav-item.active svg{filter:drop-shadow(0 0 6px rgba(52,196,95,.35))}
    @media (max-width:380px){
      .mobile-nav-item{font-size:9.5px !important}
      .mobile-nav-item svg{width:19px;height:19px}
    }

    /* ============ 设置页精简：体积较大的说明文字弱化/隐藏 ============ */
    .fm170-hide{display:none!important}

    /* ============ 展示层紧凑化（仅布局，不改数据） ============ */
    /* 面板卡片内边距收紧，降低“卡片高度偏大” */
    .panel-body{padding:4px 14px 12px}
    .panel-head{min-height:50px;padding:12px 14px 9px}
    .page{padding:14px 16px calc(80px + env(safe-area-inset-bottom))}
    .view{gap:14px}

    /* --- 首页：信号数值更突出 --- */
    .signal-meta .signal-value{font-size:19px;font-weight:740}
    .signal-row{margin-bottom:2px}
    /* 服务小区亮点：band 突出 */
    .hero-band{font-size:38px;font-weight:780}
    .network-primary{font-size:32px;font-weight:760}

    /* --- 载波页：紧凑两列信息网格，避免每项占过高卡片 --- */
    .ca-overview{padding-bottom:10px}
    .ca-total{font-size:34px}
    .ca-pcc{padding:6px 10px}
    .ca-pcc strong{font-size:15px}
    .ca-note{padding-top:10px;margin-bottom:4px}
    .cell-spotlight{padding-bottom:8px}
    .cell-band{font-size:34px}
    .metric-grid.compact{gap:4px 12px}
    .metric-grid.compact .metric-block{padding-top:8px;border-top:1px solid var(--line-soft)}
    .metric-grid.compact .metric-label{font-size:10.5px}
    .metric-grid.compact .metric-value{font-size:15px;margin-top:3px}
    .ca-components{gap:8px;padding-top:12px}
    .ca-component-head{padding-bottom:4px}
    .ca-component-band{font-size:22px}
    .ca-total-row{margin-top:10px;padding-top:10px}

    /* --- 邻区：紧凑横向卡片，两层信息，信号色突出 --- */
    .neighbor-list{gap:7px}
    .neighbor-row{padding:9px 12px;border-radius:8px}
    .neighbor-band span{font-size:14px;font-weight:720}
    .neighbor-band small{font-size:10px}
    .neighbor-title{gap:6px}
    .neighbor-title strong{font-size:13px;line-height:1.3}
    .neighbor-main{min-width:0}
    /* 邻区第一层：隐藏冗长技术细节，仅在详情可见 */
    .neighbor-details{display:none !important}
    .neighbor-select-hint{display:none !important}
    /* 信号指标：RSRP 等三值强调、颜色等级 */
    .neighbor-signal{gap:6px}
    .neighbor-signal .metric-block{padding-top:0 !important;border-top:0 !important}
    .neighbor-signal .metric-value{font-size:13px;font-weight:720}
    .neighbor-signal .metric-label{font-size:9px;letter-spacing:.02em}
    .neighbor-signal .metric-detail{display:none !important}
    /* 邻区操作（锁定/解锁）保留但紧凑 */
    .neighbor-lock{margin-top:12px;padding-top:12px}
    .lock-bar-hint{font-size:12px}

    /* --- 通量：让值/标签统一、避免卡片过高 --- */
    .metric-block{padding-top:9px}
    .metric-label{font-size:10.5px}
    .metric-value{font-size:15px;margin-top:3px}
    .panel-body .metric-grid{margin-bottom:6px}
    .wide-panel .panel-body{padding-top:6px}

    /* --- 窄屏：状态标签允许换行，避免横向溢出 --- */
    @media (max-width:600px){
      .status-pill{white-space:normal !important;word-break:break-word}
      .view-actions, .view-head>div{flex-wrap:wrap}
      .hero-strip{min-height:0;padding:16px}
      .hero-status{align-items:flex-start}
      .toast-region{bottom:76px}
    }
  `;
  document.head.appendChild(style);

  // ---- 短信导航 ----
  var SMS_NAV_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  function injectSmsNav() {
    if (location.hostname && location.pathname.indexOf('/fm170/sms.html') !== -1) return;
    var sbar = document.querySelector('.sidebar-nav');
    if (sbar && !sbar.querySelector('.sms-nav-entry')) {
      var a = document.createElement('a');
      a.className = 'nav-entry sms-nav-entry';
      a.href = '/fm170/sms.html';
      a.innerHTML = SMS_NAV_SVG + '<span>短信</span>';
      sbar.appendChild(a);
    }
    var mnav = document.querySelector('.mobile-nav');
    if (mnav && !mnav.querySelector('.sms-nav-entry')) {
      var a2 = document.createElement('a');
      a2.className = 'mobile-nav-item nav-entry sms-nav-entry';
      a2.href = '/fm170/sms.html';
      a2.innerHTML = SMS_NAV_SVG + '<span>短信</span>';
      mnav.appendChild(a2);
    }
  }

  // ---- 拨号导航 ----
  var DIAL_NAV_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.666 13.333a5.333 5.333 0 0 0 2.213-1.773l5.834-4.104-6.373 1.267"/><path d="M20.333 9.333c0-.552-.448-1-1-1"/><path d="M4.667 2.5c-2.2 0-3.089 2.352-1.561 3.772a15.431 15.431 0 0 0 3.234 2.45A15.087 15.087 0 0 0 9.2 8.6"/><path d="M2.5 4.667c0-2.2 2.352-3.089 3.772-1.561a15.431 15.431 0 0 1 2.45 3.234"/></svg>';
  function injectDialNav() {
    if (location.hostname && location.pathname.indexOf('/fm170/dial.html') !== -1) return;
    var sbar = document.querySelector('.sidebar-nav');
    if (sbar && !sbar.querySelector('.dial-nav-entry')) {
      var a = document.createElement('a');
      a.className = 'nav-entry dial-nav-entry';
      a.href = '/fm170/dial.html';
      a.innerHTML = DIAL_NAV_SVG + '<span>拨号</span>';
      sbar.appendChild(a);
    }
    var mnav = document.querySelector('.mobile-nav');
    if (mnav && !mnav.querySelector('.dial-nav-entry')) {
      var a2 = document.createElement('a');
      a2.className = 'mobile-nav-item nav-entry dial-nav-entry';
      a2.href = '/fm170/dial.html';
      a2.innerHTML = DIAL_NAV_SVG + '<span>拨号</span>';
      mnav.appendChild(a2);
    }
  }

  // ---- 隐藏设置页多余区块 ----
  function hideExtraSettings() {
    if (!location.pathname || location.pathname.indexOf('/fm170/') === -1) return;
    document.querySelectorAll('section.panel, .panel').forEach(function(panel){
      if (panel.className.indexOf('fm170-hidden') > -1) return;
      var titleEl = panel.querySelector('.panel-title');
      if (!titleEl) return;
      var t = titleEl.innerText.trim();
      // 隐藏不常用的面板：模块控制、端口、漫游控制、PLMN 锁定
      var hide = (t === '模块控制' || t === '端口' || t === '漫游控制' || t === 'PLMN 锁定');
      if (hide) { panel.classList.add('fm170-hidden'); panel.style.display = 'none'; }
    });
    document.querySelectorAll('section.panel').forEach(function(panel){
      var t = panel.querySelector('.panel-title');
      if (!t) return;
      var name = t.innerText.trim();
      if (name === '网络模式') {
        panel.querySelectorAll('.band-note, [class*="note"]').forEach(function(n){
          if (n.innerText && n.innerText.indexOf('邻区扫描后台已固定') > -1 && n.style.display !== 'none'){ n.style.display='none'; }
        });
      }
      if (name === '锁频段') {
        panel.querySelectorAll('.band-note, [class*="note"]').forEach(function(n){
          if (n.innerText && n.innerText.indexOf('可勾选列表来自') > -1 && n.style.display !== 'none'){ n.style.display='none'; }
        });
      }
    });
  }

  // ---- 拨号页：移除顶部技术性说明条，避免占空间（不动功能） ----
  function tidyDialPage() {
    if (!location.pathname || location.pathname.indexOf('/fm170/dial.html') === -1) return;
    var note = document.querySelector('.dial-note, .note');
    // 保持不动 —— 说明保留，仅确保窄屏不溢出
  }

  const apply = () => { injectSmsNav(); injectDialNav(); hideExtraSettings(); tidyDialPage(); };
  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; apply(); });
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', schedule);
  setInterval(apply, 1200);
  schedule();
})();

/* FM170 按需采集：页面打开才续租，状态数据不再自动打串口；手动刷新时整页重新取一次。 */
(() => {
  const API = '/cgi-bin/fm170_api.cgi';
  const nativeFetch = window.fetch.bind(window);
  const CACHE_KEY = 'fm170_status_cache_v1';
  let statusCache = null;
  try { statusCache = localStorage.getItem(CACHE_KEY) || null; } catch (_) {}
  let firstStatus = true;
  const isStatus = (url) => /fm170_api\.cgi\?[^#]*action=status(?:&|$)/.test(String(url));
  const lease = (action) => nativeFetch(`${API}?action=${action}&ts=${Date.now()}`, {cache:'no-store', keepalive:true}).catch(()=>{});
  lease('ui_open');
  const leaseTimer = setInterval(() => lease('ui_open'), 20000);
  window.addEventListener('pagehide', () => { clearInterval(leaseTimer); lease('ui_close'); });

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (isStatus(url) && !firstStatus) {
      // 给原页面返回上一次状态，避免它的内部定时器继续触发真实 API/串口采集。
      if (statusCache) return new Response(statusCache, {status:200, headers:{'Content-Type':'application/json'}});
      return new Response(JSON.stringify({ok:true,fresh:false,raw:{}}), {status:200, headers:{'Content-Type':'application/json'}});
    }
    if (isStatus(url)) firstStatus = false;
    let response;
    try {
      response = await nativeFetch(input, init);
    } catch (e) {
      if (isStatus(url) && statusCache) return new Response(statusCache, {status:200, headers:{'Content-Type':'application/json'}});
      throw e;
    }
    if (isStatus(url)) {
      try {
        const body = await response.clone().text();
        if (body && body.length > 20) {
          statusCache = body;
          try { localStorage.setItem(CACHE_KEY, body); } catch (_) {}
        }
      } catch (_) {}
    }
    return response;
  };

  function addRefreshButton() {
    if (document.getElementById('fm170-manual-refresh')) return;
    const b = document.createElement('button');
    b.id = 'fm170-manual-refresh'; b.type = 'button'; b.textContent = '↻ 手动刷新';
    b.title = '仅在点击时读取模块状态';
    b.onclick = () => { b.disabled = true; b.textContent = '读取中…'; lease('ui_refresh'); setTimeout(() => location.reload(), 80); };
    document.body.appendChild(b);
  }
  const style = document.createElement('style'); style.textContent = `#fm170-manual-refresh{position:fixed;right:18px;top:16px;z-index:20;border:1px solid #2f9e5b;background:#14241a;color:#dff8e7;border-radius:8px;padding:8px 13px;font-weight:650;cursor:pointer;box-shadow:0 4px 18px #0003}#fm170-manual-refresh:disabled{opacity:.65}@media(max-width:600px){#fm170-manual-refresh{top:auto;right:12px;bottom:72px;padding:9px 12px;font-size:12px}}`; document.head.appendChild(style);
  new MutationObserver(addRefreshButton).observe(document.documentElement, {childList:true, subtree:true});
  addRefreshButton();
})();

/* 高级 AT 控制：常用命令下拉 + 任意单行 AT 命令。 */
(() => {
  const CONTROL = '/cgi-bin/fm170_control.cgi';
  const presets = [
    ['AT+CSQ','查询信号强度'],['AT+CESQ','查询扩展信号质量'],['AT+COPS?','查询运营商'],['AT+CEREG?','查询 LTE 注册'],['AT+C5GREG?','查询 5G 注册'],['AT+CGREG?','查询 GPRS 注册'],['AT+GTCCINFO?','查询服务小区'],['AT+GTCAINFO?','查询载波聚合'],['AT+GTCELLLOCK?','查询小区锁定'],['AT+GTPLMNLOCK?','查询 PLMN 锁定'],['AT+GTACT?','查询网络模式'],['AT+CGDCONT?','查询 PDP/APN'],['AT+CGCONTRDP','查询地址/DNS'],['AT+CGMM','查询模块型号'],['AT+CGMR','查询固件版本'],['AT+CFUN?','查询功能状态'],['AT+CFUN=15','重新注册网络']
  ];
  const esc = x => String(x).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function panel(){
    if (document.getElementById('fm170-at-panel')) return;
    const host = document.querySelector('.page') || document.querySelector('main') || document.body; if (!host) return;
    const box=document.createElement('section'); box.id='fm170-at-panel'; box.innerHTML=`<div class="fm170-at-title">AT 控制 <span>直接通过 FM170 串口队列执行</span></div><div class="fm170-at-row"><select id="fm170-at-preset"><option value="">选择常用 AT 指令…</option>${presets.map(x=>`<option value="${esc(x[0])}">${esc(x[0])} — ${esc(x[1])}</option>`).join('')}</select><input id="fm170-at-input" value="" placeholder="或输入任意单行 AT 指令，例如 AT+CSQ"><button id="fm170-at-send">发送</button></div><div id="fm170-at-output" class="fm170-at-output">等待执行…</div>`;
    host.appendChild(box);
    box.querySelector('#fm170-at-preset').onchange=e=>{box.querySelector('#fm170-at-input').value=e.target.value};
    box.querySelector('#fm170-at-send').onclick=async()=>{const cmd=box.querySelector('#fm170-at-input').value.trim();const out=box.querySelector('#fm170-at-output');if(!/^AT(?:\+.*)?$/i.test(cmd)||/[\r\n&|;`$()]/.test(cmd)){out.textContent='请输入以 AT 开头的单行指令';return}out.textContent='执行中…';const sid=localStorage.getItem('fm170_webui_control_session')||'';try{const r=await fetch(`${CONTROL}?action=at&cmd=${encodeURIComponent(cmd)}&sid=${encodeURIComponent(sid)}`,{cache:'no-store'});const body=await r.text();let data;try{data=JSON.parse(body)}catch(_){data={raw:body}}out.textContent=(data&&typeof data.raw==='string')?data.raw:(data&&data.error)||''}catch(e){out.textContent=String(e)}};
  }
  const st=document.createElement('style');st.textContent=`#fm170-at-panel{margin:18px 0;padding:16px;border:1px solid #2b3a31;border-radius:10px;background:#101613;color:#dce8df}#fm170-at-panel .fm170-at-title{font-weight:700;margin-bottom:12px}#fm170-at-panel .fm170-at-title span{font-size:12px;color:#8d9b91;font-weight:400;margin-left:8px}.fm170-at-row{display:flex;gap:8px;flex-wrap:wrap}.fm170-at-row select,.fm170-at-row input{min-width:180px;flex:1;background:#18221c;color:#e7f1e9;border:1px solid #3a4b40;border-radius:6px;padding:8px}.fm170-at-row button{background:#2f9e5b;color:#fff;border:0;border-radius:6px;padding:8px 16px;font-weight:700}#fm170-at-panel .fm170-at-output{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;max-height:220px;overflow:auto;background:#0a0d0b;border-radius:6px;padding:10px;margin:12px 0 0;color:#b9efc5;font-size:12px;line-height:1.55;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}@media(max-width:600px){#fm170-at-panel{margin:12px 0;padding:12px}.fm170-at-row{display:grid;grid-template-columns:1fr}.fm170-at-row select,.fm170-at-row input,.fm170-at-row button{width:100%;min-width:0}}`;document.head.appendChild(st);
  new MutationObserver(panel).observe(document.documentElement,{childList:true,subtree:true}); panel();
})();
