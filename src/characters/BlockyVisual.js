// Blocky, toy-brick style characters (original designs): box head, torso,
// arms and legs with smooth plastic materials. Reuses PlaceholderVisual's
// procedural animation by building the same rig nodes.
import { TransformNode, CreateCylinder, CreateBox } from '../babylon.js';
import { PlaceholderVisual } from './PlaceholderVisual.js';

export class BlockyVisual extends PlaceholderVisual {
  mat(color, opts) { return this.kit.mat(color, { gloss: 0.42, emissive: 0.1, ...opts }); }

  box(name, w, h, d, color, parent, opts) {
    const m = this.kit.roundedBox(name, w, h, d, Math.min(0.035, w / 4, h / 4, d / 4), this.mat(color, opts));
    m.parent = parent;
    m.isPickable = false;
    this.meshes.push(m);
    return m;
  }

  build(L) {
    const s = this.scene, H = L.height;
    // Brick-figure proportions: legs 2u, torso 2u, head ~1.2u; children get bigger heads.
    const u = H / (5.2 + (L.headScale - 1) * 1.6);
    const headSize = 1.2 * u * L.headScale;
    const legLen = 2 * u, torsoH = 2 * u;
    const bw = u * L.build;        // half torso width
    const head = headSize / 2;     // half head size (face features are placed relative to it)
    this.dims = { head, legLen, torsoH, bw, H };

    this.root = new TransformNode(`${this.def.id}-root`, s);
    this.body = new TransformNode('body', s); this.body.parent = this.root;
    this.hips = new TransformNode('hips', s); this.hips.parent = this.body; this.hips.position.y = legLen;
    this.meshes = [];

    this.torso = new TransformNode('torso', s); this.torso.parent = this.hips;
    const torso = this.box('torso', bw * 2, torsoH, u, L.shirt, this.torso);
    torso.position.y = torsoH / 2;
    // Shirt stripe / collar accent printed on the front.
    const stripe = this.box('stripe', bw * 2 + 0.004, torsoH * 0.12, u + 0.004, L.accent, this.torso);
    stripe.position.y = torsoH * 0.9;
    if (L.dress) {
      const skirt = CreateCylinder('skirt', { diameterTop: bw * 2.5, diameterBottom: bw * 3.3, height: legLen * 0.8, tessellation: 4 }, s);
      skirt.rotation.y = Math.PI / 4; skirt.scaling.z = 0.55; skirt.position.y = -legLen * 0.3;
      skirt.material = this.mat(L.pants); skirt.parent = this.torso; this.meshes.push(skirt);
    } else {
      const belt = this.box('belt', bw * 2 + 0.01, torsoH * 0.12, u + 0.01, L.pants, this.torso);
      belt.position.y = torsoH * 0.06;
    }

    this.neck = new TransformNode('neck', s); this.neck.parent = this.torso; this.neck.position.y = torsoH;
    this.head = new TransformNode('head', s); this.head.parent = this.neck; this.head.position.y = head * 1.02;
    const skull = this.box('skull', headSize, headSize, headSize * 0.95, L.skin, this.head, { gloss: 0.3 });
    void skull;
    this.buildFace(L, head);
    this.buildHair(L, head);

    this.arms = [-1, 1].map(side => {
      const pivot = new TransformNode('shoulder', s); pivot.parent = this.torso;
      pivot.position.set(side * (bw + u * 0.5), torsoH - u * 0.3, 0);
      const arm = this.box('arm', u, torsoH, u, L.shirt, pivot);
      arm.position.y = -torsoH / 2 + u * 0.3;
      const hand = this.box('hand', u * 0.98, u * 0.55, u * 0.98, L.skin, pivot);
      hand.position.y = -torsoH + u * 0.55;
      return { pivot, side, len: torsoH };
    });
    this.legs = [-1, 1].map(side => {
      const pivot = new TransformNode('hip', s); pivot.parent = this.hips;
      pivot.position.set(side * bw / 2, 0, 0);
      const leg = this.box('leg', bw * 0.98, legLen, u, L.dress ? L.skin : L.pants, pivot);
      leg.position.y = -legLen / 2;
      const shoe = this.box('shoe', bw, u * 0.4, u * 1.15, L.shoes, pivot, { gloss: 0.5 });
      shoe.position.set(0, -legLen + u * 0.2, u * 0.08);
      return { pivot, side };
    });

    this.carryAnchor = new TransformNode('carry', s); this.carryAnchor.parent = this.torso;
    this.carryAnchor.position.set(0, torsoH * 0.55, u * 0.5 + 0.22);
    this.seatHeight = legLen * 0.95;
  }

  // Face features are thin blocks flush with the front of the head.
  buildFace(L, head) {
    const z = head * 0.95 + 0.004, dark = '#1E1A24';
    const flat = (name, w, h, color, x, y, parent = this.head) => {
      const m = CreateBox(name, { width: w, height: h, depth: 0.01 }, this.scene);
      m.material = this.mat(color, { emissive: color === dark ? 0 : 0.25, gloss: 0.6 });
      m.position.set(x, y, z); m.parent = parent; m.isPickable = false;
      this.meshes.push(m);
      return m;
    };
    this.eyes = [-1, 1].map(side => {
      const eye = new TransformNode('eye', this.scene); eye.parent = this.head;
      eye.position.set(side * head * 0.36, head * 0.12, 0);
      flat('pupil', head * 0.2, head * 0.34, dark, 0, 0, eye);
      flat('glint', head * 0.07, head * 0.1, '#FFFFFF', -side * head * 0.03, head * 0.08, eye).position.z = z + 0.004;
      return eye;
    });
    this.brows = [-1, 1].map(side => {
      const b = flat('brow', head * 0.3, head * 0.06, L.hair, side * head * 0.36, head * 0.43);
      b.rotation.z = side * -0.12;
      return b;
    });
    for (const side of [-1, 1]) flat('cheek', head * 0.2, head * 0.1, '#FF9E9E', side * head * 0.58, -head * 0.2).material.alpha = 0.8;
    // Classic block smile: a flat bar with two raised corners.
    this.smile = new TransformNode('smile', this.scene); this.smile.parent = this.head;
    flat('smileBar', head * 0.44, head * 0.07, dark, 0, -head * 0.38, this.smile);
    for (const side of [-1, 1]) flat('smileEnd', head * 0.07, head * 0.14, dark, side * head * 0.25, -head * 0.32, this.smile);
    this.mouthOpen = flat('mouthOpen', head * 0.36, head * 0.26, '#8A2E36', 0, -head * 0.36);
    this.mouthOpen.setEnabled(false);
  }

  buildHair(L, head) {
    const hs = head * 2, hair = L.hair, H = this.head;
    const add = (name, w, h, d, color, x, y, z) => { const m = this.box(name, w, h, d, color, H); m.position.set(x, y, z); return m; };
    if (L.hairStyle === 'scarf') {
      add('scarfTop', hs * 1.14, hs * 0.2, hs * 1.08, L.accent, 0, head + hs * 0.06, -hs * 0.03);
      for (const side of [-1, 1]) add('scarfSide', hs * 0.1, hs * 1.08, hs * 1.08, L.accent, side * (head + hs * 0.05), -hs * 0.02, -hs * 0.03);
      add('scarfBack', hs * 1.14, hs * 1.3, hs * 0.14, L.accent, 0, -hs * 0.12, -head - hs * 0.06);
      add('scarfDrape', hs * 1.1, hs * 0.6, hs * 0.5, L.accent, 0, -head - hs * 0.2, -hs * 0.25);
      return;
    }
    add('hairTop', hs * 1.08, hs * 0.22, hs * 1.06, hair, 0, head + hs * 0.07, -hs * 0.02);
    add('hairBack', hs * 1.08, hs * 0.7, hs * 0.14, hair, 0, head * 0.3, -head - hs * 0.05);
    if (L.hairStyle === 'short') add('fringe', hs * 1.08, hs * 0.12, hs * 0.16, hair, 0, head * 0.86, head * 0.88);
    if (L.hairStyle === 'cap') {
      add('cap', hs * 1.12, hs * 0.3, hs * 1.1, L.accent, 0, head + hs * 0.12, -hs * 0.01);
      add('brim', hs * 0.9, hs * 0.06, hs * 0.45, L.accent, 0, head + hs * 0.0, head + hs * 0.18);
    }
    if (L.hairStyle === 'ponytail') {
      add('bow', hs * 0.5, hs * 0.2, hs * 0.2, L.accent, 0, head * 0.7, -head - hs * 0.14);
      this.ponytail = new TransformNode('ponytailPivot', this.scene);
      this.ponytail.parent = H; this.ponytail.position.set(0, head * 0.6, -head - hs * 0.12);
      const tail = this.box('ponytail', hs * 0.3, hs * 0.75, hs * 0.3, hair, this.ponytail);
      tail.position.y = -hs * 0.35;
    }
    if (L.hairStyle === 'buns') {
      for (const side of [-1, 1]) {
        add('bun', hs * 0.38, hs * 0.38, hs * 0.38, hair, side * head * 0.8, head + hs * 0.12, -hs * 0.05);
        add('tie', hs * 0.4, hs * 0.08, hs * 0.4, L.shoes, side * head * 0.8, head + hs * 0.0, -hs * 0.05);
      }
    }
    if (L.beard) {
      add('beard', hs * 1.04, hs * 0.34, hs * 0.2, hair, 0, -head * 0.72, head * 0.88);
      add('stache', hs * 0.5, hs * 0.08, hs * 0.08, hair, 0, -head * 0.16, head * 1.0);
      this.smile.position.z = hs * 0.1; this.mouthOpen.position.z += hs * 0.1;
      this.smile.position.y = -head * 0.06;
    }
    if (L.glasses) {
      const frame = '#2E2A3A';
      for (const side of [-1, 1]) {
        add('lensTop', hs * 0.34, hs * 0.04, hs * 0.04, frame, side * head * 0.36, head * 0.34, head * 0.98);
        add('lensBottom', hs * 0.34, hs * 0.04, hs * 0.04, frame, side * head * 0.36, -head * 0.1, head * 0.98);
        for (const e of [-1, 1]) add('lensSide', hs * 0.04, hs * 0.26, hs * 0.04, frame, side * head * 0.36 + e * hs * 0.15, head * 0.12, head * 0.98);
      }
    }
  }

  // Legs/shirt/head cast shadows (fewer casters than every small part).
  shadowMeshes() { return this.meshes.filter(m => ['torso', 'skull', 'leg', 'arm', 'skirt'].includes(m.name)); }
}
