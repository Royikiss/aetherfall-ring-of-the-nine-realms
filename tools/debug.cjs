const { chromium } = require('playwright');
const EXE = '/home/royi/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE,
    args: ['--no-sandbox','--disable-crash-reporter','--disable-breakpad','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.goto('http://127.0.0.1:8090/?q=low', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  await page.click('#btn-start').catch(()=>{});
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => {
    const g = window.game;
    const cam = g.engine.camera;
    const p = g.player;
    const near = g.world.colliders.filter(c => Math.hypot(c.x - p.position.x, c.z - p.position.z) < 12);
    let meshes = 0, sprites = 0, points = 0;
    g.scene.traverse(o => { if (o.isMesh) meshes++; if (o.isSprite) sprites++; if (o.isPoints) points++; });
    return {
      cam: cam.position.toArray().map(v=>+v.toFixed(2)),
      player: p.position.toArray().map(v=>+v.toFixed(2)),
      playerScale: p.object.scale.toArray(),
      humanoidScale: p.humanoid.group.scale.toArray(),
      camDist: { current: g.camera3p.currentDistance, target: g.camera3p.targetDistance, yaw: g.camera3p.yaw, pitch: g.camera3p.pitch },
      camFov: cam.fov,
      nearColliders: near,
      meshes, sprites, points,
      sceneChildren: g.scene.children.length,
      landmasses: g.world.landmarks.instances.map(i => ({ id: i.def.id, pos: i.object.position.toArray().map(v=>+v.toFixed(1)), tris: i.object.userData.triangles })),
      terrainChunks: g.world.terrain.chunks.size,
      drawCalls: g.engine.stats.drawCalls,
      tris: g.engine.stats.triangles,
      litBeacons: Array.from(g.world.landmarks.litBeacons || []),
      enemies: g.systems.combat.enemies.length,
    };
  });
  const { landmasses, nearColliders, ...rest } = info;
  console.log(JSON.stringify(rest, null, 2));
  console.log('NEARCOLLIDERS', JSON.stringify(nearColliders));
  console.log('LANDMARKS', landmasses.map(l=>`${l.id}@${l.pos} tris=${l.tris}`).join('\n'));
  console.log('LOGS', logs.slice(0,30));
  await browser.close();
})();
