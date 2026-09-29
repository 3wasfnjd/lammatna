// Confetti bursts, ball-pit splashes and soft shadows for dynamic things.
import { ParticleSystem, DynamicTexture, Vector3, Color4, ShadowGenerator, DirectionalLight } from '../babylon.js';

export class Shadows {
  constructor(scene, light, quality) {
    this.light = light;
    this.gen = new ShadowGenerator(quality === 'low' ? 512 : 1024, light);
    this.gen.usePercentageCloserFiltering = true;
    this.gen.filteringQuality = ShadowGenerator.QUALITY_LOW;
    this.gen.bias = 0.002;
    this.gen.normalBias = 0.02;
    this.gen.darkness = 0.35;
    light.autoUpdateExtends = false;
    light.shadowMinZ = 1; light.shadowMaxZ = 40;
    light.orthoLeft = -14; light.orthoRight = 14; light.orthoTop = 14; light.orthoBottom = -14;
  }
  addCaster(visual) { for (const m of visual.shadowMeshes()) this.gen.addShadowCaster(m, false); }
  removeCaster(visual) { for (const m of visual.shadowMeshes()) this.gen.removeShadowCaster(m, false); }
  addMesh(m) { this.gen.addShadowCaster(m, false); }
  removeMesh(m) { this.gen.removeShadowCaster(m, false); }
  // Shadows follow the local player, so a small map stays crisp.
  follow(x, z) {
    const d = this.light.direction;
    this.light.position.set(x - d.x * 20, 20 * -d.y, z - d.z * 20);
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    const tex = new DynamicTexture('confetti-tex', { width: 32, height: 32 }, scene, false);
    const ctx = tex.getContext();
    ctx.fillStyle = '#fff'; ctx.fillRect(6, 10, 20, 12);
    tex.update(); tex.hasAlpha = true;
    this.texture = tex;
    const dot = new DynamicTexture('dot-tex', { width: 32, height: 32 }, scene, false);
    const c2 = dot.getContext();
    c2.fillStyle = '#fff'; c2.beginPath(); c2.arc(16, 16, 14, 0, Math.PI * 2); c2.fill();
    dot.update(); dot.hasAlpha = true;
    this.dot = dot;
  }

  confetti(position, { count = 260, duration = 1.6, spread = 3 } = {}) {
    const pairs = [['#F2735F', '#F7BE2F'], ['#2BB5B0', '#9C6BD1'], ['#FF8FB8', '#FFFFFF']];
    for (const [a, b] of pairs) {
      const ps = new ParticleSystem('confetti', Math.round(count / 3), this.scene);
      ps.particleTexture = this.texture;
      ps.emitter = position.clone();
      ps.minEmitBox = new Vector3(-spread / 2, 0, -spread / 2); ps.maxEmitBox = new Vector3(spread / 2, 0.5, spread / 2);
      ps.color1 = Color4.FromHexString(a + 'FF'); ps.color2 = Color4.FromHexString(b + 'FF'); ps.colorDead = new Color4(1, 1, 1, 0);
      ps.minSize = 0.08; ps.maxSize = 0.16; ps.minLifeTime = 1.4; ps.maxLifeTime = 2.6;
      ps.emitRate = count * 2; ps.manualEmitCount = Math.round(count / 3);
      ps.direction1 = new Vector3(-2, 8, -2); ps.direction2 = new Vector3(2, 11, 2);
      ps.gravity = new Vector3(0, -7, 0);
      ps.minAngularSpeed = -6; ps.maxAngularSpeed = 6;
      ps.minEmitPower = 0.6; ps.maxEmitPower = 1.1;
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      ps.targetStopDuration = duration; ps.disposeOnStop = true;
      ps.start();
    }
  }

  splash(position) {
    const ps = new ParticleSystem('splash', 30, this.scene);
    ps.particleTexture = this.dot;
    ps.emitter = position.clone();
    ps.color1 = Color4.FromHexString('#F7BE2FFF'); ps.color2 = Color4.FromHexString('#2BB5B0FF'); ps.colorDead = new Color4(1, 0.5, 0.5, 0);
    ps.minSize = 0.15; ps.maxSize = 0.26; ps.minLifeTime = 0.5; ps.maxLifeTime = 0.9;
    ps.manualEmitCount = 30; ps.emitRate = 300;
    ps.direction1 = new Vector3(-2, 5, -2); ps.direction2 = new Vector3(2, 7, 2);
    ps.gravity = new Vector3(0, -14, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.targetStopDuration = 0.3; ps.disposeOnStop = true;
    ps.start();
  }
}

export { DirectionalLight };
