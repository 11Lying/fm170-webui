const { chromium } = require('playwright');
const TARGET = 'http://localhost:8123/';
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond }); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(TARGET, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  ok('首页标题', (await page.title()).includes('FM170'));
  ok('首页 hero 显示', (await page.textContent('.hero-title')).includes('FM170'));
  ok('首页 hero band', (await page.textContent('.hero-band')).trim() === 'n78');
  ok('首页 6 张卡片', (await page.locator('.bento .card').count()) === 6, `count=${await page.locator('.bento .card').count()}`);
  ok('信号指标渲染', (await page.locator('.sbar').count()) === 4);
  ok('侧边栏 6 导航', (await page.locator('.nav-link').count()) === 6);
  ok('顶栏手动刷新按钮', await page.locator('[data-act="manual-refresh"]').count() === 1);
  ok('状态 pill 已连接', (await page.locator('.pill.good').first().textContent()).includes('已连接'));

  await page.click('.nav-link[href="#/carrier"]');
  await page.waitForTimeout(400);
  ok('载波页 PCC band', (await page.locator('.ca-pcc strong').textContent()).trim() === 'n78');
  ok('载波页 SCC 列表', (await page.locator('.scc').count()) === 2);
  ok('载波页允许频段', (await page.locator('#car-bands .band-sec').count()) === 3);

  await page.click('.nav-link[href="#/neighbors"]');
  await page.waitForTimeout(1200);
  await page.click('[data-act="scan-start"]');
  await page.waitForTimeout(600);
  const scanRunning = await page.locator('.scan-status strong').textContent().catch(() => '');
  ok('扫描发起（进行中/完成）', /正在|完成/.test(scanRunning), scanRunning);
  await page.waitForTimeout(3200);
  ok('扫描完成后状态', (await page.locator('.scan-status strong').textContent()).includes('扫描完成'));
  ok('邻区发现数', (await page.locator('#nz-count').textContent()) === '6', `nz-count=${await page.locator('#nz-count').textContent()}`);
  ok('邻区行渲染', (await page.locator('.nrow').count()) === 6, `count=${await page.locator('.nrow').count()}`);
  ok('服务小区卡片', await page.locator('.svc').count() === 1);
  await page.locator('.nrow').first().click();
  ok('行选中态', await page.locator('.nrow.selected').count() === 1);
  const lockBtnDisabled = await page.locator('[data-act="lock-apply"]').isDisabled();
  ok('锁定按钮可用（单选中）', !lockBtnDisabled);
  await page.click('[data-act="lock-apply"]');
  await page.waitForTimeout(800);
  ok('锁定后 toast', (await page.locator('.toast').count()) > 0);
  await page.click('[data-act="lock-manual"]');
  ok('手动锁定表单', await page.locator('.manual-lock').count() === 1);
  ok('命令预览生成', (await page.locator('#nz-lock .preview code').textContent()).startsWith('AT+GTCELLLOCK='));
  await page.click('[data-act="lock-manual"]');

  await page.click('.nav-link[href="#/sms"]');
  await page.waitForTimeout(600);
  ok('短信列表', (await page.locator('.sms-item').count()) === 3);
  ok('未读徽章', (await page.locator('#sms-unread').textContent()) === '1');
  await page.locator('.sms-item').first().click();
  ok('短信展开详情', await page.locator('.sms-body').count() === 1);
  await page.click('[data-act="sms-refresh"]');
  await page.waitForTimeout(500);
  ok('短信刷新 toast', (await page.locator('.toast').count()) > 0);

  await page.click('.nav-link[href="#/dial"]');
  await page.waitForTimeout(800);
  ok('拨号状态未拨号', (await page.locator('.dial-tt').textContent()).includes('未拨号'));
  await page.click('[data-act="dial-start"]', { force: true });
  await page.waitForTimeout(2500);
  ok('拨号启动已拨号', (await page.locator('.dial-tt').textContent()).includes('已拨号'));
  ok('拨号显示 IP', (await page.locator('#dial-info').textContent()).includes('100.23'));
  await page.click('[data-act="dial-at"][data-cmd="AT+GTCCINFO?"]', { force: true });
  await page.waitForTimeout(500);
  ok('AT 输出', (await page.locator('#dial-atout').inputValue()).includes('GTCCINFO'));

  await page.click('.nav-link[href="#/settings"]');
  await page.waitForTimeout(500);
  ok('网络模式选项', (await page.locator('.mode-opt').count()) === 3);
  ok('网络模式选中全模式', (await page.locator('.mode-opt.selected strong').textContent()).includes('全模式'));
  ok('频段编辑区', await page.locator('[data-act="band-toggle"]').count() > 0);
  page.once('dialog', d => d.accept());
  await page.click('.mode-opt[data-mode="14"]');
  await page.waitForTimeout(800);
  ok('模式切换后选中单5G', (await page.locator('.mode-opt.selected strong').textContent()).includes('单 5G'));
  await page.fill('[data-act="at-input"]', 'AT+CSQ');
  await page.click('[data-act="at-send"]');
  await page.waitForTimeout(600);
  ok('AT 面板输出', (await page.locator('#at-out').textContent()).includes('OK'));
  ok('高级设置内容', (await page.locator('#set-adv .ports .port').count()) === 3);
  ok('高级设置 AT 控制', await page.locator('#set-at .at-row').count() === 1);

  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  m.on('pageerror', e => errors.push('mobile pageerror: ' + e.message));
  await m.goto(TARGET, { waitUntil: 'domcontentloaded' });
  await m.waitForTimeout(1200);
  ok('移动端底部导航', (await m.locator('.mobile-link').count()) === 6);
  ok('移动端侧边栏隐藏', await m.locator('.sidebar').isHidden());
  await m.click('.mobile-link[href="#/neighbors"]');
  await m.waitForTimeout(1200);
  ok('移动端邻区行', (await m.locator('.nrow').count()) > 0);

  const realErrors = errors.filter(e => !e.includes('net::ERR') && !e.includes('favicon'));
  ok('无 JS 控制台错误', realErrors.length === 0, realErrors.join(' | ').slice(0, 300));

  await browser.close();
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n===== ${results.length - failed}/${results.length} passed =====`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });