const { chromium } = require('playwright');
const EXE = '/home/royi/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: EXE,
    args: ['--no-sandbox','--disable-crash-reporter','--disable-breakpad','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.stack || e.message}`));
  page.on('requestfailed', r => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  await page.goto('http://127.0.0.1:8090/?q=high', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(14000);
  await page.screenshot({ path: 'shots/shot-title.png' });
  const state1 = await page.evaluate(() => ({
    titleVisible: !document.getElementById('title-screen').classList.contains('hidden'),
    bootError: !document.getElementById('boot-error').classList.contains('hidden'),
    bootMsg: document.getElementById('boot-error-msg')?.textContent?.slice(0,600),
    loadingStatus: document.getElementById('loading-status')?.textContent,
    started: window.game?.started,
    world: !!window.game?.world,
  }));
  console.log('STATE1', JSON.stringify(state1, null, 2));
  const btn = await page.$('#btn-start');
  if (btn) { await btn.click(); await page.waitForTimeout(9000); }
  await page.screenshot({ path: 'shots/shot-game.png' });
  // 打开行囊
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: 'shots/shot-inventory.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  // 打开地图
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'shots/shot-map.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/shot-game.png' });
  const state2 = await page.evaluate(() => ({
    started: window.game?.started,
    fps: window.game?.engine?.stats?.fps,
    calls: window.game?.engine?.stats?.drawCalls,
    tris: window.game?.engine?.stats?.triangles,
    pos: window.game?.player?.position,
    systems: Object.keys(window.game?.systems || {}),
    panels: window.game?.ui ? [...window.game.ui.panels.keys()] : [],
    pois: window.game?.world?.pois?.length,
    landmarks: window.game?.world?.landmarks?.instances?.length,
    missing: window.game?.world?.landmarks?.missing,
  }));
  console.log('STATE2', JSON.stringify(state2, null, 2));
  console.log('LOGS:\n' + logs.slice(0, 100).join('\n'));
  await browser.close();
})();
