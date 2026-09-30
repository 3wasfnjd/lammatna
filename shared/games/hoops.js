// Aboden Basketball: hold to charge, release in the sweet spot. The server
// judges each shot from the player's distance and release power.
import { HOOP, nearestHoop, idealPower, shotFlight } from './arcade.js';

const COOLDOWN = 0.9;

export const hoops = {
  minPlayers: 1,
  begin(room, participants) {
    const teleport = {};
    participants.forEach((id, i) => { teleport[id] = { x: 1 + i * 1.3, y: 0, z: -12.2, yaw: Math.PI }; });
    return { data: { scores: Object.fromEntries(participants.map(id => [id, 0])), streak: {}, made: {}, shots: {}, last: {} }, teleport };
  },
  playMs() { return 60000; },

  handle(room, p, msg, a) {
    if (msg.op !== 'shoot' || a.phase !== 'play') return;
    const d = a.data, now = room.now();
    if (now - (d.last[p.id] || 0) < COOLDOWN * 1000) return;
    const power = Number(msg.power);
    if (!Number.isFinite(power) || power < 0 || power > 1) return;
    const { hoop, dist } = nearestHoop(p.x, p.z);
    if (dist < HOOP.minDist || dist > HOOP.maxDist) return room.error(p, 'far');
    d.last[p.id] = now;
    d.shots[p.id] = (d.shots[p.id] || 0) + 1;
    const err = Math.abs(power - idealPower(dist)), tol = room.assist ? 0.035 : 0;
    let result;
    if (err < 0.055 + tol) result = 'swish';
    else if (err < 0.1 + tol) result = room.random() < 0.55 ? 'rim-in' : 'rim-out';
    else result = err < 0.17 ? 'rim-out' : 'miss';
    let pts = 0;
    if (result === 'swish' || result === 'rim-in') {
      d.streak[p.id] = (d.streak[p.id] || 0) + 1;
      pts = dist >= HOOP.threePoint ? 3 : 2;
      if (d.streak[p.id] >= 3) pts += 1; // on fire
      d.made[p.id] = (d.made[p.id] || 0) + 1;
      d.scores[p.id] = (d.scores[p.id] || 0) + pts;
      p.stats.baskets += pts;
    } else d.streak[p.id] = 0;
    room.dirty = true;
    room.broadcastEvent({
      kind: 'shot', id: p.id, from: [p.x, p.y + 1.7, p.z], hoop: hoop.id, result, pts, streak: d.streak[p.id] || 0,
      power: Math.round(power * 100) / 100, flight: shotFlight(dist), three: dist >= HOOP.threePoint
    });
  },

  timeUp(room, a) {
    const ranking = Object.entries(a.data.scores).map(([id, score]) => ({ id: Number(id), score, made: a.data.made[id] || 0, shots: a.data.shots[id] || 0 }))
      .sort((x, y) => y.score - x.score);
    room.finishGame({ ranking });
  }
};
