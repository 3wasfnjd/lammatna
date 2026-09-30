// Touch: virtual joystick on the left, jump + interact on the right, drag
// anywhere else to turn the camera. Desktop: WASD/arrows, Space, E, mouse drag.
import { BTN } from '../../../shared/constants';

export class Input {
  jx = 0; jy = 0;              // joystick (right, up) in −1..1
  jumpHeld = false;
  interactQueued = false;
  dragDX = 0; dragDY = 0;      // accumulated camera drag in pixels
  keys = new Set<string>();
  joy: HTMLElement; knob: HTMLElement;
  private joyId: number | null = null;
  private dragId: number | null = null;
  private last = { x: 0, y: 0 };
  onAnyInput: () => void = () => { };

  constructor(root: HTMLElement, canvas: HTMLCanvasElement, jumpBtn: HTMLElement, actBtn: HTMLElement) {
    this.joy = document.createElement('div'); this.joy.className = 'joy';
    this.knob = document.createElement('div'); this.knob.className = 'knob';
    this.joy.appendChild(this.knob); root.appendChild(this.joy);

    const joyMove = (e: PointerEvent) => {
      const r = this.joy.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
      let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R;
      const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
      this.jx = dx; this.jy = -dy;
      this.knob.style.transform = `translate(${dx * R * 0.55}px, ${dy * R * 0.55}px)`;
    };
    this.joy.addEventListener('pointerdown', e => { this.joyId = e.pointerId; this.joy.setPointerCapture(e.pointerId); joyMove(e); this.onAnyInput(); e.preventDefault(); });
    this.joy.addEventListener('pointermove', e => { if (e.pointerId === this.joyId) joyMove(e); });
    const joyEnd = (e: PointerEvent) => { if (e.pointerId !== this.joyId) return; this.joyId = null; this.jx = this.jy = 0; this.knob.style.transform = ''; };
    this.joy.addEventListener('pointerup', joyEnd); this.joy.addEventListener('pointercancel', joyEnd);

    const hold = (el: HTMLElement, down: () => void, up: () => void) => {
      el.addEventListener('pointerdown', e => { el.classList.add('down'); down(); this.onAnyInput(); e.preventDefault(); e.stopPropagation(); });
      const end = () => { el.classList.remove('down'); up(); };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('pointerleave', end);
    };
    hold(jumpBtn, () => { this.jumpHeld = true; }, () => { this.jumpHeld = false; });
    hold(actBtn, () => { this.interactQueued = true; }, () => { });

    canvas.addEventListener('pointerdown', e => { if (this.dragId === null) { this.dragId = e.pointerId; this.last = { x: e.clientX, y: e.clientY }; this.onAnyInput(); } });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerId !== this.dragId) return;
      this.dragDX += e.clientX - this.last.x; this.dragDY += e.clientY - this.last.y;
      this.last = { x: e.clientX, y: e.clientY };
    });
    const dragEnd = (e: PointerEvent) => { if (e.pointerId === this.dragId) this.dragId = null; };
    canvas.addEventListener('pointerup', dragEnd); canvas.addEventListener('pointercancel', dragEnd);

    window.addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.code); this.onAnyInput();
      if (e.code === 'KeyE' || e.code === 'Enter') this.interactQueued = true;
      if (e.code === 'Space') { this.jumpHeld = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', e => { this.keys.delete(e.code); if (e.code === 'Space') this.jumpHeld = false; });
    window.addEventListener('blur', () => { this.keys.clear(); this.jumpHeld = false; this.jx = this.jy = 0; });
  }

  // Joystick + keys as (right, forward), length ≤ 1.
  stick(): [number, number] {
    let x = this.jx, y = this.jy;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    const l = Math.hypot(x, y);
    return l > 1 ? [x / l, y / l] : [x, y];
  }
  // Buttons for one sim frame; interact is a single-frame press.
  buttons(): number {
    let b = this.jumpHeld ? BTN.jump : 0;
    if (this.interactQueued) { b |= BTN.interact; this.interactQueued = false; }
    return b;
  }
  takeDrag(): [number, number] { const d: [number, number] = [this.dragDX, this.dragDY]; this.dragDX = this.dragDY = 0; return d; }
  show(on: boolean) { this.joy.style.display = on ? '' : 'none'; }
}
