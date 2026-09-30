// A family member: a Kenney Mini Character scaled to its role's height, with the
// outfit colour painted into its own copy of the UV palette texture, one
// accessory on the head bone, animations chosen from the physics state, and
// emoji pop-ups.
import {
  TransformNode, Vector3, Quaternion, Color3, RawTexture, Texture, DynamicTexture, StandardMaterial, PBRMaterial,
  CreatePlane, CreateCylinder, CreateSphere, CreateTorus, Mesh, type AnimationGroup, type Scene, type AbstractMesh
} from '../babylon';
import type { Assets } from '../world/assets';
import { CHARACTERS, type CharacterId } from '../../../shared/constants';
import type { Look } from '../../../shared/protocol';
import boundsJson from '../../../world/model-bounds.json';

const B = boundsJson as Record<string, { min: number[]; max: number[] }>;
const recolorCache = new Map<string, Promise<Texture | null>>();

export class Avatar {
  scene: Scene;
  root: TransformNode;
  body: TransformNode;
  anims = new Map<string, AnimationGroup>();
  current = '';
  look: Look;
  meshes: AbstractMesh[] = [];
  head: TransformNode | null = null;
  emojiPlane: Mesh | null = null;
  emojiT = -9;
  ring: Mesh;
  emoteUntil = 0;
  ready: Promise<void>;
  disposed = false;

  constructor(scene: Scene, a: Assets, look: Look, color: string) {
    this.scene = scene; this.look = look;
    this.root = new TransformNode('avatar', scene);
    this.body = new TransformNode('avatar-body', scene);
    this.body.parent = this.root;
    this.ring = CreateTorus('avatar-ring', { diameter: 0.9, thickness: 0.06, tessellation: 24 }, scene);
    const rm = new StandardMaterial('ring-' + color, scene);
    rm.emissiveColor = Color3.FromHexString(color); rm.disableLighting = true; rm.alpha = 0.9;
    this.ring.material = rm; this.ring.parent = this.root; this.ring.position.y = 0.04; this.ring.isPickable = false;
    this.ready = this.build(a, look);
  }

  async build(a: Assets, look: Look) {
    const ch = CHARACTERS[look.char as CharacterId];
    const cont = await a.load(ch.model);
    if (this.disposed) return;
    const inst = cont.instantiateModelsToScene(n => n, true, { doNotInstantiate: true });
    const top = inst.rootNodes[0];
    top.parent = this.body;
    const h = (B[ch.model]?.max[1] ?? 0.75) - (B[ch.model]?.min[1] ?? 0);
    this.body.scaling.setAll(ch.height / h);
    for (const g of inst.animationGroups) {
      const name = g.name.replace(/^Clone of /, '');
      g.stop();
      g.enableBlending = true; g.blendingSpeed = 0.12;
      this.anims.set(name, g);
    }
    this.meshes = (top as TransformNode).getChildMeshes(false);
    for (const m of this.meshes) { m.isPickable = false; m.alwaysSelectAsActiveMesh = false; }
    this.head = (top as TransformNode).getChildTransformNodes(false).find(n => n.name === 'head') || null;
    // Outfit colour through the palette texture.
    const mat = this.meshes.find(m => m.material instanceof PBRMaterial)?.material as PBRMaterial | undefined;
    if (mat?.albedoTexture) {
      const body = this.meshes.find(m => m.name.startsWith('body-mesh')) as Mesh | undefined;
      const tex = await recolor(this.scene, ch.model, mat.albedoTexture as Texture, body, look.color);
      if (tex && !this.disposed) for (const m of this.meshes) if (m.material instanceof PBRMaterial) m.material.albedoTexture = tex;
    }
    for (const m of this.meshes) if (m.material instanceof PBRMaterial) { m.material.metallic = 0; m.material.roughness = 1; m.material.unlit = false; (m.material as any).environmentIntensity = 0; m.material.directIntensity = 1.6; }
    await this.attachAccessory(a, look);
    this.play('idle');
  }

  async attachAccessory(a: Assets, look: Look) {
    const head = this.head;
    if (!head || look.acc === 'none') return;
    let node: TransformNode;
    if (look.acc === 'glasses' || look.acc === 'sunglasses') {
      const cont = await a.load(look.acc === 'glasses' ? 'chr/aid-glasses' : 'chr/aid-sunglasses');
      const inst = cont.instantiateModelsToScene(n => n, false, { doNotInstantiate: true });
      node = inst.rootNodes[0] as TransformNode;
    } else {
      node = new TransformNode('acc', this.scene);
      const mat = new StandardMaterial('acc-' + look.acc, this.scene);
      mat.specularColor = new Color3(0.2, 0.2, 0.2);
      if (look.acc === 'cap') {
        mat.diffuseColor = Color3.FromHexString(look.color);
        const crown = CreateSphere('cap', { diameter: 0.34, slice: 0.5, segments: 12 }, this.scene);
        crown.scaling.y = 0.75; crown.position.y = 0.3;
        const brim = CreateCylinder('brim', { diameter: 0.3, height: 0.02, tessellation: 16 }, this.scene);
        brim.position.set(0, 0.31, 0.14); brim.scaling.z = 0.8;
        for (const p of [crown, brim]) { p.material = mat; p.parent = node; }
      } else if (look.acc === 'bow') {
        mat.diffuseColor = Color3.FromHexString('#FF4F9A');
        for (const s of [-1, 1]) {
          const w = CreateCylinder('bow', { diameterTop: 0, diameterBottom: 0.16, height: 0.14, tessellation: 4 }, this.scene);
          w.rotation.z = s * Math.PI / 2; w.position.set(s * 0.08, 0.36, -0.02); w.material = mat; w.parent = node;
        }
        const k = CreateSphere('knot', { diameter: 0.07, segments: 6 }, this.scene); k.position.set(0, 0.36, -0.02); k.material = mat; k.parent = node;
      } else {
        mat.diffuseColor = Color3.FromHexString('#FFC93C'); mat.emissiveColor = new Color3(0.25, 0.18, 0);
        const band = CreateCylinder('crown', { diameter: 0.26, height: 0.08, tessellation: 12 }, this.scene);
        band.position.y = 0.36; band.material = mat; band.parent = node;
        for (let i = 0; i < 5; i++) {
          const sp = CreateCylinder('spike', { diameterTop: 0, diameterBottom: 0.06, height: 0.08, tessellation: 4 }, this.scene);
          const ang = i / 5 * Math.PI * 2;
          sp.position.set(Math.sin(ang) * 0.11, 0.43, Math.cos(ang) * 0.11); sp.material = mat; sp.parent = node;
        }
      }
    }
    node.parent = head;
    node.position.setAll(0);
    node.rotationQuaternion = Quaternion.Identity();
    for (const m of node.getChildMeshes(false)) m.isPickable = false;
  }

  play(name: string) {
    if (name === this.current) return;
    const next = this.anims.get(name) || this.anims.get('idle');
    if (!next) return;
    for (const [n, g] of this.anims) if (n !== name && g.isPlaying) g.stop();
    next.start(!['jump', 'pick-up', 'emote-yes'].includes(name), 1, next.from, next.to, false);
    this.current = name;
  }

  // Choose an animation from what the physics says the player is doing.
  pose(mode: string, vel: number[], grounded: boolean, carrying: boolean, time: number) {
    const hs = Math.hypot(vel[0], vel[2]);
    let a = 'idle';
    if (mode === 'seat' || mode === 'slide') a = 'sit';
    else if (mode === 'climb' || mode === 'climbUp') a = 'holding-both';
    else if (mode === 'hang') a = 'holding-both';
    else if (mode === 'claw') a = 'interact-right';
    else if (mode === 'air' && !grounded) a = vel[1] > 0.5 ? 'jump' : 'fall';
    else if (carrying) a = 'holding-both';
    else if (hs > 3.6) a = 'sprint';
    else if (hs > 0.3) a = 'walk';
    else if (time < this.emoteUntil) a = 'emote-yes';
    this.play(a);
    // Hanging: lift the arms above the head by tilting the whole body back a touch.
    this.body.position.y = mode === 'hang' ? 0.25 : mode === 'seat' ? 0.12 : 0;
    this.ring.setEnabled(mode === 'walk' || mode === 'air' || mode === 'follow' || mode === 'frozen');
  }

  place(x: number, y: number, z: number, yaw: number) {
    this.root.position.set(x, y, z);
    (this.root.rotationQuaternion ||= new Quaternion()).copyFrom(Quaternion.RotationAxis(Vector3.Up(), yaw));
  }

  emoji(e: string, time: number) {
    if (!this.emojiPlane) {
      this.emojiPlane = CreatePlane('emoji', { size: 0.9 }, this.scene);
      this.emojiPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;
      const m = new StandardMaterial('emoji', this.scene);
      m.disableLighting = true; m.emissiveColor = Color3.White(); m.useAlphaFromDiffuseTexture = true;
      this.emojiPlane.material = m;
      this.emojiPlane.parent = this.root;
      this.emojiPlane.isPickable = false;
    }
    const tex = new DynamicTexture('emoji-t', { width: 128, height: 128 }, this.scene, true);
    const g = tex.getContext() as CanvasRenderingContext2D;
    g.clearRect(0, 0, 128, 128);
    g.font = '96px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(e, 64, 70);
    tex.update(); tex.hasAlpha = true;
    const m = this.emojiPlane.material as StandardMaterial;
    m.diffuseTexture?.dispose();
    m.diffuseTexture = tex; m.emissiveTexture = tex;
    this.emojiT = time;
    this.emoteUntil = time + 1.2;
  }

  tick(time: number) {
    if (!this.emojiPlane) return;
    const age = time - this.emojiT;
    const on = age < 2.2;
    this.emojiPlane.setEnabled(on);
    if (on) {
      const s = age < 0.25 ? age / 0.25 * 1.2 : age < 0.4 ? 1.2 - (age - 0.25) : 1;
      this.emojiPlane.scaling.setAll(s);
      this.emojiPlane.position.y = 2.3 + age * 0.25;
      (this.emojiPlane.material as StandardMaterial).alpha = age > 1.8 ? (2.2 - age) / 0.4 : 1;
    }
  }

  dispose() {
    this.disposed = true;
    for (const g of this.anims.values()) g.dispose();
    this.root.dispose(false, true);
  }
}

// Find the shirt colour (the palette cell under the torso) and repaint it.
async function recolor(scene: Scene, model: string, tex: Texture, body: Mesh | undefined, color: string): Promise<Texture | null> {
  const key = model + color;
  let p = recolorCache.get(key);
  if (!p) {
    p = (async () => {
      try {
        const size = tex.getSize();
        const px = await tex.readPixels() as Uint8Array | null;
        if (!px || !body) return null;
        const uv = body.getVerticesData('uv');
        const idx = body.getVerticesData('matricesIndices');
        const wts = body.getVerticesData('matricesWeights');
        const sk = body.skeleton;
        if (!uv || !idx || !wts || !sk) return null;
        const torso = sk.bones.findIndex(b => b.name === 'torso');
        // Apply the glTF texture transform (KHR_texture_transform) the model uses.
        const pick = (u0: number, v0: number) => {
          const u = u0 * tex.uScale + tex.uOffset, v = v0 * tex.vScale + tex.vOffset;
          const x = Math.min(size.width - 1, Math.max(0, Math.floor(u * size.width)));
          const y = Math.min(size.height - 1, Math.max(0, Math.floor(v * size.height)));
          const o = (y * size.width + x) * 4;
          return (px[o] << 16) | (px[o + 1] << 8) | px[o + 2];
        };
        // The shirt is the colour found both on the torso and on the sleeves.
        // readPixels row order differs between backends: try both, ignore empty (black) texels.
        const arms = [sk.bones.findIndex(b => b.name === 'arm-left'), sk.bones.findIndex(b => b.name === 'arm-right')];
        const histFor = (flip: boolean) => {
          const hT = new Map<number, number>(), hA = new Map<number, number>();
          const tri = body.getIndices() || [];
          const bw = (i: number, bones: number[]) => { let w = 0; for (let k = 0; k < 4; k++) if (bones.includes(idx[i * 4 + k])) w += wts[i * 4 + k]; return w; };
          for (let t = 0; t < tri.length; t += 3) {
            // Sample at the triangle centre: vertices sit on palette-cell borders.
            const [i0, i1, i2] = [tri[t], tri[t + 1], tri[t + 2]];
            const u = (uv[i0 * 2] + uv[i1 * 2] + uv[i2 * 2]) / 3, v = (uv[i0 * 2 + 1] + uv[i1 * 2 + 1] + uv[i2 * 2 + 1]) / 3;
            const c = pick(u, flip ? 1 - v : v);
            if (c === 0) continue;
            const wt = (bw(i0, [torso]) + bw(i1, [torso]) + bw(i2, [torso])) / 3, wa = (bw(i0, arms) + bw(i1, arms) + bw(i2, arms)) / 3;
            if (wt > 0.6) hT.set(c, (hT.get(c) || 0) + 1);
            if (wa > 0.6) hA.set(c, (hA.get(c) || 0) + 1);
          }
          let best = -1, score = 0;
          for (const [c, n] of hT) { const sc = n * (hA.get(c) || 0); if (sc > score) { score = sc; best = c; } }
          return best >= 0 ? { c: best, share: score } : null;
        };
        const a = histFor(false), b = histFor(true);
        const target = (a && b ? (a.share >= b.share ? a : b) : a || b)?.c;
        if (target == null) return null;
        const to = Color3.FromHexString(color);
        const out = new Uint8Array(px);
        let replaced = 0;
        const tr = (target >> 16) & 255, tg = (target >> 8) & 255, tb = target & 255;
        const hsv = (r: number, g: number, b: number) => { const c = new Color3(r / 255, g / 255, b / 255).toHSV(); return c; };
        const T0 = hsv(tr, tg, tb);
        for (let o = 0; o < out.length; o += 4) {
          // The shirt colour and its darker/lighter shades (same hue, similar saturation).
          const h = hsv(out[o], out[o + 1], out[o + 2]);
          let dh = Math.abs(h.r - T0.r); dh = Math.min(dh, 360 - dh);
          const exact = Math.abs(out[o] - tr) + Math.abs(out[o + 1] - tg) + Math.abs(out[o + 2] - tb) < 18;
          if (exact || (T0.g > 0.25 && dh < 10 && Math.abs(h.g - T0.g) < 0.2 && h.b > 0.15)) {
            const k = Math.min(1.3, h.b / Math.max(0.05, T0.b));
            out[o] = Math.min(255, Math.round(to.r * 255 * k)); out[o + 1] = Math.min(255, Math.round(to.g * 255 * k)); out[o + 2] = Math.min(255, Math.round(to.b * 255 * k));
            replaced++;
          }
        }
        const t = RawTexture.CreateRGBATexture(out, size.width, size.height, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
        t.wrapU = tex.wrapU; t.wrapV = tex.wrapV;
        t.uScale = tex.uScale; t.vScale = tex.vScale; t.uOffset = tex.uOffset; t.vOffset = tex.vOffset;
        t.uAng = tex.uAng; t.vAng = tex.vAng; t.wAng = tex.wAng; t.coordinatesIndex = tex.coordinatesIndex;
        (t as any).lm3 = { a, b, target: target.toString(16), replaced };
        return t;
      } catch { return null; }
    })();
    recolorCache.set(key, p);
  }
  return p;
}
