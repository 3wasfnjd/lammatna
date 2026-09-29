// Client side of the plugin minigames (Colour Floor, Hide-and-Seek, Giant
// Ball, Family Builders): temporary props, contextual actions, HUD, sounds.
// The room decides everything; this only presents it and sends intents.
import {
  Mesh, TransformNode, Vector3, Quaternion, Color3, StandardMaterial, DynamicTexture,
  CreateSphere, CreateCylinder, CreateDisc, CreatePlane, CreateTorus
} from '../babylon.js';
import { CHARACTERS, MOVEMENT } from '../../shared/characters.js';
import { PALETTE } from '../../shared/playground.js';
import {
  FLOOR_COLORS, TILE_COUNT, tileIndexAt, GIANT, GIANT_BARRIERS, GIANT_GATES, GOAL_POSTS, gateBox,
  BLUEPRINT, PIECE_SIZE, HIDE
} from '../../shared/games/layout.js';
import { T, arabicDigits } from '../ui/strings.js';

const COLOR_INDEX = Object.fromEntries(FLOOR_COLORS.map((c, i) => [c.id, i]));

export class MiniGames {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.kit = game.kit;
    this.props = [];
    this.type = null;
    this.ballBuffer = [];
    this.pieceMeshes = new Map();
    this.ghosts = new Map();
    this.blind = document.createElement('div');
    this.blind.className = 'blind hidden';
    game.hud.root.appendChild(this.blind);
  }

  get world() { return this.game.world; }
  get me() { return this.game.me; }

  // ---- lifecycle -----------------------------------------------------------------------
  sync(a) {
    const type = a && ['colors', 'hide', 'ball', 'builders'].includes(a.type) ? a.type : null;
    if (type !== this.type || (a && a.seq !== this.seq)) {
      this.clear();
      this.type = type;
      this.seq = a?.seq;
      if (type === 'ball') this.buildBall();
      if (type === 'builders') this.buildBuilders(a);
    }
    if (type === 'builders') this.syncPieces(a);
    if (!type) this.game.playground.tileState = null;
  }

  clear() {
    for (const p of this.props) p.dispose();
    this.props = [];
    this.pieceMeshes.clear();
    this.ghosts.clear();
    this.ballMesh = null;
    this.gateMeshes = [];
    this.ballBuffer = [];
    this.blind.classList.add('hidden');
    this.game.playground.tileState = null;
  }

  keep(mesh) { this.props.push(mesh); mesh.isPickable = false; return mesh; }

  // ---- per frame ------------------------------------------------------------------------
  update(dt, time) {
    const a = this.world?.activity;
    if (!this.type || !a) return;
    if (this.type === 'colors') this.updateColors(a);
    if (this.type === 'ball') this.updateBall(dt, a);
    if (this.type === 'builders') this.updateBuilders(dt, time, a);
    if (this.type === 'hide') this.updateHide(a);
  }

  // Extra lock for this player on top of intro/countdown.
  locked(a) {
    if (!a) return false;
    if (a.type === 'hide') return (a.phase === 'hide' && a.data.seeker === this.me) || (a.phase === 'play' && a.data.found.includes(this.me));
    if (a.type === 'colors') return a.phase === 'play' && a.data.stage === 'drop' && a.data.last?.wrong.includes(this.me);
    return false;
  }

  // Visual sink for players on a dropped tile.
  sinkFor(id) {
    const a = this.world?.activity;
    if (a?.type !== 'colors' || a.phase !== 'play' || a.data.stage !== 'drop') return 0;
    return a.data.last?.wrong.includes(id) ? -0.5 : 0;
  }

  hideLabel(id) {
    const a = this.world?.activity;
    if (a?.type !== 'hide' || id === this.me) return false;
    if (a.data.seeker !== this.me || (a.phase !== 'play' && a.phase !== 'hide')) return false;
    return !a.data.found.includes(id);
  }

  // Keep the local player from walking through the giant ball.
  collide(body) {
    if (this.type !== 'ball' || !this.ballPos) return;
    const dx = body.x - this.ballPos.x, dz = body.z - this.ballPos.z, d = Math.hypot(dx, dz), min = GIANT.radius + MOVEMENT.radius;
    if (d < min && d > 1e-4 && body.y < 1.6) { body.x = this.ballPos.x + dx / d * min; body.z = this.ballPos.z + dz / d * min; }
  }

  onSnap(msg) {
    if (msg.g && this.type === 'ball') {
      this.ballBuffer.push({ t: msg.t, x: msg.g[0], z: msg.g[1] });
      if (this.ballBuffer.length > 20) this.ballBuffer.shift();
    }
  }

  holding() {
    const a = this.world?.activity;
    return a?.type === 'builders' && a.data.pieces.some(p => p.holders.includes(this.me));
  }

  // ---- actions -----------------------------------------------------------------------------
  action() {
    const a = this.world?.activity, g = this.game;
    if (!a || a.phase !== 'play') return null;
    const b = g.body, r = g.reach();
    if (a.type === 'hide' && a.data.seeker === this.me) {
      let best = null, bd = HIDE.findRange + (this.world.assist ? 0.6 : 0);
      for (const id of a.participants) {
        if (id === this.me || a.data.found.includes(id)) continue;
        const av = g.avatars.get(id);
        if (!av?.visible) continue;
        const d = Math.hypot(av.position.x - b.x, av.position.z - b.z);
        if (d < bd && Math.abs(av.position.y - b.y) < 1.8) { bd = d; best = { id, av }; }
      }
      if (best) return { label: `${T.found} ${best.av.def.name}!`, icon: '👀', color: '#8FE0C8', run: () => g.send({ type: 'game', op: 'find', id: best.id }) };
      return null;
    }
    if (a.type === 'builders') {
      const d = a.data, mine = d.pieces.find(p => p.holders.includes(this.me));
      if (mine) {
        const big = mine.kind === 'plank' && d.needTwo;
        if (big && mine.holders.length < 2) return { label: T.waitingPartner, icon: '🤝', color: '#9C6BD1', run: () => g.send({ type: 'game', op: 'drop' }) };
        const pos = this.carriedPosition(mine) || new Vector3(mine.x, 0, mine.z);
        const slot = BLUEPRINT.find(s => s.kind === mine.kind && !d.pieces.some(p => p.placed === s.id) &&
          s.needs.every(n => d.pieces.some(p => p.placed === n)) && Math.hypot(pos.x - s.x, pos.z - s.z) < r + 1.2);
        if (slot) return { label: T.placeIt, icon: '✨', color: slot.color, run: () => g.send({ type: 'game', op: 'place', slot: slot.id }) };
        return { label: T.drop, icon: '⬇️', color: '#9C6BD1', run: () => g.send({ type: 'game', op: 'drop' }) };
      }
      let best = null, bd = Infinity;
      for (const p of d.pieces) {
        if (p.placed) continue;
        const big = p.kind === 'plank' && d.needTwo;
        if (p.holders.length >= (big ? 2 : 1)) continue;
        const reach = r + (p.kind === 'plank' ? 1.6 : 0.6);
        const dist = Math.hypot(p.x - b.x, p.z - b.z);
        if (dist < reach && dist < bd) { bd = dist; best = p; }
      }
      if (best) {
        const big = best.kind === 'plank' && d.needTwo;
        return { label: big ? T.liftTogether : T.lift, icon: big ? '🤝' : '💪', color: best.color, run: () => g.send({ type: 'game', op: 'lift', id: best.id }) };
      }
    }
    return null;
  }

  // ---- HUD -------------------------------------------------------------------------------
  hud(a, left) {
    if (a.type === 'colors') {
      const d = a.data;
      if (d.stage !== 'show' && d.stage !== 'drop') return { title: `🎨 ${T.colors}`, timer: null };
      const c = FLOOR_COLORS.find(x => x.id === d.target);
      const stageLeft = (d.stageEnd - this.game.serverNow()) / 1000;
      const mine = d.scores[this.me] || 0;
      return {
        title: `${T.round} ${arabicDigits(d.round)}/${arabicDigits(d.rounds)} — ${T.colorsGoal} ${c?.symbol || ''} ${c?.name || ''}`,
        timer: d.stage === 'show' ? stageLeft : null,
        progress: d.round / d.rounds, progressText: `⭐ ${arabicDigits(mine)}`, swatch: c?.color
      };
    }
    if (a.type === 'hide') {
      const seeker = a.data.seeker === this.me, name = CHARACTERS[this.charOf(a.data.seeker)]?.name || '';
      const hiders = a.participants.length - 1;
      if (a.phase === 'hide') return { title: seeker ? `🙈 ${T.dontLook}` : `🏃 ${T.hideNow} (${T.hideSeekerIs}: ${name})`, timer: left };
      return { title: seeker ? `🔍 ${T.seekNow}` : `🤫 ${T.stayHidden}`, timer: left, progress: a.data.found.length / Math.max(1, hiders), progressText: `👀 ${arabicDigits(a.data.found.length)} / ${arabicDigits(hiders)}` };
    }
    if (a.type === 'ball') {
      return { title: `⚽ ${T.ballGoal}`, timer: left, progress: a.data.cp / (GIANT.path.length - 1), progressText: `${arabicDigits(a.data.cp)} / ${arabicDigits(GIANT.path.length - 1)}` };
    }
    if (a.type === 'builders') {
      const placed = a.data.pieces.filter(p => p.placed).length;
      return { title: `🧱 ${T.buildersGoal}`, timer: left, progress: placed / BLUEPRINT.length, progressText: `${arabicDigits(placed)} / ${arabicDigits(BLUEPRINT.length)}` };
    }
    return null;
  }

  charOf(id) { return this.world.players.find(p => p.id === id)?.character; }

  // ---- events --------------------------------------------------------------------------------
  onEvent(e) {
    const g = this.game, audio = g.audio;
    switch (e.kind) {
      case 'colorRound': audio.play('colorCue', { color: COLOR_INDEX[e.target] }); break;
      case 'colorJudge':
        if (e.correct.includes(this.me)) { audio.play('deliver'); g.hud.toast(`${T.correct} ⭐`); }
        else if (e.wrong.includes(this.me)) { audio.play('drop'); g.hud.toast(T.missed); }
        break;
      case 'found': {
        audio.play('checkpoint');
        const who = CHARACTERS[this.charOf(e.id)]?.name, by = CHARACTERS[this.charOf(e.by)]?.name;
        if (e.id === this.me) { g.teleport(e.slot); g.hud.toast(`${T.foundYou} ${by} 👀`); }
        else g.hud.toast(`👀 ${who}`);
        break;
      }
      case 'ballCp': audio.play('checkpoint'); break;
      case 'ballReset': audio.play('wrong'); g.hud.toast(T.ballReset); this.ballBuffer = []; break;
      case 'lift': audio.play('pickup'); if (e.id === this.me && e.waiting) g.hud.toast(T.needPartner, 2600); break;
      case 'placed': {
        audio.play('deliver');
        const slot = BLUEPRINT.find(s => s.id === e.slot);
        if (slot) g.effects.confetti(new Vector3(slot.x, slot.y + 0.6, slot.z), { count: 70, duration: 0.3, spread: 1 });
        break;
      }
    }
  }

  // ---- Colour Floor -----------------------------------------------------------------------------
  updateColors(a) {
    const d = a.data;
    if (a.phase !== 'play' || (d.stage !== 'show' && d.stage !== 'drop')) {
      this.game.playground.tileState = { colors: Array(TILE_COUNT).fill(-1), lowered: Array(TILE_COUNT).fill(false) };
      return;
    }
    const colors = d.tiles.map(c => (c ? COLOR_INDEX[c] : -1));
    const lowered = d.stage === 'drop' ? d.tiles.map(c => c !== d.target) : Array(TILE_COUNT).fill(false);
    this.game.playground.tileState = { colors, lowered };
    // Ticking countdown in the last seconds.
    if (d.stage === 'show') {
      const left = Math.ceil((d.stageEnd - this.game.serverNow()) / 1000);
      if (left !== this.lastTick && left > 0 && left <= 3) { this.lastTick = left; this.game.audio.play('tap'); }
    } else this.lastTick = null;
    this.onTile = tileIndexAt(this.game.body.x, this.game.body.z);
  }

  // ---- Giant Ball -------------------------------------------------------------------------------
  buildBall() {
    const k = this.kit, s = this.scene;
    const tex = new DynamicTexture('giant-tex', { width: 512, height: 256 }, s, true);
    const ctx = tex.getContext();
    const stripes = [PALETTE.coral, '#FFFFFF', PALETTE.yellow, '#FFFFFF', PALETTE.turquoise, '#FFFFFF', PALETTE.purple, '#FFFFFF'];
    stripes.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * 64, 0, 64, 256); });
    tex.update();
    const mat = new StandardMaterial('giant-mat', s);
    mat.diffuseTexture = tex; mat.specularColor = new Color3(0.5, 0.5, 0.5); mat.specularPower = 40; mat.emissiveColor = new Color3(0.15, 0.15, 0.15);
    this.ballMesh = this.keep(CreateSphere('giant', { diameter: GIANT.radius * 2, segments: 20 }, s));
    this.ballMesh.material = mat;
    this.ballMesh.rotationQuaternion = Quaternion.Identity();
    const [sx, sz] = GIANT.path[0];
    this.ballMesh.position.set(sx, GIANT.radius, sz);
    this.ballPos = { x: sx, z: sz };
    this.game.shadows.addMesh(this.ballMesh);
    for (const b of GIANT_BARRIERS) this.box(b, b.color);
    for (const p of GOAL_POSTS) this.box(p, '#FFFFFF');
    const bar = this.keep(CreateCylinder('crossbar', { diameter: 0.3, height: 3.4, tessellation: 12 }, s));
    bar.rotation.z = Math.PI / 2; bar.position.set(GIANT.goal.x, 2.4, 12.4); bar.material = k.mat(PALETTE.coral, { gloss: 0.4 });
    const net = this.keep(CreatePlane('goalnet', { width: 3.4, height: 2.3 }, s));
    net.position.set(GIANT.goal.x, 1.15, 14.45); net.material = this.game.playground.netMaterial();
    const sign = this.keep(this.kit.sign('goal-sign', { symbol: '⚽', text: 'الهدف', color: PALETTE.turquoise, width: 1.8, height: 0.6 }));
    sign.position.set(GIANT.goal.x, 3.1, 12.4); sign.billboardMode = Mesh.BILLBOARDMODE_Y;
    this.gateMeshes = GIANT_GATES.map((gdef, i) => {
      const bx = gateBox(gdef, 0), w = bx.max[0] - bx.min[0], d = bx.max[2] - bx.min[2];
      const m = this.keep(this.kit.roundedBox(`gate${i}`, w, 1.2, d, 0.2, this.kit.mat(gdef.color, { gloss: 0.35 })));
      m.position.y = 0.6;
      this.game.shadows.addMesh(m);
      return { def: gdef, mesh: m };
    });
    // Arrows along the course.
    const arrowMat = this.kit.mat('#FFFFFF', { emissive: 0.8, name: 'ballArrow' });
    for (let i = 0; i < GIANT.path.length - 1; i++) {
      const [ax, az] = GIANT.path[i], [bx, bz] = GIANT.path[i + 1];
      for (let t = 0.25; t < 1; t += 0.5) {
        const arrow = this.keep(CreateDisc('ballarrow', { radius: 0.45, tessellation: 3 }, s));
        arrow.rotation.x = Math.PI / 2; arrow.rotation.y = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
        arrow.position.set(ax + (bx - ax) * t, 0.05, az + (bz - az) * t); arrow.material = arrowMat;
      }
    }
  }

  box(b, color) {
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
    const m = this.keep(this.kit.roundedBox('mgbox', w, h, d, Math.min(0.15, w / 3, d / 3), this.kit.mat(color, { gloss: 0.3 })));
    m.position.set((b.min[0] + b.max[0]) / 2, h / 2, (b.min[2] + b.max[2]) / 2);
    return m;
  }

  updateBall(dt, a) {
    const g = this.game, now = g.serverNow();
    const seconds = a.phase === 'play' ? (now - a.phaseStart) / 1000 : 0;
    for (const gm of this.gateMeshes) {
      const bx = gateBox(gm.def, seconds);
      gm.mesh.position.x = (bx.min[0] + bx.max[0]) / 2; gm.mesh.position.z = (bx.min[2] + bx.max[2]) / 2;
    }
    // Interpolate the server-simulated ball slightly in the past, like remote players.
    const b = this.ballBuffer, rt = now - 140;
    let x = a.data.x, z = a.data.z;
    if (b.length) {
      while (b.length > 2 && b[1].t <= rt) b.shift();
      const p = b[0], q = b[1] || b[0], k = q.t === p.t ? 1 : Math.max(0, Math.min(1.2, (rt - p.t) / (q.t - p.t)));
      x = p.x + (q.x - p.x) * k; z = p.z + (q.z - p.z) * k;
    }
    const prev = this.ballMesh.position, dx = x - prev.x, dz = z - prev.z, dist = Math.hypot(dx, dz);
    if (dist > 4) { prev.set(x, GIANT.radius, z); }
    else if (dist > 1e-4) {
      // Roll: rotate about the axis perpendicular to travel.
      const axis = new Vector3(dz / dist, 0, -dx / dist);
      this.ballMesh.rotationQuaternion = Quaternion.RotationAxis(axis, dist / GIANT.radius).multiply(this.ballMesh.rotationQuaternion);
      prev.set(x, GIANT.radius, z);
    }
    this.ballPos = { x, z };
  }

  // ---- Family Builders ----------------------------------------------------------------------------
  buildBuilders() {
    const s = this.scene;
    for (const slot of BLUEPRINT) {
      const ghost = this.pieceMesh(`ghost-${slot.id}`, slot.kind, slot.color, true);
      ghost.position.set(slot.x, slot.y + PIECE_SIZE[slot.kind][1] / 2, slot.z);
      this.ghosts.set(slot.id, ghost);
    }
    const pad = this.keep(CreateDisc('buildpad', { radius: 2.6, tessellation: 40 }, s));
    pad.rotation.x = Math.PI / 2; pad.position.set(BLUEPRINT[2].x, 0.02, BLUEPRINT[2].z); pad.material = this.kit.mat(PALETTE.cream, { emissive: 0.3, name: 'buildpad' });
    const ring = this.keep(CreateTorus('buildring', { diameter: 5.2, thickness: 0.12, tessellation: 40 }, s));
    ring.position.set(BLUEPRINT[2].x, 0.04, BLUEPRINT[2].z); ring.material = this.kit.mat(PALETTE.coral, { emissive: 0.5 });
  }

  pieceMesh(name, kind, color, ghost = false) {
    const [w, h, d] = PIECE_SIZE[kind];
    let m;
    const mat = ghost ? this.ghostMat(color) : this.kit.mat(color, { gloss: 0.3 });
    if (kind === 'star') {
      m = new Mesh(name, this.scene);
      const core = CreateCylinder(`${name}-core`, { diameter: 0.5, height: d, tessellation: 5 }, this.scene);
      core.rotation.x = Math.PI / 2; core.parent = m; core.material = mat;
      for (let i = 0; i < 5; i++) {
        const tip = CreateCylinder(`${name}-tip`, { diameterTop: 0, diameterBottom: 0.3, height: w * 0.42, tessellation: 4 }, this.scene);
        const ang = i / 5 * Math.PI * 2;
        tip.rotation.z = -ang; tip.position.set(Math.sin(ang) * w * 0.3, Math.cos(ang) * w * 0.3, 0);
        tip.parent = m; tip.material = mat;
      }
    } else {
      m = this.kit.roundedBox(name, w, h, d, Math.min(0.14, h / 3), mat);
    }
    this.keep(m);
    if (!ghost) this.game.shadows.addMesh(m);
    return m;
  }

  ghostMat(color) {
    const m = new StandardMaterial(`ghost-${color}`, this.scene);
    m.diffuseColor = Color3.FromHexString(color); m.emissiveColor = Color3.FromHexString(color).scale(0.6);
    m.alpha = 0.3; m.specularColor = Color3.Black(); m.disableLighting = false;
    this.props.push(m);
    return m;
  }

  syncPieces(a) {
    for (const p of a.data.pieces) {
      if (!this.pieceMeshes.has(p.id)) this.pieceMeshes.set(p.id, this.pieceMesh(`piece-${p.id}`, p.kind, p.color));
    }
  }

  carriedPosition(piece) {
    const g = this.game, d = this.world.activity.data;
    const holders = piece.holders.map(id => g.avatars.get(id)).filter(av => av?.visible);
    if (!holders.length) return null;
    const big = piece.kind === 'plank' && d.needTwo;
    if (big && holders.length < 2) return null;
    const pts = holders.map(av => av.carryAnchor.getAbsolutePosition());
    const c = pts.reduce((s, v) => s.addInPlace(v), new Vector3()).scale(1 / pts.length);
    if (holders.length === 1) {
      const av = holders[0];
      c.x += Math.sin(av.yaw) * 0.35; c.z += Math.cos(av.yaw) * 0.35;
    }
    return c;
  }

  updateBuilders(dt, time, a) {
    const d = a.data;
    for (const slot of BLUEPRINT) {
      const ghost = this.ghosts.get(slot.id);
      const filled = d.pieces.some(p => p.placed === slot.id);
      const ready = slot.needs.every(n => d.pieces.some(p => p.placed === n));
      ghost.setEnabled(!filled && ready);
      const pulse = 1 + Math.sin(time * 4) * 0.04;
      ghost.scaling.set(pulse, pulse, pulse);
    }
    for (const p of d.pieces) {
      const m = this.pieceMeshes.get(p.id);
      if (!m) continue;
      const [, h] = PIECE_SIZE[p.kind];
      if (p.placed) {
        const slot = BLUEPRINT.find(s => s.id === p.placed);
        m.position.set(slot.x, slot.y + h / 2, slot.z); m.rotation.set(0, 0, 0);
        continue;
      }
      const carried = this.carriedPosition(p);
      if (carried) {
        m.position.copyFrom(carried);
        if (p.kind === 'plank' && p.holders.length === 2) {
          const [a1, a2] = p.holders.map(id => this.game.avatars.get(id)?.position);
          if (a1 && a2) m.rotation.y = Math.atan2(a2.x - a1.x, a2.z - a1.z) - Math.PI / 2;
        } else {
          const av = this.game.avatars.get(p.holders[0]);
          if (av) m.rotation.y = av.yaw;
        }
      } else {
        const wobble = p.holders.length ? Math.sin(time * 18) * 0.03 : 0;
        m.position.set(p.x, h / 2 + wobble + (p.holders.length ? 0.1 : 0), p.z);
      }
    }
  }

  // ---- Hide and Seek ---------------------------------------------------------------------------
  updateHide(a) {
    const blind = a.phase === 'hide' && a.data.seeker === this.me;
    this.blind.classList.toggle('hidden', !blind);
    if (blind) {
      const left = Math.max(0, Math.ceil((a.phaseEnd - this.game.serverNow()) / 1000));
      const text = `🙈 ${T.dontLook}<b>${arabicDigits(left)}</b>`;
      if (this.blind.innerHTML !== text) this.blind.innerHTML = text;
    }
  }
}

export { TransformNode };
