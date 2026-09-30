// The one world everybody uses: layout.json + generated model bounds.
import layoutJson from '../world/layout.json';
import boundsJson from '../world/model-bounds.json';
import { buildWorld, type Layout, type BoundsTable, type WorldDef } from './world';

export const LAYOUT = layoutJson as unknown as Layout;
export const BOUNDS = boundsJson as unknown as BoundsTable;
let cached: WorldDef | null = null;
export function worldDef(): WorldDef {
  if (!cached) cached = buildWorld(LAYOUT, BOUNDS);
  return cached;
}
