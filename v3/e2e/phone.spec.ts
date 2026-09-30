// Phone-sized landscape screen with real touch input (Chrome DevTools Protocol
// touch events, which the browser turns into pointer events like a phone does).
import { test, expect, type Page, type CDPSession } from '@playwright/test';

test.use({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
}
const center = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
};
const me = (page: Page) => page.evaluate(() => { const m = (window as any).__lm3game.net.me; return { pos: m.pos as number[], mode: m.mode as string, vy: m.vel[1] as number }; });

test('phone: joystick, jump and the interact button work by touch', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('?auto=solo&char=joud&color=%239C6BD1&acc=crown');
  await page.waitForFunction(() => (window as any).__lm3?.ready, null, { timeout: 180_000 });
  const cdp = await page.context().newCDPSession(page);

  // Controls fit on the screen.
  for (const sel of ['.joy', '.jump', '.emo']) {
    const { b } = await center(page, sel);
    expect(b.x >= 0 && b.y >= 0 && b.x + b.width <= 915 && b.y + b.height <= 412, `${sel} on screen`).toBeTruthy();
  }
  await expect(page.locator('.act')).toHaveClass(/hidden/);   // nothing to use at the spawn

  // Joystick: push up → the player walks forward (away from the camera).
  const j = await center(page, '.joy');
  const start = (await me(page)).pos;
  await touch(cdp, 'touchStart', j.x, j.y);
  await touch(cdp, 'touchMove', j.x, j.y - 60);
  await page.waitForTimeout(1500);
  await touch(cdp, 'touchEnd', 0, 0);
  const moved = (await me(page)).pos;
  expect(Math.hypot(moved[0] - start[0], moved[2] - start[2])).toBeGreaterThan(2);

  // Jump button.
  const jb = await center(page, '.jump');
  await touch(cdp, 'touchStart', jb.x, jb.y);
  await expect.poll(async () => (await me(page)).pos[1], { timeout: 5000 }).toBeGreaterThan(0.5);
  await touch(cdp, 'touchEnd', 0, 0);

  // Walk up to a swing: the interact button appears with the seat icon; tapping it sits you down.
  const seat = await page.evaluate(() => { const t = (window as any).__lm3game.sim.toyById.get('swing-small'); const s = t.seatPos(0), f = t.fwd(); return [s[0] + f[0] * 0.9, s[2] + f[2] * 0.9]; });
  await page.evaluate(([x, z]) => (window as any).__lm3.teleport(x, z, Math.PI), seat);
  await expect(page.locator('.act')).not.toHaveClass(/hidden/, { timeout: 10_000 });
  await expect(page.locator('.act')).toHaveText('🪑');
  await page.screenshot({ path: 'docs/phone-swing.png' });
  const ab = await center(page, '.act');
  await touch(cdp, 'touchStart', ab.x, ab.y);
  await touch(cdp, 'touchEnd', 0, 0);
  await expect.poll(async () => (await me(page)).mode, { timeout: 10_000 }).toBe('seat');
  // Pump with the joystick: the seat starts to swing.
  await touch(cdp, 'touchStart', j.x, j.y);
  await touch(cdp, 'touchMove', j.x, j.y - 60);
  await expect.poll(() => page.evaluate(() => Math.abs((window as any).__lm3game.sim.toyById.get('swing-small').state()[0])), { timeout: 15_000 }).toBeGreaterThan(0.2);
  await touch(cdp, 'touchEnd', 0, 0);
  await page.screenshot({ path: 'docs/phone-swinging.png' });

  // Drag on the canvas turns the camera.
  const yaw0 = await page.evaluate(() => (window as any).__lm3game.cam.yaw);
  await touch(cdp, 'touchStart', 500, 200);
  for (let i = 1; i <= 6; i++) await touch(cdp, 'touchMove', 500 + i * 30, 200);
  await touch(cdp, 'touchEnd', 0, 0);
  expect(Math.abs((await page.evaluate(() => (window as any).__lm3game.cam.yaw)) - yaw0)).toBeGreaterThan(0.3);
  expect(errors).toEqual([]);
});
