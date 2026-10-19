const { chromium } = require('playwright');
const EXE = '/home/royi/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';
const wait = (p, ms) => p.waitForTimeout(ms);
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE,
    args: ['--no-sandbox','--disable-crash-reporter','--disable-breakpad','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.stack || e.message}`));
  await page.goto('http://127.0.0.1:8090/?q=low', { waitUntil: 'domcontentloaded' });
  await wait(page, 13000);
  await page.click('#btn-start');
  await wait(page, 5000);

  const tp = async (x, z, heading) => {
    await page.evaluate(({x,z,heading}) => {
      const g = window.game;
      const y = g.world.groundAt(x,z,1e9);
      g.player.position.set(x,y,z);
      g.player.heading = heading;
      g.player.object.position.copy(g.player.position);
      g.player.object.rotation.y = heading;
      g.camera3p.yaw = heading + Math.PI;
      g.camera3p._initialized = false;
    }, {x,z,heading});
    await wait(page, 2500);
  };

  // 1) 圣火
  await tp(92, -766, Math.PI);
  const st1 = await page.evaluate(() => ({ focus: window.game.systems.interaction.focus?.label, prompt: document.getElementById('hud-prompt').className }));
  await page.keyboard.press('KeyF');
  await wait(page, 3000);
  const st2 = await page.evaluate(() => ({ lit: Array.from(window.game.world.landmarks.litBeacons||[]), banner: document.querySelector('.banner__title')?.textContent, quest: Array.from(window.game.systems.quest.active||[]).map(q=>q.id) }));
  console.log('BEACON', JSON.stringify({ st1, st2 }));

  // 2) NPC 对话
  await tp(-8.5, -416, Math.PI);
  const n1 = await page.evaluate(() => ({ focus: window.game.systems.interaction.focus?.label, npc: window.game.world.landmarks.npcs.map(n=>n.name), npcPos: window.game.world.landmarks.npcs.map(n=>[+n.object.position.x.toFixed(0), +n.object.position.z.toFixed(0)]) }));
  await page.keyboard.press('KeyF');
  await wait(page, 1500);
  const n2 = await page.evaluate(() => ({ dialogue: !!document.querySelector('.dialogue'), speaker: document.querySelector('.dialogue__speaker')?.textContent }));
  await page.keyboard.press('KeyF'); await wait(page, 1200);
  await page.keyboard.press('KeyF'); await wait(page, 1200);
  await page.keyboard.press('KeyF'); await wait(page, 1200);
  await page.screenshot({ path: 'shots/t01-dialogue.png' });
  await page.keyboard.press('KeyF'); await wait(page, 1500);
  const n3 = await page.evaluate(() => ({ dialogue: !!document.querySelector('.dialogue'), quest: window.game.systems.quest.state('main_awaken') }));
  console.log('NPC', JSON.stringify({ n1, n2, n3 }));

  // 3) 战斗
  const enemy = await page.evaluate(() => {
    const g = window.game;
    const e = g.systems.combat.enemies.find(e => e.alive && e.type === 'draugr');
    if (!e) return null;
    const dx = e.position.x + 2.2, dz = e.position.z;
    g.player.position.set(dx, g.world.groundAt(dx,dz,1e9), dz);
    g.player.heading = Math.atan2(e.position.x - dx, e.position.z - dz);
    g.camera3p.yaw = g.player.heading + Math.PI;
    g.camera3p._initialized = false;
    return { hp: e.hp, pos: [e.position.x, e.position.z], dist: Math.hypot(e.position.x-dx, e.position.z-dz) };
  });
  await wait(page, 2500);
  const c1 = await page.evaluate(() => {
    const g = window.game;
    const e = g.systems.combat.enemies.find(x => x.alive && x.type === 'draugr');
    const before = e?.hp;
    g.systems.combat.tryAttack();
    return { before, dist: e ? Math.hypot(e.position.x-g.player.position.x, e.position.z-g.player.position.z) : -1 };
  });
  await wait(page, 2500);
  const c2 = await page.evaluate(() => {
    const g = window.game;
    const e = g.systems.combat.enemies.find(x => x.type === 'draugr');
    return { hp: e?.hp, dead: e ? !e.alive : null, playerHp: g.systems.stats.health, kills: g.systems.combat.totalKills };
  });
  console.log('COMBAT', JSON.stringify({ enemy, c1, c2 }));

  // 4) 面板
  await page.keyboard.press('KeyL'); await wait(page, 1200);
  await page.screenshot({ path: 'shots/t02-quest.png' });
  await page.keyboard.press('Escape'); await wait(page, 600);
  await page.keyboard.press('KeyI'); await wait(page, 1200);
  await page.screenshot({ path: 'shots/t03-inventory.png' });
  await page.keyboard.press('Escape'); await wait(page, 600);

  // 5) 存档/读档
  const save = await page.evaluate(() => {
    const g = window.game;
    const before = g.player.position.toArray();
    g.systems.save.save(true);
    g.player.position.set(0, 100, 0);
    const loaded = g.systems.save.load();
    return { before, after: g.player.position.toArray(), loaded };
  });
  console.log('SAVE', JSON.stringify(save));

  // 6) 湖
  await tp(-640, 600, Math.PI);
  await page.evaluate(() => { window.game.camera3p.pitch = -0.05; });
  await wait(page, 2500);
  await page.screenshot({ path: 'shots/t04-lake.png' });

  console.log('ERRORS', JSON.stringify(logs.slice(0, 20)));
  await browser.close();
})();
