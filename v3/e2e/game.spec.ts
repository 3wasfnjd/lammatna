// 7. Headless browser run: zero console errors, every model loads, and a
// screenshot of each zone is saved to docs/. Also the menus and a real
// two-player room over the Node room server.
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const VIEWS: Record<string, { at: [number, number]; look: [number, number]; pitch?: number; dist?: number }> = {
  plaza: { at: [0, -12], look: [0, -24], dist: 11 },
  trampoline: { at: [-15, -14], look: [-27, -19], dist: 10 },
  adventure: { at: [-15, 6], look: [-28, 17], dist: 10 },
  swings: { at: [0, 5], look: [0, 20], dist: 10 },
  arcade: { at: [16, 7], look: [30, 16], dist: 9 },
  cafe: { at: [16, -12], look: [28, -19], dist: 9 },
  garden: { at: [2, 44], look: [8, 64], dist: 12, pitch: 0.5 }
};

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  return errors;
}
async function ready(page: Page) {
  await page.waitForFunction(() => (window as any).__lm3?.ready && (window as any).__lm3.stage.garden, null, { timeout: 180_000 });
}

test('solo: every model loads, no console errors, one screenshot per zone', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('?auto=solo&char=najd&color=%23FF8FB8&acc=bow');
  await ready(page);
  const { loaded, expected, failed } = await page.evaluate(() => {
    const l = (window as any).__lm3;
    return { loaded: l.loaded() as string[], expected: l.expected() as string[], failed: l.failed() as string[] };
  });
  expect(failed).toEqual([]);
  for (const m of expected) expect(loaded, `model ${m}`).toContain(m);
  expect(expected.length).toBeGreaterThan(40);
  const drawCalls: Record<string, number> = {};
  for (const [zone, v] of Object.entries(VIEWS)) {
    const yaw = Math.atan2(v.look[0] - v.at[0], v.look[1] - v.at[1]);
    await page.evaluate(([x, z, y, p, d]) => { const l = (window as any).__lm3; l.teleport(x, z, y); l.view(y, p, d); }, [v.at[0], v.at[1], yaw, v.pitch ?? 0.42, v.dist ?? 10]);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `docs/zone-${zone}.png` });
    const calls = await page.evaluate(() => (window as any).__lm3.drawCalls());
    drawCalls[zone] = calls;
    expect(calls, `draw calls in ${zone}`).toBeLessThan(150);
  }
  console.log('draw calls per zone view:', JSON.stringify(drawCalls));
  const avatars = await page.evaluate(() => (window as any).__lm3.avatars());
  expect(avatars[0].meshes).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('menus: title, character and outfit screen', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('./');
  await expect(page.locator('.title')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.rb.big')).toHaveCount(3);        // play, new room, join (server online)
  await page.screenshot({ path: 'docs/title.png' });
  await page.locator('.rb.big').first().click();
  await expect(page.locator('.char')).toHaveCount(5);
  await page.locator('.char').nth(2).click();
  await page.locator('.swatch').nth(5).click();
  await page.locator('.rb.small').nth(4).click();
  await page.screenshot({ path: 'docs/select.png' });
  await page.locator('.rb.big').click();
  await ready(page);
  expect(errors).toEqual([]);
});

test('two players share a room (create + join by code)', async ({ browser }) => {
  const a = await browser.newPage(), b = await browser.newPage();
  const ea = watchConsole(a), eb = watchConsole(b);
  await a.goto('./');
  await a.locator('.rb.big').nth(1).click();                   // new room
  await a.locator('.rb.big').click();                          // confirm character
  await ready(a);
  const code = await a.evaluate(() => (window as any).__lm3.code());
  expect(code).toMatch(/^\d{4}$/);
  await b.goto(`./?room=${code}`);
  await b.locator('.char').nth(0).click();
  await b.locator('.rb.big').click();
  await ready(b);
  await expect.poll(() => a.evaluate(() => (window as any).__lm3.players()), { timeout: 20_000 }).toBe(2);
  await expect.poll(() => b.evaluate(() => (window as any).__lm3.avatars().length), { timeout: 20_000 }).toBe(2);
  // B walks forward; A sees B move (server authority + interpolation).
  const bId = await b.evaluate(() => (window as any).__lm3game.net.myId);
  const zOf = (p: Page) => p.evaluate(id => (window as any).__lm3game.net.remoteViews().find((v: any) => v.id === id)?.pos[2], bId);
  const before = await zOf(a);
  await b.bringToFront();
  await b.keyboard.down('KeyW');
  await expect.poll(async () => (await zOf(a)) - before, { timeout: 20_000 }).toBeGreaterThan(1.5);
  await b.keyboard.up('KeyW');
  await a.screenshot({ path: 'docs/two-players.png' });
  expect(ea).toEqual([]);
  expect(eb).toEqual([]);
});
