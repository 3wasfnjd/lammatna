// Per-character customisation of palette-textured GLBs (e.g. Kenney Mini
// Characters) without editing the files:
//  • recolor: [{ part: 'head' | 'body' | 'all', from: '#3F3F46', to: '#2B211C', region?: { minY, maxY }, exclude?: { min, max } }]
//    Moves only that part's UVs from the source palette cell to a new, tinted
//    cell in an unused area of a per-character copy of the texture. So one
//    feature (hair, beard, shirt, eyes) changes without touching the others.
//  • accessories: [{ bone: 'head', kind: 'box', size: [w,h,d], color, position: [x,y,z], rotation?: [x,y,z] }
//                  { bone: 'head', kind: 'glb', url, position, rotation, scale }]
//    Attached to the model's bones, so they follow every animation.
import { Texture, StandardMaterial, TransformNode, Color3 } from '../babylon.js';

const CELL_W = 32, CELL_H = 128, SIZE = 512;
// Unused (black) palette slots in the Kenney colormap: the whole top band plus part of the second.
const FREE_SLOTS = [...Array.from({ length: 16 }, (_, i) => [i, 0]), ...Array.from({ length: 14 }, (_, i) => [i + 2, 1])];

export async function customizeGlb(visual, model, scene, kit, loadGlb) {
  if (model.recolor?.length) await recolor(visual, model.recolor, scene);
  if (model.accessories?.length) await attachAccessories(visual, model.accessories, scene, kit, loadGlb);
}

// exclude: { min: [x, y, z], max: [x, y, z] } in the mesh's own (bind-pose) coordinates.
function inside(pos, v, box) {
  for (let a = 0; a < 3; a++) { const c = pos[v * 3 + a]; if (c < (box.min?.[a] ?? -Infinity) || c > (box.max?.[a] ?? Infinity)) return false; }
  return true;
}

function hexToRgb(h) { const n = parseInt(h.replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function close(a, b, tol = 14) { return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol; }

// Read the palette back from the GPU (the glTF loader keeps no fetchable URL),
// scaled to 512², and oriented like the file (black band at the top).
async function texturePixels(tex, ctx) {
  const { width, height } = tex.getSize();
  const data = await tex.readPixels();
  if (!data || !width) return null;
  const tmp = document.createElement('canvas');
  tmp.width = width; tmp.height = height;
  const img = tmp.getContext('2d').createImageData(width, height);
  img.data.set(new Uint8ClampedArray(data.buffer, data.byteOffset, width * height * 4));
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, SIZE, SIZE);
  let out = ctx.getImageData(0, 0, SIZE, SIZE);
  const dark = y => { const i = (y * SIZE + SIZE / 2) * 4; return out.data[i] + out.data[i + 1] + out.data[i + 2] < 24; };
  if (!dark(10) && dark(SIZE - 10)) {
    ctx.save(); ctx.clearRect(0, 0, SIZE, SIZE); ctx.translate(0, SIZE); ctx.scale(1, -1); ctx.drawImage(tmp, 0, 0, SIZE, SIZE); ctx.restore();
    out = ctx.getImageData(0, 0, SIZE, SIZE);
  }
  return out;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function recolor(visual, rules, scene) {
  const meshes = visual.meshes.filter(m => m.material && m.getVerticesData('uv'));
  if (!meshes.length) return;
  const srcTex = meshes[0].material.albedoTexture || meshes[0].material.diffuseTexture;
  if (!srcTex) return;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const pixels = await texturePixels(srcTex, ctx);
  if (!pixels) return;
  const px = (x, y) => { const i = (y * SIZE + x) * 4; return [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]]; };
  const cellColor = (cx, cy) => px(cx * CELL_W + CELL_W / 2, cy * CELL_H + CELL_H / 2);

  // UV orientation: Kenney never samples the black band, so pick the V direction that avoids it.
  const flipV = (() => {
    let straight = 0, flipped = 0;
    const uv = meshes[0].getVerticesData('uv');
    for (let i = 0; i < uv.length; i += 2) {
      const x = Math.min(SIZE - 1, Math.floor(uv[i] * SIZE));
      if (px(x, Math.min(SIZE - 1, Math.floor(uv[i + 1] * SIZE))).every(c => c < 8)) straight++;
      if (px(x, Math.min(SIZE - 1, Math.floor((1 - uv[i + 1]) * SIZE))).every(c => c < 8)) flipped++;
    }
    return flipped < straight;
  })();

  let slot = 0;
  for (const rule of rules) {
    const from = hexToRgb(rule.from), to = hexToRgb(rule.to);
    // Among cells close to the colour, use the one this part's UVs actually sample.
    const targets = meshes.filter(m => {
      const name = m.name.toLowerCase();
      return rule.part === 'head' ? name.includes('head') : rule.part === 'body' ? name.includes('body') : true;
    });
    const used = new Map();
    for (const m of targets) {
      const uv = m.getVerticesData('uv');
      for (let i = 0; i < uv.length; i += 2) {
        const key = `${Math.floor(uv[i] * SIZE / CELL_W)},${Math.floor((flipV ? 1 - uv[i + 1] : uv[i + 1]) * SIZE / CELL_H)}`;
        used.set(key, (used.get(key) || 0) + 1);
      }
    }
    let src = null, bestD = Infinity;
    for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 16; cx++) {
      const c = cellColor(cx, cy);
      if (!close(c, from, 18) || !used.has(`${cx},${cy}`)) continue;
      const d = Math.abs(c[0] - from[0]) + Math.abs(c[1] - from[1]) + Math.abs(c[2] - from[2]);
      if (d < bestD) { bestD = d; src = [cx, cy]; }
    }
    if (!src || slot >= FREE_SLOTS.length) { console.warn('[lammatna] recolor: colour not found', rule.from); continue; }
    const [sx, sy] = FREE_SLOTS[slot++];
    // Paint the new cell: keep the original gradient, shifted to the new colour.
    const base = cellColor(...src), lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2] + 1;
    for (let y = 0; y < CELL_H; y++) for (let x = 0; x < CELL_W; x++) {
      const k = lum(px(src[0] * CELL_W + x, src[1] * CELL_H + y)) / lum(base);
      const i = ((sy * CELL_H + y) * SIZE + sx * CELL_W + x) * 4;
      pixels.data[i] = Math.min(255, to[0] * k); pixels.data[i + 1] = Math.min(255, to[1] * k); pixels.data[i + 2] = Math.min(255, to[2] * k); pixels.data[i + 3] = 255;
    }
    // Move this part's UVs into the new cell.
    for (const mesh of meshes) {
      const name = mesh.name.toLowerCase();
      if (rule.part === 'head' && !name.includes('head')) continue;
      if (rule.part === 'body' && !name.includes('body')) continue;
      mesh.makeGeometryUnique();
      const uv = mesh.getVerticesData('uv'), pos = rule.region || rule.exclude ? mesh.getVerticesData('position') : null;
      for (let i = 0, v = 0; i < uv.length; i += 2, v++) {
        const u = uv[i] * SIZE, vv = (flipV ? 1 - uv[i + 1] : uv[i + 1]) * SIZE;
        if (Math.floor(u / CELL_W) !== src[0] || Math.floor(vv / CELL_H) !== src[1]) continue;
        if (pos && rule.region && (pos[v * 3 + 1] < (rule.region.minY ?? -Infinity) || pos[v * 3 + 1] > (rule.region.maxY ?? Infinity))) continue;
        if (pos && rule.exclude && inside(pos, v, rule.exclude)) continue;
        const nu = (sx * CELL_W + (u - src[0] * CELL_W)) / SIZE, nv = (sy * CELL_H + (vv - src[1] * CELL_H)) / SIZE;
        uv[i] = nu; uv[i + 1] = flipV ? 1 - nv : nv;
      }
      mesh.setVerticesData('uv', uv);
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const tex = new Texture(canvas.toDataURL('image/png'), scene, { invertY: srcTex.invertY, samplingMode: srcTex.samplingMode, noMipmap: false });
  tex.wrapU = srcTex.wrapU; tex.wrapV = srcTex.wrapV;
  const materials = new Map();
  for (const mesh of meshes) {
    if (!materials.has(mesh.material)) {
      const m = mesh.material.clone(`${mesh.material.name}-custom`);
      if ('albedoTexture' in m) m.albedoTexture = tex; else m.diffuseTexture = tex;
      materials.set(mesh.material, m);
    }
    mesh.material = materials.get(mesh.material);
  }
}

async function attachAccessories(visual, list, scene, kit, loadGlb) {
  const nodes = visual.offset.getChildTransformNodes(false);
  for (const acc of list) {
    const bone = nodes.find(n => n.name.split(':').pop() === (acc.bone || 'head')) || visual.offset;
    const holder = new TransformNode(`acc-${acc.bone}`, scene);
    holder.parent = bone;
    holder.position.set(...(acc.position || [0, 0, 0]));
    if (acc.rotation) holder.rotation.set(...acc.rotation);
    if (acc.scale) holder.scaling.setAll(acc.scale);
    if (acc.kind === 'glb' && loadGlb) {
      const container = await loadGlb(acc.url);
      const entries = container.instantiateModelsToScene(n => `acc:${n}`, false, { doNotInstantiate: true });
      for (const r of entries.rootNodes) r.parent = holder;
    } else {
      const [w, h, d] = acc.size || [0.1, 0.1, 0.1];
      const box = kit.roundedBox('accessory', w, h, d, Math.min(0.02, w / 4, h / 4, d / 4), kit.mat(acc.color || '#FFFFFF', { gloss: 0.4 }));
      box.parent = holder;
    }
    for (const m of holder.getChildMeshes(false)) { m.isPickable = false; visual.meshes.push(m); }
  }
}

export { StandardMaterial, Color3 };
