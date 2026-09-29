// Colliders that exist only while a minigame runs (moving gates, placed
// building blocks). Server and clients compute the same boxes from shared state.
import { SOLIDS } from '../playground.js';
import { GIANT_BARRIERS, GIANT_GATES, GOAL_POSTS, gateBox, BLUEPRINT, pieceBox } from './layout.js';

export function activitySolids(activity, now) {
  if (!activity) return [];
  if (activity.type === 'ball') {
    const seconds = activity.phase === 'play' ? (now - activity.phaseStart) / 1000 : 0;
    return [...GIANT_BARRIERS, ...GOAL_POSTS, ...GIANT_GATES.map(g => gateBox(g, seconds))];
  }
  if (activity.type === 'builders' && activity.data?.pieces) {
    const out = [];
    for (const piece of activity.data.pieces) {
      if (!piece.placed) continue;
      const slot = BLUEPRINT.find(s => s.id === piece.placed);
      out.push({ ...pieceBox(piece.kind, slot.x, slot.y, slot.z), kind: 'piece' });
    }
    return out;
  }
  return [];
}

export function solidsFor(activity, now) {
  const extra = activitySolids(activity, now);
  return extra.length ? SOLIDS.concat(extra) : SOLIDS;
}
