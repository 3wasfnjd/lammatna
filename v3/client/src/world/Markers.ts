// In-world signals instead of menus and signs: zone icons that fade in when you
// come close, hidden stars, the first-visit trail of glowing arrows, the
// countdown above a minigame spot, race checkpoints and the winner's trophy.
import { Mesh, CreatePlane, CreateTorus, DynamicTexture, StandardMaterial, Color3, Vector3, InstancedMesh, type Scene } from '../babylon';
import type { Layout } from '../../../shared/world';
import type { GameView } from '../../../shared/protocol';

function emojiTexture(scene: Scene, text: string, size = 128, color?: string) {
  const t = new DynamicTexture('emo:' + text, { width: size, height: size }, scene, true);
  const g = t.getContext() as CanvasRenderingContext2D;
  g.clearRect(0, 0, size, size);
  if (color) { g.fillStyle = color; g.beginPath(); g.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2); g.fill(); }
  g.font = `${Math.round(size * 0.66)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
  g.fillText(text, size / 2, size * 0.54);
  t.update(); t.hasAlpha = true;
  return t;
}
function billboard(scene: Scene, name: string, tex: DynamicTexture, size: number) {
  const p = CreatePlane(name, { size }, scene);
  p.billboardMode = Mesh.BILLBOARDMODE_ALL;
  const m = new StandardMaterial(name, scene);
  m.diffuseTexture = tex; m.emissiveTexture = tex; m.useAlphaFromDiffuseTexture = true; m.disableLighting = true; m.backFaceCulling = false;
  p.material = m; p.isPickable = false;
  return p;
}

export class Markers {
  scene: Scene; layout: Layout;
  zoneIcons: { mesh: Mesh; x: number; z: number }[] = [];
  stars: InstancedMesh[] = [];
  starSrc: Mesh;
  arrows: Mesh[] = [];
  countdowns = new Map<string, { mesh: Mesh; tex: DynamicTexture; last: string }>();
  checkpoint: Mesh;
  trophy: Mesh;
  gameIcons = new Map<string, Mesh>();

  constructor(scene: Scene, layout: Layout) {
    this.scene = scene; this.layout = layout;
    for (const z of layout.zones) {
      const m = billboard(scene, 'zone-icon', emojiTexture(scene, z.icon, 128, z.color), 1.6);
      m.position.set(z.center[0], z.id === 'garden' ? 5 : 4.2, z.center[1]);
      this.zoneIcons.push({ mesh: m, x: z.center[0], z: z.center[1] });
    }
    this.starSrc = billboard(scene, 'star', emojiTexture(scene, '⭐', 128), 0.9);
    this.starSrc.position.y = -100;
    this.stars = layout.stars.map((s, i) => { const m = this.starSrc.createInstance('star' + i); m.position.set(s[0], s[1], s[2]); return m; });
    // Small game icons floating over each spot.
    for (const g of layout.games) {
      const icon = { race: '🏁', rescue: '🧺', colorFloor: '🌈', hideSeek: '🙈', giantBall: '⚽', paint: '🎨' }[g.id] || '🎲';
      const m = billboard(scene, 'game-icon', emojiTexture(scene, icon, 128, '#ffffffaa'), 1.1);
      m.position.set(g.spot[0], 2.6, g.spot[1]);
      this.gameIcons.set(g.id, m);
    }
    this.checkpoint = CreateTorus('checkpoint', { diameter: 3.2, thickness: 0.22, tessellation: 40 }, scene);
    const cm = new StandardMaterial('checkpoint', scene); cm.emissiveColor = new Color3(1, 0.85, 0.2); cm.disableLighting = true; cm.alpha = 0.85;
    this.checkpoint.material = cm; this.checkpoint.rotation.x = Math.PI / 2; this.checkpoint.setEnabled(false);
    this.trophy = billboard(scene, 'trophy', emojiTexture(scene, '🏆', 128), 1.4);
    this.trophy.setEnabled(false);
  }

  // Glowing arrows on the floor from the spawn to the first trampoline.
  showGuide(on: boolean) {
    if (on && !this.arrows.length) {
      const tex = new DynamicTexture('arrow', { width: 128, height: 128 }, this.scene, true);
      const g = tex.getContext() as CanvasRenderingContext2D;
      g.clearRect(0, 0, 128, 128); g.fillStyle = '#FF9F1C';
      g.beginPath(); g.moveTo(64, 8); g.lineTo(118, 70); g.lineTo(84, 70); g.lineTo(84, 120); g.lineTo(44, 120); g.lineTo(44, 70); g.lineTo(10, 70); g.closePath(); g.fill();
      tex.update(); tex.hasAlpha = true;
      const mat = new StandardMaterial('arrow', this.scene);
      mat.diffuseTexture = tex; mat.emissiveTexture = tex; mat.useAlphaFromDiffuseTexture = true; mat.disableLighting = true;
      const pts = this.layout.guide;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
        const a = CreatePlane('guide', { size: 1.7 }, this.scene);
        a.material = mat; a.isPickable = false;
        a.position.set((x0 + x1) / 2, 0.04, (z0 + z1) / 2);
        a.rotation.set(Math.PI / 2, Math.atan2(x1 - x0, z1 - z0), 0);
        this.arrows.push(a);
      }
      // Little footprints between the arrows.
      const foot = new StandardMaterial('guide-foot', this.scene);
      foot.emissiveColor = new Color3(1, 0.62, 0.11); foot.disableLighting = true; foot.alpha = 0.7;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], yaw = Math.atan2(x1 - x0, z1 - z0);
        for (const t of [0.2, 0.8]) {
          const side = t < 0.5 ? 1 : -1;
          const f = CreatePlane('guide-foot', { width: 0.18, height: 0.3 }, this.scene);
          f.material = foot; f.isPickable = false;
          f.position.set(x0 + (x1 - x0) * t + Math.cos(yaw) * 0.15 * side, 0.035, z0 + (z1 - z0) * t - Math.sin(yaw) * 0.15 * side);
          f.rotation.set(Math.PI / 2, yaw, 0);
          this.arrows.push(f);
        }
      }
    }
    for (const a of this.arrows) a.setEnabled(on);
  }

  update(time: number, px: number, pz: number, collected: number[], games: GameView[], myId: string) {
    for (const z of this.zoneIcons) {
      const d = Math.hypot(px - z.x, pz - z.z);
      const vis = d < 16 ? Math.min(1, (16 - d) / 6) : 0;
      z.mesh.setEnabled(vis > 0.02);
      (z.mesh.material as StandardMaterial).alpha = vis;
      z.mesh.position.y = 4.2 + Math.sin(time * 1.5) * 0.15;
    }
    this.stars.forEach((s, i) => { s.setEnabled(!collected.includes(i)); s.position.y = this.layout.stars[i][1] + Math.sin(time * 2 + i) * 0.12; });
    for (const a of this.arrows) {
      const k = this.arrows.indexOf(a);
      ((a.material as StandardMaterial)).alpha = 0.55 + 0.45 * Math.sin(time * 4 - k * 0.8);
    }
    // Countdown above spots, trophies, game icons.
    let trophyAt: Vector3 | null = null;
    this.checkpoint.setEnabled(false);
    for (const g of games) {
      const icon = this.gameIcons.get(g.id)!;
      icon.position.set(g.spot[0], 2.6 + Math.sin(time * 2) * 0.12, g.spot[1]);
      const near = Math.hypot(px - g.spot[0], pz - g.spot[1]) < 14;
      icon.setEnabled(near && g.phase === 'idle');
      let cd = this.countdowns.get(g.id);
      const label = g.phase === 'countdown' ? String(Math.ceil(g.t)) : g.phase === 'idle' && g.inSpot > 0 && g.inSpot < g.need ? `${g.inSpot}/${g.need}` : '';
      if (label && !cd) {
        const tex = new DynamicTexture('cd', { width: 256, height: 256 }, this.scene, true);
        const mesh = billboard(this.scene, 'countdown', tex, 2.2);
        cd = { mesh, tex, last: '' };
        this.countdowns.set(g.id, cd);
      }
      if (cd) {
        cd.mesh.setEnabled(!!label);
        if (label && label !== cd.last) {
          const c = cd.tex.getContext() as CanvasRenderingContext2D;
          c.clearRect(0, 0, 256, 256);
          c.fillStyle = 'rgba(255,184,107,0.9)'; c.beginPath(); c.arc(128, 128, 110, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#fff'; c.font = `bold ${label.length > 1 ? 96 : 150}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText(label, 128, 136); cd.tex.update(); cd.last = label;
        }
        const pulse = g.phase === 'countdown' ? 1 + (g.t % 1) * 0.3 : 1;
        cd.mesh.position.set(g.spot[0], 3.4, g.spot[1]); cd.mesh.scaling.setAll(pulse);
      }
      if (g.phase === 'running' && g.id === 'race' && g.players.includes(myId) && g.x?.cps) {
        const k = g.x.next?.[myId] ?? 0;
        const cps = [...g.x.cps, g.spot];
        const cp = cps[Math.min(k, cps.length - 1)];
        this.checkpoint.setEnabled(k < cps.length);
        this.checkpoint.position.set(cp[0], 1.7, cp[1]);
        this.checkpoint.rotation.y = time;
      }
      if (g.phase === 'result' && g.x?.winners?.length) trophyAt = new Vector3(g.spot[0], 3.2, g.spot[1]);
    }
    this.trophy.setEnabled(!!trophyAt);
    if (trophyAt) { this.trophy.position.copyFrom(trophyAt); this.trophy.position.y += Math.sin(time * 3) * 0.2; }
  }
}
