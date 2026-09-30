// Screenshot the dev gallery: node tools/gallery-shot.mjs out.png "ids" [extra query]
import { chromium } from '@playwright/test';
const [out, ids, extra = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', m => m.type() === 'error' && console.log('console:', m.text()));
await page.goto(`http://localhost:5173/gallery.html?ids=${ids}&${extra}`);
await page.waitForFunction(() => (window).galleryReady, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
await browser.close();
