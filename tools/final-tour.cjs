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
  await page.screenshot({ path: 'shots/f01-title.png' });
  await page.click('#btn-start');
  await wait(page, 7000);
  await page.screenshot({ path: 'shots/f02-spawn.png' });

  const tp = async (x, z, heading, pitch = 0.1, dist = 7.5) => {
    await page.evaluate(({x,z,heading,pitch,dist}) => {
      const g = window.game;
      const y = g.world.groundAt(x,z,1e9);
      g.player.position.set(x,y,z);
      g.player.heading = heading;
      g.player.object.position.copy(g.player.position);
      g.player.object.rotation.y = heading;
      g.camera3p.yaw = heading + Math.PI;
      g.camera3p.pitch = pitch;
      g.camera3p.distance = dist; g.camera3p.targetDistance = dist; g.camera3p.currentDistance = dist;
      g.camera3p._initialized = false;
    }, {x,z,heading,pitch,dist});
    await wait(page, 2600);
  };

  await tp(-20, -300, Math.PI, 0.16, 10);
  await page.screenshot({ path: 'shots/f03-hall.png' });

  await tp(-128, -500, Math.PI, 0.12, 10);
  await page.screenshot({ path: 'shots/f04-cathedral.png' });

  await tp(30, 300, Math.PI, 0.04, 10);
  await page.screenshot({ path: 'shots/f05-tree.png' });

  await tp(-196, 168, -Math.PI/2, 0.1, 10);
  await page.screenshot({ path: 'shots/f06-bridge.png' });

  await tp(-640, 610, Math.PI, -0.02, 9);
  await page.screenshot({ path: 'shots/f07-lake.png' });

  await tp(96, 390, 0, 0.1, 9);
  await page.screenshot({ path: 'shots/f08-village.png' });

  // 对话
  await page.evaluate(() => {
    const g = window.game;
    const it = g.world.interactables.find(x => x.kind === 'npc' && x.id.includes('warden'));
    const x = it.position.x + 2, z = it.position.z + 2;
    const y = g.world.groundAt(x,z,1e9);
    g.player.position.set(x, y, z);
    g.player.object.position.copy(g.player.position);
    g.player.heading = Math.atan2(it.position.x - x, it.position.z - z);
    g.camera3p.yaw = g.player.heading + Math.PI;
    g.camera3p._initialized = false;
  });
  await wait(page, 2500);
  await page.keyboard.press('KeyF');
  await wait(page, 1800);
  await page.screenshot({ path: 'shots/f09-dialogue.png' });
  await page.keyboard.press('Escape'); await wait(page, 900);

  // 圣火
  await page.evaluate(() => {
    const g = window.game;
    const it = g.world.interactables.find(x => x.kind === 'beacon');
    const x = it.position.x + 3, z = it.position.z + 4;
    const y = g.world.groundAt(x,z,1e9);
    g.player.position.set(x, y, z);
    g.player.object.position.copy(g.player.position);
    g.player.heading = Math.atan2(it.position.x - x, it.position.z - z);
    g.camera3p.yaw = g.player.heading + Math.PI;
    g.camera3p.pitch = 0.16;
    g.camera3p._initialized = false;
  });
  await wait(page, 2500);
  await page.keyboard.press('KeyF');
  await wait(page, 3200);
  await page.screenshot({ path: 'shots/f10-beacon.png' });

  // 战斗
  await page.evaluate(() => {
    const g = window.game;
    const e = g.systems.combat.enemies.find(e => e.alive);
    if (!e) return;
    const x = e.position.x + 2.6, z = e.position.z + 0.4;
    g.player.position.set(x, g.world.groundAt(x,z,1e9), z);
    g.player.object.position.copy(g.player.position);
    g.player.heading = Math.atan2(e.position.x - x, e.position.z - z);
    g.camera3p.yaw = g.player.heading + Math.PI;
    g.camera3p.pitch = 0.08;
    g.camera3p._initialized = false;
  });
  await wait(page, 2200);
  await page.evaluate(() => window.game.systems.combat.tryAttack());
  await wait(page, 1600);
  await page.screenshot({ path: 'shots/f11-combat.png' });

  // 面板
  await page.keyboard.press('KeyI'); await wait(page, 1600); await page.screenshot({ path: 'shots/f12-inventory.png' });
  await page.keyboard.press('Escape'); await wait(page, 800);
  await page.keyboard.press('KeyC'); await wait(page, 1600); await page.screenshot({ path: 'shots/f13-status.png' });
  await page.keyboard.press('Escape'); await wait(page, 800);
  await page.keyboard.press('KeyM'); await wait(page, 2200); await page.screenshot({ path: 'shots/f14-map.png' });
  await page.keyboard.press('Escape'); await wait(page, 800);
  await page.keyboard.press('KeyL'); await wait(page, 1600); await page.screenshot({ path: 'shots/f15-quest.png' });
  await page.keyboard.press('Escape'); await wait(page, 800);

  // 夜晚
  await tp(60, 260, Math.PI, 0.1, 9);
  await page.evaluate(() => { window.game.atmosphere.timeOfDay = 0.9; });
  await wait(page, 4000);
  await page.screenshot({ path: 'shots/f16-night.png' });

  const info = await page.evaluate(() => {
    const g = window.game;
    return {
      fps: +g.engine.stats.fps.toFixed(1), calls: g.engine.stats.drawCalls, tris: g.engine.stats.triangles,
      missing: g.world.landmarks.missing,
      quests: { state: g.systems.quest.state('main_awaken'), active: (g.systems.quest.active||[]).map(q=>q.id) },
      lit: Array.from(g.world.landmarks.litBeacons||[]),
      pois: g.world.pois.length, explored: g.systems.map.exploredRatio(),
      inv: g.systems.inventory.items.map(i=>`${i.id}x${i.count}`),
      hp: g.systems.stats.health,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  console.log('LOGS', JSON.stringify(logs.slice(0, 20)));
  await browser.close();
})();
