// Client side of the Aboden arcade games: basketball (hold-and-release power
// meter), the shooting gallery (aim by dragging, fire) and colour war (throw
// paint at the other team). The room judges every shot; this presents it.
import {
  Mesh, Vector3, Quaternion, Color3, StandardMaterial, DynamicTexture, TransformNode,
  CreateSphere, CreateCylinder, CreateDisc, CreateTorus
} from '../babylon.js';
import { CHARACTERS, MOVEMENT } from '../../shared/characters.js';
import { HOOPS, PALETTE } from '../../shared/playground.js';
import {
  HOOP, nearestHoop, idealPower, meterValue, GALLERY_TARGETS, targetPos, PAINT, TEAM_COLORS, TEAM_NAMES
} from '../../shared/games/arcade.js';
import { T, arabicDigits } from '../ui/strings.js';

const TYPES = ['hoops', 'gallery', 'paint'];

export class Arcade {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.kit = game.kit;
    this.type = null;
    this.flights = [];
    this.tracers = [];
    this.paintBuffer = [];
    this.buildTargets();
    this.buildBallPool();
    this.buildPaintPools();
    this.buildDom();
  }

  get world() { return this.game.world; }
  get me() { return this.game.me; }

  // ---- DOM: crosshair and power meter ---------------------------------------------------
  buildDom() {
    const root = this.game.hud.root;
    this.crosshair = document.createElement('div');
    this.crosshair.className = 'crosshair hidden';
    root.appendChild(this.crosshair);
    this.meter = document.createElement('div');
    this.meter.className = 'power-meter hidden';
    this.meter.innerHTML = '<div class="zone"></div><div class="needle"></div>';
    root.appendChild(this.meter);
  }

  // ---- shooting gallery targets (always on display, animated) -------------------------------
  buildTargets() {
    const k = this.kit, s = this.scene;
    this.targets = new Map();
    const canMats = [k.mat('#D8DDE6', { gloss: 0.8 }), k.mat(PALETTE.coral, { gloss: 0.5 })];
    for (const t of GALLERY_TARGETS) {
      const root = new TransformNode(`t-${t.id}`, s);
      if (t.kind === 'can') {
        const can = CreateCylinder('can', { diameter: 0.3, height: 0.4, tessellation: 14 }, s);
        can.material = canMats[0]; can.parent = root; can.position.y = 0.2;
        const band = CreateCylinder('canband', { diameter: 0.31, height: 0.16, tessellation: 14 }, s);
        band.material = canMats[1]; band.parent = root; band.position.y = 0.2;
        root.position.set(t.x, t.y - 0.2, t.z);
      } else if (t.kind === 'duck') {
        const body = k.roundedBox('duckbody', 0.5, 0.32, 0.26, 0.08, k.mat(PALETTE.yellow, { gloss: 0.5, emissive: 0.2 }));
        body.parent = root; body.position.y = 0.1;
        const head = k.roundedBox('duckhead', 0.24, 0.24, 0.22, 0.06, k.mat(PALETTE.yellow, { gloss: 0.5, emissive: 0.2 }));
        head.parent = root; head.position.set(0.16, 0.36, 0);
        const beak = k.roundedBox('beak', 0.14, 0.07, 0.12, 0.02, k.mat('#FF8A2B'));
        beak.parent = root; beak.position.set(0.32, 0.34, 0);
        const eye = k.roundedBox('duckeye', 0.04, 0.05, 0.23, 0.01, k.mat('#1E1A24'));
        eye.parent = root; eye.position.set(0.2, 0.41, 0);
        root.position.set(12, t.y - 0.25, t.z);
      } else {
        const rings = [[0.9, '#FFFFFF'], [0.66, PALETTE.coral], [0.42, '#FFFFFF'], [0.3, PALETTE.coral]];
        for (const [i, [d, c]] of rings.entries()) {
          const disc = CreateDisc('ring', { radius: d / 2, tessellation: 28 }, s);
          disc.material = k.mat(c, { emissive: 0.35 }); disc.parent = root; disc.position.z = -0.01 * i;
        }
        const back = CreateCylinder('boardback', { diameter: 0.95, height: 0.06, tessellation: 28 }, s);
        back.rotation.x = Math.PI / 2; back.parent = root; back.position.z = 0.04; back.material = k.mat('#8A5A3B');
        root.position.set(t.x, t.y, t.z);
      }
      root.getChildMeshes().forEach(m => { m.isPickable = false; });
      this.targets.set(t.id, { def: t, root, fold: 0 });
    }
  }

  // ---- basketballs ------------------------------------------------------------------------------
  buildBallPool() {
    const tex = new DynamicTexture('bball-tex', { width: 128, height: 64 }, this.scene, true);
    const ctx = tex.getContext();
    ctx.fillStyle = '#F07A2A'; ctx.fillRect(0, 0, 128, 64);
    ctx.strokeStyle = '#3A1E10'; ctx.lineWidth = 3;
    for (const x of [32, 64, 96]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 64); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, 32); ctx.lineTo(128, 32); ctx.stroke();
    tex.update();
    const mat = new StandardMaterial('bball', this.scene);
    mat.diffuseTexture = tex; mat.specularColor = new Color3(0.2, 0.2, 0.2); mat.emissiveColor = new Color3(0.15, 0.08, 0.04);
    this.balls = Array.from({ length: 8 }, (_, i) => {
      const m = CreateSphere(`bball${i}`, { diameter: 0.3, segments: 12 }, this.scene);
      m.material = mat; m.isPickable = false; m.setEnabled(false);
      m.rotationQuaternion = Quaternion.Identity();
      return m;
    });
  }

  // ---- paint balls, splats, robots, team rings ---------------------------------------------------
  buildPaintPools() {
    const s = this.scene;
    this.teamMat = {
      A: this.kit.mat(TEAM_COLORS.A, { emissive: 0.45, gloss: 0.6, name: 'teamA' }),
      B: this.kit.mat(TEAM_COLORS.B, { emissive: 0.45, gloss: 0.6, name: 'teamB' })
    };
    this.paintBalls = Array.from({ length: 40 }, (_, i) => {
      const m = CreateSphere(`paint${i}`, { diameter: 0.24, segments: 8 }, s);
      m.isPickable = false; m.setEnabled(false);
      return m;
    });
    const splatTex = new DynamicTexture('splat-tex', { width: 128, height: 128 }, s, true);
    const ctx = splatTex.getContext();
    ctx.clearRect(0, 0, 128, 128); ctx.fillStyle = '#fff';
    const blob = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
    blob(64, 64, 34);
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; blob(64 + Math.cos(a) * 42, 64 + Math.sin(a) * 42, 6 + (i % 3) * 5); }
    splatTex.update(); splatTex.hasAlpha = true;
    this.splatMat = {};
    for (const team of ['A', 'B']) {
      const m = new StandardMaterial(`splat${team}`, s);
      m.diffuseTexture = splatTex; m.useAlphaFromDiffuseTexture = true;
      m.diffuseColor = Color3.FromHexString(TEAM_COLORS[team]); m.emissiveColor = Color3.FromHexString(TEAM_COLORS[team]).scale(0.4);
      m.specularColor = new Color3(0.3, 0.3, 0.3); m.backFaceCulling = false; m.zOffset = -2;
      this.splatMat[team] = m;
    }
    this.splats = Array.from({ length: 40 }, (_, i) => {
      const d = CreateDisc(`splat${i}`, { radius: 0.55, tessellation: 12 }, s);
      d.rotation.x = Math.PI / 2; d.isPickable = false; d.setEnabled(false);
      return d;
    });
    this.bots = new Map();
    this.rings = new Map();
    this.stains = new Map();
  }

  makeBot(id, team) {
    const k = this.kit, root = new TransformNode(`bot-${id}`, this.scene);
    const body = k.roundedBox('botbody', 0.7, 0.8, 0.5, 0.08, k.mat('#E9ECF2', { gloss: 0.5 }));
    body.parent = root; body.position.y = 0.55;
    const head = k.roundedBox('bothead', 0.55, 0.42, 0.45, 0.08, k.mat('#E9ECF2', { gloss: 0.5 }));
    head.parent = root; head.position.y = 1.18;
    const visor = k.roundedBox('visor', 0.45, 0.16, 0.05, 0.02, this.teamMat[team]);
    visor.parent = root; visor.position.set(0, 1.2, 0.23);
    const chest = k.roundedBox('chest', 0.5, 0.2, 0.05, 0.02, this.teamMat[team]);
    chest.parent = root; chest.position.set(0, 0.62, 0.26);
    for (const side of [-1, 1]) {
      const wheel = CreateCylinder('wheel', { diameter: 0.3, height: 0.14, tessellation: 12 }, this.scene);
      wheel.rotation.z = Math.PI / 2; wheel.parent = root; wheel.position.set(side * 0.32, 0.15, 0); wheel.material = k.mat('#2E2A3A');
    }
    root.getChildMeshes().forEach(m => { m.isPickable = false; this.game.shadows.addMesh(m); });
    return { root, team, x: 0, z: 0, frozen: false };
  }

  // ---- lifecycle --------------------------------------------------------------------------------
  sync(a) {
    const type = a && TYPES.includes(a.type) ? a.type : null;
    if (type !== this.type || (a && a.seq !== this.seq)) {
      this.clear();
      this.type = type;
      this.seq = a?.seq;
      if (type === 'gallery') { this.aimYaw = 0; this.aimPitch = 0.12; }
    }
    if (type === 'paint') this.syncPaint(a);
  }

  clear() {
    for (const b of this.bots.values()) b.root.dispose();
    this.bots.clear();
    for (const r of this.rings.values()) r.dispose();
    this.rings.clear();
    for (const st of this.stains.values()) st.mesh.dispose();
    this.stains.clear();
    for (const m of this.paintBalls) m.setEnabled(false);
    for (const m of this.splats) m.setEnabled(false);
    this.paintBuffer = [];
    this.crosshair.classList.add('hidden');
    this.meter.classList.add('hidden');
    this.charging = null;
  }

  syncPaint(a) {
    const d = a.data;
    // Team rings under every family member.
    for (const [id, team] of Object.entries(d.teams)) {
      const av = this.game.avatars.get(Number(id));
      if (!av || this.rings.has(Number(id))) continue;
      const ring = CreateTorus(`ring-${id}`, { diameter: 0.9, thickness: 0.08, tessellation: 24 }, this.scene);
      ring.material = this.teamMat[team]; ring.parent = av.root; ring.position.y = 0.05; ring.isPickable = false;
      this.game.atmosphere?.addGlow(ring);
      this.rings.set(Number(id), ring);
    }
    for (const [i, m] of this.splats.entries()) {
      const sp = d.splats[i];
      m.setEnabled(!!sp);
      if (sp) { m.position.set(sp[0], Math.max(0.03, sp[1] < 0.3 ? 0.03 : sp[1]), sp[2]); m.material = this.splatMat[sp[3]]; m.rotation.x = sp[1] < 0.3 ? Math.PI / 2 : 0; }
    }
  }

  // ---- hooks used by Game -----------------------------------------------------------------------
  locked(a) { return a?.type === 'paint' && a.phase === 'play' && (a.data.frozen[this.me] || 0) > this.game.serverNow(); }
  pinned(a) { return a?.type === 'gallery' && a.phase === 'play' && a.participants.includes(this.me); }
  holding() { return false; }
  hideLabel() { return false; }
  sinkFor() { return 0; }
  collide() {}

  // Drag-to-aim while standing at the gallery counter.
  look(dx, dy) {
    if (!this.pinned(this.world?.activity)) return false;
    this.aimYaw = Math.max(-1.05, Math.min(1.05, this.aimYaw + dx * 0.0032));
    this.aimPitch = Math.max(-0.2, Math.min(0.6, this.aimPitch - dy * 0.0032));
    return true;
  }

  onSnap(msg) {
    if (this.type === 'paint' && msg.g?.b) {
      this.paintBuffer.push({ t: msg.t, b: msg.g.b, r: msg.g.r });
      if (this.paintBuffer.length > 12) this.paintBuffer.shift();
    }
  }

  action() {
    const a = this.world?.activity, g = this.game;
    if (!a || a.phase !== 'play' || !TYPES.includes(a.type) || !a.participants.includes(this.me)) return null;
    if (a.type === 'gallery') return { label: T.fire, icon: '🎯', color: PALETTE.coral, run: () => this.fire() };
    if (a.type === 'paint') {
      const team = a.data.teams[this.me];
      return { label: T.throwPaint, icon: '🎨', color: TEAM_COLORS[team], run: () => this.throwPaint() };
    }
    if (a.type === 'hoops') {
      const { dist } = nearestHoop(g.body.x, g.body.z);
      if (dist < HOOP.minDist || dist > HOOP.maxDist) return { label: T.getCloser, icon: '🏀', color: '#9C6BD1', run: () => {} };
      return { label: this.charging ? T.release : T.shoot, icon: '🏀', color: '#F07A2A', hold: true, run: () => this.startCharge(), end: () => this.releaseShot() };
    }
    return null;
  }

  // ---- basketball ------------------------------------------------------------------------------
  startCharge() {
    if (this.charging || this.game.time - (this.lastShot || -9) < 0.9) return;
    this.charging = { start: this.game.time };
    this.game.audio.play('tap');
  }

  releaseShot() {
    if (!this.charging) return;
    const power = meterValue(this.game.time - this.charging.start);
    this.charging = null;
    this.lastShot = this.game.time;
    this.game.send({ type: 'game', op: 'shoot', power: Math.round(power * 1000) / 1000 });
    this.game.local?.setAnim('celebrate');
  }

  animateShot(e) {
    const hoop = HOOPS.find(h => h.id === e.hoop);
    const ball = this.balls.find(b => !b.isEnabled()) || this.balls[0];
    const from = new Vector3(...e.from), rim = new Vector3(hoop.x, hoop.rimY + 0.15, hoop.z);
    let end;
    if (e.result === 'swish' || e.result === 'rim-in') end = rim.clone();
    else if (e.result === 'rim-out') end = rim.add(new Vector3((Math.random() - 0.5) * 0.4, 0.05, 0.2));
    else {
      const short = e.power < idealPower(Math.hypot(from.x - hoop.x, from.z - hoop.z));
      end = rim.add(new Vector3((Math.random() - 0.5) * 0.8, -0.4, short ? 1.2 : -0.35));
    }
    ball.setEnabled(true);
    this.flights.push({ ball, from, end, t: 0, dur: e.flight, result: e.result, hoop, after: 0, id: e.id, pts: e.pts, streak: e.streak });
  }

  updateFlights(dt) {
    this.flights = this.flights.filter(f => {
      if (f.t < 1) {
        f.t = Math.min(1, f.t + dt / f.dur);
        const p = Vector3.Lerp(f.from, f.end, f.t);
        p.y += Math.sin(f.t * Math.PI) * (1.6 + Vector3.Distance(f.from, f.end) * 0.25);
        f.ball.position.copyFrom(p);
        f.ball.rotationQuaternion = Quaternion.RotationAxis(Vector3.Right(), -dt * 12).multiply(f.ball.rotationQuaternion);
        if (f.t >= 1) this.landed(f);
        return true;
      }
      // After the rim: drop through the net, bounce away, or roll on the floor.
      f.after += dt;
      const b = f.ball.position;
      if (!f.vel) f.vel = f.result === 'swish' || f.result === 'rim-in' ? new Vector3(0, -2.5, 0.3) : new Vector3((Math.random() - 0.5) * 2, 1.8, 2.2);
      f.vel.y -= 9.8 * dt;
      b.addInPlace(f.vel.scale(dt));
      if (b.y < 0.15) { b.y = 0.15; f.vel.y = Math.abs(f.vel.y) * 0.55; f.vel.x *= 0.8; f.vel.z *= 0.8; }
      if (f.after > 1.6) { f.ball.setEnabled(false); return false; }
      return true;
    });
  }

  landed(f) {
    const g = this.game, mine = f.id === this.me;
    if (f.result === 'swish' || f.result === 'rim-in') {
      g.audio.play('swish');
      g.effects.sparkle(new Vector3(f.hoop.x, f.hoop.rimY, f.hoop.z), { count: 20, colors: ['#FFB347', '#FFFFFF'] });
      if (mine) g.hud.toast(`+${arabicDigits(f.pts)}${f.streak >= 3 ? ' 🔥' : ''}`, 900);
    } else {
      g.audio.play('rim');
      if (mine && f.result === 'miss') g.hud.toast(T.missed, 700);
    }
  }

  updateMeter(a) {
    const show = a?.type === 'hoops' && a.phase === 'play' && a.participants.includes(this.me);
    this.meter.classList.toggle('hidden', !show);
    if (!show) return;
    const { dist } = nearestHoop(this.game.body.x, this.game.body.z);
    const ideal = idealPower(Math.max(HOOP.minDist, Math.min(HOOP.maxDist, dist))), tol = this.world.assist ? 0.09 : 0.055;
    const zone = this.meter.firstChild;
    zone.style.left = `${(ideal - tol) * 100}%`; zone.style.width = `${tol * 200}%`;
    const v = this.charging ? meterValue(this.game.time - this.charging.start) : 0;
    this.meter.lastChild.style.left = `${v * 100}%`;
    this.meter.classList.toggle('three', dist >= HOOP.threePoint);
  }

  // ---- shooting gallery --------------------------------------------------------------------------
  aimRay() {
    const cam = this.game.rig.camera;
    const dir = cam.getDirection(Vector3.Forward());
    return { o: cam.position.clone(), d: dir.normalize() };
  }

  fire() {
    if (this.game.time - (this.lastFire || -9) < 0.32) return;
    this.lastFire = this.game.time;
    const { o, d } = this.aimRay();
    // Gentle aim help: bend the ray toward a target that is very close to the crosshair.
    if (this.world.assist) {
      const secs = (this.game.serverNow() - this.world.activity.phaseStart) / 1000;
      let best = null, bestAng = 0.07;
      for (const t of GALLERY_TARGETS) {
        const c = targetPos(t, secs), v = new Vector3(c.x - o.x, c.y - o.y, c.z - o.z).normalize();
        const ang = Math.acos(Math.min(1, Vector3.Dot(v, d)));
        if (ang < bestAng) { bestAng = ang; best = v; }
      }
      if (best) d.copyFrom(best);
    }
    this.game.send({ type: 'game', op: 'fire', o: [round(o.x), round(o.y), round(o.z)], d: [round(d.x, 4), round(d.y, 4), round(d.z, 4)] });
    this.game.audio.play('shoot');
    this.crosshair.classList.remove('kick'); void this.crosshair.offsetWidth; this.crosshair.classList.add('kick');
  }

  updateGallery(dt, time, a) {
    const playing = a?.type === 'gallery' && a.phase !== 'results';
    const secs = playing && a.phase === 'play' ? (this.game.serverNow() - a.phaseStart) / 1000 : time;
    const now = this.game.serverNow();
    for (const [id, t] of this.targets) {
      const p = targetPos(t.def, secs);
      if (t.def.kind === 'duck') { t.root.position.x = p.x; t.root.scaling.x = p.dir; }
      const down = playing && (a.data.down?.[id] || 0) > now;
      t.fold += ((down ? 1 : 0) - t.fold) * Math.min(1, dt * 12);
      t.root.rotation.x = t.fold * (t.def.kind === 'board' ? 1.3 : 1.45);
    }
    const aiming = this.pinned(a);
    this.crosshair.classList.toggle('hidden', !aiming);
    // First-person aim: the camera sits at eye height and follows the aim exactly.
    const local = this.game.local;
    if (local) local.visual.root.setEnabled(!aiming);
    if (aiming) {
      const b = this.game.body, eye = new Vector3(b.x, b.y + 1.6, b.z - 0.1);
      const dir = new Vector3(Math.sin(this.aimYaw) * Math.cos(this.aimPitch), Math.sin(this.aimPitch), Math.cos(this.aimYaw) * Math.cos(this.aimPitch));
      const rig = this.game.rig;
      rig.setFocus({ position: eye, target: eye.add(dir.scale(10)) });
      rig.focusBlend = 1; rig.snap = true;
      rig.lookAt = eye.add(dir.scale(10));
      this.game.yaw = this.aimYaw;
    }
    this.tracers = this.tracers.filter(tr => {
      tr.t += dt;
      tr.mesh.visibility = Math.max(0, 1 - tr.t / 0.25);
      if (tr.t > 0.25) { tr.mesh.dispose(); return false; }
      return true;
    });
  }

  tracer(o, d, dist) {
    const len = Math.min(dist, 14), mid = new Vector3(o[0] + d[0] * len / 2, o[1] + d[1] * len / 2, o[2] + d[2] * len / 2);
    const m = CreateCylinder('tracer', { diameter: 0.035, height: len, tessellation: 6 }, this.scene);
    m.material = this.tracerMat || (this.tracerMat = this.kit.mat('#FFF1A8', { emissive: 1, name: 'tracer' }));
    m.position.copyFrom(mid);
    const dir = new Vector3(...d), up = Vector3.Up(), axis = Vector3.Cross(up, dir), ang = Math.acos(Math.min(1, Vector3.Dot(up, dir)));
    if (axis.length() > 1e-6) m.rotationQuaternion = Quaternion.RotationAxis(axis.normalize(), ang);
    m.isPickable = false;
    this.tracers.push({ mesh: m, t: 0 });
  }

  // ---- colour war ---------------------------------------------------------------------------------
  throwPaint() {
    const g = this.game, a = this.world.activity;
    if (g.time - (this.lastThrow || -9) < PAINT.cooldown) return;
    this.lastThrow = g.time;
    const team = a.data.teams[this.me], b = g.body;
    const fx = Math.sin(g.yaw), fz = Math.cos(g.yaw);
    // Aim help: nearest opponent in front, else straight ahead.
    let best = null, bestScore = Infinity;
    // Lead moving targets by where they will be when the ball arrives.
    const consider = (x0, z0, vx = 0, vz = 0) => {
      const t = Math.hypot(x0 - b.x, z0 - b.z) / PAINT.speed + 0.12;
      const x = x0 + vx * t, z = z0 + vz * t;
      const dx = x - b.x, dz = z - b.z, dist = Math.hypot(dx, dz);
      if (dist > PAINT.range || dist < 0.3) return;
      const facing = (dx * fx + dz * fz) / dist;
      if (facing < 0.35) return;
      const score = dist * (1.6 - facing);
      if (score < bestScore) { bestScore = score; best = { dx, dz }; }
    };
    for (const [id, t] of Object.entries(a.data.teams)) {
      if (t === team) continue;
      const av = g.avatars.get(Number(id));
      if (!av?.visible) continue;
      const buf = av.buffer, n = buf.length;
      const v = n >= 2 && buf[n - 1].t > buf[n - 2].t ? [(buf[n - 1].x - buf[n - 2].x) / ((buf[n - 1].t - buf[n - 2].t) / 1000), (buf[n - 1].z - buf[n - 2].z) / ((buf[n - 1].t - buf[n - 2].t) / 1000)] : [0, 0];
      consider(av.position.x, av.position.z, v[0], v[1]);
    }
    for (const bot of this.bots.values()) if (bot.team !== team && !bot.frozen) consider(bot.root.position.x, bot.root.position.z, bot.vx || 0, bot.vz || 0);
    const dir = best || { dx: fx, dz: fz };
    if (best) g.yaw = Math.atan2(best.dx, best.dz);
    g.send({ type: 'game', op: 'throw', dx: round(dir.dx, 3), dz: round(dir.dz, 3) });
    g.audio.play('pass');
    g.local?.setAnim('wave');
  }

  updatePaint(dt, a) {
    if (a?.type !== 'paint') return;
    const rt = this.game.serverNow() - 110, buf = this.paintBuffer;
    while (buf.length > 2 && buf[1].t <= rt) buf.shift();
    const p0 = buf[0], p1 = buf[1] || buf[0];
    const k = !p0 || p1.t === p0.t ? 1 : Math.max(0, Math.min(1.3, (rt - p0.t) / (p1.t - p0.t)));
    const prev = new Map((p0?.b || []).map(x => [x[0], x]));
    const list = p1?.b || [];
    this.paintBalls.forEach((m, i) => {
      const cur = list[i];
      m.setEnabled(!!cur);
      if (!cur) return;
      const old = prev.get(cur[0]) || cur;
      m.position.set(old[1] + (cur[1] - old[1]) * k, old[2] + (cur[2] - old[2]) * k, old[3] + (cur[3] - old[3]) * k);
      m.material = this.teamMat[cur[4]];
    });
    // Robots.
    const botsPrev = new Map((p0?.r || []).map(x => [x[0], x]));
    for (const r of p1?.r || []) {
      let bot = this.bots.get(r[0]);
      if (!bot) { bot = this.makeBot(r[0], r[3]); this.bots.set(r[0], bot); }
      const o = botsPrev.get(r[0]) || r;
      const x = o[1] + (r[1] - o[1]) * k, z = o[2] + (r[2] - o[2]) * k;
      const pos = bot.root.position;
      if (dt > 0) { bot.vx = (x - pos.x) / dt; bot.vz = (z - pos.z) / dt; }
      if (Math.hypot(x - pos.x, z - pos.z) > 0.01) bot.root.rotation.y = Math.atan2(x - pos.x, z - pos.z);
      bot.frozen = !!r[4];
      pos.set(x + (bot.frozen ? Math.sin(this.game.time * 40) * 0.03 : 0), 0, z);
    }
    // Paint stains fade away.
    for (const [id, st] of this.stains) {
      st.t -= dt;
      if (st.t <= 0) { st.mesh.dispose(); this.stains.delete(id); }
    }
  }

  stain(targetId, team) {
    const av = this.game.avatars.get(targetId);
    const bot = this.bots.get(targetId);
    const parent = av?.root || bot?.root;
    if (!parent) return;
    this.stains.get(targetId)?.mesh.dispose();
    const blob = new TransformNode('stain', this.scene);
    blob.parent = parent;
    const h = av ? av.height : 1.2;
    for (let i = 0; i < 5; i++) {
      const s = CreateSphere('stainblob', { diameter: 0.16 + Math.random() * 0.14, segments: 6 }, this.scene);
      s.material = this.teamMat[team]; s.parent = blob; s.isPickable = false;
      s.position.set((Math.random() - 0.5) * 0.4, h * (0.35 + Math.random() * 0.45), 0.18 + Math.random() * 0.06);
      s.scaling.z = 0.4;
    }
    this.stains.set(targetId, { mesh: blob, t: PAINT.freeze + 0.8 });
  }

  // ---- events and HUD ----------------------------------------------------------------------------
  onEvent(e) {
    const g = this.game;
    switch (e.kind) {
      case 'shot': this.animateShot(e); if (e.id !== this.me) g.audio.play('tap', { volume: 0.5 }); break;
      case 'fire': {
        this.tracer(e.o, e.d, e.dist);
        if (e.id !== this.me) g.audio.play('shoot', { volume: 0.4 });
        if (e.target) {
          g.audio.play('ding');
          const t = this.targets.get(e.target);
          if (t) g.effects.sparkle(t.root.getAbsolutePosition().add(new Vector3(0, 0.2, 0)), { count: 16 });
          if (e.id === this.me) g.hud.toast(`+${arabicDigits(e.pts)}`, 700);
        }
        break;
      }
      case 'splat': {
        g.audio.play('splat');
        g.effects.sparkle(new Vector3(e.x, e.y, e.z), { count: 22, spread: 0.2, colors: [TEAM_COLORS[e.team], '#FFFFFF'] });
        this.stain(typeof e.target === 'number' ? e.target : e.target, e.team);
        if (e.target === this.me) g.hud.toast(T.painted, 1200);
        else if (e.by === this.me) g.hud.toast(`${T.hit} 🎯`, 700);
        break;
      }
    }
  }

  hud(a, left) {
    if (a.type === 'hoops') {
      const score = a.data.scores[this.me] || 0, streak = a.data.streak?.[this.me] || 0;
      return { title: `🏀 ${T.hoops} — ⭐ ${arabicDigits(score)}${streak >= 2 ? ` 🔥${arabicDigits(streak)}` : ''}`, timer: left };
    }
    if (a.type === 'gallery') {
      return { title: `🦆 ${T.gallery} — ⭐ ${arabicDigits(a.data.scores[this.me] || 0)}`, timer: left };
    }
    if (a.type === 'paint') {
      const { A, B } = a.data.score, team = a.data.teams[this.me];
      return { title: `🎨 ${TEAM_NAMES[team] || T.paint}`, timer: left, swatch: TEAM_COLORS[team], progress: A + B ? A / (A + B) : 0.5, progressText: `${arabicDigits(A)} — ${arabicDigits(B)}` };
    }
    return null;
  }

  update(dt, time) {
    const a = this.world?.activity;
    this.updateFlights(dt);
    this.updateGallery(dt, time, a);
    if (!this.type) return;
    this.updateMeter(a);
    this.updatePaint(dt, a);
  }
}

function round(v, d = 2) { const k = 10 ** d; return Math.round(v * k) / k; }
export { CHARACTERS, MOVEMENT, Mesh };
