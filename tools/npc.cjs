const { chromium } = require('playwright');
const EXE = '/home/royi/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE,
    args: ['--no-sandbox','--disable-crash-reporter','--disable-breakpad','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const logs=[]; page.on('pageerror', e=>logs.push(e.message));
  await page.goto('http://127.0.0.1:8090/?q=low', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(13000);
  await page.click('#btn-start'); await page.waitForTimeout(5000);
  const info = await page.evaluate(() => {
    const g = window.game;
    const npcPos = g.world.landmarks.npcs[0].object.position;
    g.player.position.set(npcPos.x + 1.2, g.world.groundAt(npcPos.x+1.2, npcPos.z, 1e9), npcPos.z);
    g.player.object.position.copy(g.player.position);
    g.camera3p._initialized = false;
    const p = g.player.position;
    const near = g.world.interactables
      .map(it => ({ id: it.id, kind: it.kind, label: it.label, r: it.radius,
        d: +Math.hypot(it.position.x - p.x, it.position.z - p.z).toFixed(2),
        dy: +(it.position.y - p.y).toFixed(2) }))
      .filter(it => it.d < 20).sort((a,b)=>a.d-b.d);
    return { npcPos: npcPos.toArray().map(v=>+v.toFixed(1)), player: p.toArray().map(v=>+v.toFixed(1)), near };
  });
  console.log(JSON.stringify(info, null, 2));
  await page.waitForTimeout(2500);
  const focus = await page.evaluate(() => ({
    focus: window.game.systems.interaction.focus && {
      id: window.game.systems.interaction.focus.id,
      label: window.game.systems.interaction.focus.label,
    },
    prompt: document.getElementById('hud-prompt-text').textContent,
  }));
  console.log('FOCUS', JSON.stringify(focus));
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => ({
    dlg: !!document.querySelector('.dialogue'),
    talked: window.game.systems.quest.quests ? window.game.systems.quest.state('main_awaken') : null,
    focus: window.game.systems.interaction.focus?.label,
  }));
  console.log('AFTER', JSON.stringify(after));
  await page.screenshot({ path: 'shots/t05-dialogue.png' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'shots/t06-dialogue2.png' });
  console.log('LOGS', logs.slice(0,10));
  await browser.close();
})();
