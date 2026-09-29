// Colour Floor: the floor lights up, a target colour + symbol is called, and
// everyone races to a matching tile before the countdown ends. Nobody is
// knocked out: wrong tiles dip into the cushions and the next round starts.
import { FLOOR_COLORS, TILE_COUNT, tileIndexAt, tileCenter } from './layout.js';
import { COLOR_FLOOR } from '../playground.js';

export const COLORS_ROUNDS = 8;
export const DROP_MS = 1700;
export function showSeconds(round) {
  return Math.max(1.8, 4.2 - (round - 1) * 0.33);
}

export const colors = {
  minPlayers: 1,
  begin(room, participants) {
    const teleport = {};
    const f = COLOR_FLOOR, south = f.z - f.rows * f.tile / 2 - 1.2;
    participants.forEach((id, i) => { teleport[id] = { x: f.x + (i - (participants.length - 1) / 2) * 1.2, y: 0, z: south, yaw: 0 }; });
    const data = { round: 0, rounds: COLORS_ROUNDS, stage: 'wait', stageStart: 0, stageEnd: 0, tiles: Array(TILE_COUNT).fill(null), target: null, scores: Object.fromEntries(participants.map(id => [id, 0])), last: null };
    return { data, teleport };
  },
  playMs() { return (COLORS_ROUNDS * 7 + 10) * 1000; },

  tick(room, a, now) {
    const d = a.data;
    if (d.stage === 'show' && now >= d.stageEnd) return judge(room, a, now);
    if (d.stage === 'wait' || (d.stage === 'drop' && now >= d.stageEnd)) {
      if (d.round >= d.rounds) return room.finishGame(results(a));
      nextRound(room, d, now);
    }
  },

  timeUp(room, a) { room.finishGame(results(a)); }
};

function nextRound(room, d, now) {
  d.round++;
  const target = FLOOR_COLORS[Math.floor(room.random() * FLOOR_COLORS.length)].id;
  // Fewer safe tiles as rounds go on (never fewer than two).
  const safe = Math.max(2, 5 - Math.floor(d.round / 2));
  const order = [...Array(TILE_COUNT).keys()].sort(() => room.random() - 0.5);
  const others = FLOOR_COLORS.map(c => c.id).filter(c => c !== target);
  d.tiles = Array(TILE_COUNT).fill(null);
  order.forEach((tile, i) => { d.tiles[tile] = i < safe ? target : others[Math.floor(room.random() * others.length)]; });
  d.target = target;
  d.stage = 'show'; d.stageStart = now; d.stageEnd = now + showSeconds(d.round) * 1000;
  d.last = null;
  room.dirty = true;
  room.broadcastEvent({ kind: 'colorRound', round: d.round, target });
}

function judge(room, a, now) {
  const d = a.data, correct = [], wrong = [];
  for (const id of a.participants) {
    const p = room.players.get(id);
    if (!p?.connected) continue;
    const tile = tileIndexAt(p.x, p.z);
    if (tile >= 0 && d.tiles[tile] === d.target) { correct.push(id); d.scores[id] = (d.scores[id] || 0) + 1; p.stats.colorPoints++; }
    else wrong.push(id);
  }
  d.last = { round: d.round, correct, wrong };
  d.stage = 'drop'; d.stageStart = now; d.stageEnd = now + DROP_MS;
  room.dirty = true;
  room.broadcastEvent({ kind: 'colorJudge', round: d.round, correct, wrong });
}

function results(a) {
  const ranking = Object.entries(a.data.scores).map(([id, score]) => ({ id: Number(id), score }))
    .sort((x, y) => y.score - x.score);
  return { ranking, rounds: a.data.rounds };
}

export { tileCenter };
