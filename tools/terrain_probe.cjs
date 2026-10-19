const { chromium } = require('playwright');
const EXE = '/home/royi/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE,
    args: ['--no-sandbox','--disable-crash-reporter','--disable-breakpad','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto('http://127.0.0.1:8090/?q=low', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const out = await page.evaluate(() => {
    const g = window.game; const t = g.world.terrain;
    const rows = [];
    for (let z = -700; z <= -320; z += 40) {
      const row = [];
      for (let x = -420; x <= 120; x += 40) {
        const h = t.baseHeight(x, z);
        // 局部起伏
        let mn=1e9, mx=-1e9;
        for (let dz=-30; dz<=30; dz+=30) for (let dx=-30; dx<=30; dx+=30) { const v=t.baseHeight(x+dx,z+dz); mn=Math.min(mn,v); mx=Math.max(mx,v); }
        const flat = mx-mn;
        row.push(`${Math.round(h)}/${Math.round(flat)}`);
      }
      rows.push(`z=${z}: ` + row.join(' '));
    }
    return rows;
  });
  console.log('x from -420 to 120 step 40 (height/roughness):');
  console.log(out.join('\n'));
  await browser.close();
})();
