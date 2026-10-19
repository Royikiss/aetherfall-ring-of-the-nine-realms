const { chromium } = require('playwright');
const EXE = '/home/royi/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE,
    args: ['--no-sandbox','--disable-crash-reporter','--disable-breakpad','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://127.0.0.1:8090/?q=low', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(13000);
  await page.click('#btn-start'); await page.waitForTimeout(5000);
  await page.evaluate(() => {
    const g = window.game;
    const n = g.world.landmarks.npcs[0].object.position;
    g.player.position.set(n.x + 1.2, g.world.groundAt(n.x+1.2, n.z, 1e9), n.z);
    g.player.object.position.copy(g.player.position);
    g.camera3p._initialized = false;
  });
  await page.waitForTimeout(4000);
  const out = await page.evaluate(() => {
    const g = window.game;
    const p = g.player.position;
    const near = g.world.interactables
      .map(it => ({ id: it.id, d: +Math.hypot(it.position.x-p.x, it.position.z-p.z).toFixed(2), dy: +(it.position.y-p.y).toFixed(2), r: it.radius }))
      .filter(x => x.d < 25).sort((a,b)=>a.d-b.d);
    const sys = g.systems.interaction;
    let err = null;
    try { sys.update(0.016); } catch (e) { err = e.message; }
    return {
      player: p.toArray().map(v=>+v.toFixed(2)),
      started: g.started,
      modal: g.ui.isOpen(), dialogue: g.ui.isDialogueOpen?.(),
      inputEnabled: g.input.enabled,
      focus: sys.focus && { id: sys.focus.id, label: sys.focus.label },
      near, err,
      promptClass: document.getElementById('hud-prompt').className,
      promptText: document.getElementById('hud-prompt-text').textContent,
    };
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
