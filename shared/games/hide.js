// Playground Hide-and-Seek: one seeker (rotating between rounds) counts with
// eyes closed while everyone hides, then finds players by walking up to them.
// Found players watch from the stage until the round ends.
import { HIDE, spectatorSlot } from './layout.js';
import { STAGE, spawnPoint } from '../playground.js';

export const hide = {
  minPlayers: 2,
  prePhase: { name: 'hide', ms: HIDE.hideTime * 1000 },
  begin(room, participants) {
    const seeker = participants[(room.seekerTurn++) % participants.length];
    const teleport = {};
    participants.forEach((id, i) => {
      teleport[id] = id === seeker ? { x: STAGE.x, y: STAGE.h, z: STAGE.z, yaw: Math.PI } : spawnPoint(i);
    });
    return { data: { seeker, found: [] }, teleport };
  },
  playMs() { return HIDE.seekTime * 1000; },

  // The seeker waits blind during the hiding phase; found players spectate.
  locked(room, a, p) {
    if (a.phase === 'hide') return p.id === a.data.seeker;
    if (a.phase === 'play') return a.data.found.includes(p.id);
    return false;
  },

  handle(room, p, msg, a) {
    if (msg.op !== 'find' || a.phase !== 'play' || p.id !== a.data.seeker) return;
    const target = room.players.get(msg.id);
    if (!target || target === p || !a.participants.includes(target.id) || a.data.found.includes(target.id)) return;
    const range = HIDE.findRange + (room.assist ? 0.6 : 0) + 0.6; // latency tolerance
    if (Math.hypot(target.x - p.x, target.z - p.z) > range || Math.abs(target.y - p.y) > 1.8) return room.error(p, 'far');
    a.data.found.push(target.id);
    p.stats.found++;
    const slot = spectatorSlot(a.data.found.length - 1);
    Object.assign(target, slot);
    room.dirty = true;
    room.broadcastEvent({ kind: 'found', id: target.id, by: p.id, slot });
    if (hiders(room, a).every(id => a.data.found.includes(id))) room.finishGame(results(room, a));
  },

  tick(room, a) {
    // A seeker who leaves ends the round early rather than stranding everyone.
    if (!room.players.get(a.data.seeker)?.connected || hiders(room, a).length === 0) room.finishGame(results(room, a));
  },

  timeUp(room, a) { room.finishGame(results(room, a)); }
};

function hiders(room, a) {
  return a.participants.filter(id => id !== a.data.seeker && room.players.get(id)?.connected);
}

function results(room, a) {
  const survivors = a.participants.filter(id => id !== a.data.seeker && !a.data.found.includes(id));
  for (const id of survivors) { const p = room.players.get(id); if (p) p.stats.hidden++; }
  return { seeker: a.data.seeker, found: [...a.data.found], survivors };
}
