// Aboden Shooting Gallery: a carnival booth with cans, moving ducks and
// bullseye boards. Clients send a ray; the server checks it against the
// targets at the current time (and a moment earlier, for latency).
import { LANES, GALLERY_TARGETS, targetPos, raySphere } from './arcade.js';

const COOLDOWN = 0.32, DOWN_MS = 2600;

export const gallery = {
  minPlayers: 1,
  begin(room, participants) {
    const teleport = {};
    participants.forEach((id, i) => { const l = LANES[i % LANES.length]; teleport[id] = { x: l.x, y: 0, z: l.z, yaw: 0 }; });
    return { data: { scores: Object.fromEntries(participants.map(id => [id, 0])), hits: {}, shots: {}, down: {}, last: {} }, teleport };
  },
  playMs() { return 60000; },
  // Everyone stays at their lane while shooting.
  pinned(room, a, p) { return a.phase === 'play' && a.participants.includes(p.id); },

  handle(room, p, msg, a) {
    if (msg.op !== 'fire' || a.phase !== 'play') return;
    const d = a.data, now = room.now();
    if (now - (d.last[p.id] || 0) < COOLDOWN * 1000) return;
    const o = msg.o, dir = msg.d;
    if (!Array.isArray(o) || !Array.isArray(dir) || o.length !== 3 || dir.length !== 3 || ![...o, ...dir].every(Number.isFinite)) return;
    if (Math.hypot(o[0] - p.x, o[2] - p.z) > 3 || o[1] < p.y - 0.5 || o[1] > p.y + 3.5) return;
    const len = Math.hypot(...dir);
    if (len < 1e-6) return;
    const u = dir.map(v => v / len);
    d.last[p.id] = now;
    d.shots[p.id] = (d.shots[p.id] || 0) + 1;
    const secs = [(now - a.phaseStart) / 1000, (now - a.phaseStart - 120) / 1000];
    let best = null;
    for (const t of GALLERY_TARGETS) {
      if ((d.down[t.id] || 0) > now) continue;
      for (const s of secs) {
        const c = targetPos(t, s), dist = raySphere(o, u, c, t.r + (room.assist ? 0.08 : 0));
        if (dist < (best?.dist ?? Infinity)) {
          let pts = t.pts;
          if (t.kind === 'board') {
            // Distance from the ray to the board centre decides bull or ring.
            const px = o[0] + u[0] * dist - c.x, py = o[1] + u[1] * dist - c.y;
            if (Math.hypot(px, py) < t.bull + 0.05) pts = t.bullPts;
          }
          best = { t, dist, pts };
        }
      }
    }
    if (best) {
      d.down[best.t.id] = now + DOWN_MS;
      d.scores[p.id] = (d.scores[p.id] || 0) + best.pts;
      d.hits[p.id] = (d.hits[p.id] || 0) + 1;
      p.stats.targets += best.pts;
      room.dirty = true;
    }
    room.broadcastEvent({ kind: 'fire', id: p.id, o, d: u, target: best?.t.id || null, pts: best?.pts || 0, dist: best ? best.dist : 12 });
  },

  timeUp(room, a) {
    const ranking = Object.entries(a.data.scores).map(([id, score]) => ({ id: Number(id), score, hits: a.data.hits[id] || 0, shots: a.data.shots[id] || 0 }))
      .sort((x, y) => y.score - x.score);
    room.finishGame({ ranking });
  }
};
