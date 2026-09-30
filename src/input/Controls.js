// Touch controls (floating joystick, jump, one contextual action, emotes,
// drag-to-look) plus keyboard and mouse for desktop. Multi-touch safe.
import { EMOTES } from '../../shared/characters.js';

export class Controls {
  constructor(root, { onInteract, onInteractEnd, onEmote, onJump } = {}) {
    this.root = root;
    this.move = { x: 0, y: 0 };      // joystick: x right, y forward
    this.look = { dx: 0, dy: 0 };    // accumulated camera drag in pixels
    this.jumpQueued = false;
    this.keys = new Set();
    this.onInteract = onInteract || (() => {});
    this.onInteractEnd = onInteractEnd || (() => {});
    this.onEmote = onEmote || (() => {});
    this.onJump = onJump || (() => {});
    this.pointers = new Map();
    this.enabled = true;
    this.buildDom();
    this.bind();
  }

  buildDom() {
    const el = document.createElement('div');
    el.className = 'controls';
    el.innerHTML = `
      <div class="stick-zone"><div class="stick-base"><div class="stick-knob"></div></div></div>
      <div class="action-stack">
        <button class="btn-emote" aria-label="تعابير">😊</button>
        <button class="btn-interact hidden" aria-label="تفاعل"><span class="ico"></span><span class="lbl"></span></button>
        <button class="btn-jump" aria-label="قفز"><span class="ico">⤒</span><span class="lbl">قفز</span></button>
      </div>
      <div class="emote-menu hidden">${EMOTES.map(e => `<button data-emote="${e.id}"><span>${e.icon}</span><small>${e.label}</small></button>`).join('')}</div>`;
    this.root.appendChild(el);
    this.el = el;
    this.zone = el.querySelector('.stick-zone');
    this.base = el.querySelector('.stick-base');
    this.knob = el.querySelector('.stick-knob');
    this.jumpBtn = el.querySelector('.btn-jump');
    this.interactBtn = el.querySelector('.btn-interact');
    this.emoteBtn = el.querySelector('.btn-emote');
    this.emoteMenu = el.querySelector('.emote-menu');
  }

  bind() {
    const press = (btn, fn) => {
      btn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); btn.classList.add('down'); fn(); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, () => btn.classList.remove('down'));
    };
    press(this.jumpBtn, () => { this.jumpQueued = true; this.onJump(); });
    press(this.interactBtn, () => this.onInteract());
    for (const ev of ['pointerup', 'pointercancel']) this.interactBtn.addEventListener(ev, () => this.onInteractEnd());
    press(this.emoteBtn, () => this.emoteMenu.classList.toggle('hidden'));
    for (const b of this.emoteMenu.querySelectorAll('button')) {
      press(b, () => { this.emoteMenu.classList.add('hidden'); this.onEmote(b.dataset.emote); });
    }

    // Joystick: a touch that starts in the left zone owns the stick until released.
    this.zone.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (this.stickId != null) return;
      this.stickId = e.pointerId;
      this.zone.setPointerCapture?.(e.pointerId);
      const r = this.zone.getBoundingClientRect();
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX - r.left}px`;
      this.base.style.top = `${e.clientY - r.top}px`;
      this.base.classList.add('active');
      this.updateStick(e);
    });
    this.zone.addEventListener('pointermove', e => { if (e.pointerId === this.stickId) this.updateStick(e); });
    const endStick = e => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null; this.move.x = this.move.y = 0;
      this.knob.style.transform = '';
      this.base.classList.remove('active');
      this.base.style.left = this.base.style.top = '';
    };
    this.zone.addEventListener('pointerup', endStick);
    this.zone.addEventListener('pointercancel', endStick);

    // Look: drag anywhere else on the game surface.
    // The canvas sits under the UI layer, so listen on the document.
    document.addEventListener('pointerdown', e => {
      if (!this.el.isConnected || this.el.classList.contains('hidden')) return;
      if (e.target.closest('button, input, .stick-zone, .panel, .emote-menu, .screen, .topbar')) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!this.emoteMenu.classList.contains('hidden')) this.emoteMenu.classList.add('hidden');
    });
    window.addEventListener('pointermove', e => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.look.dx += e.clientX - p.x; this.look.dy += e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
    });
    const endLook = e => this.pointers.delete(e.pointerId);
    window.addEventListener('pointerup', endLook);
    window.addEventListener('pointercancel', endLook);

    window.addEventListener('keydown', e => {
      if (e.target.closest?.('input, textarea')) return;
      this.keys.add(e.code);
      if (e.code === 'Space') { this.jumpQueued = true; e.preventDefault(); }
      if ((e.code === 'KeyE' || e.code === 'Enter') && !e.repeat) this.onInteract();
      const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (n >= 0) this.onEmote(EMOTES[n].id);
    });
    window.addEventListener('keyup', e => {
      this.keys.delete(e.code);
      if (e.code === 'KeyE' || e.code === 'Enter') this.onInteractEnd();
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.move.x = this.move.y = 0; });
  }

  updateStick(e) {
    const max = 52;
    let dx = e.clientX - this.stickOrigin.x, dy = e.clientY - this.stickOrigin.y;
    const d = Math.hypot(dx, dy);
    if (d > max) { dx *= max / d; dy *= max / d; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.move.x = dx / max; this.move.y = -dy / max;
  }

  // Combined move vector in camera space (x right, y forward), length 0..1.
  moveVector() {
    let x = this.move.x, y = this.move.y;
    const k = this.keys;
    const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const ky = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (kx || ky) {
      const l = Math.hypot(kx, ky), walk = k.has('ShiftLeft') || k.has('ShiftRight') ? 0.4 : 1;
      x = kx / l * walk; y = ky / l * walk;
    }
    if (!this.enabled) return { x: 0, y: 0 };
    return { x, y };
  }

  consumeJump() { const j = this.jumpQueued && this.enabled; this.jumpQueued = false; return j; }
  consumeLook() { const l = { ...this.look }; this.look.dx = this.look.dy = 0; return l; }

  setInteract(action) {
    if (!action) { this.interactBtn.classList.add('hidden'); this.currentAction = null; return; }
    if (this.currentAction?.label === action.label && this.currentAction?.icon === action.icon) return;
    this.currentAction = action;
    this.interactBtn.classList.remove('hidden');
    this.interactBtn.querySelector('.ico').textContent = action.icon;
    this.interactBtn.querySelector('.lbl').textContent = action.label;
    this.interactBtn.style.setProperty('--tint', action.color || '#F2735F');
  }

  setJumpLabel(label) { this.jumpBtn.querySelector('.lbl').textContent = label; }
  show(on) { this.el.classList.toggle('hidden', !on); }
}
