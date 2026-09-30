// Third-person camera that follows the local player, turns with drags and
// gently swings behind a walking player. A ray against the real colliders keeps
// it from ever clipping through walls.
import { FreeCamera, Vector3, type Scene } from '../babylon';
import { RAPIER } from '../../../shared/rapier';
import type { Sim } from '../../../shared/sim';

export class FollowCam {
  cam: FreeCamera;
  yaw = 0;        // camera looks along (sin yaw, 0, cos yaw)
  pitch = 0.38;
  dist = 6.5;
  cur = 6.5;
  target = new Vector3();
  idle = 0;

  constructor(scene: Scene) {
    this.cam = new FreeCamera('follow', new Vector3(0, 5, -20), scene);
    this.cam.minZ = 0.15; this.cam.maxZ = 260;
    this.cam.fov = 0.95;
    scene.activeCamera = this.cam;
  }
  // Joystick (right, forward) → world direction relative to the camera.
  toWorld(jx: number, jy: number): [number, number] {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -fz, rz = fx;               // right-handed: right = forward × up
    return [rx * jx + fx * jy, rz * jx + fz * jy];
  }
  update(dt: number, sim: Sim, px: number, py: number, pz: number, drag: [number, number], moveYaw: number | null) {
    this.yaw -= drag[0] * 0.0065;
    this.pitch = Math.min(1.15, Math.max(0.08, this.pitch + drag[1] * 0.004));
    if (drag[0] || drag[1]) this.idle = 0; else this.idle += dt;
    // After a moment without dragging, ease in behind the direction of travel.
    if (moveYaw !== null && this.idle > 1.2) {
      let d = moveYaw - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) < 2.4) this.yaw += d * Math.min(1, dt * 0.9);
    }
    const t = new Vector3(px, py + 1.35, pz);
    this.target = Vector3.Lerp(this.target.lengthSquared() ? this.target : t, t, Math.min(1, dt * 12));
    const dir = new Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    // Collide with static colliders only (walls, big props), with a small margin.
    let want = this.dist;
    const hit = sim.world.castRay(new RAPIER.Ray({ x: this.target.x, y: this.target.y, z: this.target.z }, { x: dir.x, y: dir.y, z: dir.z }), this.dist + 0.3, true,
      undefined, undefined, undefined, undefined, c => sim.meta.get(c.handle)?.kind === 'static' && !['ground'].includes(sim.meta.get(c.handle)?.tag || ''));
    if (hit) want = Math.max(0.9, hit.timeOfImpact - 0.35);
    this.cur = want < this.cur ? want : this.cur + (want - this.cur) * Math.min(1, dt * 3);
    const pos = this.target.add(dir.scale(this.cur));
    if (pos.y < 0.4) pos.y = 0.4;
    this.cam.position.copyFrom(pos);
    this.cam.setTarget(this.target);
  }
}
