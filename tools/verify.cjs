const { chromium } = require('playwright');
const EXE = '/home/royi/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';
const wait = (p, ms) => p.waitForTimeout(ms);
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE,
    args: ['--no-sandbox','--disable-crash-reporter','--disable-breakpad','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.stack || e.message}`));
  await page.goto('http://127.0.0.1:8090/?q=high', { waitUntil: 'domcontentloaded' });
  await wait(page, 16000);
  await page.screenshot({ path: 'shots/v01-title.png' });
  await page.click('#btn-start');
  await wait(page, 6000);

  // 背包（自动选中）
  await page.keyboard.press('KeyI'); await wait(page, 1800);
  await page.screenshot({ path: 'shots/v02-inventory.png' });
  const inv = await page.evaluate(() => ({
    selected: document.querySelector('.slot--selected')?.getAttribute('data-item') || null,
    detail: document.querySelector('.inv-detail__name, .inv-detail h3, [data-item] .slot__name')?.textContent || null,
  }));
  console.log('INV', JSON.stringify(inv));
  await page.keyboard.press('Escape'); await wait(page, 800);

  // 对话（检查是否还有 click-to-lock 提示）
  await page.evaluate(() => {
    const g = window.game;
    const it = g.world.interactables.find(x => x.kind === 'npc' && x.id.includes('warden'));
    const x = it.position.x + 2, z = it.position.z + 2;
    g.player.position.set(x, g.world.groundAt(x,z,1e9), z);
    g.player.object.position.copy(g.player.position);
    g.player.heading = Math.atan2(it.position.x - x, it.position.z - z);
    g.camera3p.yaw = g.player.heading + Math.PI; g.camera3p._initialized = false;
  });
  await wait(page, 2500);
  await page.keyboard.press('KeyF'); await wait(page, 2000);
  await page.screenshot({ path: 'shots/v03-dialogue.png' });
  const toasts = await page.evaluate(() => [...document.querySelectorAll('.toast__text')].map(t=>t.textContent));
  console.log('TOASTS', JSON.stringify(toasts));
  await page.keyboard.press('Escape'); await wait(page, 1200);

  // 夜晚
  await page.evaluate(() => {
    const g = window.game;
    g.atmosphere.timeOfDay = 0.9;
    const x = 40, z = 280;
    g.player.position.set(x, g.world.groundAt(x,z,1e9), z);
    g.player.object.position.copy(g.player.position);
    g.player.heading = Math.PI;
    g.camera3p.yaw = Math.PI * 2; g.camera3p.pitch = 0.08; g.camera3p.distance = 9;
    g.camera3p.targetDistance = 9; g.camera3p.currentDistance = 9; g.camera3p._initialized = false;
  });
  await wait(page, 6000);
  await page.screenshot({ path: 'shots/v04-night.png' });

  const info = await page.evaluate(() => {
    const g = window.game;
    return {
      fps: +g.engine.stats.fps.toFixed(1), calls: g.engine.stats.drawCalls, tris: g.engine.stats.triangles,
      nightAmbient: +g.atmosphere.ambient.intensity.toFixed(2), moon: +g.atmosphere.moon.intensity.toFixed(2),
      state: g.systems.quest.state('main_awaken'),
    };
  });
  console.log(JSON.stringify(info, null, 2));
  console.log('ERRORS', JSON.stringify(logs.slice(0,10)));
  await browser.close();
})();
