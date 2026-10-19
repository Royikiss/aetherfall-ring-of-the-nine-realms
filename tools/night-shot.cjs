const { chromium } = require('playwright');
const EXE = '/home/royi/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE,
    args: ['--no-sandbox','--disable-crash-reporter','--disable-breakpad','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const msgs = [];
  page.on('console', m => msgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => msgs.push(`[pageerror] ${e.message}`));
  await page.goto('http://127.0.0.1:8090/?q=high', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(15000);
  await page.click('#btn-start');
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    const g = window.game;
    g.atmosphere.timeOfDay = 0.9;
    const x = 46, z = 292;
    g.player.position.set(x, g.world.groundAt(x,z,1e9), z);
    g.player.object.position.copy(g.player.position);
    g.player.heading = Math.PI - 0.12;
    g.camera3p.yaw = g.player.heading + Math.PI;
    g.camera3p.pitch = 0.05;
    g.camera3p.distance = 8; g.camera3p.targetDistance = 8; g.camera3p.currentDistance = 8;
    g.camera3p._initialized = false;
  });
  await page.waitForTimeout(7000);
  await page.screenshot({ path: 'shots/night-final.png' });
  const uniq = {};
  for (const m of msgs) { const k = m.slice(0, 120); uniq[k] = (uniq[k]||0)+1; }
  console.log('CONSOLE:', JSON.stringify(uniq, null, 2));
  await browser.close();
})();
