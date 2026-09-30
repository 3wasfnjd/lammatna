// Colour War: two family teams throw paint balls at each other. A hit
// freezes the target briefly and scores for the thrower's team. Solo players
// face friendly paint robots instead. Projectiles are simulated here.
import { PAINT, teamSpawn } from './arcade.js';
import { SOLIDS, HALL } from '../playground.js';

const BOT_HEIGHT = 1.2;

export const paint = {
  minPlayers: 1,
  begin(room, participants) {
    const teams = {}, teleport = {};
    const order = [...participants].sort(() => room.random() - 0.5);
    order.forEach((id, i) => { teams[id] = i % 2 ? 'B' : 'A'; });
    const count = { A: 0, B: 0 };
    for (const id of participants) teleport[id] = teamSpawn(teams[id], count[teams[id]]++);
    const bots = [];
    // One player: three robots. Uneven teams get one helper robot.
    const need = participants.length === 1 ? 3 : Math.abs(count.A - count.B);
    for (let i = 0; i < need; i++) {
      const team = participants.length === 1 ? 'B' : count.A < count.B ? 'A' : 'B';
      const s = teamSpawn(team, 3 + i);
      bots.push({ id: `bot${i}`, team, x: s.x + (team === 'A' ? -1.5 : 1.5), z: s.z, tx: s.x, tz: s.z, next: 0, frozen: 0 });
    }
    return { data: { teams, score: { A: 0, B: 0 }, hits: {}, frozen: {}, balls: [], splats: [], bots, seq: 1, last: {} }, teleport };
  },
  playMs() { return PAINT.time * 1000; },
  locked(room, a, p) { return a.phase === 'play' && (a.data.frozen[p.id] || 0) > room.now(); },
  snap(a) {
    return {
      b: a.data.balls.map(b => [b.id, round2(b.x), round2(b.y), round2(b.z), b.team]),
      r: a.data.bots.map(b => [b.id, round2(b.x), round2(b.z), b.team, b.frozen > 0 ? 1 : 0])
    };
  },

  handle(room, p, msg, a) {
    if (msg.op !== 'throw' || a.phase !== 'play') return;
    const d = a.data, now = room.now();
    if ((d.frozen[p.id] || 0) > now || now - (d.last[p.id] || 0) < PAINT.cooldown * 1000) return;
    const dx = Number(msg.dx), dz = Number(msg.dz), l = Math.hypot(dx, dz);
    if (!Number.isFinite(l) || l < 1e-6) return;
    d.last[p.id] = now;
    launch(d, { owner: p.id, team: d.teams[p.id], x: p.x, z: p.z, dx: dx / l, dz: dz / l });
  },

  tick(room, a, now, dt) {
    const d = a.data;
    updateBots(room, d, now, dt);
    const targets = [
      ...a.participants.map(id => room.players.get(id)).filter(q => q?.connected).map(q => ({ id: q.id, team: d.teams[q.id], x: q.x, y: q.y, z: q.z, h: 1.5 })),
      ...d.bots.map(b => ({ id: b.id, team: b.team, x: b.x, y: 0, z: b.z, h: BOT_HEIGHT, bot: b }))
    ];
    const keep = [];
    for (const ball of d.balls) {
      // Sub-steps so a fast ball never skips over a target between ticks.
      const steps = Math.max(1, Math.ceil(Math.hypot(ball.vx, ball.vz) * dt / 0.25)), h = dt / steps;
      let hit = null, gone = false;
      for (let s = 0; s < steps && !hit && !gone; s++) {
        ball.x += ball.vx * h; ball.z += ball.vz * h; ball.vy -= 3.2 * h; ball.y += ball.vy * h; ball.travel += Math.hypot(ball.vx, ball.vz) * h;
        for (const t of targets) {
          if (t.team === ball.team || (t.bot ? t.bot.frozen > now : (d.frozen[t.id] || 0) > now)) continue;
          if (Math.hypot(t.x - ball.x, t.z - ball.z) < PAINT.radius && ball.y > t.y - 0.2 && ball.y < t.y + t.h + 0.55) { hit = t; break; }
        }
        if (!hit && (ball.y < 0.05 || ball.travel > PAINT.range || hitsSolid(ball))) gone = true;
      }
      if (hit) {
        if (hit.bot) hit.bot.frozen = now + PAINT.freeze * 1000;
        else d.frozen[hit.id] = now + PAINT.freeze * 1000;
        d.score[ball.team]++;
        if (typeof ball.owner === 'number') {
          d.hits[ball.owner] = (d.hits[ball.owner] || 0) + 1;
          const owner = room.players.get(ball.owner);
          if (owner) owner.stats.splats++;
        }
        splat(d, ball);
        room.dirty = true;
        room.broadcastEvent({ kind: 'splat', by: ball.owner, target: hit.id, team: ball.team, x: round2(ball.x), y: round2(ball.y), z: round2(ball.z) });
        continue;
      }
      if (gone) { splat(d, ball); room.dirty = true; continue; }
      keep.push(ball);
    }
    d.balls = keep;
  },

  timeUp(room, a) {
    const { A, B } = a.data.score;
    room.finishGame({ score: { A, B }, winner: A === B ? null : A > B ? 'A' : 'B', teams: a.data.teams, hits: a.data.hits });
  }
};

function launch(d, { owner, team, x, z, dx, dz }) {
  if (d.balls.length > 40) return;
  d.balls.push({ id: d.seq++, owner, team, x: x + dx * 0.5, y: 1.25, z: z + dz * 0.5, vx: dx * PAINT.speed, vz: dz * PAINT.speed, vy: 0.8, travel: 0 });
}

function splat(d, ball) {
  d.splats.push([round2(ball.x), round2(Math.max(0, ball.y)), round2(ball.z), ball.team]);
  if (d.splats.length > 40) d.splats.shift();
}

function hitsSolid(ball) {
  if (ball.x < HALL.minX || ball.x > HALL.maxX || ball.z < HALL.minZ || ball.z > HALL.maxZ) return true;
  for (const s of SOLIDS) {
    if (ball.y < s.min[1] || ball.y > s.max[1]) continue;
    if (ball.x > s.min[0] && ball.x < s.max[0] && ball.z > s.min[2] && ball.z < s.max[2]) return true;
  }
  return false;
}

// Friendly robots wander around the plaza and lob slow paint back.
function updateBots(room, d, now, dt) {
  for (const b of d.bots) {
    if (b.frozen > now) continue;
    b.frozen = 0;
    const dx = b.tx - b.x, dz = b.tz - b.z, dist = Math.hypot(dx, dz);
    if (dist < 0.3) { b.tx = (room.random() - 0.5) * 16; b.tz = (room.random() - 0.5) * 14 - 1; }
    else { b.x += dx / dist * 1.8 * dt; b.z += dz / dist * 1.8 * dt; }
    if (now > b.next) {
      b.next = now + 2600 + room.random() * 2000;
      let target = null, td = 11;
      for (const q of room.players.values()) {
        if (!q.connected || !q.character || d.teams[q.id] === b.team || d.teams[q.id] == null) continue;
        const dd = Math.hypot(q.x - b.x, q.z - b.z);
        if (dd < td) { td = dd; target = q; }
      }
      if (target) {
        // Aim slightly off so robots are beatable.
        const ang = Math.atan2(target.x - b.x, target.z - b.z) + (room.random() - 0.5) * 0.35;
        launch(d, { owner: b.id, team: b.team, x: b.x, z: b.z, dx: Math.sin(ang), dz: Math.cos(ang) });
        d.balls[d.balls.length - 1].vx *= 0.6; d.balls[d.balls.length - 1].vz *= 0.6;
      }
    }
  }
}

function round2(v) { return Math.round(v * 100) / 100; }
