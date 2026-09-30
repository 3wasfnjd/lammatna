// Tiny particle system: one instanced mesh, per-instance colour, CPU motion.
// Leaves, splashes, confetti, sparkles, sand and footprints.
import { CreatePlane, Mesh, InstancedMesh, Color4, StandardMaterial, Color3, Vector3, type Scene } from '../babylon';

interface P { m: InstancedMesh; v: Vector3; life: number; age: number; spin: number; grav: number; flat?: boolean }

export class Fx {
  src: Mesh; pool: InstancedMesh[] = []; live: P[] = [];
  constructor(scene: Scene) {
    this.src = CreatePlane('fx', { size: 1 }, scene);
    const m = new StandardMaterial('fx', scene);
    m.disableLighting = true; m.emissiveColor = Color3.White(); m.backFaceCulling = false;
    this.src.material = m;
    this.src.registerInstancedBuffer('color', 4);
    this.src.instancedBuffers.color = new Color4(1, 1, 1, 1);
    this.src.position.y = -100;
    this.src.isPickable = false;
  }
  private take(): InstancedMesh {
    const m = this.pool.pop() || this.src.createInstance('p');
    m.setEnabled(true); m.isPickable = false;
    return m;
  }
  burst(kind: 'leaf' | 'splash' | 'confetti' | 'spark' | 'sand' | 'balls', x: number, y: number, z: number, n = 14) {
    if (this.live.length > 260) return;
    for (let i = 0; i < n; i++) {
      const m = this.take();
      const a = Math.random() * Math.PI * 2, s = Math.random();
      let col: [number, number, number], v: Vector3, size = 0.12, grav = 9, life = 1.2;
      switch (kind) {
        case 'leaf': col = [0.35 + s * 0.3, 0.7, 0.25]; v = new Vector3(Math.cos(a) * 1.2, -0.5 - s, Math.sin(a) * 1.2); grav = 0.6; life = 2.4; size = 0.16; break;
        case 'splash': col = [0.55, 0.8, 1]; v = new Vector3(Math.cos(a) * 2, 3 + s * 2, Math.sin(a) * 2); size = 0.1; break;
        case 'confetti': col = [[1, 0.35, 0.37], [0.1, 0.51, 0.77], [1, 0.79, 0.23], [0.54, 0.79, 0.15], [0.9, 0.4, 0.9]][i % 5] as any; v = new Vector3(Math.cos(a) * 3, 5 + s * 3, Math.sin(a) * 3); grav = 6; life = 2.2; size = 0.14; break;
        case 'spark': col = [1, 0.9, 0.3]; v = new Vector3(Math.cos(a) * 1.8, 2 + s * 2, Math.sin(a) * 1.8); grav = 3; life = 0.9; size = 0.12; break;
        case 'sand': col = [0.9, 0.78, 0.45]; v = new Vector3(Math.cos(a) * 1.4, 2 + s, Math.sin(a) * 1.4); size = 0.08; break;
        default: col = [[1, 0.35, 0.37], [0.1, 0.51, 0.77], [1, 0.79, 0.23], [0.54, 0.79, 0.15]][i % 4] as any; v = new Vector3(Math.cos(a) * 2, 4 + s * 2, Math.sin(a) * 2); size = 0.22; break;
      }
      m.instancedBuffers.color = new Color4(col[0], col[1], col[2], 1);
      m.position.set(x + (Math.random() - 0.5) * 0.4, y + (kind === 'leaf' ? 2.5 + s * 1.5 : 0.2), z + (Math.random() - 0.5) * 0.4);
      m.scaling.setAll(size);
      this.live.push({ m, v, life, age: 0, spin: (Math.random() - 0.5) * 10, grav });
    }
  }
  footprint(x: number, z: number, yaw: number) {
    if (this.live.length > 260) return;
    const m = this.take();
    m.instancedBuffers.color = new Color4(0.72, 0.6, 0.35, 1);
    m.position.set(x, 0.03, z);
    m.rotation.set(Math.PI / 2, yaw, 0);
    m.scaling.set(0.16, 0.26, 1);
    this.live.push({ m, v: new Vector3(), life: 4, age: 0, spin: 0, grav: 0, flat: true });
  }
  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      if (p.age > p.life) { p.m.setEnabled(false); this.pool.push(p.m); this.live.splice(i, 1); continue; }
      if (p.flat) { p.m.instancedBuffers.color.a = 1 - p.age / p.life; continue; }
      p.v.y -= p.grav * dt;
      p.m.position.addInPlace(p.v.scale(dt));
      if (p.m.position.y < 0.05) { p.m.position.y = 0.05; p.v.scaleInPlace(0.3); }
      p.m.rotation.set(p.age * p.spin, p.age * p.spin * 0.7, 0);
    }
  }
}
