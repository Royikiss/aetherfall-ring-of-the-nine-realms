const { chromium } = require('playwright');
const EXE = '/home/royi/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE,
    args: ['--no-sandbox','--disable-crash-reporter','--disable-breakpad','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto('http://127.0.0.1:8090/?q=low', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const data = await page.evaluate(() => {
    const g = window.game;
    const s = (x,z)=>+g.world.sampleHeight(x,z).toFixed(1);
    return {
      lake: { center: s(-640,520), at: s(-640,640), east: s(-540,520), west: s(-740,520) },
      river: [0,1,2,3].map(k => s(-282 + k*10 - 120, 168)),
      bridgeDeck: g.world.platforms.filter(p=>Math.abs(p.x+282)<60 && Math.abs(p.z-168)<60).map(p=>({x:+p.x.toFixed(0),z:+p.z.toFixed(0),y:+p.y.toFixed(1),hw:p.hw,hd:p.hd})).slice(0,6),
      regions: g.world.regions.map(r=>({id:r.id, d:+Math.hypot(-640-r.cx, 640-r.cz).toFixed(0)})).sort((a,b)=>a.d-b.d),
      water: { pos: g.world.water.mesh.position.toArray(), visible: g.world.water.mesh.visible, mat: g.world.water.material.type },
      rendererHasWater: !!g.world.water.mesh.parent,
      pixelRatio: g.engine.stats.pixelRatio,
    };
  });
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
