// Rapier entry point for all shared code. The Worker build aliases
// '@dimforge/rapier3d-compat' to a copy that imports the .wasm file as a module
// (Workers cannot compile WASM from base64 at runtime); see tools/rapier-worker.mjs.
import RAPIER from '@dimforge/rapier3d-compat';

let ready: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  if (!ready) ready = RAPIER.init();
  return ready;
}
export { RAPIER };
export type World = InstanceType<typeof RAPIER.World>;
export type RigidBody = ReturnType<World['createRigidBody']>;
export type Collider = ReturnType<World['createCollider']>;
