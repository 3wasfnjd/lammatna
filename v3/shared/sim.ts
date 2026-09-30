// The physics simulation shared by the room server, solo play and client
// prediction. One Rapier world per Sim; players are kinematic capsules moved by
// Rapier's KinematicCharacterController; toys and props are real rigid bodies.
//
// mode 'authority': everything is simulated (server / solo room).
// mode 'mirror':   client prediction; toys and props are kinematic copies of the
//                  server state and only the local player is stepped.
import { RAPIER, type World, type RigidBody, type Collider } from './rapier';
import { MOVE, SIM_DT, BTN, G, groups } from './constants';
import type { V3 } from './math';
import { clamp, quatY, wrapAngle } from './math';
import type { WorldDef, ColliderDef, PropDef } from './world';
import { makeToy, type Toy } from './toys';

export type Mode = 'walk' | 'air' | 'climb' | 'hang' | 'seat' | 'slide' | 'climbUp' | 'claw' | 'follow' | 'frozen';
export const PREDICTED_MODES: Mode[] = ['walk', 'air', 'climb', 'hang'];
export const MODES: Mode[] = ['walk', 'air', 'climb', 'hang', 'seat', 'slide', 'climbUp', 'claw', 'follow', 'frozen'];

export interface InputFrame { seq: number; mx: number; mz: number; b: number }

export interface PlayerSim {
  id: string;
  body: RigidBody;
  col: Collider;
  pos: V3;                 // feet
  vel: V3;
  yaw: number;
  mode: Mode;
  grounded: boolean;
  groundTag: string;
  ground: number;          // handle of the collider under the feet (-1 none)
  toy: string;             // toy id for seat / slide / climb / hang / claw
  slot: number;            // seat index, slide arc length, ...
  aux: number;             // mode timer / slide speed
  prevB: number;           // buttons of the previous frame (edge detection)
  carry: string;           // prop id being carried
  follow: string;          // player being held by the hand
  lastSeq: number;
  input: InputFrame;
  speedMul: number;
  inWater: string;
  lastBounce: number;
  noGrabUntil?: number;
}

export interface SimEvent { type: string; [k: string]: any }

export interface PropSim {
  def: PropDef;
  body: RigidBody;
  col: Collider;
  carriedBy: string;
  lastToucher: string;
  index: number;
}

type Meta = { tag?: string; owner?: string; kind: 'static' | 'player' | 'prop' | 'toy'; id?: string };

export class Sim {
  world: World;
  def: WorldDef;
  mode: 'authority' | 'mirror';
  kcc: ReturnType<World['createCharacterController']>;
  players = new Map<string, PlayerSim>();
  props: PropSim[] = [];
  propById = new Map<string, PropSim>();
  toys: Toy[] = [];
  toyById = new Map<string, Toy>();
  meta = new Map<number, Meta>();
  events: SimEvent[] = [];
  time = 0;
  tick = 0;
  // Minigames may freeze or override players: return true to consume the interact press.
  interactHook: ((p: PlayerSim) => boolean) | null = null;

  constructor(def: WorldDef, mode: 'authority' | 'mirror' = 'authority') {
    this.def = def;
    this.mode = mode;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = SIM_DT;
    const k = this.world.createCharacterController(0.02);
    k.setUp({ x: 0, y: 1, z: 0 });
    k.setMaxSlopeClimbAngle(MOVE.maxSlope);
    k.setMinSlopeSlideAngle(60 * Math.PI / 180);
    k.enableAutostep(MOVE.stepHeight, 0.15, false);
    k.enableSnapToGround(MOVE.snap);
    k.setSlideEnabled(true);
    k.setApplyImpulsesToDynamicBodies(mode === 'authority');
    k.setCharacterMass(40);
    this.kcc = k;
    for (const c of def.statics) this.addStatic(c);
    for (const p of def.props) this.addProp(p);
    for (const t of def.toys) {
      const toy = makeToy(t, this);
      this.toys.push(toy);
      this.toyById.set(t.id, toy);
    }
  }

  // ---------- construction helpers ----------
  colliderDesc(c: ColliderDef) {
    const d = c.shape === 'box' ? RAPIER.ColliderDesc.cuboid(c.h[0], c.h[1], c.h[2])
      : c.shape === 'cyl' ? RAPIER.ColliderDesc.cylinder(c.h[1], c.h[0])
        : RAPIER.ColliderDesc.ball(c.h[0]);
    if (c.friction != null) d.setFriction(c.friction);
    return d;
  }
  addStatic(c: ColliderDef, body?: RigidBody): Collider {
    const d = this.colliderDesc(c).setTranslation(c.c[0], c.c[1], c.c[2]);
    if (c.q) d.setRotation(c.q);
    d.setCollisionGroups(groups(G.STATIC, 0xffff));
    const col = this.world.createCollider(d, body);
    this.meta.set(col.handle, { kind: 'static', tag: c.tag, owner: c.owner });
    return col;
  }
  addProp(p: PropDef) {
    const bd = (this.mode === 'authority' ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.kinematicPositionBased())
      .setTranslation(p.pos[0] + 0, p.pos[1], p.pos[2]).setRotation(quatY(p.rot))
      .setLinearDamping(p.shape === 'ball' ? 0.08 : 0.8).setAngularDamping(p.shape === 'ball' ? 0.4 : 1.5).setCcdEnabled(p.shape === 'ball');
    const body = this.world.createRigidBody(bd);
    const cd = (p.shape === 'ball' ? RAPIER.ColliderDesc.ball(p.half[0]) : RAPIER.ColliderDesc.cuboid(p.half[0], p.half[1], p.half[2]))
      .setTranslation(p.shape === 'ball' ? 0 : p.offset[0], p.shape === 'ball' ? p.half[0] : p.offset[1], p.shape === 'ball' ? 0 : p.offset[2])
      .setMass(p.mass).setRestitution(p.restitution ?? 0.1).setFriction(p.shape === 'ball' ? 0.6 : 0.7)
      .setCollisionGroups(groups(G.DYNAMIC, G.STATIC | G.PLAYER | G.DYNAMIC | G.TOY));
    const col = this.world.createCollider(cd, body);
    const ps: PropSim = { def: p, body, col, carriedBy: '', lastToucher: '', index: this.props.length };
    this.props.push(ps);
    this.propById.set(p.id, ps);
    this.meta.set(col.handle, { kind: 'prop', id: p.id, tag: p.tag });
    return ps;
  }
  // Toys register their own bodies' colliders.
  registerToyCollider(col: Collider, toyId: string, tag?: string) {
    this.meta.set(col.handle, { kind: 'toy', id: toyId, tag, owner: toyId });
  }
  dynamicOrKinematic() {
    return this.mode === 'authority' ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.kinematicPositionBased();
  }

  // ---------- players ----------
  addPlayer(id: string, pos: V3, yaw = 0): PlayerSim {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos[0], pos[1] + MOVE.halfHeight + MOVE.radius, pos[2]));
    const col = this.world.createCollider(RAPIER.ColliderDesc.capsule(MOVE.halfHeight, MOVE.radius).setCollisionGroups(groups(G.PLAYER, G.STATIC | G.PLAYER | G.DYNAMIC | G.TOY)), body);
    const p: PlayerSim = {
      id, body, col, pos: [...pos] as V3, vel: [0, 0, 0], yaw, mode: 'walk', grounded: true, groundTag: '', ground: -1,
      toy: '', slot: 0, aux: 0, prevB: 0, carry: '', follow: '', lastSeq: 0, input: { seq: 0, mx: 0, mz: 0, b: 0 },
      speedMul: 1, inWater: '', lastBounce: -9
    };
    this.meta.set(col.handle, { kind: 'player', id });
    this.players.set(id, p);
    return p;
  }
  removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.release(p);
    for (const o of this.players.values()) if (o.follow === id) { o.follow = ''; if (o.mode === 'follow') o.mode = 'walk'; }
    this.meta.delete(p.col.handle);
    this.world.removeRigidBody(p.body);
    this.players.delete(id);
  }
  teleport(p: PlayerSim, pos: V3, yaw = p.yaw) {
    this.release(p);
    p.pos = [...pos] as V3; p.vel = [0, 0, 0]; p.yaw = yaw; p.mode = 'walk';
    p.body.setTranslation({ x: pos[0], y: pos[1] + MOVE.halfHeight + MOVE.radius, z: pos[2] }, true);
    p.body.setNextKinematicTranslation({ x: pos[0], y: pos[1] + MOVE.halfHeight + MOVE.radius, z: pos[2] });
  }
  setSolid(p: PlayerSim, solid: boolean) {
    p.col.setCollisionGroups(groups(G.PLAYER, solid ? G.STATIC | G.PLAYER | G.DYNAMIC | G.TOY : 0));
  }
  // Leave whatever the player is attached to.
  release(p: PlayerSim) {
    if (p.toy) { this.toyById.get(p.toy)?.leave(p); p.toy = ''; }
    if (p.carry) this.dropCarry(p, false);
    p.follow = '';
    if (!PREDICTED_MODES.includes(p.mode)) p.mode = 'air';
    this.setSolid(p, true);
  }
  placeKinematic(p: PlayerSim) {
    p.body.setNextKinematicTranslation({ x: p.pos[0], y: p.pos[1] + MOVE.halfHeight + MOVE.radius, z: p.pos[2] });
  }

  // ---------- stepping ----------
  step(inputs?: Map<string, InputFrame>, only?: string) {
    this.tick++;
    this.time += SIM_DT;
    for (const p of this.players.values()) {
      if (only && p.id !== only) continue;
      const f = inputs?.get(p.id);
      if (f) p.input = f;
      this.stepPlayer(p, p.input);
      p.prevB = p.input.b;
    }
    if (this.mode === 'authority') for (const t of this.toys) t.preStep(SIM_DT);
    for (const pr of this.props) if (pr.carriedBy) this.holdCarry(pr);
    this.world.step();
    if (this.mode === 'authority') {
      for (const t of this.toys) t.postStep(SIM_DT);
      this.keepPropsInside();
    }
  }

  forwardOf(yaw: number): V3 { return [Math.sin(yaw), 0, Math.cos(yaw)]; }

  stepPlayer(p: PlayerSim, f: InputFrame) {
    const dt = SIM_DT;
    const pressed = (bit: number) => (f.b & bit) !== 0 && (p.prevB & bit) === 0;
    let mx = f.mx, mz = f.mz;
    const m = Math.hypot(mx, mz);
    if (m > 1) { mx /= m; mz /= m; }

    // Interact button: games, toys, props and players, in that order.
    if (pressed(BTN.interact) && this.mode === 'authority') this.interact(p);

    switch (p.mode) {
      case 'seat': case 'slide': case 'climbUp': case 'claw': case 'frozen': {
        const toy = p.toy ? this.toyById.get(p.toy) : undefined;
        if (p.mode !== 'frozen' && pressed(BTN.jump) && p.mode !== 'slide' && p.mode !== 'climbUp') {
          // Jump off.
          const v = toy?.riderVelocity(p) || [0, 0, 0];
          this.release(p);
          p.vel = [v[0], Math.max(v[1], 0) + 5, v[2]];
          p.mode = 'air';
          this.placeKinematic(p);
          return;
        }
        if (toy) toy.drive(p, f, dt);
        this.placeKinematic(p);
        return;
      }
      case 'follow': return this.stepFollow(p, f, dt);
      case 'climb': return this.stepClimb(p, f, dt, pressed(BTN.jump));
      case 'hang': return this.stepHang(p, f, dt, pressed(BTN.jump));
    }

    // Walk / air.
    const speed = MOVE.speed * p.speedMul;
    const accel = p.grounded ? MOVE.accel : MOVE.airAccel;
    const tx = mx * speed, tz = mz * speed;
    const dvx = tx - p.vel[0], dvz = tz - p.vel[2];
    const dl = Math.hypot(dvx, dvz), maxDv = accel * dt;
    if (dl > maxDv) { p.vel[0] += dvx / dl * maxDv; p.vel[2] += dvz / dl * maxDv; } else { p.vel[0] = tx; p.vel[2] = tz; }
    if (m > 0.1) p.yaw = turnToward(p.yaw, Math.atan2(mx, mz), 12 * dt);

    if (p.grounded && pressed(BTN.jump)) { p.vel[1] = MOVE.jumpVelocity; p.grounded = false; this.emit({ type: 'jump', p: p.id }); }
    p.vel[1] -= MOVE.gravity * dt;
    if (p.vel[1] < -30) p.vel[1] = -30;

    // Standing on a moving toy (roundabout): ride along.
    let carryX = 0, carryZ = 0;
    if (p.grounded && p.ground >= 0) {
      const meta = this.meta.get(p.ground);
      if (meta?.kind === 'toy') {
        const toy = this.toyById.get(meta.id!);
        const v = toy?.surfaceVelocity?.(p.pos);
        if (v) { carryX = v[0] * dt; carryZ = v[2] * dt; p.yaw += (toy!.spin || 0) * dt; }
      }
    }

    const vy0 = p.vel[1];
    this.moveKcc(p, [p.vel[0] * dt + carryX, p.vel[1] * dt, p.vel[2] * dt + carryZ]);
    if (p.grounded && p.vel[1] < 0) p.vel[1] = 0;

    // Trampoline: a fixed push back up whenever you land on a bounce surface.
    if (p.grounded && p.groundTag === 'bounce' && vy0 <= 0.5) {
      p.vel[1] = MOVE.bounceVelocity + ((f.b & BTN.jump) ? 1.5 : 0);
      p.grounded = false;
      const meta = this.meta.get(p.ground);
      this.emit({ type: 'bounce', p: p.id, toy: meta?.owner || meta?.id || '', x: p.pos[0], z: p.pos[2] });
      p.lastBounce = this.time;
    }
    p.mode = p.grounded ? 'walk' : 'air';

    // Enter climbables / bars.
    for (const t of this.toys) {
      if (t.tryGrab && t.tryGrab(p, mx, mz, pressed(BTN.jump))) break;
    }
    this.updateZones(p);
  }

  moveKcc(p: PlayerSim, d: V3) {
    const exclude = p.carry ? this.propById.get(p.carry)?.col.handle : -1;
    this.kcc.computeColliderMovement(p.col, { x: d[0], y: d[1], z: d[2] }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined,
      c => c.handle !== exclude && c.handle !== p.col.handle);
    const mv = this.kcc.computedMovement();
    p.pos[0] += mv.x; p.pos[1] += mv.y; p.pos[2] += mv.z;
    p.grounded = this.kcc.computedGrounded();
    p.ground = -1; p.groundTag = '';
    const n = this.kcc.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const c = this.kcc.computedCollision(i);
      if (!c || !c.collider) continue;
      const meta = this.meta.get(c.collider.handle);
      if (c.normal1.y > 0.6) { p.ground = c.collider.handle; p.groundTag = meta?.tag || ''; }
      else if (c.normal1.y < -0.6 && p.vel[1] > 0) p.vel[1] = 0;      // head bump
      else if (meta) {
        const hs = Math.hypot(p.vel[0], p.vel[2]);
        if (meta.tag === 'tree' && hs > 1.5 && this.mode === 'authority') this.toyById.get(meta.owner!)?.bump?.(p);
        if (meta.tag === 'bounceWall' && Math.abs(c.normal1.y) < 0.3 && hs > 1) {
          // Wall trampoline: bounce back off it.
          p.vel[0] = c.normal1.x * 7; p.vel[2] = c.normal1.z * 7; p.vel[1] = Math.max(p.vel[1], 6);
          this.emit({ type: 'bounce', p: p.id, toy: meta.owner || '', x: p.pos[0], z: p.pos[2] });
        }
        if (meta.kind === 'prop' && this.mode === 'authority') {
          const pr = this.propById.get(meta.id!);
          if (pr) { pr.lastToucher = p.id; if (pr.def.shape === 'ball') this.kickBall(pr, p, 0.35); }
        }
      }
    }
    if (p.grounded && p.ground < 0) {
      // Grounded by snapping: find the collider below with a short ray.
      const hit = this.world.castRay(new RAPIER.Ray({ x: p.pos[0], y: p.pos[1] + 0.1, z: p.pos[2] }, { x: 0, y: -1, z: 0 }), 0.3, true,
        undefined, undefined, undefined, undefined, c => c.handle !== p.col.handle);
      if (hit) { p.ground = hit.collider.handle; p.groundTag = this.meta.get(hit.collider.handle)?.tag || ''; }
    }
    this.placeKinematic(p);
  }

  stepClimb(p: PlayerSim, f: InputFrame, dt: number, jump: boolean) {
    const toy = this.toyById.get(p.toy);
    if (!toy || !toy.climbStep) { p.mode = 'air'; return; }
    toy.climbStep(p, f, dt, jump);
    this.updateZones(p);
  }
  stepHang(p: PlayerSim, f: InputFrame, dt: number, jump: boolean) {
    const toy = this.toyById.get(p.toy);
    if (!toy || !toy.hangStep) { p.mode = 'air'; return; }
    toy.hangStep(p, f, dt, jump);
  }
  stepFollow(p: PlayerSim, f: InputFrame, dt: number) {
    const lead = this.players.get(p.follow);
    const pressed = (f.b & BTN.jump) && !(p.prevB & BTN.jump);
    if (!lead || pressed) { p.follow = ''; p.mode = 'air'; this.placeKinematic(p); return; }
    // Walk hand in hand: stay at the leader's right side.
    const r: V3 = [Math.cos(lead.yaw), 0, -Math.sin(lead.yaw)];
    const tx = lead.pos[0] - r[0] * 0.75, tz = lead.pos[2] - r[2] * 0.75;
    const dx = tx - p.pos[0], dz = tz - p.pos[2];
    if (Math.hypot(dx, dz) > 3.5) { p.follow = ''; p.mode = 'air'; this.emit({ type: 'letgo', p: p.id }); return; }
    p.vel[1] -= MOVE.gravity * dt;
    const k = Math.min(1, 10 * dt);
    this.moveKcc(p, [dx * k, p.vel[1] * dt, dz * k]);
    if (p.grounded && p.vel[1] < 0) p.vel[1] = 0;
    p.vel[0] = dx * k / dt; p.vel[2] = dz * k / dt;
    p.yaw = turnToward(p.yaw, lead.yaw, 10 * dt);
    this.updateZones(p);
  }

  updateZones(p: PlayerSim) {
    p.speedMul = 1;
    let water = '';
    for (const t of this.toys) {
      if (!t.zoneAt) continue;
      const z = t.zoneAt(p.pos);
      if (!z) continue;
      if (z.speed) p.speedMul = Math.min(p.speedMul, z.speed);
      if (z.water) water = t.id;
    }
    if (water && water !== p.inWater && this.mode === 'authority') this.emit({ type: 'splash', p: p.id, toy: water, x: p.pos[0], z: p.pos[2] });
    p.inWater = water;
  }

  // ---------- interaction ----------
  interactions(p: PlayerSim) {
    const out: { d: number; kind: string; icon: string; run: () => void }[] = [];
    for (const t of this.toys) {
      const it = t.interaction?.(p);
      if (it) out.push({ ...it, run: () => t.interact!(p, it.kind) });
    }
    if (p.carry) out.push({ d: 0, kind: 'throw', icon: '🤾', run: () => this.throwCarry(p) });
    else for (const pr of this.props) {
      const t = pr.body.translation();
      const d = Math.hypot(t.x - p.pos[0], t.z - p.pos[2]);
      const reach = MOVE.reach + pr.def.half[0];
      if (d > reach || Math.abs(t.y - p.pos[1] - 0.5) > 2 || pr.carriedBy) continue;
      const light = pr.def.mass <= 6 && pr.def.tag !== 'giant';
      out.push({ d: d - 0.3, kind: light ? 'pick' : 'push', icon: light ? '🤲' : '👐', run: () => light ? this.pickUp(p, pr) : this.shove(p, pr) });
    }
    for (const o of this.players.values()) {
      if (o === p || o.mode === 'seat' || o.mode === 'slide') continue;
      const d = Math.hypot(o.pos[0] - p.pos[0], o.pos[2] - p.pos[2]);
      if (d < 1.6 && p.mode === 'walk') out.push({ d: d + 0.6, kind: 'hand', icon: '🤝', run: () => this.holdHand(p, o) });
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }
  interact(p: PlayerSim) {
    if (this.interactHook && this.interactHook(p)) return;
    if (p.mode === 'follow') { p.follow = ''; p.mode = 'walk'; this.emit({ type: 'letgo', p: p.id }); return; }
    if (p.mode === 'seat' || p.mode === 'hang' || p.mode === 'climb') { this.release(p); p.vel = [0, 2, 0]; return; }
    if (p.mode === 'claw') { this.toyById.get(p.toy)?.interact?.(p, 'drop'); return; }
    const best = this.interactions(p)[0];
    if (best) best.run();
  }
  holdHand(p: PlayerSim, lead: PlayerSim) {
    if (lead.follow === p.id) lead.follow = '';
    p.follow = lead.id; p.mode = 'follow';
    this.emit({ type: 'hand', p: p.id, other: lead.id });
  }
  kickBall(pr: PropSim, p: PlayerSim, k: number) {
    const t = pr.body.translation();
    const dx = t.x - p.pos[0], dz = t.z - p.pos[2], d = Math.hypot(dx, dz) || 1;
    const hs = Math.hypot(p.vel[0], p.vel[2]);
    const imp = pr.def.mass * (1.5 + hs) * k;
    pr.body.applyImpulse({ x: dx / d * imp, y: pr.def.mass * k * 1.2, z: dz / d * imp }, true);
  }
  shove(p: PlayerSim, pr: PropSim) {
    const fwd = this.forwardOf(p.yaw);
    const imp = pr.def.mass * 3.5;
    pr.body.applyImpulse({ x: fwd[0] * imp, y: pr.def.mass * 1.2, z: fwd[2] * imp }, true);
    pr.lastToucher = p.id;
    this.emit({ type: 'push', p: p.id, prop: pr.def.id });
  }
  pickUp(p: PlayerSim, pr: PropSim) {
    pr.carriedBy = p.id; pr.lastToucher = p.id;
    p.carry = pr.def.id;
    pr.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    pr.col.setCollisionGroups(groups(G.DYNAMIC, 0));
    this.emit({ type: 'pick', p: p.id, prop: pr.def.id });
  }
  holdCarry(pr: PropSim) {
    const p = this.players.get(pr.carriedBy);
    if (!p) { pr.carriedBy = ''; return; }
    const fwd = this.forwardOf(p.yaw);
    const y = p.pos[1] + 1.05 - (pr.def.shape === 'ball' ? pr.def.half[0] : pr.def.offset[1]);
    pr.body.setNextKinematicTranslation({ x: p.pos[0] + fwd[0] * (0.45 + pr.def.half[0]), y, z: p.pos[2] + fwd[2] * (0.45 + pr.def.half[0]) });
  }
  dropCarry(p: PlayerSim, thrown: boolean) {
    const pr = this.propById.get(p.carry);
    p.carry = '';
    if (!pr) return;
    pr.carriedBy = '';
    if (this.mode === 'authority') pr.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    pr.col.setCollisionGroups(groups(G.DYNAMIC, G.STATIC | G.PLAYER | G.DYNAMIC | G.TOY));
    if (!thrown) pr.body.setLinvel({ x: p.vel[0], y: 0, z: p.vel[2] }, true);
  }
  // Put a carried/thrown prop just in front of the player's chest.
  releasePoint(p: PlayerSim, pr: PropSim) {
    const f = this.forwardOf(p.yaw), r = pr.def.half[0];
    pr.body.setTranslation({ x: p.pos[0] + f[0] * (MOVE.radius + r + 0.08), y: p.pos[1] + 1.05 - (pr.def.shape === 'ball' ? r : pr.def.offset[1]), z: p.pos[2] + f[2] * (MOVE.radius + r + 0.08) }, true);
  }
  throwCarry(p: PlayerSim) {
    const pr = this.propById.get(p.carry);
    this.dropCarry(p, true);
    if (!pr) return;
    const fwd = this.forwardOf(p.yaw);
    // Throw toward the nearest player in front, if any, so families can pass the ball.
    let dir = fwd, dist = 7;
    for (const o of this.players.values()) {
      if (o === p) continue;
      const dx = o.pos[0] - p.pos[0], dz = o.pos[2] - p.pos[2], d = Math.hypot(dx, dz);
      if (d > 2 && d < 14 && (dx * fwd[0] + dz * fwd[2]) / d > 0.8) { dir = [dx / d, 0, dz / d]; dist = d; break; }
    }
    p.yaw = Math.atan2(dir[0], dir[2]);
    this.releasePoint(p, pr);
    // Launch at 45°-ish so it lands near `dist`.
    const g = 9.81, v = Math.sqrt(dist * g) * 0.95;
    pr.body.setLinvel({ x: dir[0] * v * 0.72 + p.vel[0] * 0.5, y: v * 0.68, z: dir[2] * v * 0.72 + p.vel[2] * 0.5 }, true);
    pr.lastToucher = p.id;
    this.emit({ type: 'throw', p: p.id, prop: pr.def.id });
  }

  keepPropsInside() {
    const { min, max } = this.def.layout.bounds;
    for (const pr of this.props) {
      if (pr.body.isSleeping() || pr.carriedBy) continue;
      const t = pr.body.translation();
      if (t.y < -3 || t.x < min[0] - 2 || t.x > max[0] + 2 || t.z < min[1] - 2 || t.z > max[1] + 2) this.resetProp(pr);
    }
  }
  resetProp(pr: PropSim, pos?: V3) {
    const p = pos || pr.def.pos;
    pr.body.setTranslation({ x: p[0], y: p[1] + 0.05, z: p[2] }, true);
    pr.body.setRotation(quatY(pr.def.rot), true);
    pr.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    pr.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  emit(e: SimEvent) { if (this.mode === 'authority') this.events.push(e); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ---------- serialisation ----------
  playerState(p: PlayerSim) {
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return {
      id: p.id, p: p.pos.map(r) as V3, v: p.vel.map(r) as V3, yaw: r(p.yaw), mode: p.mode, g: p.grounded ? 1 : 0,
      toy: p.toy, slot: r(p.slot), aux: r(p.aux), carry: p.carry, follow: p.follow, seq: p.lastSeq, prevB: p.prevB
    };
  }
  applyPlayerState(p: PlayerSim, s: ReturnType<Sim['playerState']>) {
    p.pos = [...s.p] as V3; p.vel = [...s.v] as V3; p.yaw = s.yaw; p.mode = s.mode as Mode; p.grounded = !!s.g;
    p.toy = s.toy; p.slot = s.slot; p.aux = s.aux; p.carry = s.carry; p.follow = s.follow; p.prevB = s.prevB;
    this.setSolid(p, PREDICTED_MODES.includes(p.mode) || p.mode === 'follow');
    p.body.setTranslation({ x: p.pos[0], y: p.pos[1] + MOVE.halfHeight + MOVE.radius, z: p.pos[2] }, true);
  }
  propStates(all = false) {
    const out: number[] = [];
    const r = (v: number) => Math.round(v * 1000) / 1000;
    for (const pr of this.props) {
      if (!all && pr.body.isSleeping() && !pr.carriedBy) continue;
      const t = pr.body.translation(), q = pr.body.rotation();
      out.push(pr.index, r(t.x), r(t.y), r(t.z), r(q.x), r(q.y), r(q.z), r(q.w));
    }
    return out;
  }
  applyPropStates(a: number[]) {
    for (let i = 0; i + 7 < a.length + 0; i += 8) {
      const pr = this.props[a[i]];
      if (!pr) continue;
      pr.body.setNextKinematicTranslation({ x: a[i + 1], y: a[i + 2], z: a[i + 3] });
      pr.body.setNextKinematicRotation({ x: a[i + 4], y: a[i + 5], z: a[i + 6], w: a[i + 7] });
    }
  }
  toyStates() {
    const out: Record<string, number[]> = {};
    for (const t of this.toys) { const s = t.state(); if (s) out[t.id] = s.map(v => Math.round(v * 1000) / 1000); }
    return out;
  }
  applyToyStates(s: Record<string, number[]>) {
    for (const id in s) this.toyById.get(id)?.applyState(s[id]);
  }
}

export function turnToward(a: number, b: number, maxStep: number) {
  const d = wrapAngle(b - a);
  return a + clamp(d, -maxStep, maxStep);
}
