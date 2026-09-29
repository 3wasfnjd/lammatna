// Family Builders: carry oversized foam pieces to a glowing blueprint and snap
// them into place, bottom layer first. The long plank needs two carriers when
// two or more people play.
import { BLUEPRINT, PIECE_SPAWNS, BUILD } from './layout.js';

export function buildStars(success, seconds) {
  if (!success) return 0;
  return 1 + (seconds <= 80 ? 1 : 0) + (seconds <= 50 ? 1 : 0);
}

export const builders = {
  minPlayers: 1,
  begin(room, participants) {
    const pieces = BLUEPRINT.map((slot, i) => ({
      id: i + 1, kind: slot.kind, target: slot.id, color: slot.color,
      x: PIECE_SPAWNS[slot.id][0], y: 0, z: PIECE_SPAWNS[slot.id][1], holders: [], placed: null
    }));
    const teleport = {};
    participants.forEach((id, i) => { teleport[id] = { x: BUILD.x - 1.6 + i * 0.8, y: 0, z: BUILD.z - 4.2, yaw: 0 }; });
    return { data: { pieces, needTwo: participants.length >= 2, placedBy: {} }, teleport };
  },
  playMs() { return BUILD.timeLimit * 1000; },

  handle(room, p, msg, a) {
    if (a.phase !== 'play') return;
    const d = a.data;
    if (msg.op === 'lift') {
      const piece = d.pieces.find(x => x.id === msg.id);
      if (!piece || piece.placed || piece.holders.includes(p.id) || heldBy(d, p.id)) return;
      if (p.carrying || p.equipment) return;
      const big = piece.kind === 'plank' && d.needTwo;
      if (piece.holders.length >= (big ? 2 : 1)) return room.error(p, 'occupied');
      const reach = room.reach(piece.kind === 'plank' ? 1.8 : 0.8);
      if (Math.hypot(piece.x - p.x, piece.z - p.z) > reach) return room.error(p, 'far');
      piece.holders.push(p.id);
      room.dirty = true;
      room.broadcastEvent({ kind: 'lift', id: p.id, piece: piece.id, waiting: big && piece.holders.length < 2 });
    } else if (msg.op === 'drop') {
      const piece = heldBy(d, p.id);
      if (!piece) return;
      release(piece, p.id);
      room.dirty = true;
      room.broadcastEvent({ kind: 'drop', id: p.id });
    } else if (msg.op === 'place') {
      const piece = heldBy(d, p.id);
      const slot = BLUEPRINT.find(s => s.id === msg.slot);
      if (!piece || !slot || slot.kind !== piece.kind) return;
      if (piece.kind === 'plank' && d.needTwo && piece.holders.length < 2) return room.error(p, 'need-help');
      if (d.pieces.some(x => x.placed === slot.id)) return;
      if (!slot.needs.every(n => d.pieces.some(x => x.placed === n))) return room.error(p, 'not-yet');
      if (Math.hypot(piece.x - slot.x, piece.z - slot.z) > room.reach(1.4)) return room.error(p, 'far');
      for (const id of piece.holders) {
        const q = room.players.get(id);
        if (q) q.stats.placed++;
        d.placedBy[id] = (d.placedBy[id] || 0) + 1;
      }
      Object.assign(piece, { placed: slot.id, holders: [], x: slot.x, y: slot.y, z: slot.z });
      room.dirty = true;
      const count = d.pieces.filter(x => x.placed).length;
      room.broadcastEvent({ kind: 'placed', id: p.id, piece: piece.id, slot: slot.id, count, total: BLUEPRINT.length });
      if (count === BLUEPRINT.length) {
        const seconds = (room.now() - a.phaseStart) / 1000;
        room.finishGame({ success: true, seconds: Math.round(seconds), stars: buildStars(true, seconds), placedBy: d.placedBy });
      }
    }
  },

  // Carried pieces follow their carriers (a plank follows the midpoint of two).
  tick(room, a) {
    for (const piece of a.data.pieces) {
      if (piece.placed || !piece.holders.length) continue;
      piece.holders = piece.holders.filter(id => room.players.get(id)?.connected);
      const holders = piece.holders.map(id => room.players.get(id));
      const big = piece.kind === 'plank' && a.data.needTwo;
      if (big && holders.length < 2) continue;
      if (!holders.length) continue;
      piece.x = holders.reduce((s, q) => s + q.x, 0) / holders.length;
      piece.z = holders.reduce((s, q) => s + q.z, 0) / holders.length;
    }
  },

  // A carrier who disconnects lets go.
  released(room, a, p) {
    const piece = heldBy(a.data, p.id);
    if (piece) release(piece, p.id);
  },

  timeUp(room, a) {
    const placed = a.data.pieces.filter(x => x.placed).length;
    room.finishGame({ success: false, stars: 0, placed, total: BLUEPRINT.length, placedBy: a.data.placedBy });
  }
};

function heldBy(d, id) { return d.pieces.find(x => x.holders.includes(id)); }
function release(piece, id) {
  piece.holders = piece.holders.filter(h => h !== id);
  piece.y = 0;
}
