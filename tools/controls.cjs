const { chromium } = require('playwright');
const EXE = '/home/royi/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';
const wait = (p, ms) => p.waitForTimeout(ms);
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE,
    args: ['--no-sandbox','--disable-crash-reporter','--disable-breakpad','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.goto('http://127.0.0.1:8090/?q=low', { waitUntil: 'domcontentloaded' });
  await wait(page, 13000);
  await page.click('#btn-start');
  await wait(page, 5000);

  const before = await page.evaluate(() => ({ p: window.game.player.position.toArray(), st: window.game.systems.stats.stamina, fps: window.game.engine.stats.fps }));
  await page.keyboard.down('KeyW');
  await wait(page, 4000);
  await page.keyboard.down('ShiftLeft');
  await wait(page, 3000);
  const mid = await page.evaluate(() => ({ p: window.game.player.position.toArray(), st: window.game.systems.stats.stamina, sprint: window.game.player.isSprinting }));
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Space');
  await wait(page, 600);
  const air = await page.evaluate(() => ({ y: window.game.player.position.y, ground: window.game.player.onGround, vy: window.game.player.velocity.y }));
  await wait(page, 2500);
  const land = await page.evaluate(() => ({ y: window.game.player.position.y, ground: window.game.player.onGround }));

  // F3
  await page.keyboard.press('F3'); await wait(page, 800);
  const perf = await page.evaluate(() => ({ visible: document.getElementById('hud-perf').classList.contains('is-visible'), text: document.getElementById('hud-perf').textContent.slice(0,80) }));

  // F5 存档 + 刷新后继续
  await page.keyboard.press('F5'); await wait(page, 1200);
  const saved = await page.evaluate(() => Object.keys(localStorage).length > 0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await wait(page, 14000);
  const cont = await page.evaluate(() => ({
    continueVisible: !document.getElementById('btn-continue').classList.contains('hidden'),
    hasSave: window.game.systems.save.hasSave(),
  }));
  console.log(JSON.stringify({ before, mid, air, land, perf, saved, cont }, null, 2));
  console.log('LOGS', JSON.stringify(logs.filter(l=>!l.startsWith('[log]')).slice(0,20)));
  await browser.close();
})();
