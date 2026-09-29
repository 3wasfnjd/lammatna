// Client game: scene, local player, remote players, shared equipment, balls,
// minigame presentation. The room (server or in-page) is the source of truth.
import { Engine, Scene, Vector3, Color3, Color4, HemisphericLight, DirectionalLight, Matrix, ImageProcessingConfiguration } from './babylon.js';
import { Playground } from './world/Playground.js';
import { Balls } from './world/Balls.js';
import { Effects, Shadows } from './world/Effects.js';
import { Avatar } from './characters/Avatar.js';
import { CameraRig } from './camera/CameraRig.js';
import { Controls } from './input/Controls.js';
import { Hud } from './ui/Hud.js';
import { T, arabicDigits } from './ui/strings.js';
import { resultsHtml } from './games/results.js';
import { CHARACTERS, CHARACTER_IDS, MOVEMENT, ANIM_CODE, EMOTES } from '../shared/characters.js';
import { createBody, stepBody } from '../shared/physics.js';
import {
  SWINGS, SLIDE, slidePoint, swingAngle, SWING_FRAME, BASKETS, PADS, RACE, BALL_PIT, DECK_Y, STAGE,
  inBallPit, inFoamPit, raceStartSlot, BALL_COLORS, spawnPoint
} from '../shared/playground.js';
import { STATE_SEND_MS } from '../shared/protocol.js';

const EMOTE_TIME = 2.2;

export class Game {
  constructor(canvas, uiRoot, { quality = 'high', audio }) {
    this.canvas = canvas;
    this.quality = quality;
    this.audio = audio;
    this.engine = new Engine(canvas, quality !== 'low', { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance', audioEngine: false }, false);
    this.baseScaling = 1 / Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1.5 : 2);
    this.engine.setHardwareScalingLevel(this.baseScaling);
    const scene = this.scene = new Scene(this.engine);
    scene.clearColor = Color4.FromHexString('#FFE7C7FF');
    scene.ambientColor = new Color3(0.3, 0.25, 0.2);
    scene.skipPointerMovePicking = true;
    scene.autoClear = true;
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL ?? ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.05; ip.contrast = 1.12;
    ip.vignetteEnabled = true; ip.vignetteWeight = 1.6; ip.vignetteColor = new Color4(0.55, 0.3, 0.25, 0);

    const hemi = new HemisphericLight('sky', new Vector3(0.2, 1, -0.3), scene);
    hemi.diffuse = Color3.FromHexString('#FFF4E0'); hemi.groundColor = Color3.FromHexString('#E8A98A'); hemi.intensity = 0.78;
    hemi.specular = new Color3(0.2, 0.2, 0.2);
    const sun = new DirectionalLight('sun', new Vector3(-0.35, -1, -0.55).normalize(), scene);
    sun.diffuse = Color3.FromHexString('#FFD9A0'); sun.intensity = 0.95; sun.specular = new Color3(0.5, 0.45, 0.4);
    this.shadows = new Shadows(scene, sun, quality);

    this.playground = new Playground(scene, { quality });
    this.kit = this.playground.kit;
    this.balls = new Balls(scene, this.kit, this.shadows);
    this.effects = new Effects(scene);
    this.rig = new CameraRig(scene, canvas);
    this.hud = new Hud(uiRoot);
    this.controls = new Controls(uiRoot, {
      onInteract: () => this.interact(),
      onEmote: e => this.doEmote(e),
      onJump: () => this.audio.unlock()
    });
    this.controls.show(false);

    this.avatars = new Map();
    this.previews = [];
    this.me = null;
    this.world = null;
    this.body = createBody(0, 0, -3);
    this.yaw = 0;
    this.timeOffset = 0;
    this.lastSend = 0;
    this.time = 0;
    this.localAnim = 'idle';
    this.emote = null;
    this.ride = null;
    this.respawnPoint = null;
    this.pendingCp = -1;
    this.lastActivityKey = '';
    this.stepTimer = 0;

    this.characters = CHARACTERS; // exposed for testing model swaps from the console
    this.showPreview(true);
    window.addEventListener('resize', () => { this.engine.resize(); this.rig.resize(canvas); });
    this.engine.runRenderLoop(() => this.frame());
    this.adaptTimer = setInterval(() => this.adaptResolution(), 2500);
  }

  // ---- networking ------------------------------------------------------------------
  attach(transport) {
    this.transport = transport;
    transport.onMessage(msg => this.onMessage(msg));
  }

  send(msg) {
    if (msg.type !== 'state' && msg.type !== 'join' && this.local) {
      const p = this.local.root.position;
      msg.p = [round(p.x), round(p.y), round(p.z)];
    }
    this.transport?.send(msg);
  }
  serverNow() { return Date.now() + this.timeOffset; }

  onMessage(msg) {
    if (Number.isFinite(msg.t)) {
      const off = msg.t - Date.now();
      this.timeOffset = this.hasOffset ? this.timeOffset * 0.9 + off * 0.1 : off;
      this.hasOffset = true;
    }
    switch (msg.type) {
      case 'welcome': this.me = msg.you; this.code = msg.code; this.onWelcome?.(msg); break;
      case 'world': this.onWorld(msg); break;
      case 'snap': this.onSnap(msg); break;
      case 'event': this.onEvent(msg); break;
      case 'error': this.onError(msg); break;
    }
  }

  onWorld(w) {
    const prev = this.world;
    this.world = w;
    const mine = w.players.find(p => p.id === this.me);
    this.onWorldHook?.(w, mine);
    // Avatars follow the roster; a disconnected player's avatar is hidden, never duplicated.
    for (const p of w.players) {
      if (!p.character) continue;
      let av = this.avatars.get(p.id);
      if (av && av.characterId !== p.character) { av.dispose(); this.avatars.delete(p.id); av = null; }
      if (!av) {
        av = new Avatar(this.scene, this.kit, { playerId: p.id, characterId: p.character, local: p.id === this.me, shadows: this.shadows });
        this.avatars.set(p.id, av);
        if (p.id === this.me) this.spawnLocal(av);
      }
      av.setVisible(p.connected);
    }
    for (const [id, av] of this.avatars) {
      if (!w.players.some(p => p.id === id && p.character)) { av.dispose(); this.avatars.delete(id); this.hud.removeLabel(id); }
    }
    this.balls.sync(w.balls);
    this.hud.setRoster(w.players, this.me);
    this.syncActivity(prev);
  }

  onSnap(msg) {
    for (const [id, x, y, z, yaw, anim] of msg.p) {
      if (id === this.me) continue;
      this.avatars.get(id)?.pushSnapshot(msg.t, x, y, z, yaw, anim);
    }
  }

  onEvent(e) {
    const av = this.avatars.get(e.id);
    const near = av ? this.volumeAt(av.position) : 1;
    switch (e.kind) {
      case 'emote':
        if (e.id !== this.me && av) { av.emote = { name: e.e, until: this.time + EMOTE_TIME }; this.hud.bubble(e.id, EMOTES.find(x => x.id === e.e)?.icon); this.audio.play(e.e, { volume: near }); }
        break;
      case 'pickup': this.audio.play('pickup', { volume: near }); break;
      case 'drop': this.audio.play('drop', { volume: near }); break;
      case 'deliver': {
        this.audio.play('deliver', { volume: Math.max(0.6, near) });
        const b = BASKETS.find(k => k.id === e.basket);
        if (b) this.effects.confetti(new Vector3(b.x, 1, b.z), { count: 60, duration: 0.3, spread: 0.8 });
        break;
      }
      case 'pass': {
        const from = this.avatars.get(e.from);
        if (from) this.balls.startPass(e.ball, from.carryAnchor.getAbsolutePosition());
        this.audio.play('pass');
        break;
      }
      case 'cp': if (e.id === this.me) { this.audio.play('checkpoint'); this.pendingCp = -1; } break;
      case 'finish': {
        const name = CHARACTERS[this.world?.players.find(p => p.id === e.id)?.character]?.name || '';
        this.hud.toast(`🏁 ${name} — ${T.place(e.place)}`);
        if (e.id === this.me) { this.doEmote('celebrate', true); this.audio.play('complete'); }
        if (av) this.effects.confetti(av.position.add(new Vector3(0, 1, 0)), { count: 90, duration: 0.4, spread: 1.2 });
        break;
      }
      case 'joined': if (e.id !== this.me) { this.audio.play('join'); this.hud.toast(`${CHARACTERS[e.character].name} ${T.joined} 👋`); } break;
      case 'away': if (e.id !== this.me && av) this.hud.toast(`${av.def.name}: ${T.away}`); break;
      case 'back': if (e.id !== this.me && av) this.hud.toast(`${av.def.name} ${T.backOnline} 👋`); break;
    }
  }

  onError(e) {
    if (e.code === 'taken') this.onTaken?.();
    if (e.code === 'far') return;
    this.audio.play('wrong');
    this.hud.toast(T.errors[e.code] || e.code);
  }

  volumeAt(p) {
    const d = Math.hypot(p.x - this.body.x, p.z - this.body.z);
    return Math.max(0.15, 1 - d / 25);
  }

  // ---- character preview (selection screen) ---------------------------------------
  showPreview(on) {
    for (const p of this.previews) p.dispose();
    this.previews = [];
    this.previewMode = on;
    if (!on) return;
    CHARACTER_IDS.forEach((id, i) => {
      const av = new Avatar(this.scene, this.kit, { playerId: `preview-${id}`, characterId: id, shadows: this.shadows });
      const a = Math.PI / 2 + (i - 2) * 0.5;
      av.root.position.set(Math.cos(a) * 1.7, STAGE.h, -Math.sin(a) * 1.7 + 0.6);
      av.yaw = Math.PI + (i - 2) * 0.25;
      av.emote = null;
      this.previews.push(av);
    });
  }

  highlightPreview(id) {
    for (const av of this.previews) if (av.characterId === id) { av.setAnim('celebrate'); av.emote = { name: 'celebrate', until: this.time + 1.5 }; }
  }

  // ---- local player -------------------------------------------------------------------
  spawnLocal(av) {
    this.local = av;
    const p = this.snapPosition(this.me);
    this.body = createBody(p.x, p.y, p.z);
    this.yaw = 0;
    this.rig.yaw = 0;
    this.rig.jumpTo();
    this.showPreview(false);
    this.controls.show(true);
    this.onLocalSpawn?.();
  }

  snapPosition(id) {
    return spawnPoint(id % 5);
  }

  teleport(t) {
    this.body = createBody(t.x, t.y || 0, t.z);
    this.yaw = t.yaw ?? this.yaw;
    this.rig.yaw = this.yaw;
    this.rig.jumpTo();
  }

  // The ride this player is on, ignoring one already left locally but not yet confirmed.
  myEquipment() {
    if (!this.world) return null;
    for (const [id, e] of Object.entries(this.world.equipment)) {
      if (!e || e.occupant !== this.me) continue;
      if (this.leftRide && this.leftRide.id === id && this.leftRide.since === e.since) return null;
      return { id, ...e };
    }
    return null;
  }

  isLocked() {
    const a = this.world?.activity;
    if (!a) return false;
    if (a.type === 'celebrate') return true;
    return (a.phase === 'intro' || a.phase === 'countdown') && a.participants.includes(this.me);
  }

  updateLocal(dt) {
    const av = this.local;
    if (!av) return;
    const look = this.controls.consumeLook();
    this.rig.applyLook(look.dx, look.dy);
    const eq = this.myEquipment();
    const locked = this.isLocked();
    this.controls.enabled = !locked;
    let jump = this.controls.consumeJump();

    if (eq && eq.id.startsWith('swing')) {
      const s = SWINGS.find(x => x.id === eq.id);
      const secs = Math.max(0, (this.serverNow() - eq.since) / 1000), ang = swingAngle(secs);
      const seat = this.swingSeat(s, ang);
      this.body.x = seat.x; this.body.y = seat.y; this.body.z = seat.z;
      this.yaw = 0; av.yaw = 0;
      av.root.position.set(seat.x, seat.y, seat.z);
      av.setAnim('swing'); av.swingValue = ang;
      if (Math.abs(ang) > 0.5 && Math.sign(ang) !== this.lastSwingSign) { this.lastSwingSign = Math.sign(ang); this.audio.play('swing'); }
      const side = s.x < SWING_FRAME.x ? -1 : 1;
      this.rig.setFocus({ position: new Vector3(s.x + side * 4.2, 3.1, s.z - 5.2), target: new Vector3(s.x, 1.5, s.z + ang * 1.2) });
      this.ride = eq;
      this.rig.follow(dt, av.root.position, null, false, av.def.look.height);
      if (jump || this.controls.moveVector().y < -0.8) this.leaveSwing(s);
      return;
    }
    if (eq && eq.id === SLIDE.id) {
      const t = (this.serverNow() - eq.since) / 1000 / SLIDE.duration;
      const k = Math.max(0, Math.min(1, t)), p = slidePoint(k), q = slidePoint(Math.min(1, k + 0.03));
      av.root.position.set(p.x, p.y + 0.05, p.z);
      this.yaw = Math.atan2(q.x - p.x, q.z - p.z) || Math.PI; av.yaw = this.yaw;
      av.setAnim('slide');
      if (!this.ride || this.ride.id !== SLIDE.id) this.audio.play('slide');
      this.ride = eq;
      this.rig.setFocus({ position: new Vector3(p.x + 5, p.y + 2.4, p.z - 1.5), target: new Vector3(p.x, p.y + 0.8, p.z - 1) });
      this.rig.follow(dt, av.root.position, null, false, av.def.look.height);
      if (t >= 1) this.finishSlide();
      return;
    }
    if (this.ride && this.ride.id === SLIDE.id) this.finishSlide();
    this.ride = null;
    const celebrating = this.world?.activity?.type === 'celebrate';
    this.rig.setFocus(celebrating ? { position: new Vector3(0, 2.2, -6.2), target: new Vector3(0, 1.1, 0) } : null);

    const mv = this.controls.moveVector();
    const f = this.rig.forward();
    const wx = f.z * mv.x + f.x * mv.y, wz = -f.x * mv.x + f.z * mv.y;
    if (locked) jump = false;
    const wasGrounded = this.body.grounded;
    stepBody(this.body, { x: locked ? 0 : wx, z: locked ? 0 : wz, jump }, dt);
    if (jump && wasGrounded && !this.body.grounded) this.audio.play('jump');
    if (this.body.landed > 0.3) { this.audio.play('land', { volume: this.body.landed }); this.landTime = this.time; }
    const speed = Math.hypot(this.body.vx, this.body.vz);
    if (speed > 0.4) {
      const target = Math.atan2(this.body.vx, this.body.vz);
      let d = target - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 12);
    }
    // Safety: never lose the player outside the hall.
    if (this.body.y < -3) this.teleport({ x: 0, y: 0, z: -3 });

    const carrying = this.carrying();
    let anim;
    if (!this.body.grounded) anim = this.body.vy > 0 ? 'jump' : 'fall';
    else if (this.time - (this.landTime || -9) < 0.2) anim = 'land';
    else if (speed > 3.6) anim = carrying ? 'carryWalk' : 'run';
    else if (speed > 0.3) anim = carrying ? 'carryWalk' : 'walk';
    else if (this.emote && this.time < this.emote.until) anim = this.emote.name;
    else anim = carrying ? 'carry' : 'idle';
    if (speed > 0.3 && this.emote) this.emote = null;
    av.setAnim(anim);
    av.speed = speed;
    av.yaw = this.yaw;
    const sink = inBallPit(this.body.x, this.body.z) && this.body.y < 0.2 ? -0.28 : 0;
    av.root.position.set(this.body.x, this.body.y + sink, this.body.z);
    if (this.body.grounded && speed > 0.5) {
      this.stepTimer -= dt * (speed / 2.6);
      if (this.stepTimer <= 0) { this.stepTimer = 0.36; this.audio.play('step', { volume: 0.8 }); }
    }
    if (sink && speed > 1 && this.time - (this.lastSplash || 0) > 0.5) {
      this.lastSplash = this.time; this.effects.splash(new Vector3(this.body.x, 0.3, this.body.z));
    }
    this.rig.follow(dt, av.root.position, speed > 0.5 ? this.yaw : null, speed > 0.5 && mv.y > -0.3, av.def.look.height);
    this.raceLogic();
  }

  swingSeat(s, ang) {
    const r = SWING_FRAME.rope;
    return { x: s.x, y: SWING_FRAME.pivotY - Math.cos(ang) * r + 0.06, z: s.z + Math.sin(ang) * r };
  }

  leaveSwing(s) {
    const eq = this.myEquipment();
    if (eq) this.leftRide = { id: eq.id, since: eq.since };
    this.send({ type: 'release', id: s.id });
    this.teleport({ x: s.x, y: 0, z: s.z - 1.2, yaw: Math.PI });
    this.audio.play('jump');
  }

  finishSlide() {
    const e = SLIDE.end;
    const eq = this.myEquipment();
    if (eq && eq.id === SLIDE.id) { this.leftRide = { id: eq.id, since: eq.since }; this.send({ type: 'release', id: SLIDE.id }); }
    this.body = createBody(e.x, 0, e.z - 0.4);
    this.body.vz = -2;
    this.ride = null;
    this.audio.play('splash');
    this.effects.splash(new Vector3(e.x, 0.3, e.z));
    this.rig.setFocus(null);
    const a = this.world?.activity;
    if (a?.type === 'race' && a.phase === 'play' && a.data.progress[this.me] >= RACE.checkpoints.length) this.send({ type: 'race', op: 'finish' });
  }

  carrying() {
    return this.world?.players.find(p => p.id === this.me)?.carrying || null;
  }

  // ---- race (client side: checkpoints, respawn) --------------------------------------
  raceLogic() {
    const a = this.world?.activity;
    const racing = a?.type === 'race' && a.phase === 'play' && a.participants.includes(this.me);
    this.playground.showRoute(a?.type === 'race' && a.phase !== 'results', racing ? a.data.progress[this.me] : -2);
    if (!racing) return;
    const next = a.data.progress[this.me];
    if (next > RACE.checkpoints.length) return; // finished
    const b = this.body;
    if (next < RACE.checkpoints.length && (this.pendingCp !== next || this.time - this.pendingAt > 1)) {
      const cp = RACE.checkpoints[next];
      const high = cp.y ? b.y > cp.y - 0.4 : true;
      if (high && Math.hypot(b.x - cp.x, b.z - cp.z) < cp.r) {
        this.pendingCp = next; this.pendingAt = this.time;
        this.respawnPoint = { x: cp.x, y: cp.y || 0, z: cp.z, yaw: this.yaw };
        this.send({ type: 'race', op: 'cp', i: next });
      }
    }
    if (next >= RACE.checkpoints.length && inBallPit(b.x, b.z) && b.grounded && this.time - (this.finishSentAt || -9) > 1) {
      this.finishSentAt = this.time;
      this.send({ type: 'race', op: 'finish' });
    }
    // Forgiving falls: the foam pit or dropping off the tower sends you back.
    const fell = (inFoamPit(b.x, b.z) && b.y < 0.1 && b.grounded) ||
      (next >= 6 && next <= RACE.checkpoints.length && b.y < 1.2 && b.grounded && !inBallPit(b.x, b.z));
    if (fell) {
      const r = this.respawnPoint || raceStartSlot(0);
      this.hud.fade(true);
      setTimeout(() => this.hud.fade(false), 350);
      this.teleport(r);
      this.audio.play('drop');
    }
  }

  // ---- interactions -------------------------------------------------------------------
  reach() { return this.world?.assist ? MOVEMENT.assistReach : MOVEMENT.reach; }

  findAction() {
    if (!this.local || !this.world) return null;
    const b = this.body, r = this.reach();
    const eq = this.myEquipment();
    if (eq?.id.startsWith('swing')) return { label: T.getOff, icon: '⬇️', color: '#2BB5B0', run: () => this.leaveSwing(SWINGS.find(s => s.id === eq.id)) };
    if (eq) return null;
    const a = this.world.activity;
    if (this.isLocked()) return null;
    const d = (x, z) => Math.hypot(b.x - x, b.z - z);
    const carrying = this.carrying();
    if (carrying) {
      const ball = this.balls.get(carrying);
      const basket = BASKETS.find(k => k.id === ball?.color && d(k.x, k.z) < r + 0.7 + (this.world.assist ? 0.6 : 0));
      if (basket) return { label: T.put, icon: '🧺', color: BALL_COLORS.find(c => c.id === basket.id).color, run: () => this.send({ type: 'ball', op: 'deliver', basket: basket.id }) };
      // Pass to the closest free teammate within reach, favouring the one in front.
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      let best = null, bestScore = Infinity;
      for (const p of this.world.players) {
        if (p.id === this.me || !p.connected || p.carrying || p.equipment || !p.character) continue;
        const av = this.avatars.get(p.id); if (!av) continue;
        const dx = av.position.x - b.x, dz = av.position.z - b.z, dist = Math.hypot(dx, dz);
        if (dist > r + 5.5) continue;
        const facing = (dx * fx + dz * fz) / (dist || 1);
        const score = dist - facing * 2.5;
        if (score < bestScore) { bestScore = score; best = p; }
      }
      if (best) {
        const name = CHARACTERS[best.character].name;
        return { label: `${T.passTo} ${name}`, icon: '🤾', color: CHARACTERS[best.character].badgeColor, run: () => this.send({ type: 'ball', op: 'pass', to: best.id }) };
      }
      return { label: T.drop, icon: '⬇️', color: '#9C6BD1', run: () => this.send({ type: 'ball', op: 'drop', x: b.x + Math.sin(this.yaw) * 0.7, z: b.z + Math.cos(this.yaw) * 0.7 }) };
    }
    // Nearest free ball.
    let ball = null, bd = r;
    for (const x of this.balls.list()) {
      if (x.holder || x.done) continue;
      const dist = d(x.x, x.z);
      if (dist < bd && b.y < 1) { bd = dist; ball = x; }
    }
    if (ball) return { label: T.pickUp, icon: '✋', color: BALL_COLORS.find(c => c.id === ball.color)?.color, run: () => this.send({ type: 'ball', op: 'pickup', id: ball.id }) };
    for (const s of SWINGS) {
      if (d(s.x, s.z) < r + 0.3 && b.y < 1 && !this.world.equipment[s.id]) {
        return { label: T.ride, icon: '🪢', color: '#2BB5B0', run: () => this.send({ type: 'occupy', id: s.id }) };
      }
    }
    const e = SLIDE.entrance;
    if (d(e.x, e.z) < r + 0.3 && b.y > DECK_Y - 0.5) {
      const racing = a?.type === 'race' && a.phase === 'play' && a.participants.includes(this.me);
      const free = !this.world.equipment[SLIDE.id];
      if (free && (!racing || a.data.progress[this.me] >= RACE.checkpoints.length)) {
        return { label: T.slide, icon: '🛝', color: '#F7BE2F', run: () => this.send({ type: 'occupy', id: SLIDE.id }) };
      }
    }
    if (!a) {
      for (const pad of PADS) {
        if (d(pad.x, pad.z) < 1.3) return { label: `${T.start} ${pad.name}`, icon: pad.icon, color: pad.color, run: () => this.send({ type: 'start', activity: pad.id }) };
      }
    }
    return null;
  }

  interact() {
    this.audio.unlock();
    const action = this.currentAction;
    if (!action) return;
    this.audio.play('tap');
    action.run();
  }

  doEmote(e, silentSend = false) {
    this.audio.unlock();
    if (!this.local || this.myEquipment()) return;
    this.emote = { name: e, until: this.time + EMOTE_TIME };
    this.local.setAnim(e);
    this.hud.bubble(this.me, EMOTES.find(x => x.id === e)?.icon);
    this.audio.play(e);
    if (!silentSend) this.send({ type: 'emote', e });
  }

  // ---- minigame presentation -------------------------------------------------------------
  syncActivity(prev) {
    const a = this.world.activity;
    const key = a ? `${a.seq}:${a.phase}` : '';
    if (key === this.lastActivityKey) return;
    this.lastActivityKey = key;
    this.hud.showDemo(null);
    this.hud.showResults(null);
    if (this.local) this.controls.show(a?.type !== 'celebrate');
    if (!a) { this.hud.setActivityHud(null); this.hud.showCountdown(null); this.balls.showSymbols = false; this.respawnPoint = null; return; }
    this.balls.showSymbols = a.type === 'rescue';
    if (a.teleport && a.teleport[this.me] && (a.phase === 'intro' || a.type === 'celebrate')) {
      this.teleport(a.teleport[this.me]);
      this.respawnPoint = { ...a.teleport[this.me] };
      this.pendingCp = -1;
    }
    if (a.phase === 'intro') this.hud.showDemo(a.type);
    if (a.phase === 'play') { this.hud.showCountdown(T.go); this.audio.play('go'); setTimeout(() => this.hud.showCountdown(null), 900); }
    if (a.phase === 'results') {
      this.hud.showResults(resultsHtml(a, this.world.players, this.me), a.type === 'celebrate');
      const success = a.type !== 'rescue' || a.data.results?.success;
      this.audio.play(a.type === 'celebrate' ? 'celebrate' : success ? 'complete' : 'wrong');
      const where = a.type === 'celebrate' ? new Vector3(0, 0.5, 0) : new Vector3(this.body.x, this.body.y + 0.5, this.body.z);
      if (success) this.effects.confetti(where, { count: a.type === 'celebrate' ? 420 : 220, duration: a.type === 'celebrate' ? 3 : 1.2, spread: 4 });
      if (a.type === 'celebrate') this.doEmote('celebrate');
    }
  }

  updateActivityHud() {
    const a = this.world?.activity;
    if (!a) return;
    const left = (a.phaseEnd - this.serverNow()) / 1000;
    if (a.phase === 'countdown') {
      const n = Math.ceil(left);
      if (n !== this.lastCountN && n > 0) { this.lastCountN = n; this.audio.play('count'); }
      this.hud.showCountdown(n > 0 ? arabicDigits(n) : null);
    } else this.lastCountN = null;
    if (a.phase === 'intro' || a.phase === 'countdown') {
      this.hud.setActivityHud({ title: T[a.type], timer: null });
      return;
    }
    if (a.phase === 'play') {
      if (a.type === 'race') {
        const next = a.data.progress[this.me] ?? 0, total = RACE.checkpoints.length + 1;
        const done = a.data.finished.length;
        this.hud.setActivityHud({ title: `🏁 ${T.race}`, timer: left, progress: Math.min(1, next / total), progressText: next > RACE.checkpoints.length ? T.finished : `${arabicDigits(Math.min(next, total))} / ${arabicDigits(total)}${done ? `  🏁${arabicDigits(done)}` : ''}` });
      } else {
        this.hud.setActivityHud({ title: `🧺 ${T.rescueGoal}`, timer: left, progress: a.data.delivered / a.data.target, progressText: `${arabicDigits(a.data.delivered)} / ${arabicDigits(a.data.target)}` });
      }
    } else if (a.phase === 'results') {
      this.hud.setActivityHud(null);
    }
  }

  // ---- frame ----------------------------------------------------------------------------
  frame() {
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000 || 0.016);
    this.time += dt;
    this.playground.update(this.time);
    if (this.previewMode) {
      this.rig.setFocus({ position: new Vector3(0, 2.3, -5.6), target: new Vector3(0, 1.0, 0.6) });
      this.rig.follow(dt, new Vector3(0, 0, 0), null, false);
      for (const av of this.previews) {
        if (av.emote && this.time > av.emote.until) { av.emote = null; av.setAnim('idle'); }
        av.update(dt);
      }
    }
    this.updateLocal(dt);
    this.updateRemotes(dt);
    this.updateSwings();
    this.balls.update(dt, this.time, id => {
      const av = this.avatars.get(id);
      return av && av.visible ? av.carryAnchor.getAbsolutePosition() : null;
    });
    if (this.local) {
      this.local.update(dt, { swing: this.local.swingValue || 0 });
      this.shadows.follow(this.body.x, this.body.z);
      this.playground.setRoofFade(this.local.root.position.y > DECK_Y - 0.5);
      const lp = this.local.root.position, cp = this.rig.camera.position;
      this.playground.setArchFade((lp.z > 1.2 && lp.z < 9 && Math.abs(lp.x) < 5 && cp.z < 2.3) || (cp.z > 2.3 && lp.z < 2.3 && Math.abs(lp.x) < 5));
      this.playground.updateSigns(this.rig.camera);
      const action = this.findAction();
      this.currentAction = action;
      this.controls.setInteract(action);
      const now = performance.now();
      if (now - this.lastSend > STATE_SEND_MS) {
        this.lastSend = now;
        const p = this.local.root.position;
        this.send({ type: 'state', p: [round(p.x), round(p.y), round(p.z)], r: round(this.local.yaw), a: ANIM_CODE[this.local.anim] ?? 0 });
      }
      this.updateActivityHud();
    }
    this.updateLabels();
    this.scene.render();
  }

  updateRemotes(dt) {
    const renderTime = this.serverNow() - 140;
    for (const [id, av] of this.avatars) {
      if (id === this.me) continue;
      const ride = this.world && Object.entries(this.world.equipment).find(([, e]) => e && e.occupant === id);
      if (ride) {
        const [eqId, e] = ride;
        if (eqId === SLIDE.id) {
          const k = Math.min(1, (this.serverNow() - e.since) / 1000 / SLIDE.duration), p = slidePoint(k), q = slidePoint(Math.min(1, k + 0.03));
          av.root.position.set(p.x, p.y + 0.05, p.z); av.yaw = Math.atan2(q.x - p.x, q.z - p.z); av.setAnim('slide');
        } else {
          const s = SWINGS.find(x => x.id === eqId), ang = swingAngle(Math.max(0, (this.serverNow() - e.since) / 1000)), seat = this.swingSeat(s, ang);
          av.root.position.set(seat.x, seat.y, seat.z); av.yaw = 0; av.setAnim('swing'); av.swingValue = ang;
        }
        av.buffer.length = 0;
      } else {
        av.interpolate(renderTime);
        if (av.emote && this.time < av.emote.until && av.speed < 0.3) av.setAnim(av.emote.name);
        const p = av.root.position;
        if (inBallPit(p.x, p.z) && p.y < 0.2) p.y -= 0.28;
        if (av.speed > 0.6 && av.anim !== 'jump' && av.anim !== 'fall') this.audio.play('step', { id, volume: this.volumeAt(p) * 0.5 });
      }
      av.update(dt, { swing: av.swingValue || 0 });
    }
  }

  updateSwings() {
    for (const s of SWINGS) {
      const e = this.world?.equipment[s.id];
      const ang = e ? swingAngle(Math.max(0, (this.serverNow() - e.since) / 1000)) : 0;
      const sw = this.playground.swings.get(s.id);
      // Empty swings settle gently.
      sw.angle = e ? ang : sw.angle * 0.96;
      this.playground.setSwingAngle(s.id, sw.angle);
    }
  }

  updateLabels() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const view = this.rig.camera.getViewMatrix(), proj = this.rig.camera.getProjectionMatrix();
    const vp = view.multiply(proj);
    for (const [id, av] of this.avatars) {
      const def = av.def;
      const label = this.hud.label(id, id === this.me ? '' : def.name, def.badgeColor);
      const head = av.root.position.add(new Vector3(0, def.look.height + 0.45, 0));
      const inView = Vector3.TransformCoordinates(head, view);
      if (!av.visible || inView.z <= 0.2) { label.style.display = 'none'; continue; }
      const ndc = Vector3.TransformCoordinates(head, vp);
      label.style.display = '';
      label.classList.toggle('self', id === this.me);
      label.style.transform = `translate(${((ndc.x + 1) / 2 * w).toFixed(1)}px, ${((1 - ndc.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  adaptResolution() {
    const fps = this.engine.getFps();
    const level = this.engine.getHardwareScalingLevel();
    if (fps < 42 && level < 1.25) this.engine.setHardwareScalingLevel(Math.min(1.25, level + 0.15));
    else if (fps > 58 && level > this.baseScaling + 0.01) this.engine.setHardwareScalingLevel(Math.max(this.baseScaling, level - 0.08));
  }
}

function round(v) { return Math.round(v * 100) / 100; }
export { Matrix };
