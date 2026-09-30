// Combines the minigame presenters (MiniGames, Arcade) behind one interface.
export class GameHub {
  constructor(game, classes) { this.parts = classes.map(C => new C(game)); }
  get type() { return this.parts.map(p => p.type).find(Boolean) || null; }
  each(fn) { for (const p of this.parts) fn(p); }
  first(fn) { for (const p of this.parts) { const v = fn(p); if (v) return v; } return null; }
  some(fn) { return this.parts.some(fn); }
  sync(a) { this.each(p => p.sync(a)); }
  update(dt, time) { this.each(p => p.update(dt, time)); }
  onSnap(msg) { this.each(p => p.onSnap?.(msg)); }
  onEvent(e) { this.each(p => p.onEvent?.(e)); }
  collide(body) { this.each(p => p.collide?.(body)); }
  locked(a) { return this.some(p => p.locked?.(a)); }
  pinned(a) { return this.some(p => p.pinned?.(a)); }
  holding() { return this.some(p => p.holding?.()); }
  hideLabel(id) { return this.some(p => p.hideLabel?.(id)); }
  look(dx, dy) { return this.some(p => p.look?.(dx, dy)); }
  sinkFor(id) { return this.parts.reduce((s, p) => s + (p.sinkFor?.(id) || 0), 0); }
  action() { return this.first(p => p.action?.()); }
  hud(a, left) { return this.first(p => p.type && p.hud?.(a, left)); }
}
