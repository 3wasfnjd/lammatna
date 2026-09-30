// Short arcade challenges started by walking up to a machine and pressing the
// interact button. No instructions: the shapes say what to do.
import { el } from './Screens';
import type { Input } from '../input/Input';

const ARROWS: [string, number, number][] = [['⬆️', 0, 1], ['➡️', 1, 0], ['⬇️', 0, -1], ['⬅️', -1, 0]];

export function runChallenge(kind: string, input: Input, sfx: (s: string) => void): Promise<boolean> {
  if (kind === 'ticket' || kind === 'vending') { sfx('chime'); return Promise.resolve(true); }
  return new Promise(resolve => {
    const box = el('div', 'challenge');
    document.getElementById('ui')!.append(box);
    let raf = 0;
    const finish = (ok: boolean) => { cancelAnimationFrame(raf); box.remove(); sfx(ok ? 'win' : 'miss'); resolve(ok); };
    const exit = el('button', 'rb small', '✖️'); exit.style.position = 'fixed'; exit.style.top = '14px'; exit.style.left = '14px';
    exit.onclick = () => finish(false);
    box.append(exit);
    if (kind === 'dance') {
      // Follow the arrows with the joystick.
      const arrow = el('div', 'arrow'); box.append(arrow);
      let step = 0, hits = 0, t0 = performance.now(), want = ARROWS[0];
      const next = () => { want = ARROWS[Math.floor(Math.random() * 4)]; arrow.textContent = want[0]; t0 = performance.now(); sfx('beep'); };
      next();
      const loop = () => {
        const [x, y] = input.stick();
        if (Math.hypot(x, y) > 0.7) {
          const ok = Math.sign(Math.round(x)) === want[1] && Math.sign(Math.round(y)) === want[2];
          if (ok) { hits++; sfx('pop'); arrow.animate([{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], 200); }
          step++; if (step >= 5) return finish(hits >= 3);
          input.jx = input.jy = 0; next();
        } else if (performance.now() - t0 > 1800) { step++; if (step >= 5) return finish(hits >= 3); next(); }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    } else if (kind === 'pinball') {
      // Keep the ball up: tap quickly.
      const ball = el('div', 'arrow', '⚪'); const meter = el('div', 'meter'); const fill = el('i'); meter.append(fill); box.append(ball, meter);
      let level = 0.5; const start = performance.now();
      const tap = el('button', 'rb big', '👆'); box.append(tap);
      tap.onpointerdown = e => { e.preventDefault(); level = Math.min(1, level + 0.12); sfx('click'); };
      const loop = () => {
        level -= 0.006; if (input.interactQueued || input.jumpHeld) { input.interactQueued = false; level = Math.min(1, level + 0.02); }
        fill.style.width = Math.max(0, level) * 100 + '%';
        ball.style.transform = `translateY(${(0.5 - level) * 80}px)`;
        if (level <= 0) return finish(false);
        if (performance.now() - start > 5000) return finish(true);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    } else {
      // Stop the moving bar in the golden middle.
      const meter = el('div', 'meter'); meter.style.width = '260px'; meter.style.height = '26px'; meter.style.position = 'relative';
      const gold = el('i'); gold.style.position = 'absolute'; gold.style.left = '40%'; gold.style.width = '20%'; gold.style.background = '#FFD166'; meter.append(gold);
      const mark = el('b'); mark.style.cssText = 'position:absolute;top:-6px;width:8px;height:38px;border-radius:4px;background:#fff;box-shadow:0 2px 6px #0004';
      meter.append(mark);
      const stop = el('button', 'rb big', '✋');
      const stars = el('div', 'label', '');
      box.append(stars, meter, stop);
      let t = 0, tries = 0, hits = 0;
      const press = () => {
        const pos = (Math.sin(t) + 1) / 2;
        const ok = pos > 0.4 && pos < 0.6;
        hits += ok ? 1 : 0; tries++; sfx(ok ? 'score' : 'miss');
        stars.textContent = '⭐'.repeat(hits) + '▫️'.repeat(tries - hits);
        if (tries >= 3) setTimeout(() => finish(hits >= 2), 300);
      };
      stop.onpointerdown = e => { e.preventDefault(); press(); };
      const loop = () => {
        t += 0.06 + tries * 0.015;
        mark.style.left = ((Math.sin(t) + 1) / 2 * 252) + 'px';
        if (input.interactQueued) { input.interactQueued = false; press(); }
        if (tries < 3) raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
  });
}
