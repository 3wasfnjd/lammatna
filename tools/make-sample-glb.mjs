// Writes a tiny animated GLB used to test the model-replacement path
// (unit conversion via targetHeight, clip mapping and cross-fading).
// Usage: node tools/make-sample-glb.mjs [out.glb]
import { writeFile } from 'node:fs/promises';

export function sampleGlb() {
  // A 60 x 170 x 40 box in centimetres, feet at 0 (deliberately not metres).
  const w = 30, h = 170, d = 20;
  const p = [[-w, 0, -d], [w, 0, -d], [w, h, -d], [-w, h, -d], [-w, 0, d], [w, 0, d], [w, h, d], [-w, h, d]];
  const positions = new Float32Array(p.flat());
  const indices = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
  const times = new Float32Array([0, 0.5, 1]);
  const idleScale = new Float32Array([1, 1, 1, 1.04, 0.96, 1.04, 1, 1, 1]);
  const s = Math.sin(0.15), c = Math.cos(0.15);
  const walkRot = new Float32Array([0, 0, -s, c, 0, 0, s, c, 0, 0, -s, c]);
  const parts = [positions, indices, times, idleScale, walkRot];
  const views = []; let offset = 0;
  const chunks = parts.map(a => {
    const bytes = new Uint8Array(a.buffer.slice(0));
    const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4); padded.set(bytes);
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    offset += padded.length;
    return padded;
  });
  const bin = new Uint8Array(offset); let o = 0;
  for (const c2 of chunks) { bin.set(c2, o); o += c2.length; }
  const gltf = {
    asset: { version: '2.0', generator: 'lammatna sample' }, scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Body', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.95, 0.55, 0.7, 1], metallicFactor: 0, roughnessFactor: 0.7 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-w, 0, -d], max: [w, h, d] },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 3, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 4, componentType: 5126, count: 3, type: 'VEC4' }
    ],
    animations: [
      { name: 'Idle', samplers: [{ input: 2, output: 3 }], channels: [{ sampler: 0, target: { node: 0, path: 'scale' } }] },
      { name: 'Walk', samplers: [{ input: 2, output: 4 }], channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }] }
    ]
  };
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLen = Math.ceil(json.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLen + 8 + bin.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, out.length, true);
  v.setUint32(12, jsonLen, true); v.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLen); out.set(json, 20);
  v.setUint32(20 + jsonLen, bin.length, true); v.setUint32(24 + jsonLen, 0x004e4942, true);
  out.set(bin, 28 + jsonLen);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2] || new URL('../assets/characters/sample-block.glb', import.meta.url);
  await writeFile(file, sampleGlb());
  console.log('wrote', String(file));
}
