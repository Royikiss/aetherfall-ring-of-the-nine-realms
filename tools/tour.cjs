const { chromium } = require('playwright');
const EXE = '/home/royi/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE,
    args: ['--no-sandbox','--disable-crash-reporter','--disable-breakpad','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.stack || e.message}`));
  await page.goto('http://127.0.0.1:8090/?q=high', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(14000);
  await page.screenshot({ path: 'shots/01-title.png' });
  await page.click('#btn-start');
  await page.waitForTimeout(6000);
  await page.screenshot({ path: 'shots/02-spawn.png' });

  const places = [
    ['03-hall', -20, -250, Math.PI, 0.06],
    ['04-tree', 60, 210, Math.PI, 0.02],
    ['05-cathedral', -262, -420, Math.PI, 0.05],
    ['06-village', 96, 380, 0, 0.06],
    ['07-bridge', -300, 260, Math.PI, 0.04],
    ['08-shrine', 92, -700, Math.PI, 0.05],
  ];
  for (const [name, x, z, heading, pitch] of places) {
    await page.evaluate(({ x, z, heading, pitch }) => {
      const g = window.game;
      const y = g.world.groundAt(x, z, 1e9);
      g.player.position.set(x, y, z);
      g.player.heading = heading;
      g.player.object.position.copy(g.player.position);
      g.player.object.rotation.y = heading;
      g.camera3p.yaw = heading + Math.PI;
      g.camera3p.pitch = pitch;
      g.camera3p.distance = 7.2;
      g.camera3p.targetDistance = 7.2;
      g.camera3p._initialized = false;
      g.camera3p.currentDistance = 7.2;
    }, { x, z, heading, pitch });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `shots/${name}.png` });
  }

  // 面板
  await page.keyboard.press('KeyI'); await page.waitForTimeout(1400); await page.screenshot({ path: 'shots/09-inventory.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  await page.keyboard.press('KeyC'); await page.waitForTimeout(1200); await page.screenshot({ path: 'shots/10-status.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  await page.keyboard.press('KeyM'); await page.waitForTimeout(1600); await page.screenshot({ path: 'shots/11-map.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  await page.keyboard.press('KeyL'); await page.waitForTimeout(1200); await page.screenshot({ path: 'shots/12-quest.png' });

  const info = await page.evaluate(() => {
    const g = window.game;
    return {
      fps: +g.engine.stats.fps.toFixed(1), calls: g.engine.stats.drawCalls, tris: g.engine.stats.triangles,
      cam: g.engine.camera.position.toArray().map(v=>+v.toFixed(1)),
      player: g.player.position.toArray().map(v=>+v.toFixed(1)),
      camDist: +g.camera3p.currentDistance.toFixed(2),
      yaw: +g.camera3p.yaw.toFixed(2), pitch: +g.camera3p.pitch.toFixed(2),
      panel: g.ui.openId,
      missing: g.world.landmarks.missing,
      errors: g.__errors || null,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  if (logs.length) console.log('LOGS:\n' + logs.slice(0, 40).join('\n'));
  await browser.close();
})();
