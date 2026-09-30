// One player in the world: identity, transform, animation state and a
// swappable visual. Movement (local controller or network interpolation) and
// the visual model are separate, so a new model never changes gameplay.
import { TransformNode } from '../babylon.js';
import { CHARACTERS, characterModel, ANIMATION_STATES } from '../../shared/characters.js';
import { PlaceholderVisual } from './PlaceholderVisual.js';
import { BlockyVisual } from './BlockyVisual.js';
import { BLOCKY } from '../style.js';
import { createGlbVisual } from './GlbVisual.js';

export class Avatar {
  constructor(scene, kit, { playerId, characterId, local = false, shadows = null }) {
    this.scene = scene;
    this.kit = kit;
    this.playerId = playerId;
    this.characterId = characterId;
    this.def = CHARACTERS[characterId];
    this.local = local;
    this.shadows = shadows;
    this.root = new TransformNode(`avatar-${playerId}`, scene);
    this.anim = 'idle';
    this.stateTime = 0;
    this.speed = 0;
    this.yaw = 0;
    this.buffer = [];
    this.emote = null;
    this.ride = null;
    this.visible = true;
    this.scale = 1;
    this.setVisual(new (BLOCKY ? BlockyVisual : PlaceholderVisual)(scene, kit, this.def));
    const model = characterModel(characterId);
    if (model.type === 'glb') {
      createGlbVisual(scene, this.def, model, kit)
        .then(v => { if (!this.disposed) this.setVisual(v); })
        .catch(err => console.warn(`[lammatna] ${characterId}: keeping placeholder, GLB failed`, err));
    }
  }

  setVisual(visual) {
    if (this.visual) {
      this.shadows?.removeCaster(this.visual);
      this.visual.dispose();
    }
    this.visual = visual;
    visual.root.parent = this.root;
    visual.root.scaling.setAll(this.scale);
    this.shadows?.addCaster(visual);
    this.onVisualChanged?.(visual);
  }

  // Room-wide character size (dwarf / tiny modes): visual only, gameplay is unchanged.
  setScale(s) {
    if (s === this.scale) return;
    this.scale = s;
    this.visual.root.scaling.setAll(s);
  }

  get height() { return this.def.look.height * this.scale; }

  get carryAnchor() { return this.visual.carryAnchor; }
  get position() { return this.root.position; }

  setAnim(name) {
    if (name !== this.anim) { this.anim = name; this.stateTime = 0; }
  }

  // Remote players: buffer snapshots and render slightly in the past.
  pushSnapshot(t, x, y, z, yaw, animCode) {
    this.buffer.push({ t, x, y, z, yaw, anim: ANIMATION_STATES[animCode] || 'idle' });
    if (this.buffer.length > 30) this.buffer.shift();
  }

  interpolate(renderTime) {
    const b = this.buffer;
    if (!b.length) return;
    while (b.length > 2 && b[1].t <= renderTime) b.shift();
    const a = b[0], c = b[1] || b[0];
    let k = c.t === a.t ? 1 : (renderTime - a.t) / (c.t - a.t);
    k = Math.max(0, Math.min(1.25, k));
    const x = a.x + (c.x - a.x) * k, y = a.y + (c.y - a.y) * k, z = a.z + (c.z - a.z) * k;
    this.root.position.set(x, y, z);
    let dy = c.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw = a.yaw + dy * Math.min(1, k);
    this.speed = c.t === a.t ? 0 : Math.hypot(c.x - a.x, c.z - a.z) / ((c.t - a.t) / 1000);
    this.setAnim(k > 0.5 ? c.anim : a.anim);
  }

  update(dt, ctx = {}) {
    this.stateTime += dt;
    this.root.rotation.y = this.yaw;
    this.visual.update(dt, this.anim, { speed: this.speed, stateTime: this.stateTime, ...ctx });
  }

  setVisible(on) {
    if (on === this.visible) return;
    this.visible = on;
    this.root.setEnabled(on);
  }

  dispose() {
    this.disposed = true;
    this.shadows?.removeCaster(this.visual);
    this.visual.dispose();
    this.root.dispose();
  }
}
