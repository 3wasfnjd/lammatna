// Reusable building blocks: shared toon-ish materials, rounded boxes and labels.
import { BLOCKY } from '../style.js';
import { StandardMaterial, Color3, Mesh, VertexData, DynamicTexture, CreatePlane } from '../babylon.js';

export function hex(c) { return Color3.FromHexString(c); }

export class Kit {
  constructor(scene) {
    this.scene = scene;
    this.materials = new Map();
    this.geometry = new Map();
  }

  // Soft, slightly glossy "padded foam / plastic" material, shared per colour.
  mat(color, { gloss = 0.18, emissive = 0.12, alpha = 1, name } = {}) {
    if (BLOCKY) gloss = Math.max(gloss, 0.32); // smooth plastic
    const key = `${color}|${gloss}|${emissive}|${alpha}|${name || ''}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new StandardMaterial(name || `m${this.materials.size}`, this.scene);
      const c = hex(color);
      m.diffuseColor = c;
      m.specularColor = new Color3(gloss, gloss, gloss);
      m.specularPower = 24;
      // A little self-light keeps shadow sides warm and colourful instead of grey.
      m.emissiveColor = c.scale(emissive);
      if (alpha < 1) { m.alpha = alpha; m.backFaceCulling = false; }
      this.materials.set(key, m);
    }
    return m;
  }

  // Rounded box with shared geometry per size. Corners use a few arc steps.
  roundedBox(name, w, h, d, r, material, { segments = 3 } = {}) {
    // The blocky style keeps only a small bevel: crisp toy-brick edges.
    if (BLOCKY) r = Math.min(r, 0.05);
    r = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
    const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r.toFixed(3)}|${segments}`;
    let source = this.geometry.get(key);
    if (!source) {
      source = new Mesh(`rb:${key}`, this.scene);
      roundedBoxData(w, h, d, r, segments).applyToMesh(source);
      source.setEnabled(false);
      this.geometry.set(key, source);
    }
    const mesh = source.clone(name);
    mesh.setEnabled(true);
    mesh.material = material;
    return mesh;
  }

  // Canvas label for signs: symbol plus Arabic text, rendered once.
  sign(name, { symbol, text, color, width = 2.6, height = 1.1, textColor = '#ffffff' }) {
    const res = 512, aspect = width / height;
    const tex = new DynamicTexture(`${name}-tex`, { width: res, height: Math.round(res / aspect) }, this.scene, true);
    const ctx = tex.getContext(), W = res, H = Math.round(res / aspect);
    ctx.clearRect(0, 0, W, H);
    const rad = H * 0.35;
    ctx.fillStyle = color;
    roundRect(ctx, 6, 6, W - 12, H - 12, rad); ctx.fill();
    ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    roundRect(ctx, 12, 12, W - 24, H - 24, rad * 0.9); ctx.stroke();
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    if (text) {
      ctx.font = `bold ${Math.round(H * 0.34)}px "Baloo Bhaijaan 2", "Tajawal", system-ui, sans-serif`;
      ctx.fillText(text, W * 0.43, H * 0.54);
      ctx.font = `bold ${Math.round(H * 0.46)}px system-ui, sans-serif`;
      ctx.fillText(symbol || '', W * 0.86, H * 0.52);
    } else {
      ctx.font = `bold ${Math.round(H * 0.62)}px system-ui, sans-serif`;
      ctx.fillText(symbol || '', W / 2, H * 0.54);
    }
    tex.update();
    tex.hasAlpha = true;
    const m = new StandardMaterial(`${name}-mat`, this.scene);
    m.diffuseTexture = tex; m.useAlphaFromDiffuseTexture = true;
    m.emissiveColor = new Color3(0.55, 0.55, 0.55); m.specularColor = Color3.Black();
    m.backFaceCulling = false;
    const plane = CreatePlane(name, { width, height }, this.scene);
    plane.material = m;
    return plane;
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function axisCoords(half, r, seg) {
  const out = [];
  for (let i = 0; i <= seg; i++) out.push(-half + r - r * Math.cos(i / seg * Math.PI / 2));
  for (let i = seg; i >= 0; i--) out.push(half - r + r * Math.cos(i / seg * Math.PI / 2));
  return out.filter((v, i, a) => i === 0 || Math.abs(v - a[i - 1]) > 1e-6);
}

export function roundedBoxData(w, h, d, r, seg) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const cx = axisCoords(hx, r, seg), cy = axisCoords(hy, r, seg), cz = axisCoords(hz, r, seg);
  const positions = [], normals = [], indices = [];
  const face = (us, vs, map) => {
    const base = positions.length / 3;
    for (const v of vs) for (const u of us) {
      const p = map(u, v);
      const ix = Math.max(-hx + r, Math.min(hx - r, p[0]));
      const iy = Math.max(-hy + r, Math.min(hy - r, p[1]));
      const iz = Math.max(-hz + r, Math.min(hz - r, p[2]));
      let nx = p[0] - ix, ny = p[1] - iy, nz = p[2] - iz;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      positions.push(ix + nx * r, iy + ny * r, iz + nz * r);
      normals.push(nx, ny, nz);
    }
    const n = us.length;
    for (let j = 0; j < vs.length - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = base + j * n + i, b = a + 1, c = a + n, e = c + 1;
      indices.push(a, c, b, b, c, e);
    }
  };
  // Winding chosen for Babylon's left-handed, clockwise-front convention.
  face(cx, cy, (u, v) => [u, v, -hz]);
  face(cx.slice().reverse(), cy, (u, v) => [u, v, hz]);
  face(cz.slice().reverse(), cy, (u, v) => [-hx, v, u]);
  face(cz, cy, (u, v) => [hx, v, u]);
  face(cx, cz.slice().reverse(), (u, v) => [u, hy, v]);
  face(cx, cz, (u, v) => [u, -hy, v]);
  const data = new VertexData();
  data.positions = positions; data.normals = normals; data.indices = indices;
  return data;
}
