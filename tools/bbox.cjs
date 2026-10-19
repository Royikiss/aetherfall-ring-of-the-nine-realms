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
    return g.world.landmarks.instances.map(({def, object, baseY}) => {
      const box = object.userData.bounds;
      return {
        id: def.id,
        baseY: +baseY.toFixed(2),
        minY: box ? +(baseY + box.min.y).toFixed(2) : null,
        maxY: box ? +(baseY + box.max.y).toFixed(2) : null,
        terrainAt: +g.world.sampleHeight(def.x, def.z).toFixed(2),
        groundNear: [+g.world.sampleHeight(def.x+20, def.z).toFixed(1), +g.world.sampleHeight(def.x-20, def.z).toFixed(1)],
      };
    });
  });
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
