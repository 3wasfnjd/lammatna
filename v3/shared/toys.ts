// Toy behaviours. Each layout behaviour type maps to one class here. Toys own
// their Rapier bodies/joints and can be driven by riders (seat, slide, claw).
// In 'mirror' mode (client prediction) bodies are kinematic and follow state().
import { RAPIER, type RigidBody, type Collider } from './rapier';
import type { Sim, PlayerSim, InputFrame } from './sim';
import type { ToyDef, Bounds6 } from './world';
import { xfPoint, xfDir, xfInverse, boxCollider, trunkCollider } from './world';
import { MOVE, G, groups, BTN, BODY_HEIGHT } from './constants';
import type { V3, Q } from './math';
import { Spline, clamp, quatY, quatMul, quatAxis, quatRotate } from './math';

export interface Interaction { d: number; kind: string; icon: string }

const hd = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const center = (b: Bounds6): V3 => [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
const size = (b: Bounds6): V3 => [b[3] - b[0], b[4] - b[1], b[5] - b[2]];

export abstract class Toy {
  id: string; def: ToyDef; sim: Sim; type: string;
  spin = 0;
  constructor(def: ToyDef, sim: Sim) { this.def = def; this.sim = sim; this.id = def.id; this.type = def.type; }
  get auth() { return this.sim.mode === 'authority'; }
  w(p: V3) { return xfPoint(this.def.xf, p); }
  wd(d: V3) { return xfDir(this.def.xf, d); }
  local(p: V3) { return xfInverse(this.def.xf, p); }
  get s() { return this.def.xf.scale; }
  get rot() { return this.def.xf.rot; }
  part(key: string): Bounds6 { return this.def.parts[key] || this.def.b; }
  addStatic(b: Bounds6, extra: any = {}) { return this.sim.addStatic(boxCollider(this.def.xf, b, { owner: this.id, ...extra })); }
  fixedBody(pos: V3, q: Q = quatY(this.rot)) {
    return this.sim.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos[0], pos[1], pos[2]).setRotation(q));
  }
  toyCollider(desc: any, body: RigidBody, filter = G.PLAYER | G.DYNAMIC, tag?: string): Collider {
    desc.setCollisionGroups(groups(G.TOY, filter));
    const c = this.sim.world.createCollider(desc, body);
    this.sim.registerToyCollider(c, this.id, tag);
    return c;
  }
  preStep(_dt: number) { }
  postStep(_dt: number) { }
  state(): number[] | null { return null; }
  applyState(_s: number[]) { }
  leave(_p: PlayerSim) { }
  drive(_p: PlayerSim, _f: InputFrame, _dt: number) { }
  riderVelocity(_p: PlayerSim): V3 { return [0, 0, 0]; }
  surfaceVelocity?(pos: V3): V3 | null;
  interaction?(p: PlayerSim): Interaction | null;
  interact?(p: PlayerSim, kind: string): void;
  tryGrab?(p: PlayerSim, mx: number, mz: number, jump: boolean): boolean;
  climbStep?(p: PlayerSim, f: InputFrame, dt: number, jump: boolean): void;
  hangStep?(p: PlayerSim, f: InputFrame, dt: number, jump: boolean): void;
  zoneAt?(pos: V3): { speed?: number; water?: boolean } | null;
  bump?(p: PlayerSim): void;
  // Seat pose helper: put a rider on a point, facing yaw.
  seat(p: PlayerSim, at: V3, yaw: number) {
    p.pos = [at[0], at[1] - 0.45, at[2]]; p.yaw = yaw; p.vel = [0, 0, 0];
  }
  occupy(p: PlayerSim, mode: 'seat' | 'slide' | 'climbUp' | 'claw', slot = 0) {
    this.sim.release(p);
    p.toy = this.id; p.mode = mode; p.slot = slot; p.aux = 0;
    this.sim.setSolid(p, false);
  }
  inRect(pos: V3, b: Bounds6, pad = 0) {
    const l = this.local(pos);
    return l[0] > b[0] - pad && l[0] < b[3] + pad && l[2] > b[2] - pad && l[2] < b[5] + pad;
  }
}

// Angle of body rotation q about a local axis relative to base rotation (yaw).
function angleAbout(q: Q, yaw: number, axis: 'x' | 'y' | 'z') {
  const inv = quatY(-yaw);
  const r = quatMul(inv, q);
  const c = axis === 'x' ? r.x : axis === 'y' ? r.y : r.z;
  return 2 * Math.atan2(c, r.w);
}
const AX = (a: 'x' | 'y' | 'z'): V3 => a === 'x' ? [1, 0, 0] : a === 'y' ? [0, 1, 0] : [0, 0, 1];

// ---------------------------------------------------------------- swing
interface Seat { body: RigidBody; pivot: V3; len: number; occ: string; seatL: V3 }
export class SwingToy extends Toy {
  seats: Seat[] = [];
  axis: 'x' | 'z';
  constructor(def: ToyDef, sim: Sim) {
    super(def, sim);
    const b = def.b, sz = size(b);
    this.axis = sz[0] >= sz[2] ? 'x' : 'z';
    // Frame legs at both ends of the top bar.
    if (this.axis === 'x') {
      this.addStatic([b[0], b[1], b[2], b[0] + 0.28, b[4], b[5]]);
      this.addStatic([b[3] - 0.28, b[1], b[2], b[3], b[4], b[5]]);
    } else {
      this.addStatic([b[0], b[1], b[2], b[3], b[4], b[2] + 0.28]);
      this.addStatic([b[0], b[1], b[5] - 0.28, b[3], b[4], b[5]]);
    }
    const keys: string[] = def.p.seats?.length ? def.p.seats : ['__whole'];
    for (const key of keys) {
      const pb = def.parts[key] || def.b;
      const c = center(pb);
      const pivotL: V3 = [c[0], pb[4] - 0.03, c[2]];
      const seatL: V3 = [c[0], pb[1] + 0.06, c[2]];
      const pivot = this.w(pivotL), seatW = this.w(seatL);
      const len = pivot[1] - seatW[1];
      const q = quatY(this.rot);
      const body = sim.world.createRigidBody(sim.dynamicOrKinematic().setTranslation(seatW[0], seatW[1], seatW[2]).setRotation(q)
        .setAngularDamping(0.06).setLinearDamping(0.02).setCanSleep(true));
      const half = Math.min(0.35, (this.axis === 'x' ? pb[3] - pb[0] : pb[5] - pb[2]) * this.s / 2);
      this.toyCollider(RAPIER.ColliderDesc.cuboid(this.axis === 'x' ? half : 0.22, 0.05, this.axis === 'x' ? 0.22 : half).setMass(10), body);
      if (this.auth) {
        const anchor = this.fixedBody(pivot);
        const jd = RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: len, z: 0 }, { ...vec(AX(this.axis)) });
        sim.world.createImpulseJoint(jd, anchor, body, true);
      }
      this.seats.push({ body, pivot, len, occ: '', seatL });
    }
  }
  angle(i: number) { return angleAbout(this.seats[i].body.rotation(), this.rot, this.axis); }
  fwd(): V3 { return this.wd(this.axis === 'x' ? [0, 0, 1] : [1, 0, 0]); }
  axisW(): V3 { return this.wd(AX(this.axis)); }
  seatPos(i: number): V3 { const t = this.seats[i].body.translation(); return [t.x, t.y, t.z]; }
  interaction(p: PlayerSim): Interaction | null {
    if (p.mode !== 'walk') return null;
    let best: Interaction | null = null;
    this.seats.forEach((s, i) => {
      const d = hd(p.pos, this.seatPos(i));
      if (d > 1.5) return;
      const it = s.occ && s.occ !== p.id ? { d, kind: 'push:' + i, icon: '👐' } : !s.occ ? { d, kind: 'sit:' + i, icon: '🪑' } : null;
      if (it && (!best || it.d < best.d)) best = it;
    });
    return best;
  }
  interact(p: PlayerSim, kind: string) {
    const [k, n] = kind.split(':'); const i = +n; const s = this.seats[i];
    if (!s) return;
    if (k === 'sit' && !s.occ) { this.occupy(p, 'seat', i); s.occ = p.id; this.sim.emit({ type: 'sit', p: p.id, toy: this.id }); }
    if (k === 'push') this.push(i, p.pos, 1);
  }
  // Push a seat away from a point (a player behind it, or a test).
  push(i: number, from: V3, strength = 1) {
    const s = this.seats[i], t = this.seatPos(i), f = this.fwd();
    const dir = Math.sign((t[0] - from[0]) * f[0] + (t[2] - from[2]) * f[2]) || 1;
    // A push along the swing direction; the joint turns it into a swing.
    s.body.applyImpulse({ x: f[0] * dir * 22 * strength, y: 0, z: f[2] * dir * 22 * strength }, true);
    this.sim.emit({ type: 'push', toy: this.id });
  }
  leave(p: PlayerSim) { for (const s of this.seats) if (s.occ === p.id) s.occ = ''; }
  drive(p: PlayerSim, f: InputFrame, dt: number) {
    const s = this.seats[p.slot];
    if (!s || !this.auth) return;
    const m = Math.hypot(f.mx, f.mz);
    const v = s.body.linvel(), fw = this.fwd();
    const along = v.x * fw[0] + v.z * fw[2];
    if (m > 0.2 && Math.abs(this.angle(p.slot)) < 1.25) {
      // Pumping: push in the direction the seat is already moving.
      const dir = Math.abs(along) > 0.15 ? Math.sign(along) : Math.sign(f.mx * fw[0] + f.mz * fw[2]) || 1;
      const k = 11 * m * dt * 10;
      s.body.applyImpulse({ x: fw[0] * dir * k, y: 0, z: fw[2] * dir * k }, true);
    }
  }
  riderVelocity(p: PlayerSim): V3 { const v = this.seats[p.slot]?.body.linvel(); return v ? [v.x, v.y, v.z] : [0, 0, 0]; }
  postStep() {
    this.seats.forEach((s, i) => {
      if (!s.occ) return;
      const p = this.sim.players.get(s.occ);
      if (!p || p.toy !== this.id) { s.occ = ''; return; }
      const t = this.seatPos(i), f = this.fwd();
      this.seat(p, [t[0], t[1] + 0.1, t[2]], Math.atan2(f[0], f[2]));
    });
  }
  state() { return [...this.seats.map((_, i) => this.angle(i)), ...this.seats.map(s => s.occ ? 1 : 0)]; }
  applyState(a: number[]) {
    this.seats.forEach((s, i) => {
      const q = quatMul(quatY(this.rot), quatAxis(AX(this.axis), a[i]));
      const off = quatRotate(q, [0, -s.len, 0]);
      s.body.setNextKinematicTranslation({ x: s.pivot[0] + off[0], y: s.pivot[1] + off[1], z: s.pivot[2] + off[2] });
      s.body.setNextKinematicRotation(q);
    });
  }
}
const vec = (v: V3) => ({ x: v[0], y: v[1], z: v[2] });

// ---------------------------------------------------------------- seesaw
export class SeesawToy extends Toy {
  beam: RigidBody; pivot: V3; long: 'x' | 'z'; axis: 'x' | 'z'; half: number; limit: number;
  occ: [string, string] = ['', ''];
  constructor(def: ToyDef, sim: Sim) {
    super(def, sim);
    const pb = def.parts[def.p.part] || def.b, sz = size(pb);
    this.long = sz[2] >= sz[0] ? 'z' : 'x';
    this.axis = this.long === 'z' ? 'x' : 'z';
    const c = center(pb);
    const pivotY = def.p.pivotY ?? (pb[1] + pb[4]) / 2;
    this.pivot = this.w([c[0], pivotY, c[2]]);
    this.half = (this.long === 'z' ? sz[2] : sz[0]) / 2 * this.s;
    this.limit = Math.min(0.32, Math.asin(clamp((this.pivot[1] - this.def.xf.pos[1] - 0.12) / this.half, 0.05, 0.9)));
    // Base under the pivot.
    this.addStatic([c[0] - 0.2, 0, c[2] - 0.2, c[0] + 0.2, pivotY - 0.08, c[2] + 0.2]);
    const q = quatY(this.rot);
    this.beam = sim.world.createRigidBody(sim.dynamicOrKinematic().setTranslation(this.pivot[0], this.pivot[1], this.pivot[2]).setRotation(q).setAngularDamping(0.6));
    const w = (this.long === 'z' ? sz[0] : sz[2]) / 2 * this.s;
    this.toyCollider(RAPIER.ColliderDesc.cuboid(this.long === 'x' ? this.half : Math.min(w, 0.3), 0.06, this.long === 'z' ? this.half : Math.min(w, 0.3)).setMass(25), this.beam);
    if (this.auth) {
      const jd = RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, vec(AX(this.axis)));
      const j = sim.world.createImpulseJoint(jd, this.fixedBody(this.pivot), this.beam, true) as any;
      j.setLimits(-this.limit, this.limit);
    }
  }
  tilt() { return angleAbout(this.beam.rotation(), this.rot, this.axis); }
  seatPoint(i: number): V3 {
    const d = (this.half - 0.35) * (i === 0 ? 1 : -1);
    const q = this.beam.rotation(), t = this.beam.translation();
    const o = quatRotate(q, this.long === 'z' ? [0, 0.12, d] : [d, 0.12, 0]);
    return [t.x + o[0], t.y + o[1], t.z + o[2]];
  }
  interaction(p: PlayerSim): Interaction | null {
    if (p.mode !== 'walk') return null;
    let best: Interaction | null = null;
    for (let i = 0; i < 2; i++) {
      const d = hd(p.pos, this.seatPoint(i));
      if (d > 1.5) continue;
      const it = this.occ[i] ? { d, kind: 'push:' + i, icon: '👇' } : { d, kind: 'sit:' + i, icon: '🪑' };
      if (!best || it.d < best.d) best = it;
    }
    return best;
  }
  interact(p: PlayerSim, kind: string) {
    const [k, n] = kind.split(':'); const i = +n;
    if (k === 'sit' && !this.occ[i]) { this.occupy(p, 'seat', i); this.occ[i] = p.id; this.sim.emit({ type: 'sit', p: p.id, toy: this.id }); }
    if (k === 'push') this.pushEnd(i, -1);
  }
  pushEnd(i: number, dir: number) {
    const sp = this.seatPoint(i);
    this.beam.applyImpulseAtPoint({ x: 0, y: 160 * dir, z: 0 }, vec(sp), true);
  }
  leave(p: PlayerSim) { this.occ = this.occ.map(o => o === p.id ? '' : o) as [string, string]; }
  drive(p: PlayerSim, f: InputFrame, dt: number) {
    if (!this.auth) return;
    // Kick off the ground with jump... (jump leaves the seat) — so use joystick up to push up.
    if (f.mz * f.mz + f.mx * f.mx > 0.5 && this.tilt() * (p.slot === 0 ? 1 : -1) > 0.5 * this.limit) {
      // Our end is down: push off the floor.
      this.pushEnd(p.slot, 1.2);
    }
    void dt;
  }
  preStep(dt: number) {
    // Riders weigh their end down.
    this.occ.forEach((o, i) => {
      if (!o) return;
      this.beam.applyImpulseAtPoint({ x: 0, y: -40 * 9.81 * dt, z: 0 }, vec(this.seatPoint(i)), true);
    });
  }
  postStep() {
    this.occ.forEach((o, i) => {
      if (!o) return;
      const p = this.sim.players.get(o);
      if (!p || p.toy !== this.id) { this.occ[i] = ''; return; }
      const sp = this.seatPoint(i);
      const toward = [this.pivot[0] - sp[0], this.pivot[2] - sp[2]];
      this.seat(p, [sp[0], sp[1] + 0.05, sp[2]], Math.atan2(toward[0], toward[1]));
    });
  }
  riderVelocity(p: PlayerSim): V3 { void p; return [0, 1, 0]; }
  state() { return [this.tilt(), this.occ[0] ? 1 : 0, this.occ[1] ? 1 : 0]; }
  applyState(a: number[]) {
    this.beam.setNextKinematicRotation(quatMul(quatY(this.rot), quatAxis(AX(this.axis), a[0])));
  }
}

// ---------------------------------------------------------------- roundabout
export class RoundaboutToy extends Toy {
  deck: RigidBody; c: V3; r: number; angleMirror = 0;
  constructor(def: ToyDef, sim: Sim) {
    super(def, sim);
    const b = def.parts[def.p.part] || def.b, sz = size(b);
    this.r = (def.p.radius ?? Math.min(sz[0], sz[2]) / 2 * 0.95) * this.s;
    const deckY = def.p.deckY ?? b[4];
    const cc = center(def.b);
    this.c = this.w([cc[0], deckY, cc[2]]);
    this.deck = sim.world.createRigidBody(sim.dynamicOrKinematic().setTranslation(this.c[0], this.c[1] - 0.06, this.c[2]).setRotation(quatY(this.rot)).setAngularDamping(0.25));
    this.toyCollider(RAPIER.ColliderDesc.cylinder(0.06, this.r).setMass(80).setFriction(1.2), this.deck);
    // Centre post with handles.
    sim.addStatic({ shape: 'cyl', c: [this.c[0], this.c[1] + 0.5, this.c[2]], h: [0.12, 0.5, 0.12], owner: this.id });
    if (this.auth) {
      const jd = RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
      sim.world.createImpulseJoint(jd, this.fixedBody([this.c[0], this.c[1] - 0.06, this.c[2]]), this.deck, true);
    }
  }
  get omega() { return this.auth ? this.deck.angvel().y : this.spin; }
  angle() { return angleAbout(this.deck.rotation(), this.rot, 'y'); }
  surfaceVelocity(pos: V3): V3 {
    const w = this.omega; this.spin = w;
    const rx = pos[0] - this.c[0], rz = pos[2] - this.c[2];
    return [w * rz, 0, -w * rx];
  }
  interaction(p: PlayerSim): Interaction | null {
    if (p.mode !== 'walk') return null;
    const d = hd(p.pos, this.c);
    return d < this.r + 1.4 ? { d: Math.max(0, d - this.r), kind: 'spin', icon: '🔄' } : null;
  }
  interact(p: PlayerSim) { this.push(p.pos, p.yaw, 1); }
  push(from: V3, yaw: number, strength: number) {
    // Tangential push: direction from the player's facing, sign from the cross product.
    const rx = from[0] - this.c[0], rz = from[2] - this.c[2];
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let sign = Math.sign(rz * fx - rx * fz);   // (r × f).y
    if (!sign) sign = 1;
    this.deck.applyTorqueImpulse({ x: 0, y: 140 * sign * strength, z: 0 }, true);
    this.sim.emit({ type: 'push', toy: this.id });
  }
  postStep() { this.spin = this.deck.angvel().y; if (Math.abs(this.spin) > 6) this.deck.setAngvel({ x: 0, y: Math.sign(this.spin) * 6, z: 0 }, true); }
  state() { return [this.angle(), this.omega]; }
  applyState(a: number[]) {
    this.spin = a[1];
    this.deck.setNextKinematicRotation(quatMul(quatY(this.rot), quatAxis([0, 1, 0], a[0])));
  }
}

// ---------------------------------------------------------------- spring rider
export class SpringRiderToy extends Toy {
  body: RigidBody; pivot: V3; seatL: V3; occ = ''; axis: 'x' | 'z';
  constructor(def: ToyDef, sim: Sim) {
    super(def, sim);
    const pb = def.parts[def.p.part] || def.b, c = center(pb), sz = size(def.b);
    this.axis = sz[2] >= sz[0] ? 'x' : 'z';      // rocks along its long side
    const pivotL: V3 = [c[0], pb[1] + 0.05, c[2]];
    this.pivot = this.w(pivotL);
    this.seatL = [c[0], pb[1] + (pb[4] - pb[1]) * (def.p.seatAt ?? 0.55), c[2]];
    this.addStatic([c[0] - 0.15, 0, c[2] - 0.15, c[0] + 0.15, pb[1] + 0.05, c[2] + 0.15]);
    this.body = sim.world.createRigidBody(sim.dynamicOrKinematic().setTranslation(this.pivot[0], this.pivot[1], this.pivot[2]).setRotation(quatY(this.rot)).setAngularDamping(0.3));
    const s = this.s, hsz = size(pb);
    const cd = RAPIER.ColliderDesc.cuboid(hsz[0] / 2 * s * 0.8, hsz[1] / 2 * s * 0.8, hsz[2] / 2 * s * 0.8).setTranslation(0, hsz[1] / 2 * s, 0).setMass(18);
    this.toyCollider(cd, this.body);
    if (this.auth) {
      const jd = RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, vec(AX(this.axis)));
      const j = sim.world.createImpulseJoint(jd, this.fixedBody(this.pivot), this.body, true) as any;
      j.configureMotorPosition(0, 900, 25);   // the spring
      j.setLimits(-0.6, 0.6);
    }
  }
  angle() { return angleAbout(this.body.rotation(), this.rot, this.axis); }
  seatPos(): V3 { const q = this.body.rotation(), t = this.body.translation(); const o = quatRotate(q, [0, (this.seatL[1] - (this.local(this.pivot)[1])) * this.s, 0]); return [t.x + o[0], t.y + o[1], t.z + o[2]]; }
  interaction(p: PlayerSim): Interaction | null {
    if (p.mode !== 'walk') return null;
    const d = hd(p.pos, this.pivot);
    return d < 1.5 ? { d, kind: this.occ ? 'wobble' : 'sit', icon: this.occ ? '👐' : '🐴' } : null;
  }
  interact(p: PlayerSim, kind: string) {
    if (kind === 'sit' && !this.occ) { this.occupy(p, 'seat'); this.occ = p.id; this.sim.emit({ type: 'sit', p: p.id, toy: this.id }); }
    else this.wobble(1);
  }
  wobble(k: number) {
    const a = this.wd(AX(this.axis));
    this.body.applyTorqueImpulse({ x: a[0] * 22 * k, y: 0, z: a[2] * 22 * k }, true);
    this.sim.emit({ type: 'boing', toy: this.id });
  }
  bump() { this.wobble(0.6); }
  leave(p: PlayerSim) { if (this.occ === p.id) this.occ = ''; }
  drive(p: PlayerSim, f: InputFrame, dt: number) {
    if (!this.auth) return;
    const m = f.mx * f.mx + f.mz * f.mz;
    if (m > 0.2) { const a = this.wd(AX(this.axis)); const dir = Math.sign(this.body.angvel().x * a[0] + this.body.angvel().z * a[2]) || 1; this.body.applyTorqueImpulse({ x: a[0] * 70 * dt * dir, y: 0, z: a[2] * 70 * dt * dir }, true); }
    void p;
  }
  postStep() {
    if (!this.occ) return;
    const p = this.sim.players.get(this.occ);
    if (!p || p.toy !== this.id) { this.occ = ''; return; }
    const f = this.wd(this.axis === 'x' ? [0, 0, 1] : [1, 0, 0]);
    this.seat(p, this.seatPos(), Math.atan2(f[0], f[2]));
  }
  state() { return [this.angle(), this.occ ? 1 : 0]; }
  applyState(a: number[]) { this.body.setNextKinematicRotation(quatMul(quatY(this.rot), quatAxis(AX(this.axis), a[0]))); }
}

// ---------------------------------------------------------------- spinner (prize wheel, spinner seat)
export class SpinnerToy extends Toy {
  body: RigidBody; c: V3; axis: 'x' | 'y' | 'z'; spinning = false; occ = '';
  constructor(def: ToyDef, sim: Sim) {
    super(def, sim);
    const pb = def.parts[def.p.part] || def.b;
    this.axis = def.p.axis || 'y';
    this.c = this.w(def.p.center || center(pb));
    this.body = sim.world.createRigidBody(sim.dynamicOrKinematic().setTranslation(this.c[0], this.c[1], this.c[2]).setRotation(quatY(this.rot)).setAngularDamping(def.p.damping ?? 0.5).setGravityScale(0));
    const sz = size(pb);
    this.toyCollider(RAPIER.ColliderDesc.cuboid(Math.max(0.05, sz[0] / 2 * this.s * 0.8), Math.max(0.05, sz[1] / 2 * this.s * 0.8), Math.max(0.05, sz[2] / 2 * this.s * 0.8)).setMass(10), this.body, this.axis === 'y' ? G.PLAYER | G.DYNAMIC : 0);
    if (this.auth) {
      const jd = RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, vec(AX(this.axis)));
      sim.world.createImpulseJoint(jd, this.fixedBody(this.c), this.body, true);
    }
    if (def.p.base) this.addStatic(def.p.base);
  }
  angle() { return angleAbout(this.body.rotation(), this.rot, this.axis); }
  omega() { const w = this.body.angvel(); const a = this.wd(AX(this.axis)); return w.x * a[0] + w.y * a[1] + w.z * a[2]; }
  interaction(p: PlayerSim): Interaction | null {
    if (p.mode !== 'walk') return null;
    const d = hd(p.pos, this.c);
    if (d > 1.6) return null;
    return { d, kind: this.def.p.seat && !this.occ ? 'sit' : 'spin', icon: this.def.p.seat && !this.occ ? '🪑' : '🔄' };
  }
  interact(p: PlayerSim, kind: string) {
    if (kind === 'sit') { this.occupy(p, 'seat'); this.occ = p.id; }
    this.spinUp(1);
  }
  spinUp(k: number) {
    const a = this.wd(AX(this.axis));
    const J = 3 * k;
    this.body.applyTorqueImpulse({ x: a[0] * J, y: a[1] * J, z: a[2] * J }, true);
    this.spinning = true;
    this.sim.emit({ type: 'spin', toy: this.id });
  }
  leave(p: PlayerSim) { if (this.occ === p.id) this.occ = ''; }
  postStep() {
    if (this.spinning && Math.abs(this.omega()) < 0.08) { this.spinning = false; this.sim.emit({ type: 'prize', toy: this.id, n: Math.floor(((this.angle() + Math.PI * 4) % (Math.PI * 2)) / (Math.PI / 4)) }); }
    if (this.occ) {
      const p = this.sim.players.get(this.occ);
      if (!p || p.toy !== this.id) { this.occ = ''; return; }
      this.seat(p, [this.c[0], this.c[1] + 0.3, this.c[2]], this.rot + this.angle());
    }
  }
  state() { return [this.angle()]; }
  applyState(a: number[]) { this.body.setNextKinematicRotation(quatMul(quatY(this.rot), quatAxis(AX(this.axis), a[0]))); }
}

// ---------------------------------------------------------------- slide (spline ride)
export class SlideToy extends Toy {
  spline: Spline; entry: V3; start: V3; end: V3;
  constructor(def: ToyDef, sim: Sim) {
    super(def, sim);
    const pts: V3[] = def.p.path.map((p: V3) => this.w(p));
    this.spline = new Spline(pts);
    this.start = pts[0]; this.end = pts[pts.length - 1];
    this.entry = this.w(def.p.entry || def.p.path[0]);
    for (const post of def.p.posts || []) this.addStatic(post);
    if (def.p.deck) this.addStatic(def.p.deck);
    // The chute itself: thin ramps under the path so it can be walked up (or blocked from the side).
    const width = (def.p.width ?? 0.8) * this.s;
    const n = Math.max(2, Math.round(this.spline.length / 0.6));
    for (let i = 0; i < n; i++) {
      const a = this.spline.at(this.spline.length * i / n).p, b = this.spline.at(this.spline.length * (i + 1) / n).p;
      if (Math.min(a[1], b[1]) - this.def.xf.pos[1] < 0.3) continue;
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz), hl = Math.hypot(dx, dz);
      const q = quatMul(quatY(Math.atan2(dx, dz)), quatAxis([1, 0, 0], -Math.atan2(dy, hl)));
      const c: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.12, (a[2] + b[2]) / 2];
      sim.addStatic({ shape: 'box', c, h: [width / 2, 0.06, len / 2 + 0.03], q, owner: this.id, tag: 'chute' });
    }
  }
  interaction(p: PlayerSim): Interaction | null {
    if (p.mode !== 'walk') return null;
    const de = Math.hypot(p.pos[0] - this.entry[0], p.pos[2] - this.entry[2]) + Math.abs(p.pos[1] - this.entry[1]) * 0.5;
    const ds = Math.hypot(p.pos[0] - this.start[0], p.pos[2] - this.start[2]) + Math.abs(p.pos[1] - this.start[1]) * 0.8;
    const d = Math.min(de, ds);
    return d < 1.7 ? { d, kind: ds < de ? 'ride' : 'climb', icon: '🛝' } : null;
  }
  interact(p: PlayerSim, kind: string) {
    if (kind === 'ride') this.ride(p);
    else { this.occupy(p, 'climbUp'); p.aux = 0; (p as any).climbFrom = [...p.pos]; }
  }
  ride(p: PlayerSim) {
    this.occupy(p, 'slide');
    p.slot = 0; p.aux = 2.5;
    this.sim.emit({ type: 'whoosh', p: p.id, toy: this.id });
  }
  tryGrab(p: PlayerSim, mx: number, mz: number): boolean {
    if (Math.hypot(mx, mz) < 0.2) return false;
    const d = Math.hypot(p.pos[0] - this.start[0], p.pos[2] - this.start[2]);
    if (d < 0.55 && Math.abs(p.pos[1] - (this.start[1] - 0.1)) < 0.5 && this.auth) { this.ride(p); return true; }
    return false;
  }
  drive(p: PlayerSim, _f: InputFrame, dt: number) {
    if (p.mode === 'climbUp') {
      // Climb the ladder, then sit down at the top.
      p.aux += dt / 1.3;
      const from: V3 = (p as any).climbFrom || this.entry;
      const t = Math.min(1, p.aux);
      const mid: V3 = [this.entry[0], this.entry[1], this.entry[2]];
      const a = t < 0.3 ? t / 0.3 : 1, b = t < 0.3 ? 0 : (t - 0.3) / 0.7;
      const x = from[0] + (mid[0] - from[0]) * a + (this.start[0] - mid[0]) * b;
      const z = from[2] + (mid[2] - from[2]) * a + (this.start[2] - mid[2]) * b;
      const y = from[1] + (mid[1] - from[1]) * a + (this.start[1] - 0.1 - mid[1]) * b;
      p.yaw = Math.atan2(this.start[0] - mid[0], this.start[2] - mid[2]) || p.yaw;
      p.pos = [x, y, z];
      if (t >= 1) this.ride(p);
      return;
    }
    // Riding: gravity along the tangent, a little friction.
    const at = this.spline.at(p.slot);
    const g = -at.t[1] * MOVE.gravity * 0.75;
    p.aux = clamp(p.aux + (g - 0.35 * p.aux) * dt, 2.2, 9);
    p.slot += p.aux * dt;
    const now = this.spline.at(p.slot);
    p.pos = [now.p[0], now.p[1] - 0.05, now.p[2]];
    p.yaw = Math.atan2(now.t[0], now.t[2]);
    p.vel = [now.t[0] * p.aux, now.t[1] * p.aux, now.t[2] * p.aux];
    if (p.slot >= this.spline.length - 0.01) {
      const v = p.vel;
      this.sim.release(p);
      p.mode = 'air';
      p.vel = [v[0] * 0.8, 1.5, v[2] * 0.8];
      p.pos = [this.end[0], this.end[1] + 0.05, this.end[2]];
      this.sim.emit({ type: 'land', p: p.id, toy: this.id });
    }
  }
  riderVelocity(p: PlayerSim): V3 { return p.vel; }
}

// ---------------------------------------------------------------- climbing frames / towers
export class ClimbToy extends Toy {
  solid: Bounds6; top: number; c: V3;
  constructor(def: ToyDef, sim: Sim) {
    super(def, sim);
    const b = def.p.solid || def.b;
    const inset = def.p.inset ?? 0.12;
    this.solid = [b[0] + inset, b[1], b[2] + inset, b[3] - inset, def.p.top ?? b[4], b[5] - inset];
    this.addStatic(this.solid, { tag: 'climb' });
    this.top = this.w([0, this.solid[4], 0])[1];
    this.c = this.w(center(this.solid));
  }
  dirIn(p: PlayerSim): V3 {
    // Direction from the player to the nearest face (towards the solid).
    const l = this.local(p.pos), b = this.solid;
    const dx = l[0] < b[0] ? 1 : l[0] > b[3] ? -1 : 0, dz = l[2] < b[2] ? 1 : l[2] > b[5] ? -1 : 0;
    const d = this.wd([dx, 0, dz]); const n = Math.hypot(d[0], d[2]) || 1;
    return [d[0] / n, 0, d[2] / n];
  }
  nearFace(p: PlayerSim, pad = 0.55) {
    const l = this.local(p.pos), b = this.solid, s = this.s;
    return l[0] > b[0] - pad / s && l[0] < b[3] + pad / s && l[2] > b[2] - pad / s && l[2] < b[5] + pad / s && !(l[0] > b[0] && l[0] < b[3] && l[2] > b[2] && l[2] < b[5]);
  }
  tryGrab(p: PlayerSim, mx: number, mz: number): boolean {
    if (p.pos[1] > this.top - 0.3 || !this.nearFace(p) || (p.noGrabUntil || 0) > this.sim.time) return false;
    const d = this.dirIn(p);
    if (mx * d[0] + mz * d[2] < 0.6) return false;
    this.grab(p);
    return true;
  }
  grab(p: PlayerSim) {
    this.sim.release(p);
    p.toy = this.id; p.mode = 'climb'; p.vel = [0, 0, 0];
    this.sim.emit({ type: 'grab', p: p.id, toy: this.id });
  }
  interaction(p: PlayerSim): Interaction | null {
    if (p.mode !== 'walk' || !this.nearFace(p, 0.9) || p.pos[1] > this.top - 0.3) return null;
    return { d: 0.5, kind: 'climb', icon: '🧗' };
  }
  interact(p: PlayerSim) { this.grab(p); }
  climbStep(p: PlayerSim, f: InputFrame, dt: number, jump: boolean) {
    const d = this.dirIn(p);
    const fwd = f.mx * d[0] + f.mz * d[2];
    const side: V3 = [f.mx - d[0] * fwd, 0, f.mz - d[2] * fwd];
    p.yaw = Math.atan2(d[0], d[2]);
    if (jump) { this.sim.release(p); p.mode = 'air'; p.toy = ''; p.vel = [-d[0] * 4, 6, -d[2] * 4]; p.noGrabUntil = this.sim.time + 0.8; this.sim.moveKcc(p, [0, 0.01, 0]); return; }
    const vy = fwd > 0.25 ? MOVE.climbSpeed : fwd < -0.25 ? -MOVE.climbSpeed : 0;
    this.sim.moveKcc(p, [side[0] * 1.5 * dt + d[0] * 0.3 * dt, vy * dt, side[2] * 1.5 * dt + d[2] * 0.3 * dt]);
    if (p.pos[1] >= this.top - 0.05 && fwd > 0.25) {
      // Over the top edge onto the deck.
      p.pos = [p.pos[0] + d[0] * 0.6, this.top + 0.05, p.pos[2] + d[2] * 0.6];
      p.mode = 'air'; p.toy = ''; p.vel = [d[0], 0, d[2]];
      this.sim.placeKinematic(p);
      return;
    }
    if (!this.nearFace(p, 0.8) || (p.grounded && fwd < -0.25)) { p.mode = p.grounded ? 'walk' : 'air'; p.toy = ''; }
  }
}

// ---------------------------------------------------------------- monkey bars (hang)
export class HangToy extends Toy {
  a: V3; b: V3; barY: number; long: 'x' | 'z';
  constructor(def: ToyDef, sim: Sim) {
    super(def, sim);
    const b = def.b, sz = size(b), c = center(b);
    this.long = sz[0] >= sz[2] ? 'x' : 'z';
    const inset = 0.35;
    const barYL = def.p.barY ?? b[4] - 0.08;
    this.a = this.w(this.long === 'x' ? [b[0] + inset, barYL, c[2]] : [c[0], barYL, b[2] + inset]);
    this.b = this.w(this.long === 'x' ? [b[3] - inset, barYL, c[2]] : [c[0], barYL, b[5] - inset]);
    this.barY = this.a[1];
    // End frames.
    if (this.long === 'x') { this.addStatic([b[0], b[1], b[2], b[0] + 0.22, b[4], b[5]]); this.addStatic([b[3] - 0.22, b[1], b[2], b[3], b[4], b[5]]); }
    else { this.addStatic([b[0], b[1], b[2], b[3], b[4], b[2] + 0.22]); this.addStatic([b[0], b[1], b[5] - 0.22, b[3], b[4], b[5]]); }
  }
  proj(pos: V3) {
    const ax = this.b[0] - this.a[0], az = this.b[2] - this.a[2], L = Math.hypot(ax, az);
    const t = ((pos[0] - this.a[0]) * ax + (pos[2] - this.a[2]) * az) / (L * L);
    const px = this.a[0] + ax * t, pz = this.a[2] + az * t;
    return { t, off: Math.hypot(pos[0] - px, pos[2] - pz), L, dir: [ax / L, 0, az / L] as V3 };
  }
  canReach(p: PlayerSim, extra = 0) {
    const j = this.proj(p.pos);
    return j.t > 0 && j.t < 1 && j.off < 0.6 && p.pos[1] + BODY_HEIGHT + 0.35 + extra >= this.barY;
  }
  tryGrab(p: PlayerSim, _mx: number, _mz: number, jump: boolean): boolean {
    if ((p.noGrabUntil || 0) > this.sim.time) return false;
    if (p.mode === 'air' && p.vel[1] > -1 && this.canReach(p)) { this.grab(p); return true; }
    if (jump && this.canReach(p, 1.4)) { this.grab(p); return true; }
    return false;
  }
  grab(p: PlayerSim) {
    this.sim.release(p);
    p.toy = this.id; p.mode = 'hang'; p.vel = [0, 0, 0];
    this.sim.emit({ type: 'grab', p: p.id, toy: this.id });
  }
  interaction(p: PlayerSim): Interaction | null {
    return p.mode === 'walk' && this.canReach(p, 1.6) ? { d: 0.4, kind: 'hang', icon: '🙌' } : null;
  }
  interact(p: PlayerSim) { this.grab(p); }
  hangStep(p: PlayerSim, f: InputFrame, dt: number, jump: boolean) {
    const j = this.proj(p.pos);
    const along = f.mx * j.dir[0] + f.mz * j.dir[2];
    let t = j.t + along * MOVE.hangSpeed * dt / j.L;
    if (jump || t < -0.02 || t > 1.02) {
      p.mode = 'air'; p.toy = ''; p.vel = [j.dir[0] * along * 2, jump ? 3 : 0, j.dir[2] * along * 2];
      p.noGrabUntil = this.sim.time + 0.8;
      this.sim.emit({ type: 'drop', p: p.id });
      return;
    }
    t = clamp(t, 0, 1);
    p.pos = [this.a[0] + (this.b[0] - this.a[0]) * t, this.barY - BODY_HEIGHT - 0.3, this.a[2] + (this.b[2] - this.a[2]) * t];
    if (Math.abs(along) > 0.2) p.yaw = Math.atan2(j.dir[0] * Math.sign(along), j.dir[2] * Math.sign(along));
    p.vel = [j.dir[0] * along * MOVE.hangSpeed, 0, j.dir[2] * along * MOVE.hangSpeed];
    this.sim.placeKinematic(p);
  }
}

// ---------------------------------------------------------------- sand, water, soft pits
export class ZoneToy extends Toy {
  rect: Bounds6; radius: number; c: V3;
  piles: number[] = [];
  constructor(def: ToyDef, sim: Sim) {
    super(def, sim);
    this.rect = def.p.rect || def.b;
    this.c = this.w(center(this.rect));
    this.radius = def.p.circle ? Math.min(size(this.rect)[0], size(this.rect)[2]) / 2 * this.s : 0;
    for (const b of def.p.walls || []) this.addStatic(b);
  }
  inside(pos: V3) {
    if (this.radius) return hd(pos, this.c) < this.radius && pos[1] < this.c[1] + 1.5;
    const l = this.local(pos), r = this.rect;
    return l[0] > r[0] && l[0] < r[3] && l[2] > r[2] && l[2] < r[5] && l[1] < r[4] + 1.2 / this.s;
  }
  zoneAt(pos: V3) {
    if (!this.inside(pos)) return null;
    switch (this.type) {
      case 'sandbox': return { speed: MOVE.sandSpeed };
      case 'water': return { water: true, speed: 0.8 };
      default: return { speed: MOVE.pitSpeed };
    }
  }
  interaction(p: PlayerSim): Interaction | null {
    if (p.mode !== 'walk') return null;
    if (this.type === 'water' && this.def.p.tap) { const d = hd(p.pos, this.c); return d < 1.4 ? { d, kind: 'splash', icon: '💦' } : null; }
    if (!this.inside(p.pos)) return null;
    if (this.type === 'sandbox') return { d: 0.8, kind: 'dig', icon: '⛏️' };
    if (this.type === 'ballPit') return { d: 0.8, kind: 'splash', icon: '🎈' };
    if (this.type === 'water') return { d: 0.8, kind: 'splash', icon: '💦' };
    return null;
  }
  interact(p: PlayerSim, kind: string) {
    if (kind === 'dig') {
      const fwd = this.sim.forwardOf(p.yaw);
      const x = p.pos[0] + fwd[0] * 0.7, z = p.pos[2] + fwd[2] * 0.7;
      for (let i = 0; i < this.piles.length; i += 3) {
        if (Math.hypot(this.piles[i] - x, this.piles[i + 1] - z) < 0.8) {
          this.piles[i + 2] = Math.min(0.9, this.piles[i + 2] + 0.15);
          this.sim.emit({ type: 'dig', p: p.id, toy: this.id });
          return;
        }
      }
      if (this.piles.length >= 18) this.piles.splice(0, 3);
      this.piles.push(x, z, 0.2);
      this.sim.emit({ type: 'dig', p: p.id, toy: this.id });
    } else this.sim.emit({ type: kind === 'splash' && this.type === 'ballPit' ? 'ballsplash' : 'splash', p: p.id, toy: this.id, x: p.pos[0], z: p.pos[2] });
  }
  state() { return this.type === 'sandbox' ? this.piles : null; }
  applyState(a: number[]) { this.piles = a; }
}

// ---------------------------------------------------------------- trees
export class TreeToy extends Toy {
  last = -9; c: V3;
  constructor(def: ToyDef, sim: Sim) {
    super(def, sim);
    const tb: Bounds6 = def.p.trunk || def.b;
    const col = trunkCollider(def.xf, tb, { owner: this.id, tag: 'tree' }, def.p.radius);
    sim.addStatic(col);
    this.c = col.c;
  }
  bump(p: PlayerSim) {
    if (this.sim.time - this.last < 1.2) return;
    this.last = this.sim.time;
    this.sim.emit({ type: 'shake', toy: this.id, p: p.id });
  }
  interaction(p: PlayerSim): Interaction | null {
    if (p.mode !== 'walk') return null;
    const d = hd(p.pos, this.c);
    return d < 1.5 ? { d: d + 0.2, kind: 'shake', icon: '🌳' } : null;
  }
  interact(p: PlayerSim) { this.last = -9; this.bump(p); }
}

// ---------------------------------------------------------------- doors & gates
interface Leaf { body: RigidBody; hinge: V3; sign: number }
export class DoorToy extends Toy {
  leaves: Leaf[] = []; angle = 0; c: V3;
  constructor(def: ToyDef, sim: Sim) {
    super(def, sim);
    this.c = this.w(center(def.b));
    const specs: [Bounds6, string][] = def.p.leaves
      ? def.p.leaves.map((l: any) => [def.parts[l.part] || l.box, l.hinge])
      : [[def.b, def.p.hinge || 'minX']];
    for (const s of def.p.posts || []) this.addStatic(s);
    for (const [b, hingeSide] of specs) {
      const c = center(b);
      const hl: V3 = hingeSide === 'minX' ? [b[0], b[1], c[2]] : hingeSide === 'maxX' ? [b[3], b[1], c[2]] : hingeSide === 'minZ' ? [c[0], b[1], b[2]] : [c[0], b[1], b[5]];
      const hinge = this.w(hl);
      const body = sim.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(hinge[0], hinge[1], hinge[2]).setRotation(quatY(this.rot)));
      const sz = size(b), s = this.s;
      const off: V3 = [(c[0] - hl[0]) * s, (c[1] - hl[1]) * s, (c[2] - hl[2]) * s];
      this.toyCollider(RAPIER.ColliderDesc.cuboid(Math.max(0.04, sz[0] / 2 * s), sz[1] / 2 * s, Math.max(0.04, sz[2] / 2 * s)).setTranslation(off[0], off[1], off[2]), body, G.PLAYER | G.DYNAMIC);
      this.leaves.push({ body, hinge, sign: hingeSide === 'minX' || hingeSide === 'minZ' ? 1 : -1 });
    }
  }
  preStep(dt: number) {
    let near = false;
    for (const p of this.sim.players.values()) if (hd(p.pos, this.c) < (this.def.p.openDistance ?? 3.2)) near = true;
    const target = near ? 1.65 : 0;
    const was = this.angle;
    this.angle += clamp(target - this.angle, -4 * dt, 4 * dt);
    if (was === 0 && this.angle > 0) this.sim.emit({ type: 'door', toy: this.id });
    this.pose();
  }
  pose() {
    for (const l of this.leaves) l.body.setNextKinematicRotation(quatY(this.rot + l.sign * this.angle));
  }
  state() { return [this.angle]; }
  applyState(a: number[]) { this.angle = a[0]; this.pose(); }
}

// ---------------------------------------------------------------- hoops (basketball)
export class HoopToy extends Toy {
  ring: V3; r: number; score = 0; prevY = new Map<number, number>(); facing: V3;
  constructor(def: ToyDef, sim: Sim) {
    super(def, sim);
    // ring: model-space point; ringOffset: relative to the bottom centre of the toy's bounds.
    const b = def.b, o = def.p.ringOffset;
    this.ring = this.w(o ? [(b[0] + b[3]) / 2 + o[0], b[1] + o[1], (b[2] + b[5]) / 2 + o[2]] : def.p.ring);
    this.facing = this.wd(def.p.facing || [0, 0, 1]);
    this.r = (def.p.r ?? 0.22) * (def.p.rScale ?? 1);
    for (const b of def.p.solids || []) this.addStatic(b);
  }
  // Where a shooter stands (in front of the hoop).
  shootFrom(dist = this.def.p.shootDist ?? 2.6): V3 { return [this.ring[0] + this.facing[0] * dist, this.def.xf.pos[1], this.ring[2] + this.facing[2] * dist]; }
  postStep() {
    for (const pr of this.sim.props) {
      if (pr.def.shape !== 'ball' || pr.carriedBy) continue;
      const t = pr.body.translation();
      const d = Math.hypot(t.x - this.ring[0], t.z - this.ring[2]);
      const prev = this.prevY.get(pr.index);
      this.prevY.set(pr.index, t.y);
      if (d < this.r + pr.def.half[0] * 0.5 && prev != null && prev > this.ring[1] && t.y <= this.ring[1] && pr.body.linvel().y < 0) {
        this.score++;
        this.sim.emit({ type: 'score', toy: this.id, p: pr.lastToucher, n: this.score });
      }
    }
  }
  interaction(p: PlayerSim): Interaction | null {
    if (!p.carry) return null;
    const pr = this.sim.propById.get(p.carry);
    if (!pr || pr.def.shape !== 'ball' || pr.def.tag === 'giant') return null;
    const d = hd(p.pos, this.ring);
    return d < 7 && d > 0.6 ? { d: -1, kind: 'shoot', icon: '🏀' } : null;
  }
  interact(p: PlayerSim) {
    const pr = this.sim.propById.get(p.carry);
    if (!pr) return;
    this.sim.dropCarry(p, true);
    // Turn to the hoop and release from in front of the chest.
    p.yaw = Math.atan2(this.ring[0] - p.pos[0], this.ring[2] - p.pos[2]);
    this.sim.releasePoint(p, pr);
    const t = pr.body.translation();
    // Aim so the ball is already dropping when it reaches the ring.
    const T = 0.95;
    const jitter = (((this.sim.tick * 2654435761) >>> 0) % 1000) / 1000 - 0.5;
    const tx = this.ring[0] + jitter * this.r * 0.5, ty = this.ring[1] - 0.02, tz = this.ring[2] - jitter * this.r * 0.4;
    const g = 9.81, drag = 1 + 0.5 * pr.body.linearDamping() * T;
    pr.body.setLinvel({ x: (tx - t.x) / T * drag, y: ((ty - t.y) / T + 0.5 * g * T) * drag, z: (tz - t.z) / T * drag }, true);
    pr.lastToucher = p.id;
    this.sim.emit({ type: 'throw', p: p.id, prop: pr.def.id });
  }
  state() { return [this.score]; }
  applyState(a: number[]) { this.score = a[0]; }
}

// ---------------------------------------------------------------- arcade machines
export class MachineToy extends Toy {
  front: V3; users = new Map<string, number>();
  constructor(def: ToyDef, sim: Sim) {
    super(def, sim);
    const b = def.b;
    this.front = this.w([(b[0] + b[3]) / 2, 0, b[5] + (def.p.frontGap ?? 0.35)]);
  }
  interaction(p: PlayerSim): Interaction | null {
    if (p.mode !== 'walk') return null;
    const d = hd(p.pos, this.front);
    return d < 1.3 ? { d, kind: 'play', icon: this.def.p.kind === 'dance' ? '💃' : this.def.p.kind === 'vending' ? '🥤' : this.def.p.kind === 'ticket' ? '🎟️' : '🕹️' } : null;
  }
  interact(p: PlayerSim) {
    this.users.set(p.id, this.sim.time);
    this.sim.emit({ type: 'challenge', p: p.id, toy: this.id, kind: this.def.p.kind || 'arcade' });
  }
}

// ---------------------------------------------------------------- claw machine
export class ClawToy extends Toy {
  area: Bounds6; claw: [number, number] = [0, 0]; drop = 0; phase = 0; holding = -1; prizes = [1, 1, 1, 1]; respawn = [0, 0, 0, 0];
  front: V3; user = '';
  spots: [number, number][];
  constructor(def: ToyDef, sim: Sim) {
    super(def, sim);
    this.area = def.parts[def.p.part] || [-0.15, 0.25, -0.15, 0.15, 0.55, 0.15];
    const a = this.area, cx = (a[0] + a[3]) / 2, cz = (a[2] + a[5]) / 2, hx = (a[3] - a[0]) / 2 * 0.7, hz = (a[5] - a[2]) / 2 * 0.7;
    this.spots = [[cx - hx * 0.6, cz - hz * 0.5], [cx + hx * 0.5, cz - hz * 0.6], [cx - hx * 0.4, cz + hz * 0.5], [cx + hx * 0.6, cz + hz * 0.4]];
    this.claw = [cx, cz];
    this.front = this.w([cx, 0, def.b[5] + 0.35]);
  }
  interaction(p: PlayerSim): Interaction | null {
    if (p.mode !== 'walk' || this.user) return null;
    const d = hd(p.pos, this.front);
    return d < 1.3 ? { d, kind: 'claw', icon: '🕹️' } : null;
  }
  interact(p: PlayerSim, kind: string) {
    if (kind === 'claw' && !this.user) {
      this.occupy(p, 'claw'); this.user = p.id; this.phase = 0; this.drop = 0;
      p.pos = [this.front[0], p.pos[1], this.front[2]];
      p.yaw = this.rot + Math.PI;
      this.sim.emit({ type: 'claw', p: p.id, toy: this.id });
    } else if (kind === 'drop' && this.user === p.id && this.phase === 0) this.phase = 1;
  }
  leave(p: PlayerSim) { if (this.user === p.id) { this.user = ''; this.phase = 0; this.drop = 0; } }
  drive(p: PlayerSim, f: InputFrame, dt: number) {
    if (!this.auth || this.phase !== 0) return;
    const [lx, lz] = [f.mx * Math.cos(this.rot) - f.mz * Math.sin(this.rot), f.mx * Math.sin(this.rot) + f.mz * Math.cos(this.rot)];
    const a = this.area, sp = 0.12 * dt;
    this.claw[0] = clamp(this.claw[0] + lx * sp, a[0] + 0.03, a[3] - 0.03);
    this.claw[1] = clamp(this.claw[1] + lz * sp, a[2] + 0.03, a[5] - 0.03);
    void p;
  }
  preStep(dt: number) {
    const t = this.sim.time;
    this.respawn.forEach((r, i) => { if (!this.prizes[i] && r && t > r) { this.prizes[i] = 1; this.respawn[i] = 0; } });
    if (this.phase === 1) { this.drop = Math.min(1, this.drop + dt / 0.8); if (this.drop >= 1) { this.grabNow(); this.phase = 2; } }
    else if (this.phase === 2) { this.drop = Math.max(0, this.drop - dt / 0.8); if (this.drop <= 0) this.phase = 3; }
    else if (this.phase === 3) {
      const a = this.area, target: [number, number] = [a[0] + 0.04, a[5] - 0.04];
      const dx = target[0] - this.claw[0], dz = target[1] - this.claw[1], d = Math.hypot(dx, dz), st = 0.15 * dt;
      if (d > st) { this.claw[0] += dx / d * st; this.claw[1] += dz / d * st; }
      else {
        if (this.holding >= 0) {
          this.sim.emit({ type: 'prize', toy: this.id, p: this.user, n: this.holding });
          this.respawn[this.holding] = t + 15;
          this.holding = -1;
        } else this.sim.emit({ type: 'miss', toy: this.id, p: this.user });
        const p = this.sim.players.get(this.user);
        this.phase = 0;
        if (p) { this.sim.release(p); p.mode = 'walk'; }
        this.user = '';
      }
    }
  }
  grabNow() {
    let best = -1, bd = 0.07;
    this.spots.forEach((s, i) => { const d = Math.hypot(s[0] - this.claw[0], s[1] - this.claw[1]); if (this.prizes[i] && d < bd) { bd = d; best = i; } });
    if (best >= 0) { this.holding = best; this.prizes[best] = 0; this.sim.emit({ type: 'grabbed', toy: this.id }); }
  }
  state() { return [this.claw[0], this.claw[1], this.drop, this.holding, this.prizes.reduce((m, v, i) => m | (v << i), 0), this.user ? 1 : 0]; }
  applyState(a: number[]) { this.claw = [a[0], a[1]]; this.drop = a[2]; this.holding = a[3]; this.prizes = [0, 1, 2, 3].map(i => (a[4] >> i) & 1); }
}

// ---------------------------------------------------------------- air hockey
export class AirHockeyToy extends Toy {
  puck: RigidBody; mallets: RigidBody[] = []; score = [0, 0];
  y: number; hl: number; hw: number; cx: number; cz: number; goalHalf: number; home: V3[] = [];
  constructor(def: ToyDef, sim: Sim) {
    super(def, sim);
    const b = def.b, s = this.s;
    this.cx = (b[0] + b[3]) / 2; this.cz = (b[2] + b[5]) / 2;
    this.hl = (b[3] - b[0]) / 2 - 0.04; this.hw = (b[5] - b[2]) / 2 - 0.05;
    const surf = def.p.surfaceY ?? 0.25;
    this.y = this.w([0, surf, 0])[1];
    this.goalHalf = def.p.goalHalf ?? 0.14;
    // The table blocks players.
    this.addStatic([b[0], b[1], b[2], b[3], surf, b[5]]);
    // Rims (puck only), with a goal gap in each end.
    const rim = (lb: Bounds6) => {
      const c = boxCollider(def.xf, lb);
      const col = sim.world.createCollider(sim.colliderDesc(c).setTranslation(c.c[0], c.c[1], c.c[2]).setRotation(c.q!).setCollisionGroups(groups(G.RIM, G.PUCK)).setRestitution(0.9).setFriction(0));
      void col;
    };
    const t = 0.03, h0 = surf, h1 = surf + 0.06;
    rim([b[0], h0, b[2] - t, b[3], h1, b[2] + 0.01]);
    rim([b[0], h0, b[5] - 0.01, b[3], h1, b[5] + t]);
    for (const x of [b[0], b[3]]) {
      const x0 = x === b[0] ? x - t : x - 0.01, x1 = x === b[0] ? x + 0.01 : x + t;
      rim([x0, h0, b[2], x1, h1, this.cz - this.goalHalf]);
      rim([x0, h0, this.cz + this.goalHalf, x1, h1, b[5]]);
    }
    const pr = 0.045 * s;
    this.puck = sim.world.createRigidBody(sim.dynamicOrKinematic().setTranslation(...this.w([this.cx, surf + 0.012, this.cz]))
      .setGravityScale(0).lockRotations().enabledTranslations(true, false, true).setLinearDamping(0.25).setCcdEnabled(true));
    sim.world.createCollider(RAPIER.ColliderDesc.cylinder(0.012 * s, pr).setRestitution(0.9).setFriction(0).setMass(0.2).setCollisionGroups(groups(G.PUCK, G.RIM | G.PUCK)), this.puck);
    for (const side of [1, -1]) {
      // Idle mallets rest beside their goal so the mouth stays open.
      const home = this.w([this.cx + side * this.hl * 0.8, surf + 0.012, this.cz + this.hw * 0.65]);
      this.home.push(home);
      const m = sim.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(home[0], home[1], home[2]));
      sim.world.createCollider(RAPIER.ColliderDesc.cylinder(0.02 * s, 0.065 * s).setRestitution(0.8).setCollisionGroups(groups(G.PUCK, G.PUCK)), m);
      this.mallets.push(m);
    }
  }
  endPoint(side: number): V3 { return this.w([this.cx + side * (this.hl + 0.25), 0, this.cz]); }
  controller(side: number): PlayerSim | undefined {
    let best: PlayerSim | undefined, bd = 1.9;
    for (const p of this.sim.players.values()) {
      if (p.mode !== 'walk') continue;
      const l = this.local(p.pos);
      const d = Math.abs(l[0] - this.cx) - this.hl;          // how far beyond this end
      if (Math.sign(l[0] - this.cx) !== side || d < -0.05 * 0) { /* on the other half */ }
      const e = hd(p.pos, this.endPoint(side));
      if (Math.sign(l[0] - this.cx) === side && e < bd) { bd = e; best = p; }
      void d;
    }
    return best;
  }
  preStep(dt: number) {
    const s = this.s;
    [1, -1].forEach((side, i) => {
      const m = this.mallets[i], cur = m.translation();
      const p = this.controller(side);
      let target: V3 = this.home[i];
      if (p) {
        const f = this.sim.forwardOf(p.yaw);
        const reach: V3 = [p.pos[0] + f[0] * 0.9 + p.vel[0] * 0.12, 0, p.pos[2] + f[2] * 0.9 + p.vel[2] * 0.12];
        const l = this.local(reach);
        const lx = clamp(l[0], side > 0 ? this.cx + 0.06 : this.cx - this.hl + 0.03, side > 0 ? this.cx + this.hl - 0.03 : this.cx - 0.06);
        const lz = clamp(l[2], this.cz - this.hw + 0.05, this.cz + this.hw - 0.05);
        target = this.w([lx, 0, lz]); target[1] = this.home[i][1];
      }
      const dx = target[0] - cur.x, dz = target[2] - cur.z, d = Math.hypot(dx, dz), st = 5 * dt;
      const k = d > st ? st / d : 1;
      m.setNextKinematicTranslation({ x: cur.x + dx * k, y: this.home[i][1], z: cur.z + dz * k });
    });
    void s;
  }
  postStep() {
    const t = this.puck.translation(), l = this.local([t.x, t.y, t.z]);
    const v = this.puck.linvel(), sp = Math.hypot(v.x, v.z);
    if (sp > 7) this.puck.setLinvel({ x: v.x / sp * 7, y: 0, z: v.z / sp * 7 }, true);
    if (Math.abs(l[0] - this.cx) > this.hl + 0.03 || Math.abs(l[2] - this.cz) > this.hw + 0.1) {
      const side = l[0] > this.cx ? 0 : 1;           // puck left through +x end → side b scores
      if (Math.abs(l[2] - this.cz) <= this.goalHalf + 0.02) {
        this.score[side]++;
        this.sim.emit({ type: 'goal', toy: this.id, side, score: [...this.score] });
      }
      const c = this.w([this.cx, 0, this.cz]);
      this.puck.setTranslation({ x: c[0], y: this.home[0][1], z: c[2] }, true);
      this.puck.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
  }
  interaction(p: PlayerSim): Interaction | null {
    if (p.mode !== 'walk') return null;
    const d = Math.min(hd(p.pos, this.endPoint(1)), hd(p.pos, this.endPoint(-1)));
    return d < 1.6 ? { d, kind: 'serve', icon: '🏒' } : null;
  }
  interact(p: PlayerSim) {
    const t = this.puck.translation();
    const dx = t.x - p.pos[0], dz = t.z - p.pos[2], d = Math.hypot(dx, dz) || 1;
    this.puck.setLinvel({ x: dx / d * 3, y: 0, z: dz / d * 3 }, true);
    this.sim.emit({ type: 'hit', toy: this.id });
  }
  state() {
    const t = this.puck.translation(), a = this.mallets[0].translation(), b = this.mallets[1].translation();
    return [t.x, t.z, a.x, a.z, b.x, b.z, this.score[0], this.score[1]];
  }
  applyState(s: number[]) {
    this.puck.setNextKinematicTranslation({ x: s[0], y: this.home[0][1], z: s[1] });
    this.mallets[0].setNextKinematicTranslation({ x: s[2], y: this.home[0][1], z: s[3] });
    this.mallets[1].setNextKinematicTranslation({ x: s[4], y: this.home[0][1], z: s[5] });
    this.score = [s[6], s[7]];
  }
}

// ---------------------------------------------------------------- simple structures
export class BounceToy extends Toy {
  last = 0;
  interaction(): Interaction | null { return null; }
}
export class SolidToy extends Toy {
  // Walkable structures (stages, tunnels, step blocks): extra colliders only.
  constructor(def: ToyDef, sim: Sim) {
    super(def, sim);
    for (const b of def.p.solids || []) this.addStatic(b);
    for (const t of def.p.posts || []) sim.addStatic(trunkCollider(def.xf, t, { owner: this.id }, 0.12));
  }
}
// Areas used by minigames (colour floor, paint arena, goals, rescue basket, race gates).
export class AreaToy extends Toy {
  c: V3; grid: number[] = [];
  constructor(def: ToyDef, sim: Sim) {
    super(def, sim);
    this.c = this.w(center(def.b));
    for (const b of def.p.solids || []) this.addStatic(b);
    for (const t of def.p.posts || []) sim.addStatic(trunkCollider(def.xf, t, { owner: this.id }, 0.1));
  }
  inside(pos: V3, pad = 0) { return this.inRect(pos, this.def.b, pad); }
  cell(pos: V3): number {
    const n = this.def.p.cells || 6, l = this.local(pos), b = this.def.b;
    const i = Math.floor((l[0] - b[0]) / (b[3] - b[0]) * n), j = Math.floor((l[2] - b[2]) / (b[5] - b[2]) * n);
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i;
  }
  cellCenter(k: number): V3 {
    const n = this.def.p.cells || 6, b = this.def.b, i = k % n, j = Math.floor(k / n);
    return this.w([b[0] + (i + 0.5) * (b[3] - b[0]) / n, b[4], b[2] + (j + 0.5) * (b[5] - b[2]) / n]);
  }
  state() { return this.grid.length ? this.grid : null; }
  applyState(a: number[]) { this.grid = a; }
}

export function makeToy(def: ToyDef, sim: Sim): Toy {
  switch (def.type) {
    case 'swing': return new SwingToy(def, sim);
    case 'seesaw': return new SeesawToy(def, sim);
    case 'roundabout': return new RoundaboutToy(def, sim);
    case 'springRider': return new SpringRiderToy(def, sim);
    case 'spinner': return new SpinnerToy(def, sim);
    case 'slide': return new SlideToy(def, sim);
    case 'climb': return new ClimbToy(def, sim);
    case 'hang': return new HangToy(def, sim);
    case 'sandbox': case 'water': case 'ballPit': case 'softPit': return new ZoneToy(def, sim);
    case 'tree': return new TreeToy(def, sim);
    case 'door': return new DoorToy(def, sim);
    case 'hoop': return new HoopToy(def, sim);
    case 'machine': return new MachineToy(def, sim);
    case 'claw': return new ClawToy(def, sim);
    case 'airHockey': return new AirHockeyToy(def, sim);
    case 'bounce': return new BounceToy(def, sim);
    case 'solid': return new SolidToy(def, sim);
    case 'area': return new AreaToy(def, sim);
    default: throw new Error(`Unknown behaviour ${def.type} (${def.id})`);
  }
}
export const INTERACTIVE_TYPES = new Set(['swing', 'seesaw', 'roundabout', 'springRider', 'spinner', 'slide', 'climb', 'hang', 'sandbox', 'water', 'ballPit', 'softPit', 'tree', 'door', 'hoop', 'machine', 'claw', 'airHockey', 'bounce']);
