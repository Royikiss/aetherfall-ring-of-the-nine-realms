const { chromium } = require('playwright');
const EXE = '/home/royi/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';
const wait = (p, ms) => p.waitForTimeout(ms);
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE,
    args: ['--no-sandbox','--disable-crash-reporter','--disable-breakpad','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const logs=[]; page.on('pageerror', e=>logs.push(e.message));
  await page.goto('http://127.0.0.1:8090/?q=low', { waitUntil: 'domcontentloaded' });
  await wait(page, 13000);
  await page.click('#btn-start'); await wait(page, 5000);
  await page.evaluate(() => {
    const g = window.game;
    g.player.position.set(0, g.world.groundAt(0,322,1e9), 322);
    g.player.object.position.copy(g.player.position);
    g.systems.stats.damage(9999, 'test');
  });
  await wait(page, 1500);
  const dying = await page.evaluate(() => ({
    dead: window.game.systems.stats.isDead,
    hp: window.game.systems.stats.health,
    overlay: document.getElementById('hud-death').classList.contains('is-visible'),
  }));
  await page.screenshot({ path: 'shots/x01-death.png' });
  await wait(page, 5000);
  const after = await page.evaluate(() => ({
    dead: window.game.systems.stats.isDead,
    hp: Math.round(window.game.systems.stats.health),
    overlay: document.getElementById('hud-death').classList.contains('is-visible'),
    pos: window.game.player.position.toArray().map(v=>+v.toFixed(1)),
  }));
  // 使用物品
  const use = await page.evaluate(() => {
    const g = window.game;
    g.systems.stats.health = 50;
    const ok = g.systems.inventory.use('mead_horn');
    return { ok, hp: Math.round(g.systems.stats.health), count: g.systems.inventory.count('mead_horn') };
  });
  console.log(JSON.stringify({ dying, after, use }, null, 2));
  console.log('LOGS', logs.slice(0,10));
  await browser.close();
})();
