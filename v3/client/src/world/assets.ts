// Model loading with one canonical (cheap Standard) material per pack+name,
// so meshes from different files can be merged into a single draw call.
import { LoadAssetContainerAsync, AssetContainer, StandardMaterial, PBRMaterial, Color3, Texture, type Scene, type Material } from '../babylon';

export const MODEL_BASE = import.meta.env.DEV ? 'models/' : 'public/models/';

export class Assets {
  scene: Scene;
  containers = new Map<string, Promise<AssetContainer>>();
  loaded = new Set<string>();
  mats = new Map<string, StandardMaterial>();
  failed: string[] = [];
  constructor(scene: Scene) { this.scene = scene; }

  load(id: string): Promise<AssetContainer> {
    let p = this.containers.get(id);
    if (!p) {
      p = LoadAssetContainerAsync(MODEL_BASE + id + '.glb', this.scene)
        .then(c => { this.loaded.add(id); return c; })
        .catch(e => { this.failed.push(id); throw e; });
      this.containers.set(id, p);
    }
    return p;
  }

  pack(id: string) { return id.startsWith('scn/') ? id : id.split('/')[0]; }

  // Canonical material for a glTF material of a given model pack.
  canonical(id: string, m: Material | null): StandardMaterial {
    const name = m?.name || 'default';
    const key = this.pack(id) + ':' + name;
    let c = this.mats.get(key);
    if (c) return c;
    c = new StandardMaterial(key, this.scene);
    c.specularColor = new Color3(0.08, 0.08, 0.08);
    if (m instanceof PBRMaterial) {
      c.diffuseColor = m.albedoColor.clone();
      if (m.albedoTexture) {
        c.diffuseTexture = m.albedoTexture;
        (m.albedoTexture as Texture).updateSamplingMode(Texture.NEAREST_LINEAR_MIPLINEAR);
      }
      if (m.alpha < 1 || /glass/i.test(name)) { c.alpha = Math.min(m.alpha, 0.45); c.backFaceCulling = false; }
      c.emissiveColor = m.emissiveColor.scale(0.6);
    }
    this.mats.set(key, c);
    return c;
  }

  flat(color: string, opts: { emissive?: number; alpha?: number } = {}): StandardMaterial {
    const key = `flat:${color}:${opts.emissive || 0}:${opts.alpha ?? 1}`;
    let c = this.mats.get(key);
    if (c) return c;
    c = new StandardMaterial(key, this.scene);
    c.diffuseColor = Color3.FromHexString(color);
    c.specularColor = new Color3(0.05, 0.05, 0.05);
    if (opts.emissive) c.emissiveColor = Color3.FromHexString(color).scale(opts.emissive);
    if (opts.alpha != null && opts.alpha < 1) c.alpha = opts.alpha;
    this.mats.set(key, c);
    return c;
  }
}
