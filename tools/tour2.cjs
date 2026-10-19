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
  await page.screenshot({ path: 'shots/n01-title.png' });
  await page.click('#btn-start');
  await page.waitForTimeout(6000);
  await page.screenshot({ path: 'shots/n02-spawn.png' });

  const places = [
    ['n03-bridge', -196, 168, -Math.PI / 2, 0.10, 10],
    ['n04-lake', -640, 700, Math.PI, 0.05, 9],
    ['n05-hall', -20, -300, Math.PI, 0.14, 9],
    ['n06-cathedral', -262, -445, Math.PI, 0.10, 9],
  ];
  for (const [name, x, z, heading, pitch, dist] of places) {
    await page.evaluate(({ x, z, heading, pitch, dist }) => {
      const g = window.game;
      const y = g.world.groundAt(x, z, 1e9);
      g.player.position.set(x, y, z);
      g.player.heading = heading;
      g.player.object.position.copy(g.player.position);
      g.player.object.rotation.y = heading;
      g.camera3p.yaw = heading + Math.PI;
      g.camera3p.pitch = pitch;
      g.camera3p.distance = dist; g.camera3p.targetDistance = dist; g.camera3p.currentDistance = dist;
      g.camera3p._initialized = false;
    }, { x, z, heading, pitch, dist });
    await page.waitForTimeout(2400);
    await page.screenshot({ path: `shots/${name}.png` });
  }
  const info = await page.evaluate(() => {
    const g = window.game;
    return {
      fps: +g.engine.stats.fps.toFixed(1), calls: g.engine.stats.drawCalls, tris: g.engine.stats.triangles,
      bridge: g.world.landmarks.instances.find(i=>i.def.id==='bridge_bifrost')?.object.position.toArray().map(v=>+v.toFixed(1)),
      waterVisible: !!g.world.water?.mesh?.visible,
      waterPos: g.world.water?.mesh?.position.toArray(),
      cam: g.engine.camera.position.toArray().map(v=>+v.toFixed(1)),
      region: g.hud._currentRegion?.id,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  if (logs.length) console.log('LOGS:\n' + logs.slice(0, 30).join('\n'));
  await browser.close();
})();
