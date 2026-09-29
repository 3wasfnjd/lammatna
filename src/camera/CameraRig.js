// Third-person follow camera with wall avoidance and smooth "activity" framing
// for swings and the slide.
import { TargetCamera, Vector3 } from '../babylon.js';
import { raycastSolids } from '../../shared/physics.js';

export class CameraRig {
  constructor(scene, canvas) {
    this.camera = new TargetCamera('cam', new Vector3(0, 6, -10), scene);
    this.camera.fov = 0.95;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 120;
    this.yaw = 0;          // orbit angle around the player (0 = camera behind, looking +z)
    this.pitch = 0.42;
    this.distance = 7.2;
    this.current = new Vector3(0, 6, -10);
    this.lookAt = new Vector3(0, 1, 0);
    this.focus = null;     // { position, target } overrides while riding
    this.focusBlend = 0;
    this.shake = 0;
    this.resize(canvas);
  }

  resize(canvas) {
    // Portrait phones need a wider view to show enough playground.
    const aspect = canvas.width / Math.max(1, canvas.height);
    this.camera.fov = aspect < 0.8 ? 1.15 : aspect < 1.2 ? 1.02 : 0.9;
    this.baseDistance = aspect < 0.8 ? 8.2 : 7.2;
  }

  applyLook(dx, dy) {
    this.yaw += dx * 0.006;
    this.pitch = Math.min(1.1, Math.max(0.12, this.pitch + dy * 0.004));
  }

  // Keep the camera slowly swinging behind the direction of travel.
  follow(dt, target, moveYaw, moving, height = 1.5) {
    if (moving && moveYaw != null) {
      let d = moveYaw - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 0.9) * (Math.abs(d) < 2.4 ? 1 : 0);
    }
    // Smaller characters get a closer, lower camera so they stay the star.
    const dist = this.baseDistance * (0.62 + height * 0.2);
    const head = new Vector3(target.x, target.y + 0.55 + height * 0.5, target.z);
    // Try the chosen angle first, then flatter ones (under the tower deck, by walls).
    let best = null;
    for (const pitch of [this.pitch, this.pitch * 0.5, 0.06]) {
      const dir = new Vector3(-Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(this.yaw) * Math.cos(pitch));
      const free = raycastSolids(head.x, head.y, head.z, dir.x, dir.y, dir.z, dist) - 0.3;
      if (!best || free > best.free) best = { dir, free };
      if (free >= dist * 0.7) break;
    }
    const d = Math.max(0.45, Math.min(dist, best.free));
    let want = head.add(best.dir.scale(d));
    want.y = Math.max(0.35, Math.min(7.0, want.y));
    let look = head.clone();

    if (this.focus) this.focusBlend = Math.min(1, this.focusBlend + dt * 1.6);
    else this.focusBlend = Math.max(0, this.focusBlend - dt * 1.4);
    if (this.focusBlend > 0 && (this.focus || this.lastFocus)) {
      const f = this.focus || this.lastFocus, k = smooth(this.focusBlend);
      want = Vector3.Lerp(want, f.position, k);
      look = Vector3.Lerp(look, f.target, k);
      if (this.focus) this.lastFocus = this.focus;
    }
    const k = 1 - Math.exp(-dt * (this.snap ? 60 : 7));
    this.snap = false;
    this.current = Vector3.Lerp(this.current, want, k);
    this.lookAt = Vector3.Lerp(this.lookAt, look, 1 - Math.exp(-dt * 12));
    this.camera.position.copyFrom(this.current);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      this.camera.position.y += Math.sin(performance.now() * 0.05) * this.shake * 0.08;
    }
    this.camera.setTarget(this.lookAt);
  }

  // Forward direction on the ground, for camera-relative movement.
  forward() { return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; }

  setFocus(focus) { this.focus = focus; }
  jumpTo() { this.snap = true; }
}

function smooth(t) { return t * t * (3 - 2 * t); }
