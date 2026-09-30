// Builds the indoor playground from the shared layout. Static parts are merged
// per material after construction so the whole hall costs a few dozen draw calls.
import {
  Mesh, TransformNode, Vector3, Color3, VertexData, StandardMaterial, DynamicTexture,
  CreateSphere, CreateCylinder, CreateGround, CreatePlane, CreateTorus, CreateDisc, CreateTube, CreateBox, CreateCapsule
} from '../babylon.js';
import { Kit, hex, roundRect } from './Kit.js';
import { BLOCKY } from '../style.js';
import {
  HALL, PALETTE, AREAS, SOLIDS, STAGE, TOWERS, DECK_Y, STAIRS, SLIDE, slidePoint, BALL_PIT, TUNNEL, FOAM_PIT,
  SWING_FRAME, SWINGS, IGLOO, TENT, COLOR_FLOOR, BASKETS, BALL_COLORS, PADS, RACE, BENCHES, BEACH_BALLS, POTS
} from '../../shared/playground.js';

export class Playground {
  constructor(scene, { quality = 'high' } = {}) {
    this.scene = scene;
    this.kit = new Kit(scene);
    this.quality = quality;
    this.static = [];
    this.swings = new Map();
    this.pads = new Map();
    this.baskets = new Map();
    this.tiles = [];
    this.routeMarkers = [];
    this.signs = [];
    this.build();
  }

  add(mesh) { this.static.push(mesh); return mesh; }

  build() {
    this.buildFloor();
    this.buildWalls();
    this.buildSolids();
    this.buildPlaza();
    this.buildSwings();
    this.buildSlide();
    this.buildBallPit();
    this.buildCourse();
    this.buildHidingPlaces();
    this.buildColorFloor();
    this.buildBaskets();
    this.buildPads();
    this.buildSigns();
    this.buildDecor();
    this.buildRouteMarkers();
    this.mergeStatic();
  }

  // ---- floor with painted areas and baked soft shading ---------------------------
  buildFloor() {
    const W = HALL.maxX - HALL.minX, D = HALL.maxZ - HALL.minZ;
    const res = this.quality === 'low' ? 1024 : 2048, px = res / W, H = Math.round(D * px);
    const tex = new DynamicTexture('floor-tex', { width: res, height: H }, this.scene, true);
    const ctx = tex.getContext();
    const X = x => (x - HALL.minX) * px, Z = z => (HALL.maxZ - z) * px;
    ctx.fillStyle = '#FBE9CF'; ctx.fillRect(0, 0, res, H);
    // Soft foam mat tiles.
    const tile = 2 * px;
    for (let i = 0; i * tile < res; i++) for (let j = 0; j * tile < H; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#FFF1DB' : '#F8E2C2';
      ctx.fillRect(i * tile + 2, j * tile + 2, tile - 4, tile - 4);
    }
    if (BLOCKY) {
      // Studded baseplate look.
      const step = 0.5 * px, r = step * 0.28;
      for (let x = step / 2; x < res; x += step) for (let y = step / 2; y < H; y += step) {
        ctx.fillStyle = 'rgba(120,80,40,0.10)'; ctx.beginPath(); ctx.arc(x + 1.5, y + 1.5, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(x - 0.5, y - 0.5, r * 0.8, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Area pools of colour children can recognise from far away.
    for (const a of AREAS) {
      if (a.id === 'pit' || a.id === 'floor') continue;
      const g = ctx.createRadialGradient(X(a.x), Z(a.z), a.r * px * 0.2, X(a.x), Z(a.z), a.r * px * 1.15);
      g.addColorStop(0, a.color + '66'); g.addColorStop(0.75, a.color + '40'); g.addColorStop(1, a.color + '00');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X(a.x), Z(a.z), a.r * px * 1.15, 0, Math.PI * 2); ctx.fill();
    }
    // Plaza star rug.
    ctx.save(); ctx.translate(X(0), Z(0));
    ctx.fillStyle = '#FFD45C'; star(ctx, 0, 0, 5.2 * px, 2.6 * px, 8); ctx.fill();
    ctx.fillStyle = '#FFE9A8'; star(ctx, 0, 0, 3.8 * px, 2.9 * px, 8); ctx.fill();
    ctx.restore();
    // Friendly footprint paths between the plaza and each area.
    ctx.fillStyle = 'rgba(242,115,95,0.35)';
    for (const a of AREAS) {
      if (a.id === 'plaza') continue;
      const len = Math.hypot(a.x, a.z) - a.r * 0.6 - 5.4, dirx = a.x / Math.hypot(a.x, a.z), dirz = a.z / Math.hypot(a.x, a.z);
      for (let s = 0; s < len; s += 1.1) {
        const d = 5.6 + s, side = (Math.round(s / 1.1) % 2 ? 0.22 : -0.22);
        const x = dirx * d - dirz * side, z = dirz * d + dirx * side;
        ctx.beginPath(); ctx.ellipse(X(x), Z(z), 0.12 * px, 0.2 * px, Math.atan2(dirx, -dirz), 0, Math.PI * 2); ctx.fill();
      }
    }
    // Baked contact shading under structures.
    const shade = (x0, z0, x1, z1, a = 0.16) => {
      const cx = X((x0 + x1) / 2), cz = Z((z0 + z1) / 2), rx = (x1 - x0) / 2 * px + 30, rz = (z1 - z0) / 2 * px + 30;
      const g = ctx.createRadialGradient(cx, cz, 0, cx, cz, Math.max(rx, rz));
      g.addColorStop(0, `rgba(120,70,60,${a})`); g.addColorStop(1, 'rgba(120,70,60,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - rx - 40, cz - rz - 40, rx * 2 + 80, rz * 2 + 80);
    };
    for (const t of TOWERS) shade(t.minX, t.minZ, t.maxX, t.maxZ, 0.2);
    shade(STAIRS.minX, STAIRS.minZ, STAIRS.maxX, STAIRS.maxZ, 0.12);
    shade(SWING_FRAME.x - 4.5, SWING_FRAME.z - 1.3, SWING_FRAME.x + 4.5, SWING_FRAME.z + 1.3, 0.1);
    shade(TUNNEL.minX, TUNNEL.z - 1.4, TUNNEL.maxX, TUNNEL.z + 1.4, 0.16);
    // Soft foam pit.
    ctx.fillStyle = '#B79BE6';
    roundRect(ctx, X(FOAM_PIT.minX), Z(FOAM_PIT.maxZ), (FOAM_PIT.maxX - FOAM_PIT.minX) * px, (FOAM_PIT.maxZ - FOAM_PIT.minZ) * px, 0.6 * px); ctx.fill();
    ctx.fillStyle = '#C9B3F0';
    for (let x = FOAM_PIT.minX + 0.5; x < FOAM_PIT.maxX; x += 0.8) for (let z = FOAM_PIT.minZ + 0.5; z < FOAM_PIT.maxZ; z += 0.8) {
      ctx.fillRect(X(x) - 0.3 * px, Z(z) - 0.3 * px, 0.6 * px, 0.6 * px);
    }
    // Race start line.
    const s = RACE.start;
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#39486A' : '#FFFFFF';
      ctx.fillRect(X(s.x - 0.8) , Z(s.z + 2) + i * 0.5 * px, 0.35 * px, 0.5 * px);
      ctx.fillStyle = i % 2 ? '#FFFFFF' : '#39486A';
      ctx.fillRect(X(s.x - 0.8) + 0.35 * px, Z(s.z + 2) + i * 0.5 * px, 0.35 * px, 0.5 * px);
    }
    tex.update();
    tex.wrapU = tex.wrapV = 0;
    tex.anisotropicFilteringLevel = 4;
    const m = new StandardMaterial('floor', this.scene);
    m.diffuseTexture = tex; m.specularColor = new Color3(0.05, 0.05, 0.05); m.emissiveColor = new Color3(0.1, 0.08, 0.06);
    const ground = CreateGround('floor', { width: W, height: D }, this.scene);
    ground.position.set((HALL.minX + HALL.maxX) / 2, 0, (HALL.minZ + HALL.maxZ) / 2);
    ground.material = m;
    ground.receiveShadows = true;
    ground.freezeWorldMatrix();
    this.floor = ground;
  }

  buildWalls() {
    const tex = new DynamicTexture('wall-tex', { width: 1024, height: 256 }, this.scene, true);
    const ctx = tex.getContext();
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#BFE6F5'); g.addColorStop(0.55, '#E4F4F1'); g.addColorStop(0.56, '#FFD9A8'); g.addColorStop(1, '#FFC98A');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 256);
    // Rainbow stripe and painted clouds.
    ['#F2735F', '#F7BE2F', '#8FE0C8', '#2BB5B0', '#9C6BD1'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, 150 + i * 7, 1024, 7); });
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 5; i++) {
      const x = 90 + i * 210, y = 45 + (i % 2) * 30;
      for (const [dx, dy, r] of [[0, 0, 26], [28, -10, 32], [60, 0, 24], [30, 8, 26]]) { ctx.beginPath(); ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2); ctx.fill(); }
    }
    tex.update();
    const m = new StandardMaterial('walls', this.scene);
    m.diffuseTexture = tex; m.specularColor = Color3.Black(); m.emissiveColor = new Color3(0.28, 0.26, 0.24);
    const W = HALL.maxX - HALL.minX, D = HALL.maxZ - HALL.minZ, h = HALL.height;
    const walls = [
      [0, HALL.maxZ, 0, W], [0, HALL.minZ, Math.PI, W], [HALL.maxX, 0, Math.PI / 2, D], [HALL.minX, 0, -Math.PI / 2, D]
    ];
    for (const [x, z, rot, len] of walls) {
      const p = CreatePlane('wall', { width: len, height: h }, this.scene);
      p.position.set(x, h / 2, z); p.rotation.y = rot; p.material = m;
      p.freezeWorldMatrix();
    }
    // Tall bright windows let the warm "sunlight" in.
    const win = this.kit.mat('#FFF8E6', { emissive: 0.95, gloss: 0 });
    const frame = this.kit.mat(PALETTE.cream, { emissive: 0.3 });
    for (const x of [-16, -6, 6, 16]) {
      const f = this.kit.roundedBox('winframe', 3.6, 3.2, 0.3, 0.12, frame); f.position.set(x, 4.8, HALL.maxZ - 0.1); this.add(f);
      const w = CreatePlane('window', { width: 3.1, height: 2.7 }, this.scene); w.position.set(x, 4.8, HALL.maxZ - 0.27); w.material = win; this.add(w);
    }
    // Hanging clouds and stars under the ceiling.
    const cloud = this.kit.mat('#FFFFFF', { emissive: 0.4 });
    for (const [x, z] of [[-10, 2], [8, -4], [0, 9], [-6, -10], [14, 12]]) {
      for (const [dx, dy, r] of [[0, 0, 0.9], [0.9, 0.2, 1.1], [1.8, 0, 0.8]]) {
        const s = CreateSphere('cloud', { diameter: r * 2, segments: 8 }, this.scene);
        s.position.set(x + dx, 6.6 + dy, z); s.scaling.z = 0.7; s.material = cloud; this.add(s);
      }
    }
  }

  // ---- colliders rendered as padded parts -------------------------------------------
  buildSolids() {
    const k = this.kit;
    for (const s of SOLIDS) {
      if (s.hidden || s.kind === 'wall' || s.kind === 'basket') continue;
      const w = s.max[0] - s.min[0], h = s.max[1] - s.min[1], d = s.max[2] - s.min[2];
      const cx = (s.min[0] + s.max[0]) / 2, cy = (s.min[1] + s.max[1]) / 2, cz = (s.min[2] + s.max[2]) / 2;
      if (s.kind === 'rail' || s.kind === 'net') { this.rail(s, w, h, d, cx, cz); continue; }
      if (s.kind === 'siderail') { this.stairRail(s, cz); continue; }
      if (s.kind === 'barrier') {
        const log = CreateCapsule('barrier', { height: d, radius: h / 2, tessellation: 14, subdivisions: 1 }, this.scene);
        log.rotation.x = Math.PI / 2; log.position.set(cx, h / 2, cz); log.material = k.mat(s.color, { gloss: 0.3 }); this.add(log);
        const stripe = CreateTorus('stripe', { diameter: h * 1.02, thickness: 0.08, tessellation: 16 }, this.scene);
        stripe.rotation.x = Math.PI / 2; stripe.position.set(cx, h / 2, cz); stripe.material = k.mat('#FFFFFF'); this.add(stripe);
        continue;
      }
      const radius = s.kind === 'post' ? 0.18 : s.kind === 'deck' ? 0.1 : Math.min(0.22, h * 0.3, w * 0.3, d * 0.3);
      const mesh = k.roundedBox(s.kind, w, h, d, radius, k.mat(s.color || PALETTE.cream, { gloss: s.kind === 'post' ? 0.35 : 0.18 }));
      mesh.position.set(cx, cy, cz);
      mesh.receiveShadows = true;
      this.add(mesh);
      if (s.kind === 'platform') {
        const top = CreateDisc('star', { radius: 0.35, tessellation: 5 }, this.scene);
        top.rotation.x = Math.PI / 2; top.position.set(cx, s.max[1] + 0.01, cz); top.material = k.mat('#FFFFFF', { emissive: 0.4 }); this.add(top);
      }
    }
    // Tower roofs: friendly canopies.
    for (const [i, t] of TOWERS.entries()) {
      const roof = CreateCylinder('roof', { diameterTop: 0, diameterBottom: 4.8, height: 1.6, tessellation: 4 }, this.scene);
      roof.rotation.y = Math.PI / 4;
      roof.position.set((t.minX + t.maxX) / 2, DECK_Y + 3.4, (t.minZ + t.maxZ) / 2);
      roof.scaling.set(1, 1, 1.5);
      roof.material = this.kit.mat(i ? PALETTE.purple : PALETTE.turquoise, { gloss: 0.3, name: `roof${i}` }); this.add(roof);
      this.roofMaterials = [...(this.roofMaterials || []), roof.material];
      for (const [x, z] of [[t.minX + 0.2, t.minZ + 0.2], [t.maxX - 0.2, t.minZ + 0.2], [t.minX + 0.2, t.maxZ - 0.2], [t.maxX - 0.2, t.maxZ - 0.2]]) {
        const p = CreateCylinder('roofpost', { diameter: 0.22, height: 2.6, tessellation: 10 }, this.scene);
        p.position.set(x, DECK_Y + 1.3, z); p.material = this.kit.mat(PALETTE.yellow, { gloss: 0.35 }); this.add(p);
      }
      const ball = CreateSphere('roofball', { diameter: 0.5, segments: 10 }, this.scene);
      ball.position.set((t.minX + t.maxX) / 2, DECK_Y + 4.3, (t.minZ + t.maxZ) / 2); ball.material = this.kit.mat(PALETTE.yellow, { emissive: 0.3 }); this.add(ball);
    }
    // Crawl tunnel under tower A doubles as a hiding place.
    const tube = CreateCylinder('crawl', { diameter: 1.9, height: 3.4, tessellation: 20, arc: 0.5, enclose: false, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    tube.rotation.set(Math.PI / 2, 0, 0); tube.position.set(12.25, 0, 8); tube.scaling.set(1, 1, 1.1);
    tube.material = this.kit.mat(PALETTE.mint); this.add(tube);
  }

  rail(s, w, h, d, cx, cz) {
    const k = this.kit, along = w > d, len = along ? w : d;
    const bar = k.roundedBox('railbar', along ? len : 0.16, 0.14, along ? 0.16 : len, 0.07, k.mat(s.kind === 'net' ? PALETTE.yellow : PALETTE.turquoise, { gloss: 0.35 }));
    bar.position.set(cx, s.max[1], cz); this.add(bar);
    if (s.kind === 'net') {
      const net = CreatePlane('net', { width: len, height: h }, this.scene);
      net.position.set(cx, s.min[1] + h / 2, cz); net.rotation.y = along ? 0 : Math.PI / 2;
      net.material = this.netMaterial(); this.add(net);
      return;
    }
    const n = Math.max(2, Math.round(len / 0.7));
    for (let i = 0; i <= n; i++) {
      const t = i / n - 0.5, x = along ? cx + t * (len - 0.1) : cx, z = along ? cz : cz + t * (len - 0.1);
      const post = CreateCylinder('railpost', { diameter: 0.09, height: h, tessellation: 8 }, this.scene);
      post.position.set(x, s.min[1] + h / 2, z); post.material = k.mat('#FFFFFF', { gloss: 0.35 }); this.add(post);
    }
  }

  netMaterial() {
    if (this._net) return this._net;
    const tex = new DynamicTexture('net-tex', { width: 128, height: 128 }, this.scene, true);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 128, 128); ctx.strokeStyle = '#9C6BD1'; ctx.lineWidth = 7;
    for (let i = -128; i < 256; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 128, 128); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i + 128, 0); ctx.lineTo(i, 128); ctx.stroke(); }
    tex.update(); tex.hasAlpha = true; tex.uScale = 3; tex.vScale = 1.5;
    const m = new StandardMaterial('net', this.scene);
    m.diffuseTexture = tex; m.useAlphaFromDiffuseTexture = true; m.backFaceCulling = false;
    m.emissiveColor = new Color3(0.3, 0.2, 0.4); m.specularColor = Color3.Black();
    this._net = m;
    return m;
  }

  stairRail(s, cz) {
    const k = this.kit, len = Math.hypot(STAIRS.maxX - STAIRS.minX, DECK_Y);
    const bar = k.roundedBox('stairbar', len + 0.3, 0.16, 0.16, 0.07, k.mat(PALETTE.turquoise, { gloss: 0.35 }));
    bar.position.set((STAIRS.minX + STAIRS.maxX) / 2, DECK_Y / 2 + 0.95, cz);
    bar.rotation.z = Math.atan2(DECK_Y, STAIRS.maxX - STAIRS.minX);
    this.add(bar);
    const slope = DECK_Y / (STAIRS.maxX - STAIRS.minX);
    for (let x = STAIRS.minX + 0.3; x < STAIRS.maxX; x += 0.6) {
      const base = Math.ceil((x - STAIRS.minX) / (STAIRS.maxX - STAIRS.minX) * STAIRS.steps) * DECK_Y / STAIRS.steps;
      const top = (x - STAIRS.minX) * slope + 0.95;
      const post = CreateCylinder('stairpost', { diameter: 0.09, height: top - base + 0.05, tessellation: 8 }, this.scene);
      post.position.set(x, (top + base) / 2, cz); post.material = k.mat('#FFFFFF', { gloss: 0.35 }); this.add(post);
    }
  }

  // ---- plaza and celebration stage ---------------------------------------------------
  buildPlaza() {
    const k = this.kit;
    const stage = CreateCylinder('stage', { diameter: STAGE.r * 2, height: STAGE.h, tessellation: 40 }, this.scene);
    stage.position.set(STAGE.x, STAGE.h / 2, STAGE.z); stage.material = k.mat(PALETTE.turquoise, { gloss: 0.3 }); stage.receiveShadows = true; this.add(stage);
    const rim = CreateTorus('stagerim', { diameter: STAGE.r * 2, thickness: 0.22, tessellation: 40 }, this.scene);
    rim.position.set(STAGE.x, STAGE.h, STAGE.z); rim.material = k.mat(PALETTE.yellow, { gloss: 0.4 }); this.add(rim);
    const top = CreateDisc('stagetop', { radius: STAGE.r - 0.3, tessellation: 40 }, this.scene);
    top.rotation.x = Math.PI / 2; top.position.set(STAGE.x, STAGE.h + 0.005, STAGE.z); top.material = k.mat(PALETTE.cream, { emissive: 0.2 }); top.receiveShadows = true; this.add(top);
    const starDisc = CreateDisc('stagestar', { radius: 1.2, tessellation: 5 }, this.scene);
    starDisc.rotation.x = Math.PI / 2; starDisc.position.set(STAGE.x, STAGE.h + 0.01, STAGE.z); starDisc.material = k.mat(PALETTE.yellow, { emissive: 0.3 }); this.add(starDisc);
    // Celebration arch behind the stage.
    const arch = CreateTorus('arch', { diameter: 5.6, thickness: 0.35, tessellation: 40 }, this.scene);
    arch.rotation.x = Math.PI / 2; arch.rotation.y = 0; arch.position.set(0, 0, 2.3);
    arch.material = k.mat(PALETTE.coral, { gloss: 0.4, name: 'arch' });
    this.archMaterial = arch.material;
    this.add(arch);
    const bulbs = k.mat('#FFF4C2', { emissive: 0.9, name: 'bulbs' });
    for (let i = 1; i < 12; i++) {
      const a = Math.PI * i / 12, b = CreateSphere('bulb', { diameter: 0.22, segments: 6 }, this.scene);
      b.position.set(Math.cos(a) * 2.8, Math.sin(a) * 2.8, 2.05); b.material = bulbs; this.add(b);
    }
    // Parent benches around the plaza.
    for (const { x, z, rot: r } of BENCHES) {
      const seat = k.roundedBox('bench', 2.4, 0.45, 0.8, 0.15, k.mat(PALETTE.purple)); seat.position.set(x, 0.23, z); seat.rotation.y = r; this.add(seat);
      const back = k.roundedBox('benchback', 2.4, 0.6, 0.25, 0.1, k.mat(PALETTE.pink)); back.position.set(x + (x < 0 ? -0.35 : 0.35), 0.7, z); back.rotation.y = r; this.add(back);
    }
  }

  // ---- swings (animated) -----------------------------------------------------------
  buildSwings() {
    const k = this.kit, f = SWING_FRAME;
    const frameMat = k.mat(PALETTE.turquoise, { gloss: 0.4 });
    for (const side of [-1, 1]) {
      const x = f.x + side * f.halfWidth;
      for (const dz of [-1, 1]) {
        const leg = CreateCylinder('swingleg', { diameter: 0.26, height: 4.6, tessellation: 12 }, this.scene);
        leg.position.set(x, f.pivotY / 2, f.z + dz * 0.9); leg.rotation.x = dz * 0.24; leg.material = frameMat; this.add(leg);
      }
      const cap = CreateSphere('swingcap', { diameter: 0.5, segments: 10 }, this.scene);
      cap.position.set(x, f.pivotY, f.z); cap.material = k.mat(PALETTE.yellow, { gloss: 0.4 }); this.add(cap);
    }
    const bar = CreateCylinder('swingbar', { diameter: 0.24, height: f.halfWidth * 2, tessellation: 14 }, this.scene);
    bar.rotation.z = Math.PI / 2; bar.position.set(f.x, f.pivotY, f.z); bar.material = k.mat(PALETTE.coral, { gloss: 0.4 }); this.add(bar);
    const seatColors = [PALETTE.yellow, PALETTE.pink, PALETTE.purple];
    for (const [i, s] of SWINGS.entries()) {
      const pivot = new TransformNode(`${s.id}-pivot`, this.scene);
      pivot.position.set(s.x, f.pivotY, s.z);
      for (const dx of [-0.32, 0.32]) {
        const rope = CreateCylinder('rope', { diameter: 0.05, height: f.rope, tessellation: 6 }, this.scene);
        rope.position.set(dx, -f.rope / 2, 0); rope.parent = pivot; rope.material = k.mat('#FFFFFF');
      }
      const seat = k.roundedBox(`${s.id}-seat`, 0.85, 0.12, 0.42, 0.05, k.mat(seatColors[i], { gloss: 0.35 }));
      seat.parent = pivot; seat.position.y = -f.rope;
      this.swings.set(s.id, { pivot, seat, angle: 0 });
    }
  }

  setSwingAngle(id, angle) {
    const s = this.swings.get(id);
    if (s) s.pivot.rotation.x = -angle;
  }

  // ---- slide -----------------------------------------------------------------------
  buildSlide() {
    const k = this.kit, n = 40, width = 0.62, wall = 0.32;
    const positions = [], indices = [];
    const profile = [[-width - 0.06, wall], [-width, 0.05], [-width * 0.6, 0], [0, -0.03], [width * 0.6, 0], [width, 0.05], [width + 0.06, wall]];
    for (let i = 0; i <= n; i++) {
      const t = i / n, p = slidePoint(t), q = slidePoint(Math.min(1, t + 0.02)), o = slidePoint(Math.max(0, t - 0.02));
      let dx = q.x - o.x, dz = q.z - o.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const lx = dz, lz = -dx; // lateral
      for (const [u, v] of profile) positions.push(p.x + lx * u, p.y + v, p.z + lz * u);
    }
    const m = profile.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < m - 1; j++) {
      const a = i * m + j, b = a + 1, c = a + m, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
    const normals = [];
    VertexData.ComputeNormals(positions, indices, normals);
    const chute = new Mesh('slide', this.scene);
    const data = new VertexData(); data.positions = positions; data.indices = indices; data.normals = normals; data.applyToMesh(chute);
    const mat = k.mat(PALETTE.yellow, { gloss: 0.6, emissive: 0.15, name: 'slide' });
    chute.material = mat; mat.backFaceCulling = false;
    this.add(chute);
    for (const side of [-1, 1]) {
      const path = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, p = slidePoint(t), q = slidePoint(Math.min(1, t + 0.02)), o = slidePoint(Math.max(0, t - 0.02));
        let dx = q.x - o.x, dz = q.z - o.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        path.push(new Vector3(p.x + dz * side * (width + 0.06), p.y + wall, p.z - dx * side * (width + 0.06)));
      }
      const rimTube = CreateTube('sliderim', { path, radius: 0.07, tessellation: 8 }, this.scene);
      rimTube.material = k.mat(PALETTE.coral, { gloss: 0.5 }); this.add(rimTube);
    }
    for (const t of [0.25, 0.5, 0.72]) {
      const p = slidePoint(t);
      const post = CreateCylinder('slidepost', { diameter: 0.22, height: p.y, tessellation: 10 }, this.scene);
      post.position.set(p.x, p.y / 2 - 0.02, p.z); post.material = k.mat(PALETTE.turquoise, { gloss: 0.4 }); this.add(post);
    }
    // Entrance arch on the deck.
    const e = SLIDE.entrance;
    const arch = CreateTorus('slidearch', { diameter: 1.6, thickness: 0.16, tessellation: 24 }, this.scene);
    arch.rotation.x = Math.PI / 2; arch.position.set(e.x, DECK_Y + 0.05, 5.02); arch.scaling.set(1, 1.2, 1);
    arch.material = k.mat(PALETTE.coral, { gloss: 0.45 }); this.add(arch);
  }

  // ---- ball pit with lightweight decorative balls ------------------------------------
  buildBallPit() {
    const p = BALL_PIT, k = this.kit;
    const base = CreateGround('pitbase', { width: p.maxX - p.minX, height: p.maxZ - p.minZ }, this.scene);
    base.position.set((p.minX + p.maxX) / 2, 0.02, (p.minZ + p.maxZ) / 2); base.material = k.mat('#6FA9D8'); this.add(base);
    const colors = ['#F2735F', '#2BB5B0', '#F7BE2F', '#9C6BD1', '#FF8FB8', '#FFFFFF'];
    const count = this.quality === 'low' ? 700 : 1500;
    const rand = mulberry(7);
    const per = colors.map(() => []);
    for (let i = 0; i < count; i++) {
      const x = p.minX + 0.2 + rand() * (p.maxX - p.minX - 0.4), z = p.minZ + 0.2 + rand() * (p.maxZ - p.minZ - 0.4);
      const y = 0.12 + rand() * 0.3;
      per[i % colors.length].push(x, y, z);
    }
    this.pitBalls = [];
    for (const [ci, list] of per.entries()) {
      const ball = CreateSphere(`pitball${ci}`, { diameter: 0.28, segments: 5 }, this.scene);
      ball.material = k.mat(colors[ci], { gloss: 0.5, emissive: 0.15 });
      const matrices = new Float32Array(list.length / 3 * 16);
      for (let i = 0; i < list.length / 3; i++) {
        matrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, list[i * 3], list[i * 3 + 1], list[i * 3 + 2], 1], i * 16);
      }
      ball.thinInstanceSetBuffer('matrix', matrices, 16, true);
      ball.isPickable = false;
      ball.alwaysSelectAsActiveMesh = true;
      ball.freezeWorldMatrix();
      this.pitBalls.push(ball);
    }
  }

  // ---- obstacle course details --------------------------------------------------------
  buildCourse() {
    const k = this.kit, t = TUNNEL;
    const tube = CreateCylinder('tunnel', { diameter: t.width + 0.5, height: t.maxX - t.minX, tessellation: 24, arc: 0.5, enclose: false, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    // Axis along x, open half facing down: local z becomes height.
    tube.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
    tube.position.set((t.minX + t.maxX) / 2, 0, t.z);
    tube.scaling.set(1, 1, 1.6);
    tube.material = k.mat(PALETTE.purple, { gloss: 0.3 });
    this.add(tube);
    for (const x of [t.minX, t.maxX]) {
      const ring = CreateTorus('tunnelring', { diameter: t.width + 0.55, thickness: 0.22, tessellation: 24 }, this.scene);
      ring.rotation.z = Math.PI / 2; ring.position.set(x, 0, t.z); ring.scaling.set(1.6, 1, 1);
      ring.material = k.mat(PALETTE.yellow, { gloss: 0.4 }); this.add(ring);
    }
  }

  buildHidingPlaces() {
    const k = this.kit;
    const dome = CreateSphere('igloo', { diameter: IGLOO.r * 2, segments: 16, slice: 0.5, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    dome.position.set(IGLOO.x, 0, IGLOO.z); dome.material = k.mat(PALETTE.mint, { gloss: 0.3 }); this.add(dome);
    const door = CreateSphere('iglooDoor', { diameter: 1.5, segments: 12, slice: 0.5 }, this.scene);
    door.position.set(IGLOO.x + IGLOO.r - 0.25, 0, IGLOO.z); door.scaling.set(0.4, 1.2, 1); door.material = k.mat('#3E6F78'); this.add(door);
    const tent = CreateCylinder('tent', { diameterTop: 0, diameterBottom: 2.8, height: 2.6, tessellation: 6 }, this.scene);
    tent.position.set(TENT.x, 1.3, TENT.z + 0.8); tent.material = k.mat(PALETTE.coral, { gloss: 0.2 }); this.add(tent);
    const flag = CreatePlane('tentflag', { width: 0.6, height: 0.35 }, this.scene);
    flag.position.set(TENT.x + 0.3, 2.9, TENT.z + 0.8); flag.material = k.mat(PALETTE.yellow, { emissive: 0.3 }); flag.material.backFaceCulling = false; this.add(flag);
  }

  // ---- illuminated floor (animated tiles) ----------------------------------------------
  buildColorFloor() {
    const f = COLOR_FLOOR, k = this.kit;
    const colors = [PALETTE.coral, PALETTE.turquoise, PALETTE.yellow, PALETTE.purple];
    for (let r = 0; r < f.rows; r++) for (let c = 0; c < f.cols; c++) {
      const tile = k.roundedBox('tile', f.tile - 0.12, 0.08, f.tile - 0.12, 0.03, null);
      const m = new StandardMaterial(`tile${r}${c}`, this.scene);
      m.specularColor = new Color3(0.2, 0.2, 0.2);
      tile.material = m;
      tile.position.set(f.x + (c - (f.cols - 1) / 2) * f.tile, 0.04, f.z + (r - (f.rows - 1) / 2) * f.tile);
      this.tiles.push({ mesh: tile, mat: m, phase: (r * 3 + c * 5) % 4, colors: colors.map(hex) });
    }
    const border = k.roundedBox('floorborder', f.cols * f.tile + 0.4, 0.06, f.rows * f.tile + 0.4, 0.03, k.mat(PALETTE.navy));
    border.position.set(f.x, 0.02, f.z); this.add(border);
  }

  // ---- Ball Rescue baskets ------------------------------------------------------------
  buildBaskets() {
    const k = this.kit;
    for (const b of BASKETS) {
      const def = BALL_COLORS.find(c => c.id === b.id);
      const body = CreateCylinder('basket', { diameterTop: 1.25, diameterBottom: 0.95, height: 0.85, tessellation: 20 }, this.scene);
      body.position.set(b.x, 0.425, b.z); body.material = k.mat(def.color, { gloss: 0.35 }); this.add(body);
      const rim = CreateTorus('basketrim', { diameter: 1.25, thickness: 0.14, tessellation: 20 }, this.scene);
      rim.position.set(b.x, 0.85, b.z); rim.material = k.mat('#FFFFFF', { gloss: 0.4 }); this.add(rim);
      const inside = CreateDisc('basketinside', { radius: 0.55, tessellation: 20 }, this.scene);
      inside.rotation.x = Math.PI / 2; inside.position.set(b.x, 0.8, b.z); inside.material = k.mat('#5A4A6A'); this.add(inside);
      const sign = k.sign(`basket-${b.id}`, { symbol: def.symbol, color: def.color, width: 0.9, height: 0.9 });
      sign.position.set(b.x, 1.75, b.z); sign.billboardMode = Mesh.BILLBOARDMODE_Y;
      this.baskets.set(b.id, { sign, x: b.x, z: b.z });
    }
  }

  // ---- activity start pads ------------------------------------------------------------
  buildPads() {
    for (const p of PADS) {
      const disc = CreateCylinder(`pad-${p.id}`, { diameter: 2.2, height: 0.08, tessellation: 32 }, this.scene);
      disc.position.set(p.x, 0.04, p.z);
      const m = new StandardMaterial(`pad-${p.id}`, this.scene);
      m.diffuseColor = hex(p.color); m.emissiveColor = hex(p.color).scale(0.12); m.specularColor = Color3.Black();
      disc.material = m;
      const ring = CreateTorus(`padring-${p.id}`, { diameter: 2.3, thickness: 0.1, tessellation: 32 }, this.scene);
      ring.position.set(p.x, 0.08, p.z); ring.material = this.kit.mat('#FFFFFF', { emissive: 0.6 });
      const sign = this.kit.sign(`padsign-${p.id}`, { symbol: p.icon, text: p.name, color: p.color, width: 1.7, height: 0.56 });
      sign.position.set(p.x, 2.5, p.z); sign.billboardMode = Mesh.BILLBOARDMODE_Y;
      this.signs.push(sign);
      this.pads.set(p.id, { disc, mat: m, ring, sign, base: hex(p.color) });
    }
  }

  buildSigns() {
    for (const a of AREAS) {
      if (a.id === 'plaza') continue;
      const pos = { swings: [-14, 14.5], tower: [15, 12.4], pit: [9.2, -8.5], course: [-11, -5.2], blocks: [-4.5, 16.6], floor: [3, 15.6], hide: [-19, 4.8] }[a.id];
      const pole = CreateCylinder('signpole', { diameter: 0.12, height: 2.6, tessellation: 8 }, this.scene);
      pole.position.set(pos[0], 1.3, pos[1]); pole.material = this.kit.mat('#FFFFFF'); this.add(pole);
      const sign = this.kit.sign(`sign-${a.id}`, { symbol: a.symbol, text: a.name, color: a.color, width: 2.6, height: 0.85 });
      sign.position.set(pos[0], 3, pos[1]); sign.billboardMode = Mesh.BILLBOARDMODE_Y;
      this.signs.push(sign);
    }
  }

  buildDecor() {
    const k = this.kit;
    // Giant beach balls and cushions for colour and scale.
    for (const [x, z, d] of BEACH_BALLS) {
      const ball = CreateSphere('beachball', { diameter: d, segments: 14 }, this.scene);
      ball.position.set(x, d / 2, z); ball.material = k.mat(PALETTE.pink, { gloss: 0.5 }); this.add(ball);
      const band = CreateTorus('beachband', { diameter: d * 0.99, thickness: d * 0.14, tessellation: 20 }, this.scene);
      band.position.set(x, d / 2, z); band.rotation.z = Math.PI / 2; band.material = k.mat(PALETTE.yellow, { gloss: 0.5 }); this.add(band);
    }
    for (const [x, z, c] of [[-22.5, -3, PALETTE.yellow], [-22.6, 8, PALETTE.coral], [22.6, 3.5, PALETTE.purple], [-1, -17.2, PALETTE.turquoise], [4, -17.2, PALETTE.coral]]) {
      const cushion = k.roundedBox('cushion', 1.3, 0.35, 1.3, 0.16, k.mat(c)); cushion.position.set(x, 0.18, z); this.add(cushion);
    }
    // Potted round trees.
    for (const [x, z] of POTS) {
      const pot = CreateCylinder('pot', { diameterTop: 0.9, diameterBottom: 0.7, height: 0.7, tessellation: 14 }, this.scene);
      pot.position.set(x, 0.35, z); pot.material = k.mat(PALETTE.coral); this.add(pot);
      const crown = CreateSphere('crown', { diameter: 1.6, segments: 10 }, this.scene);
      crown.position.set(x, 1.5, z); crown.material = k.mat('#6CCB8F', { gloss: 0.1 }); this.add(crown);
    }
  }

  // Glowing arrows showing the race route; visible during the race.
  buildRouteMarkers() {
    const m = this.kit.mat('#FFFFFF', { emissive: 0.9, name: 'route' });
    const cps = [{ x: RACE.start.x, z: RACE.start.z }, ...RACE.checkpoints];
    for (let i = 0; i < cps.length; i++) {
      const c = cps[i], n = cps[i + 1] || { x: SLIDE.entrance.x, z: SLIDE.entrance.z, y: DECK_Y };
      const arrow = CreateDisc('arrow', { radius: 0.55, tessellation: 3 }, this.scene);
      arrow.rotation.x = Math.PI / 2;
      arrow.rotation.y = Math.atan2(n.x - c.x, n.z - c.z) + Math.PI / 2;
      arrow.position.set(c.x, (c.y || 0) + 0.06, c.z);
      arrow.material = m; arrow.setEnabled(false);
      this.routeMarkers.push(arrow);
      const ring = CreateTorus('cpring', { diameter: (c.r || 1.5) * 1.6, thickness: 0.12, tessellation: 28 }, this.scene);
      ring.position.set(c.x, (c.y || 0) + 1.4, c.z); ring.material = this.kit.mat(PALETTE.yellow, { emissive: 0.7, name: 'cpring' });
      ring.rotation.x = Math.PI / 2; ring.setEnabled(false);
      ring.metadata = { cp: i - 1 };
      this.routeMarkers.push(ring);
    }
  }

  showRoute(on, nextCp = -1) {
    for (const m of this.routeMarkers) {
      if (m.metadata) m.setEnabled(on && m.metadata.cp === nextCp);
      else m.setEnabled(on);
    }
  }

  mergeStatic() {
    const groups = new Map();
    // Merge per material and vertex layout (primitives carry UVs, custom shapes do not).
    for (const mesh of this.static) {
      if (!mesh.material) continue;
      const key = `${mesh.material.uniqueId}|${mesh.getVerticesDataKinds().sort().join()}`;
      const group = groups.get(key) || { material: mesh.material, list: [] };
      group.list.push(mesh); groups.set(key, group);
    }
    this.merged = [];
    for (const { material, list } of groups.values()) {
      const merged = list.length > 1 ? Mesh.MergeMeshes(list, true, true) : list[0];
      if (!merged) continue;
      merged.material = material;
      merged.receiveShadows = true;
      merged.isPickable = false;
      merged.freezeWorldMatrix();
      this.merged.push(merged);
    }
    for (const g of this.kit.geometry.values()) g.dispose();
  }

  // Canopies turn see-through while the camera is up on the tower.
  setRoofFade(on) {
    for (const m of this.roofMaterials) {
      const a = on ? 0.25 : 1;
      if (m.alpha !== a) { m.alpha = a; m.backFaceCulling = !on; }
    }
  }

  // The plaza arch turns see-through when it stands between the camera and the player.
  setArchFade(on) {
    const a = on ? 0.3 : 1;
    if (this.archMaterial.alpha !== a) this.archMaterial.alpha = a;
  }

  // Signs never block the view: hide those right in front of the camera.
  updateSigns(camera) {
    const c = camera.position;
    for (const s of this.signs) s.setEnabled(Math.hypot(s.position.x - c.x, s.position.z - c.z) > 4.2);
  }

  // During Colour Floor the minigame drives the tiles: { colors: [0..3 | -1], lowered: [bool], dim }.
  update(time) {
    const st = this.tileState;
    const dt = Math.min(0.1, Math.max(0, time - (this.lastTime ?? time)));
    this.lastTime = time;
    const ease = 1 - Math.exp(-dt * 10);
    for (const [n, t] of this.tiles.entries()) {
      if (st) {
        const ci = st.colors[n];
        const c = ci >= 0 ? t.colors[ci] : this.offColor || (this.offColor = hex('#6B6478'));
        const glow = ci >= 0 ? (st.lowered[n] ? 0.15 : 0.6 + 0.3 * Math.sin(time * 8)) : 0.05;
        t.mat.diffuseColor = c;
        t.mat.emissiveColor = c.scale(glow);
        const y = st.lowered[n] ? -0.55 : 0.04;
        t.mesh.position.y += (y - t.mesh.position.y) * ease;
        continue;
      }
      if (t.mesh.position.y !== 0.04) t.mesh.position.y += (0.04 - t.mesh.position.y) * ease;
      const i = Math.floor(time / 1.2 + t.phase) % 4, glow = 0.55 + 0.25 * Math.sin(time * 3 + t.phase);
      t.mat.diffuseColor = t.colors[i];
      t.mat.emissiveColor = t.colors[i].scale(glow);
    }
    for (const pad of this.pads.values()) {
      pad.ring.scaling.x = pad.ring.scaling.z = 1 + 0.06 * Math.sin(time * 4);
    }
  }
}

function star(ctx, x, y, R, r, n) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = i * Math.PI / n - Math.PI / 2, rad = i % 2 ? r : R;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
}

function mulberry(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
