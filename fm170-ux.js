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
