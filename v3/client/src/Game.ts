// The running game: Babylon scene, world, avatars, camera, input, sounds and
// effects, all driven by a NetClient (solo room in the page, or a server room).
import {
  Engine, Scene, HemisphericLight, DirectionalLight, ShadowGenerator, Vector3, Color3, Color4, type AbstractMesh
} from './babylon';
import { Assets } from './world/assets';
import { WorldView } from './world/WorldView';
import { Markers } from './world/Markers';
import { Avatar } from './avatar/Avatar';
import { FollowCam } from './input/FollowCam';
import { Input } from './input/Input';
import { Hud } from './ui/Hud';
import { Sfx } from './audio/Sfx';
import { Fx } from './fx/Fx';
import { runChallenge } from './ui/Challenge';
import { toast } from './ui/Screens';
import type { NetClient } from './net/NetClient';
import { Sim, PREDICTED_MODES } from '../../shared/sim';
import { initPhysics } from '../../shared/rapier';
import { worldDef } from '../../shared/worldData';
import { SIM_DT, EMOJIS, CHARACTERS, type CharacterId } from '../../shared/constants';
import * as T from '../../shared/toys';

export class Game {
  canvas: HTMLCanvasElement;
  engine: Engine;
  scene: Scene;
  assets: Assets;
  sim!: Sim;
  world!: WorldView;
  markers!: Markers;
  net: NetClient | null = null;
  cam: FollowCam;
  input!: Input;
  hud!: Hud;
  sfx = new Sfx();
  fx: Fx;
  avatars = new Map<string, Avatar>();
  sun: DirectionalLight;
  shadows: ShadowGenerator;
  hallReady: Promise<void>;
  gardenLoading: Promise<void> | null = null;
  time = 0;
  acc = 0;
  guided = false;
  busy = false;          // a mini-challenge overlay is open
  lastFoot = new Map<string, [number, number]>();
  debug = new URLSearchParams(location.search).has('debug');
  fps = 60;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: this.debug, stencil: false, antialias: true, powerPreference: 'high-performance' }, false);
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
    const s = this.scene = new Scene(this.engine);
    s.useRightHandedSystem = true;
    s.clearColor = new Color4(0.72, 0.87, 0.98, 1);
    s.ambientColor = new Color3(0.4, 0.4, 0.4);
    s.fogMode = Scene.FOGMODE_EXP2; s.fogDensity = 0.006; s.fogColor = new Color3(0.8, 0.9, 0.98);
    s.skipPointerMovePicking = true;
    s.autoClearDepthAndStencil = true;
    const hemi = new HemisphericLight('sky', new Vector3(0.2, 1, 0.1), s);
    hemi.intensity = 0.85; hemi.groundColor = new Color3(0.55, 0.45, 0.4);
    this.sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.35), s);
    this.sun.intensity = 0.75;
    this.sun.autoUpdateExtends = false; this.sun.autoCalcShadowZBounds = false;
    this.sun.orthoLeft = -16; this.sun.orthoRight = 16; this.sun.orthoTop = 16; this.sun.orthoBottom = -16;
    this.sun.shadowMinZ = 1; this.sun.shadowMaxZ = 80;
    this.shadows = new ShadowGenerator(1024, this.sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.bias = 0.004;
    this.shadows.darkness = 0.35;
    this.assets = new Assets(s);
    this.cam = new FollowCam(s);
    this.fx = new Fx(s);
    this.hallReady = this.prepare();
    this.engine.runRenderLoop(() => this.frame());
    window.addEventListener('resize', () => this.engine.resize());
  }

  // Build the mirror world and load the hall while the menus are open.
  async prepare() {
    await initPhysics();
    this.sim = new Sim(worldDef(), 'mirror');
    this.world = new WorldView(this.scene, this.assets, this.sim.def, { sim: this.sim, propViews: () => new Map() } as any);
    this.markers = new Markers(this.scene, this.sim.def.layout);
    // Behind the menus: a calm overview of the hall towards the garden gate.
    this.markers.update(0, 1000, 1000, [], [], '');
    this.cam.yaw = 0; this.cam.pitch = 0.55; this.cam.dist = 30; this.cam.cur = 30;
    this.cam.update(0.1, this.sim, 0, 0, 0, [0, 0], null);
    await this.world.loadStage('hall', f => this.onProgress(f));
  }
  onProgress: (f: number) => void = () => { };

  async begin(net: NetClient) {
    this.net = net;
    this.world.net = net;
    this.sfx.zones = this.sim.def.layout.zones.map(z => ({ id: z.id, center: z.center, sound: z.sound }));
    const ui = document.getElementById('ui')!;
    this.hud = new Hud();
    this.input = new Input(ui, this.canvas, this.hud.jump, this.hud.act);
    this.input.onAnyInput = () => this.sfx.unlock();
    this.hud.onEmoji = i => { net.sendEmoji(i); this.sfx.unlock(); };
    net.onEvent = e => this.onEvent(e);
    net.onInfo = () => this.syncAvatars();
    this.syncAvatars();
    try { this.guided = localStorage.getItem('lm3-guided') === '1'; } catch { this.guided = false; }
    this.markers.showGuide(!this.guided);
    const me = net.me;
    if (me) { this.cam.yaw = me.yaw; this.cam.pitch = 0.38; this.cam.dist = 6.5; this.cam.cur = 6.5; this.cam.target.setAll(0); }
    // Stage two: the garden streams in while you play.
    this.gardenLoading = this.world.loadStage('garden', () => { });
    this.exposeDebug();
  }

  syncAvatars() {
    const net = this.net!;
    const ids = new Set(net.players.map(p => p.id));
    for (const [id, a] of this.avatars) if (!ids.has(id)) { a.dispose(); this.avatars.delete(id); }
    for (const p of net.players) {
      const a = this.avatars.get(p.id);
      if (a && a.look.char === p.look.char && a.look.color === p.look.color && a.look.acc === p.look.acc) continue;
      a?.dispose();
      const av = new Avatar(this.scene, this.assets, p.look, p.color);
      av.ready.then(() => { for (const m of av.meshes) this.shadows.addShadowCaster(m, false); });
      this.avatars.set(p.id, av);
    }
    const mine = net.players.find(p => p.id === net.myId);
    this.hud.setRoom(net.code, net.solo, net.players, net.myId);
    if (mine) this.hud.setStars(mine.stars.length, this.sim.def.layout.stars.length, mine.tickets);
  }

  frame() {
    const dt = Math.min(0.1, this.engine.getDeltaTime() / 1000);
    this.time += dt;
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    const net = this.net;
    if (net && this.world) {
      // Fixed 60 Hz simulation steps with the current input.
      this.acc += dt;
      let n = 0;
      while (this.acc >= SIM_DT && n < 5) {
        this.acc -= SIM_DT; n++;
        const [jx, jy] = this.busy ? [0, 0] : this.input.stick();
        const [mx, mz] = this.cam.toWorld(jx, jy);
        net.step(mx, mz, this.busy ? 0 : this.input.buttons());
      }
      if (n === 5) this.acc = 0;
      this.updateActors(dt);
    }
    if (this.world) this.world.update(dt, this.time);
    this.fx.update(dt);
    this.scene.render();
  }

  updateActors(dt: number) {
    const net = this.net!;
    const me = net.me;
    const views = net.remoteViews();
    let myPos: [number, number, number] = [0, 0, -14];
    for (const v of views) {
      const av = this.avatars.get(v.id);
      if (!av) continue;
      let pos = v.pos, yaw = v.yaw, mode = v.mode, vel = v.vel, grounded = v.grounded, carry = v.carry;
      if (v.id === net.myId && me && PREDICTED_MODES.includes(me.mode)) {
        const o = net.visualOffset;
        pos = [me.pos[0] + o[0], me.pos[1] + o[1], me.pos[2] + o[2]]; yaw = me.yaw; mode = me.mode; vel = me.vel; grounded = me.grounded; carry = me.carry;
      }
      av.place(pos[0], pos[1], pos[2], yaw);
      av.pose(mode, vel, grounded, !!carry, this.time);
      av.tick(this.time);
      if (v.id === net.myId) myPos = pos;
      this.footprints(v.id, pos, yaw);
    }
    // Camera, ears, markers.
    const [jx, jy] = this.input.stick();
    const moving = Math.hypot(jx, jy) > 0.3 && me && (me.mode === 'walk' || me.mode === 'air');
    this.cam.update(dt, net.sim, myPos[0], myPos[1], myPos[2], this.input.takeDrag(), moving ? Math.atan2(...this.cam.toWorld(jx, jy)) : null);
    this.sfx.update(myPos[0], myPos[2], this.time);
    const mine = net.players.find(p => p.id === net.myId);
    this.markers.update(this.time, myPos[0], myPos[2], mine?.stars || [], net.games, net.myId);
    this.sun.position.set(myPos[0] + 18, 40, myPos[2] - 14);
    this.sun.setDirectionToTarget(new Vector3(myPos[0], 0, myPos[2]));
    if (Math.floor(this.time * 2) !== Math.floor((this.time - dt) * 2)) this.updateShadowCasters(myPos);
    // The interact button appears only when something nearby can be used.
    let icon: string | null = null, at: [number, number, number] | null = null;
    if (me && !this.busy) {
      if (me.mode === 'walk' || me.mode === 'air') {
        const best = net.sim.interactions(me)[0];
        if (best) { icon = best.icon; at = best.at as any; }
      } else if (me.mode === 'claw') icon = '⬇️';
      else if (['seat', 'hang', 'climb', 'follow'].includes(me.mode)) icon = '↩️';
    }
    this.hud.setAct(icon);
    this.world.showHalo(at, this.time);
    const g = net.games.find(x => (x.phase === 'running' || x.phase === 'result') && x.players.includes(net.myId)) || net.games.find(x => x.phase === 'running');
    this.hud.setGame(g, net.myId, net.players);
  }

  updateShadowCasters(p: [number, number, number]) {
    const near = (m: AbstractMesh) => Vector3.DistanceSquared(m.getAbsolutePosition(), new Vector3(p[0], p[1], p[2])) < 11 * 11;
    const list = this.shadows.getShadowMap()!.renderList!;
    const avatarMeshes = new Set<AbstractMesh>();
    for (const a of this.avatars.values()) for (const m of a.meshes) avatarMeshes.add(m);
    list.length = 0;
    for (const m of avatarMeshes) list.push(m);
    for (const m of this.world.shadowCasters) if (near(m)) list.push(m);
  }

  footprints(id: string, pos: number[], yaw: number) {
    const last = this.lastFoot.get(id);
    if (last && Math.hypot(pos[0] - last[0], pos[2] - last[1]) < 0.45) return;
    this.lastFoot.set(id, [pos[0], pos[2]]);
    if (!last || pos[1] > 0.3) return;
    for (const t of this.sim.toys) if (t instanceof T.ZoneToy && t.type === 'sandbox' && t.inside(pos as any)) { this.fx.footprint(pos[0], pos[2], yaw); break; }
  }

  onEvent(e: any) {
    const net = this.net!;
    const mine = e.p === net.myId;
    const toy = e.toy ? this.sim.toyById.get(e.toy) : undefined;
    const c = toy?.center();
    const near = (x?: number, z?: number) => {
      const me = net.me; if (!me || x == null || z == null) return true;
      return Math.hypot(me.pos[0] - x, me.pos[2] - z) < 22;
    };
    switch (e.type) {
      case 'bounce':
        if (near(e.x, e.z)) this.sfx.play('bounce');
        this.world.bounce(e.toy, this.time);
        if (mine && !this.guided) { this.guided = true; this.markers.showGuide(false); try { localStorage.setItem('lm3-guided', '1'); } catch { /* ignore */ } this.sfx.play('laugh'); }
        break;
      case 'jump': if (mine) this.sfx.play('jump'); break;
      case 'splash': if (near(e.x, e.z)) { this.sfx.play('splash'); this.fx.burst('splash', e.x ?? c?.[0], 0.2, e.z ?? c?.[2]); } break;
      case 'shake': if (c && near(c[0], c[2])) { this.sfx.play('shake'); this.fx.burst('leaf', c[0], 0, c[2], 12); } this.world.shake(e.toy, this.time); break;
      case 'whoosh': this.sfx.play('whoosh'); break;
      case 'land': this.sfx.play('land'); if (mine) this.sfx.play('laugh'); break;
      case 'sit': case 'grab': this.sfx.play('grab'); break;
      case 'push': case 'spin': this.sfx.play(toy instanceof T.SwingToy ? 'creak' : 'push'); if (Math.random() < 0.3) this.sfx.play('laugh'); break;
      case 'boing': this.sfx.play('boing'); break;
      case 'door': if (c && near(c[0], c[2])) this.sfx.play('door'); break;
      case 'dig': this.sfx.play('dig'); if (net.me && mine) this.fx.burst('sand', net.me.pos[0], 0, net.me.pos[2], 10); break;
      case 'ballsplash': this.sfx.play('pop'); if (c) this.fx.burst('balls', e.x ?? c[0], 0.3, e.z ?? c[2], 16); break;
      case 'throw': case 'pick': this.sfx.play('throw'); break;
      case 'hand': this.sfx.play('hand'); break;
      case 'star': if (mine) { this.sfx.play('star'); const s = this.sim.def.layout.stars[e.i]; this.fx.burst('spark', s[0], s[1] - 0.5, s[2], 16); } break;
      case 'emoji': { const a = this.avatars.get(e.p); a?.emoji(EMOJIS[e.e], this.time); this.sfx.play(e.e === 0 ? 'laugh' : 'pop'); break; }
      case 'score': case 'goal': this.sfx.play(e.type); if (c) this.fx.burst('confetti', c[0], 1.5, c[2], 18); break;
      case 'prize': if (mine || !e.p) { this.sfx.play('win'); if (c) this.fx.burst('confetti', c[0], 1, c[2], 20); } break;
      case 'miss': if (mine) this.sfx.play('miss'); break;
      case 'win': case 'chime': if (mine) this.sfx.play(e.type); break;
      case 'challenge':
        if (mine && !this.busy) {
          this.busy = true;
          runChallenge(e.kind, this.input, s => this.sfx.play(s)).then(ok => { this.busy = false; net.sendChallenge(e.toy, ok); if (ok && c) this.fx.burst('confetti', c[0], 1.5, c[2], 16); });
        }
        break;
      case 'countdown': this.sfx.play('beep'); break;
      case 'gameStart': this.sfx.play('whistle'); if (e.players?.includes(net.myId)) toast('🏁'); break;
      case 'whistle': this.sfx.play('whistle'); break;
      case 'checkpoint': case 'rescued': if (mine) this.sfx.play('chime'); break;
      case 'finish': if (mine) { this.sfx.play('win'); toast(e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : '🥉'); } break;
      case 'out': if (mine) { this.sfx.play('miss'); toast('💨'); } break;
      case 'found': this.sfx.play('laugh'); break;
      case 'color': this.sfx.play('beep'); break;
      case 'paint': this.sfx.play('pop'); this.fx.burst('confetti', e.x, 0.1, e.z, 8); break;
      case 'gameEnd': {
        this.sfx.play('win');
        for (const w of e.winners || []) this.avatars.get(w)?.emoji('🏆', this.time);
        const g = this.sim.def.layout.games.find(x => x.id === e.game);
        if (g) this.fx.burst('confetti', g.spot[0], 1, g.spot[1], 30);
        break;
      }
    }
  }

  // Test hooks (Playwright) — harmless in normal play.
  exposeDebug() {
    const w = window as any;
    w.__lm3 = {
      ready: true,
      code: () => this.net!.code,
      players: () => this.net!.players.length,
      get stage() { return (w.__lm3game as Game).world.staged; },
      loaded: () => [...this.assets.loaded],
      expected: () => [...this.world.expectedModels],
      failed: () => this.assets.failed,
      fps: () => this.fps,
      activeMeshes: () => this.scene.getActiveMeshes().length,
      drawCalls: async () => {
        const { SceneInstrumentation } = await import('@babylonjs/core/Instrumentation/sceneInstrumentation');
        const ins = (this as any).ins ||= new SceneInstrumentation(this.scene);
        ins.captureFrameTime = true;
        await new Promise(r => setTimeout(r, 300));
        return ins.drawCallsCounter.current;
      },
      teleport: (x: number, z: number, yaw = 0, y = 0.05) => {
        const t: any = this.net!.t;
        if (t.room) { const p = t.room.sim.players.get(this.net!.myId); t.room.sim.teleport(p, [x, y, z], yaw); }
        const me = this.net!.me; if (me) { this.sim.teleport(me, [x, y, z], yaw); }
        this.cam.yaw = yaw; this.cam.target.set(x, y + 1.35, z);
      },
      view: (yaw: number, pitch: number, dist: number) => { this.cam.yaw = yaw; this.cam.pitch = pitch; this.cam.dist = dist; this.cam.cur = dist; this.cam.idle = 0; },
      avatars: () => [...this.avatars.values()].map(a => ({ char: a.look.char, meshes: a.meshes.length, anim: a.current })),
      characters: () => Object.keys(CHARACTERS) as CharacterId[]
    };
    w.__lm3game = this;
  }
}
