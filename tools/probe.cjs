const { chromium } = require('playwright');
(async () => {
  for (const exe of [
    '/home/royi/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
    '/home/royi/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
  ]) {
    try {
      const b = await chromium.launch({ headless: true, executablePath: exe,
        args: ['--no-sandbox','--disable-crash-reporter','--disable-breakpad','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
      const p = await b.newPage();
      await p.goto('data:text/html,<canvas id=c></canvas>');
      const gl = await p.evaluate(() => { const c=document.getElementById('c'); const g=c.getContext('webgl2')||c.getContext('webgl'); return g? g.getParameter(g.VERSION):'no-gl'; });
      console.log('OK', exe, gl);
      await b.close();
      break;
    } catch (e) {
      console.log('FAIL', exe, String(e).slice(0,200));
    }
  }
})();
