// Mood and polish: an open sky over the hall, drifting clouds, bunting,
// floating light motes and a selective glow on lights and treasures.
import {
  Mesh, Vector3, Color3, Color4, StandardMaterial, DynamicTexture, ParticleSystem, GlowLayer,
  CreateSphere, CreatePlane, CreateDisc, TransformNode
} from '../babylon.js';
import { HALL, PALETTE } from '../../shared/playground.js';

export class Atmosphere {
  constructor(scene, kit, { quality = 'high' } = {}) {
    this.scene = scene;
    this.kit = kit;
    this.quality = quality;
    this.clouds = [];
    this.buildSky();
    this.buildClouds();
    this.buildBunting();
    this.buildMotes();
    if (quality !== 'low') {
      this.glow = new GlowLayer('glow', scene, { mainTextureRatio: 0.35, blurKernelSize: 28 });
      this.glow.intensity = 0.55;
    }
  }

  // Only chosen meshes glow; everything else keeps its flat plastic look.
  addGlow(mesh) { this.glow?.addIncludedOnlyMesh(mesh); }

  buildSky() {
    const tex = new DynamicTexture('sky-tex', { width: 16, height: 256 }, this.scene, false);
    const ctx = tex.getContext();
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#3E9BEA'); g.addColorStop(0.45, '#7CC6F5'); g.addColorStop(0.62, '#CFEFFF'); g.addColorStop(0.7, '#FFE9C9'); g.addColorStop(1, '#FFD7A8');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
    tex.update();
    const m = new StandardMaterial('sky', this.scene);
    m.emissiveTexture = tex; m.disableLighting = true; m.backFaceCulling = false; m.fogEnabled = false;
    const dome = CreateSphere('sky', { diameter: 300, segments: 16, sideOrientation: Mesh.BACKSIDE }, this.scene);
    dome.material = m; dome.isPickable = false; dome.infiniteDistance = true;
    dome.applyFog = false;
    this.scene.clearColor = Color4.FromHexString('#7CC6F5FF');
  }

  buildClouds() {
    const mat = this.kit.mat('#FFFFFF', { emissive: 0.75, gloss: 0, name: 'skycloud' });
    const rand = seeded(11);
    for (let i = 0; i < (this.quality === 'low' ? 6 : 11); i++) {
      const cloud = new TransformNode('cloud', this.scene);
      const puffs = 3 + Math.floor(rand() * 3);
      for (let j = 0; j < puffs; j++) {
        const s = CreateSphere('puff', { diameter: 4 + rand() * 4, segments: 8 }, this.scene);
        s.material = mat; s.parent = cloud; s.isPickable = false;
        s.position.set(j * 3 - puffs * 1.5, rand() * 1.5, rand() * 2);
        s.scaling.y = 0.6;
      }
      const a = rand() * Math.PI * 2, r = 70 + rand() * 30;
      cloud.position.set(Math.cos(a) * r, 18 + rand() * 14, Math.sin(a) * r);
      cloud.rotation.y = -a;
      this.clouds.push({ node: cloud, a, r, speed: 0.004 + rand() * 0.006 });
    }
  }

  // Strings of triangle flags across the hall, made from one thin-instanced mesh.
  buildBunting() {
    const colors = [PALETTE.coral, PALETTE.yellow, PALETTE.turquoise, PALETTE.purple, PALETTE.pink];
    const x0 = HALL.minX + 2, x1 = HALL.maxX - 2, z0 = HALL.minZ + 2, z1 = HALL.maxZ - 2, y = HALL.height - 0.4;
    const lines = [[[x0, y, z0], [x1, y, z1]], [[x0, y, z1], [x1, y, z0]], [[x0, y - 0.1, 0], [x1, y - 0.1, 0]], [[0, y - 0.1, z0], [0, y - 0.1, z1]], [[x0, y - 0.2, z0 / 2], [x1, y - 0.2, z0 / 2]], [[x0, y - 0.2, z1 / 2], [x1, y - 0.2, z1 / 2]]];
    const per = colors.map(() => []);
    let n = 0;
    for (const [a, b] of lines) {
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]), count = Math.floor(len / 1.1);
      const yaw = Math.atan2(b[0] - a[0], b[2] - a[2]);
      for (let i = 1; i < count; i++) {
        const t = i / count, sag = Math.sin(t * Math.PI) * 1.2;
        per[n++ % colors.length].push([a[0] + (b[0] - a[0]) * t, a[1] - sag, a[2] + (b[2] - a[2]) * t, yaw]);
      }
    }
    for (const [ci, list] of per.entries()) {
      const flag = CreateDisc(`flag${ci}`, { radius: 0.42, tessellation: 3, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
      flag.material = this.kit.mat(colors[ci], { emissive: 0.35, name: `flag${ci}` });
      flag.material.backFaceCulling = false;
      flag.isPickable = false;
      flag.rotation.z = -Math.PI / 2; // point the triangle down
      flag.bakeCurrentTransformIntoVertices();
      const buf = new Float32Array(list.length * 16);
      list.forEach(([x, y, z, yaw], i) => {
        // Triangle pointing down, facing along the string.
        const c = Math.cos(yaw + Math.PI / 2), s = Math.sin(yaw + Math.PI / 2);
        buf.set([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1], i * 16);
      });
      flag.thinInstanceSetBuffer('matrix', buf, 16, true);
      flag.alwaysSelectAsActiveMesh = true;
    }
  }

  buildMotes() {
    const tex = new DynamicTexture('mote-tex', { width: 32, height: 32 }, this.scene, false);
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,240,200,0.6)'); g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32); tex.update(); tex.hasAlpha = true;
    this.moteTex = tex;
    const ps = new ParticleSystem('motes', this.quality === 'low' ? 40 : 90, this.scene);
    ps.particleTexture = tex;
    ps.emitter = new Vector3(0, 0, 0);
    ps.minEmitBox = new Vector3(HALL.minX, 0.3, HALL.minZ); ps.maxEmitBox = new Vector3(HALL.maxX, 5, HALL.maxZ);
    ps.color1 = new Color4(1, 0.95, 0.75, 0.8); ps.color2 = new Color4(0.8, 0.95, 1, 0.6); ps.colorDead = new Color4(1, 1, 1, 0);
    ps.minSize = 0.06; ps.maxSize = 0.16; ps.minLifeTime = 4; ps.maxLifeTime = 8;
    ps.emitRate = this.quality === 'low' ? 6 : 14;
    ps.direction1 = new Vector3(-0.15, 0.1, -0.15); ps.direction2 = new Vector3(0.15, 0.3, 0.15);
    ps.minEmitPower = 0.3; ps.maxEmitPower = 0.6;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.preWarmCycles = 60;
    ps.start();
  }

  update(dt) {
    for (const c of this.clouds) {
      c.a += c.speed * dt;
      c.node.position.x = Math.cos(c.a) * c.r; c.node.position.z = Math.sin(c.a) * c.r;
      c.node.rotation.y = -c.a;
    }
  }
}

export function seeded(seed) {
  return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
}

export { Color3, CreatePlane };
