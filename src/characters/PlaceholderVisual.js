// Simplified, rounded placeholder characters built from primitives with
// procedural animation. Implements the CharacterVisual interface:
//   root (TransformNode at the feet), carryAnchor, update(dt, anim, ctx), setExpression(name), dispose()
import { TransformNode, CreateSphere, CreateCapsule, CreateCylinder, CreateTorus, CreateDisc, Mesh, Vector3 } from '../babylon.js';

const TAU = Math.PI * 2;

export class PlaceholderVisual {
  constructor(scene, kit, def) {
    this.scene = scene;
    this.kit = kit;
    this.def = def;
    this.time = Math.random() * 10;
    this.blink = 2 + Math.random() * 3;
    this.expression = 'smile';
    this.build(def.look);
  }

  mat(color, opts) { return this.kit.mat(color, { gloss: 0.25, emissive: 0.14, ...opts }); }

  build(L) {
    const s = this.scene, H = L.height;
    // Proportions: children get relatively bigger heads for the cartoon look.
    const head = (0.2 + H * 0.085) * L.headScale;
    const legLen = H * 0.36 - (L.headScale - 1) * 0.08;
    const torsoH = H - legLen - head * 2 - 0.02;
    const bw = 0.2 * L.build * (0.75 + H * 0.2);
    this.dims = { head, legLen, torsoH, bw, H };

    this.root = new TransformNode(`${this.def.id}-root`, s);
    this.body = new TransformNode('body', s); this.body.parent = this.root;
    this.hips = new TransformNode('hips', s); this.hips.parent = this.body; this.hips.position.y = legLen;
    this.meshes = [];
    const add = (m, parent) => { m.parent = parent; this.meshes.push(m); return m; };

    // Torso: rounded capsule, dress flares for Mama and Najd.
    this.torso = new TransformNode('torso', s); this.torso.parent = this.hips;
    const torso = CreateCapsule('torso', { height: torsoH + bw * 0.6, radius: bw, tessellation: 14, subdivisions: 2, capSubdivisions: 5 }, s);
    torso.position.y = torsoH / 2; torso.scaling.z = 0.78; torso.material = this.mat(L.shirt);
    add(torso, this.torso);
    if (L.dress) {
      const skirt = CreateCylinder('skirt', { diameterTop: bw * 2.0, diameterBottom: bw * 2.9, height: legLen * 0.75 + torsoH * 0.25, tessellation: 18 }, s);
      skirt.position.y = -legLen * 0.2; skirt.scaling.z = 0.85; skirt.material = this.mat(L.pants);
      add(skirt, this.torso);
    } else {
      const belt = CreateTorus('belt', { diameter: bw * 1.95, thickness: bw * 0.35, tessellation: 18 }, s);
      belt.position.y = 0.02; belt.scaling.z = 0.8; belt.material = this.mat(L.pants);
      add(belt, this.torso);
    }
    // Collar accent.
    const collar = CreateTorus('collar', { diameter: bw * 1.1, thickness: bw * 0.28, tessellation: 16 }, s);
    collar.position.y = torsoH + bw * 0.1; collar.material = this.mat(L.accent);
    add(collar, this.torso);

    // Head group.
    this.neck = new TransformNode('neck', s); this.neck.parent = this.torso; this.neck.position.y = torsoH + bw * 0.25;
    this.head = new TransformNode('head', s); this.head.parent = this.neck; this.head.position.y = head * 0.92;
    const skull = CreateSphere('skull', { diameter: head * 2, segments: 16 }, s);
    skull.scaling.set(1.04, 1, 0.98); skull.material = this.mat(L.skin, { gloss: 0.15 });
    add(skull, this.head);
    this.buildFace(L, head);
    this.buildHair(L, head);

    // Arms and legs pivot at shoulders and hips.
    const armLen = torsoH * 0.95 + 0.06, armR = bw * 0.33;
    this.arms = [-1, 1].map(side => {
      const pivot = new TransformNode('shoulder', s); pivot.parent = this.torso;
      pivot.position.set(side * (bw + armR * 0.6), torsoH - armR * 0.2, 0);
      const arm = CreateCapsule('arm', { height: armLen, radius: armR, tessellation: 10, subdivisions: 1, capSubdivisions: 4 }, s);
      arm.position.y = -armLen / 2 + armR; arm.material = this.mat(L.shirt);
      add(arm, pivot);
      const hand = CreateSphere('hand', { diameter: armR * 2.5, segments: 10 }, s);
      hand.position.y = -armLen + armR; hand.material = this.mat(L.skin);
      add(hand, pivot);
      return { pivot, side, len: armLen };
    });
    const legR = bw * 0.42;
    this.legs = [-1, 1].map(side => {
      const pivot = new TransformNode('hip', s); pivot.parent = this.hips;
      pivot.position.set(side * bw * 0.48, 0, 0);
      const leg = CreateCapsule('leg', { height: legLen + legR, radius: legR, tessellation: 10, subdivisions: 1, capSubdivisions: 4 }, s);
      leg.position.y = -legLen / 2; leg.material = this.mat(L.dress ? L.skin : L.pants);
      add(leg, pivot);
      const shoe = CreateSphere('shoe', { diameter: legR * 2.6, segments: 10 }, s);
      shoe.scaling.set(0.9, 0.62, 1.35); shoe.position.set(0, -legLen + legR * 0.3, legR * 0.45); shoe.material = this.mat(L.shoes, { gloss: 0.4 });
      add(shoe, pivot);
      return { pivot, side };
    });

    // Items are carried at chest height in front, held with both hands.
    this.carryAnchor = new TransformNode('carry', s); this.carryAnchor.parent = this.torso;
    this.carryAnchor.position.set(0, torsoH * 0.55, bw + 0.2);
    this.seatHeight = legLen * 0.95;

    for (const m of this.meshes) { m.isPickable = false; }
  }

  buildFace(L, head) {
    const s = this.scene, white = this.mat('#FFFFFF', { emissive: 0.3 }), dark = this.mat('#2A1E1A', { emissive: 0, gloss: 0.6 });
    this.eyes = [-1, 1].map(side => {
      const eye = new TransformNode('eye', s); eye.parent = this.head;
      eye.position.set(side * head * 0.36, head * 0.12, head * 0.84);
      const ball = CreateSphere('eyeball', { diameter: head * 0.42, segments: 10 }, s);
      ball.scaling.set(0.85, 1.05, 0.5); ball.material = white; ball.parent = eye; this.meshes.push(ball);
      const pupil = CreateSphere('pupil', { diameter: head * 0.26, segments: 8 }, s);
      pupil.scaling.set(0.9, 1.1, 0.5); pupil.position.set(0, -head * 0.01, head * 0.09); pupil.material = dark; pupil.parent = eye; this.meshes.push(pupil);
      const glint = CreateSphere('glint', { diameter: head * 0.08, segments: 6 }, s);
      glint.position.set(side * -head * 0.04, head * 0.06, head * 0.16); glint.material = white; glint.parent = eye; this.meshes.push(glint);
      return eye;
    });
    // Brows for expression.
    this.brows = [-1, 1].map(side => {
      const brow = CreateCapsule('brow', { height: head * 0.3, radius: head * 0.045, tessellation: 6, subdivisions: 1 }, s);
      brow.rotation.z = Math.PI / 2 + side * 0.12; brow.position.set(side * head * 0.36, head * 0.43, head * 0.86);
      brow.material = this.mat(L.hair); brow.parent = this.head; this.meshes.push(brow);
      return brow;
    });
    const blush = this.mat('#FF9E9E', { emissive: 0.25, alpha: 0.75 });
    for (const side of [-1, 1]) {
      const cheek = CreateDisc('cheek', { radius: head * 0.14, tessellation: 12 }, s);
      cheek.position.set(side * head * 0.58, -head * 0.16, head * 0.78); cheek.rotation.y = Math.PI - side * 0.6;
      cheek.material = blush; cheek.parent = this.head; this.meshes.push(cheek);
    }
    const nose = CreateSphere('nose', { diameter: head * 0.2, segments: 8 }, s);
    nose.position.set(0, -head * 0.05, head * 0.98); nose.material = this.mat(L.skin); nose.parent = this.head; this.meshes.push(nose);
    // Smile: a half torus; an open mouth disc for laughing.
    this.smile = CreateTorus('smile', { diameter: head * 0.45, thickness: head * 0.07, tessellation: 16, arc: 0.5 }, s);
    this.smile.rotation.set(-Math.PI / 2, 0, Math.PI);
    this.smile.position.set(0, -head * 0.28, head * 0.9); this.smile.material = this.mat('#9C3B3B', { emissive: 0.1 });
    this.smile.parent = this.head; this.meshes.push(this.smile);
    this.mouthOpen = CreateSphere('mouthopen', { diameter: head * 0.34, segments: 10 }, s);
    this.mouthOpen.scaling.set(1, 0.75, 0.35); this.mouthOpen.position.set(0, -head * 0.34, head * 0.9);
    this.mouthOpen.material = this.mat('#8A2E36', { emissive: 0.1 }); this.mouthOpen.parent = this.head; this.mouthOpen.setEnabled(false); this.meshes.push(this.mouthOpen);
  }

  buildHair(L, head) {
    const s = this.scene, hair = this.mat(L.hair, { gloss: 0.3 });
    const add = m => { m.parent = this.head; m.material ??= hair; this.meshes.push(m); return m; };
    if (L.hairStyle === 'scarf') {
      // Soft hood-like headscarf: a slightly flattened shell sitting behind the face.
      const scarf = add(CreateSphere('scarf', { diameter: head * 2.26, segments: 18 }, s));
      scarf.material = this.mat(L.accent); scarf.scaling.set(1.02, 1.02, 0.86); scarf.position.set(0, head * 0.1, -head * 0.26);
      const drape = add(CreateCapsule('drape', { height: head * 1.7, radius: head * 0.66, tessellation: 12 }, s));
      drape.material = this.mat(L.accent); drape.position.set(0, -head * 0.72, -head * 0.3); drape.scaling.z = 0.75;
      const band = add(CreateTorus('scarfband', { diameter: head * 1.72, thickness: head * 0.13, tessellation: 24 }, s));
      band.material = this.mat(L.shirt); band.rotation.x = Math.PI / 2; band.position.set(0, head * 0.06, head * 0.46); band.scaling.set(0.98, 1.2, 1);
      return;
    }
    const cap = add(CreateSphere('hair', { diameter: head * 2.1, segments: 14, slice: 0.5 }, s));
    cap.rotation.x = -0.35; cap.position.set(0, head * 0.06, -head * 0.06);
    if (L.hairStyle === 'short') {
      cap.scaling.set(1.02, 0.78, 1.04); cap.position.y = head * 0.2;
    }
    if (L.hairStyle === 'cap') {
      const hat = add(CreateSphere('cap', { diameter: head * 2.14, segments: 14, slice: 0.5 }, s));
      hat.material = this.mat(L.accent, { gloss: 0.3 }); hat.position.y = head * 0.18; hat.rotation.x = -0.12;
      const brim = add(CreateCylinder('brim', { diameter: head * 1.3, height: head * 0.08, tessellation: 16 }, s));
      brim.material = this.mat(L.accent); brim.position.set(0, head * 0.48, head * 0.85); brim.scaling.z = 0.8; brim.rotation.x = 0.15;
    }
    if (L.hairStyle === 'ponytail') {
      const tail = add(CreateCapsule('ponytail', { height: head * 1.3, radius: head * 0.3, tessellation: 10 }, s));
      tail.position.set(0, head * 0.2, -head * 1.05); tail.rotation.x = 0.5;
      const bow = add(CreateSphere('bow', { diameter: head * 0.42, segments: 8 }, s));
      bow.material = this.mat(L.accent, { gloss: 0.4 }); bow.position.set(0, head * 0.7, -head * 0.8); bow.scaling.set(1.6, 0.8, 0.8);
      this.ponytail = tail;
    }
    if (L.hairStyle === 'buns') {
      for (const side of [-1, 1]) {
        const bun = add(CreateSphere('bun', { diameter: head * 0.7, segments: 10 }, s));
        bun.position.set(side * head * 0.72, head * 0.72, -head * 0.1);
        const tie = add(CreateTorus('tie', { diameter: head * 0.5, thickness: head * 0.1, tessellation: 12 }, s));
        tie.material = this.mat(L.shoes); tie.position.set(side * head * 0.58, head * 0.58, -head * 0.08); tie.rotation.z = side * 0.8;
      }
    }
    if (L.beard) {
      // Rounded jaw beard hugging the chin, plus a friendly moustache.
      const beard = add(CreateSphere('beard', { diameter: head * 2.12, segments: 16, slice: 0.5 }, s));
      beard.rotation.x = Math.PI + 0.55; beard.position.set(0, -head * 0.02, head * 0.02); beard.scaling.set(1.02, 1, 1.02);
      const stache = add(CreateCapsule('stache', { height: head * 0.5, radius: head * 0.08, tessellation: 8, subdivisions: 1 }, s));
      stache.rotation.z = Math.PI / 2; stache.position.set(0, -head * 0.2, head * 0.95);
      this.smile.position.y = -head * 0.36;
      this.mouthOpen.position.y = -head * 0.4;
    }
    if (L.glasses) {
      const frame = this.mat('#2E2A3A', { gloss: 0.6 });
      for (const side of [-1, 1]) {
        const lens = add(CreateTorus('glasses', { diameter: head * 0.52, thickness: head * 0.06, tessellation: 16 }, s));
        lens.material = frame; lens.rotation.x = Math.PI / 2; lens.position.set(side * head * 0.36, head * 0.12, head * 0.93);
      }
      const bridge = add(CreateCylinder('bridge', { diameter: head * 0.05, height: head * 0.2, tessellation: 6 }, s));
      bridge.material = frame; bridge.rotation.z = Math.PI / 2; bridge.position.set(0, head * 0.15, head * 0.98);
    }
  }

  setExpression(name) { this.expression = name; }

  // ctx: { speed (m/s), time since state began (stateTime), grounded, landed (0..1) }
  update(dt, anim, ctx = {}) {
    this.time += dt;
    const t = this.time, d = this.dims;
    const speed = ctx.speed || 0, st = ctx.stateTime || 0;
    let hipY = d.legLen, bodyY = 0, lean = 0, headTilt = 0, headTurn = 0, squash = 1;
    let armL = 0, armR = 0, armSpreadL = 0.08, armSpreadR = 0.08, legL = 0, legR = 0, kneeBend = 0, spin = 0;
    let face = this.expression;

    switch (anim) {
      case 'walk': case 'run': case 'carryWalk': {
        const run = anim === 'run', freq = run ? 2.6 : 1.9 + speed * 0.12;
        const ph = t * freq * TAU / 2;
        const amp = run ? 0.85 : 0.55;
        legL = Math.sin(ph) * amp; legR = -legL;
        armL = -Math.sin(ph) * amp * 0.9; armR = -armL;
        bodyY = Math.abs(Math.sin(ph)) * (run ? 0.09 : 0.05) * (d.H / 1.5);
        lean = run ? 0.18 : 0.05;
        headTilt = -lean * 0.5;
        if (anim === 'carryWalk') { armL = armR = -1.25; armSpreadL = armSpreadR = 0.35; }
        break;
      }
      case 'jump': case 'fall': {
        legL = 0.55; legR = -0.2; armL = armR = -2.4; armSpreadL = armSpreadR = 0.45;
        lean = -0.05; face = 'open';
        if (anim === 'fall') { armL = armR = -2.8; legL = 0.2; legR = 0.3; }
        break;
      }
      case 'land': {
        const k = Math.max(0, 1 - st / 0.22);
        squash = 1 - 0.18 * k; bodyY = -0.08 * k * d.H;
        armL = armR = -0.6 * k; armSpreadL = armSpreadR = 0.5 * k;
        break;
      }
      case 'sit': case 'swing': case 'slide': {
        hipY = 0.06; // the root sits on the seat surface
        legL = legR = -Math.PI / 2 + (anim === 'swing' ? (ctx.swing || 0) * 0.6 : 0);
        armL = armR = anim === 'slide' ? -2.7 : -2.6;
        armSpreadL = armSpreadR = anim === 'slide' ? 0.6 : 0.22;
        lean = anim === 'swing' ? -(ctx.swing || 0) * 0.35 : anim === 'slide' ? -0.35 : 0;
        face = anim === 'sit' ? face : 'open';
        break;
      }
      case 'carry': {
        armL = armR = -1.25; armSpreadL = armSpreadR = 0.35;
        bodyY = Math.sin(t * 2.2) * 0.008;
        break;
      }
      case 'wave': {
        armR = -2.9 + Math.sin(st * 14) * 0.08; armSpreadR = 0.25 + Math.sin(st * 12) * 0.35;
        headTilt = 0.1; headTurn = Math.sin(st * 3) * 0.1;
        break;
      }
      case 'laugh': {
        face = 'open';
        bodyY = Math.abs(Math.sin(st * 16)) * 0.03; lean = -0.12 + Math.sin(st * 16) * 0.05;
        armL = armR = -0.5; armSpreadL = armSpreadR = 0.5; headTilt = -0.25;
        break;
      }
      case 'clap': {
        armL = armR = -1.4; const c = Math.abs(Math.sin(st * 11));
        armSpreadL = armSpreadR = -0.35 + c * 0.55; face = 'open';
        break;
      }
      case 'celebrate': {
        const hop = Math.abs(Math.sin(st * 6));
        bodyY = hop * 0.28 * Math.min(1, d.H / 1.2); armL = armR = -2.9; armSpreadL = armSpreadR = 0.5 + hop * 0.3;
        legL = hop * 0.3; legR = hop * 0.3; face = 'open';
        spin = st < 0.6 ? st / 0.6 * TAU : 0;
        break;
      }
      default: { // idle
        const b = Math.sin(t * 1.8);
        bodyY = b * 0.006; armSpreadL = armSpreadR = 0.1 + b * 0.02; headTurn = Math.sin(t * 0.5) * 0.18;
        headTilt = Math.sin(t * 0.7) * 0.05;
      }
    }

    // Smoothly approach the target pose.
    const k = 1 - Math.exp(-dt * 14), lerp = (a, b) => a + (b - a) * k;
    const r = this.rest || (this.rest = { hipY: d.legLen, bodyY: 0, lean: 0, armL: 0, armR: 0, sl: 0, sr: 0, legL: 0, legR: 0, headTilt: 0, headTurn: 0, squash: 1 });
    r.hipY = lerp(r.hipY, hipY); r.bodyY = lerp(r.bodyY, bodyY); r.lean = lerp(r.lean, lean);
    r.armL = lerp(r.armL, armL); r.armR = lerp(r.armR, armR); r.sl = lerp(r.sl, armSpreadL); r.sr = lerp(r.sr, armSpreadR);
    r.legL = lerp(r.legL, legL); r.legR = lerp(r.legR, legR); r.headTilt = lerp(r.headTilt, headTilt); r.headTurn = lerp(r.headTurn, headTurn);
    r.squash = lerp(r.squash, squash);

    this.hips.position.y = r.hipY + r.bodyY;
    this.torso.rotation.x = r.lean;
    this.body.scaling.set(1 + (1 - r.squash) * 0.6, r.squash, 1 + (1 - r.squash) * 0.6);
    this.body.rotation.y = spin;
    this.arms[0].pivot.rotation.set(r.armL, 0, -r.sl);
    this.arms[1].pivot.rotation.set(r.armR, 0, r.sr);
    this.legs[0].pivot.rotation.x = r.legL;
    this.legs[1].pivot.rotation.x = r.legR;
    this.head.rotation.set(r.headTilt, r.headTurn, 0);
    if (this.ponytail) this.ponytail.rotation.x = 0.5 + Math.sin(t * 5) * 0.08 * (1 + speed * 0.2);

    // Blinking and mouth.
    this.blink -= dt;
    const closed = this.blink < 0.12;
    if (this.blink < 0) this.blink = 2.2 + Math.random() * 3;
    for (const e of this.eyes) e.scaling.y = closed ? 0.12 : 1;
    const open = face === 'open';
    this.smile.setEnabled(!open);
    this.mouthOpen.setEnabled(open);
    if (open) this.mouthOpen.scaling.y = 0.6 + Math.abs(Math.sin(t * 9)) * 0.3;
    for (const [i, b] of this.brows.entries()) b.position.y = this.dims.head * (open ? 0.5 : 0.43) + (i ? 0 : 0);
  }

  shadowMeshes() { return this.meshes.filter(m => m.name === 'torso' || m.name === 'skull' || m.name === 'leg' || m.name === 'skirt' || m.name === 'arm'); }

  dispose() { this.root.dispose(false, false); }
}
