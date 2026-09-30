// Tiny vector helpers (plain tuples keep the shared code free of engine types).
export type V3 = [number, number, number];

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const len2 = (x: number, z: number) => Math.hypot(x, z);
export const dist2 = (a: { x: number; z: number } | V3, b: { x: number; z: number } | V3) => {
  const ax = Array.isArray(a) ? a[0] : a.x, az = Array.isArray(a) ? a[2] : a.z;
  const bx = Array.isArray(b) ? b[0] : b.x, bz = Array.isArray(b) ? b[2] : b.z;
  return Math.hypot(ax - bx, az - bz);
};
export const deg = (d: number) => d * Math.PI / 180;
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// Rotation about +Y (right-handed): the same convention as Babylon (with
// useRightHandedSystem), glTF and Rapier quaternions. Forward of yaw θ is (sin θ, 0, cos θ).
export function rotY(x: number, z: number, a: number): [number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}
export function quatY(a: number) { return { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) }; }
export function quatMul(a: Q, b: Q): Q {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
  };
}
export type Q = { x: number; y: number; z: number; w: number };
export function quatAxis(ax: V3, a: number): Q {
  const s = Math.sin(a / 2);
  return { x: ax[0] * s, y: ax[1] * s, z: ax[2] * s, w: Math.cos(a / 2) };
}
export function quatRotate(q: Q, v: V3): V3 {
  // v' = q v q*
  const { x, y, z, w } = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
export function yawOfQuat(q: Q) { return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)); }

// Centripetal-ish Catmull-Rom path sampled into an arc-length table.
export class Spline {
  pts: V3[] = [];
  cum: number[] = [];
  length = 0;
  constructor(ctrl: V3[], samplesPerSeg = 12) {
    const P = (i: number) => ctrl[clamp(i, 0, ctrl.length - 1)];
    for (let i = 0; i < ctrl.length - 1; i++) {
      for (let s = 0; s < samplesPerSeg; s++) {
        const t = s / samplesPerSeg;
        const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
        const t2 = t * t, t3 = t2 * t;
        this.pts.push([0, 1, 2].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)) as V3);
      }
    }
    this.pts.push(ctrl[ctrl.length - 1]);
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      this.cum.push(this.cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    this.length = this.cum[this.cum.length - 1];
  }
  // Point and unit tangent at arc length s.
  at(s: number): { p: V3; t: V3 } {
    s = clamp(s, 0, this.length);
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    const a = this.pts[i - 1], b = this.pts[i];
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const f = (s - this.cum[i - 1]) / seg;
    const t: V3 = [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg, (b[2] - a[2]) / seg];
    return { p: [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)], t };
  }
}

// Small deterministic PRNG (mulberry32) so games are reproducible in tests.
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
