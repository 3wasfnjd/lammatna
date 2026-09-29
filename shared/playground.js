// Playground layout shared by the renderer, the movement code and the room
// server. Metres, y up. Every solid box is both a collider and a rendered part.

export const HALL = { minX: -24, maxX: 24, minZ: -18, maxZ: 18, height: 7.5 };

// Area palette: each activity area has a colour and a symbol children can follow.
export const PALETTE = {
  turquoise: '#2BB5B0', yellow: '#F7BE2F', coral: '#F2735F', purple: '#9C6BD1',
  pink: '#FF8FB8', cream: '#FFF3DC', sand: '#F4DDB8', navy: '#39486A', mint: '#8FE0C8', sky: '#8CCBF2'
};

export const AREAS = [
  { id: 'plaza', name: 'ساحة اللمّة', symbol: '★', color: PALETTE.yellow, x: 0, z: 0, r: 5.4 },
  { id: 'swings', name: 'المراجيح', symbol: '☁', color: PALETTE.turquoise, x: -14, z: 11, r: 4.5 },
  { id: 'tower', name: 'برج المغامرة', symbol: '▲', color: PALETTE.coral, x: 15, z: 8, r: 5 },
  { id: 'pit', name: 'بركة الكرات', symbol: '●', color: PALETTE.sky, x: 15.5, z: -8.5, r: 5 },
  { id: 'course', name: 'مسار العقبات', symbol: '■', color: PALETTE.purple, x: -13, z: -11, r: 6 },
  { id: 'blocks', name: 'ركن البناء', symbol: '✚', color: PALETTE.coral, x: -6, z: 14, r: 3.5 },
  { id: 'floor', name: 'الأرضية المضيئة', symbol: '◆', color: PALETTE.pink, x: 3, z: 12, r: 3.8 },
  { id: 'hide', name: 'ركن الاختباء', symbol: '☾', color: PALETTE.mint, x: -20.5, z: 2, r: 3 }
];

const solids = [];
function box(kind, min, max, extra = {}) {
  solids.push({ kind, min, max, ...extra });
}

// Hall walls (outside the play area).
box('wall', [HALL.minX - 1, 0, HALL.minZ - 1], [HALL.minX, HALL.height, HALL.maxZ + 1]);
box('wall', [HALL.maxX, 0, HALL.minZ - 1], [HALL.maxX + 1, HALL.height, HALL.maxZ + 1]);
box('wall', [HALL.minX, 0, HALL.minZ - 1], [HALL.maxX, HALL.height, HALL.minZ]);
box('wall', [HALL.minX, 0, HALL.maxZ], [HALL.maxX, HALL.height, HALL.maxZ + 1]);

// Central celebration stage: low enough to step onto.
export const STAGE = { x: 0, z: 0, r: 2.4, h: 0.3 };
// Round walkable tops that are not boxes.
export const DISCS = [{ x: STAGE.x, z: STAGE.z, r: STAGE.r, top: STAGE.h }];

// ---- Two-level play structure -------------------------------------------------
export const DECK_Y = 2.6;
export const TOWERS = [
  { id: 'A', minX: 10.5, maxX: 14, minZ: 5, maxZ: 11 },
  { id: 'B', minX: 16, maxX: 19.5, minZ: 5, maxZ: 11 }
];
for (const t of TOWERS) {
  box('deck', [t.minX, DECK_Y - 0.25, t.minZ], [t.maxX, DECK_Y, t.maxZ], { color: PALETTE.coral });
  for (const [x, z] of [[t.minX, t.minZ], [t.maxX, t.minZ], [t.minX, t.maxZ], [t.maxX, t.maxZ]]) {
    const px = Math.min(Math.max(x, t.minX + 0.2), t.maxX - 0.2), pz = Math.min(Math.max(z, t.minZ + 0.2), t.maxZ - 0.2);
    box('post', [px - 0.2, 0, pz - 0.2], [px + 0.2, DECK_Y - 0.25, pz + 0.2], { color: PALETTE.yellow });
  }
}
// Net bridge between the towers.
box('bridge', [14, DECK_Y - 0.15, 7], [16, DECK_Y, 9], { color: PALETTE.purple });
const RAIL_H = 1.0, RT = 0.18;
function rail(min, max, kind = 'rail') { box(kind, [min[0], DECK_Y, min[1]], [max[0], DECK_Y + RAIL_H, max[1]], { color: PALETTE.turquoise }); }
// Tower A rails (openings: stairs on the west, bridge on the east).
rail([10.5, 5], [14, 5 + RT]); rail([10.5, 11 - RT], [14, 11]);
rail([10.5, 5], [10.5 + RT, 7]); rail([10.5, 9], [10.5 + RT, 11]);
rail([14 - RT, 5], [14, 7]); rail([14 - RT, 9], [14, 11]);
// Tower B rails (openings: bridge on the west, slide on the south).
rail([16, 11 - RT], [19.5, 11]); rail([19.5 - RT, 5], [19.5, 11]);
rail([16, 5], [17.1, 5 + RT]); rail([18.5, 5], [19.5, 5 + RT]);
rail([16, 5], [16 + RT, 7]); rail([16, 9], [16 + RT, 11]);
// Bridge nets.
rail([14, 7 - RT], [16, 7], 'net'); rail([14, 9], [16, 9 + RT], 'net');

// Stairs: seven padded steps rising east onto tower A.
export const STAIRS = { minX: 5.5, maxX: 10.5, minZ: 7, maxZ: 9, steps: 7 };
for (let i = 0; i < STAIRS.steps; i++) {
  const run = (STAIRS.maxX - STAIRS.minX) / STAIRS.steps, top = DECK_Y * (i + 1) / STAIRS.steps;
  box('step', [STAIRS.minX + i * run, 0, STAIRS.minZ], [STAIRS.minX + (i + 1) * run, top, STAIRS.maxZ],
    { color: i % 2 ? PALETTE.yellow : PALETTE.cream });
}
box('siderail', [STAIRS.minX, 0, STAIRS.minZ - 0.2], [STAIRS.maxX, DECK_Y + 0.9, STAIRS.minZ], { color: PALETTE.turquoise, ramp: true });
box('siderail', [STAIRS.minX, 0, STAIRS.maxZ], [STAIRS.maxX, DECK_Y + 0.9, STAIRS.maxZ + 0.2], { color: PALETTE.turquoise, ramp: true });

// ---- Slide into the ball pit ------------------------------------------------
export const SLIDE = {
  id: 'slide',
  entrance: { x: 17.8, y: DECK_Y, z: 5.6 },
  // Path sampled by `slidePoint`; the ride ends inside the ball pit.
  start: { x: 17.8, y: DECK_Y + 0.15, z: 4.9 },
  end: { x: 17.8, y: 0.35, z: -5.2 },
  duration: 2.3
};
export function slidePoint(t) {
  const s = SLIDE.start, e = SLIDE.end, k = Math.min(Math.max(t, 0), 1);
  // Steep at the top, flattening out into the pit, with a gentle playful curve.
  return {
    x: s.x + Math.sin(k * Math.PI * 2) * 0.7 * (1 - k),
    y: s.y + (e.y - s.y) * Math.sin(k * Math.PI / 2),
    z: s.z + (e.z - s.z) * k
  };
}
// Keep walkers out from under the low end of the slide.
box('foam', [17.1, 0, -2.9], [18.5, 1.1, 1.2], { color: PALETTE.purple, hidden: true });

// ---- Ball pit ---------------------------------------------------------------
export const BALL_PIT = { minX: 10, maxX: 21, minZ: -14, maxZ: -3, rim: 0.4, depth: 0.45 };
{
  const p = BALL_PIT, t = 0.4, c = { color: PALETTE.turquoise };
  box('rim', [p.minX - t, 0, p.minZ - t], [p.maxX + t, p.rim, p.minZ], c);
  box('rim', [p.minX - t, 0, p.maxZ], [p.maxX + t, p.rim, p.maxZ + t], c);
  box('rim', [p.minX - t, 0, p.minZ], [p.minX, p.rim, p.maxZ], c);
  box('rim', [p.maxX, 0, p.minZ], [p.maxX + t, p.rim, p.maxZ], c);
}

// ---- Soft obstacle course -----------------------------------------------------
export const TUNNEL = { minX: -10, maxX: -5, z: -9, width: 2.2, height: 2.2 };
box('tunnelwall', [TUNNEL.minX, 0, TUNNEL.z - 1.4], [TUNNEL.maxX, TUNNEL.height, TUNNEL.z - 1.1], { color: PALETTE.purple, hidden: true });
box('tunnelwall', [TUNNEL.minX, 0, TUNNEL.z + 1.1], [TUNNEL.maxX, TUNNEL.height, TUNNEL.z + 1.4], { color: PALETTE.purple, hidden: true });
box('barrier', [-12.6, 0, -10.8], [-12.0, 0.55, -7.2], { color: PALETTE.coral, round: true });
box('barrier', [-14.9, 0, -10.8], [-14.3, 0.55, -7.2], { color: PALETTE.yellow, round: true });
// Soft foam pit crossed on low platforms.
export const FOAM_PIT = { minX: -20.7, maxX: -16.6, minZ: -15.5, maxZ: -8 };
box('foamwall', [-16.6, 0, -15.5], [-16.2, 1.3, -8], { color: PALETTE.purple });
box('foamwall', [-21.1, 0, -15.5], [-20.7, 1.3, -8], { color: PALETTE.purple });
export const PLATFORMS = [[-18.6, -9.3], [-19.4, -11.1], [-17.8, -12.8], [-18.8, -14.5]];
for (const [x, z] of PLATFORMS) box('platform', [x - 0.6, 0, z - 0.6], [x + 0.6, 0.6, z + 0.6], { color: PALETTE.yellow });

// ---- Swings -------------------------------------------------------------------
export const SWING_FRAME = { x: -14, z: 11, halfWidth: 4.2, pivotY: 4.3, rope: 3.6 };
export const SWINGS = [-16.4, -14, -11.6].map((x, i) => ({ id: `swing${i}`, x, z: SWING_FRAME.z, seatY: SWING_FRAME.pivotY - SWING_FRAME.rope }));
for (const side of [-1, 1]) {
  const x = SWING_FRAME.x + side * SWING_FRAME.halfWidth;
  box('post', [x - 0.25, 0, SWING_FRAME.z - 1.3], [x + 0.25, 3.6, SWING_FRAME.z - 0.8], { color: PALETTE.turquoise, hidden: true });
  box('post', [x - 0.25, 0, SWING_FRAME.z + 0.8], [x + 0.25, 3.6, SWING_FRAME.z + 1.3], { color: PALETTE.turquoise, hidden: true });
}
// Deterministic swing angle so every device animates the same ride from `since`.
export function swingAngle(seconds) {
  const amp = 0.95 * (1 - Math.exp(-seconds / 2.2));
  return Math.sin(seconds * 2 * Math.PI / 2.9) * amp;
}

// ---- Building corner, hiding places ------------------------------------------
export const BLOCKS = [
  { x: -7.5, z: 15.6, w: 1.6, h: 1.2, d: 1.6, color: PALETTE.turquoise },
  { x: -5.8, z: 15.6, w: 1.6, h: 1.2, d: 1.6, color: PALETTE.yellow },
  { x: -6.65, z: 15.6, w: 1.6, h: 1.0, d: 1.6, y: 1.2, color: PALETTE.coral },
  { x: -3.8, z: 13.2, w: 1.2, h: 1.2, d: 1.2, color: PALETTE.purple },
  { x: -8.2, z: 12.6, w: 2.2, h: 0.8, d: 1.0, color: PALETTE.pink }
];
for (const b of BLOCKS) {
  const y = b.y || 0;
  box('block', [b.x - b.w / 2, y, b.z - b.d / 2], [b.x + b.w / 2, y + b.h, b.z + b.d / 2], { color: b.color });
}
export const IGLOO = { x: -21, z: 2, r: 2.1 };
box('hidewall', [IGLOO.x - 2, 0, IGLOO.z + 1.3], [IGLOO.x + 1.2, 2, IGLOO.z + 2.0], { hidden: true });
box('hidewall', [IGLOO.x - 2, 0, IGLOO.z - 2.0], [IGLOO.x + 1.2, 2, IGLOO.z - 1.3], { hidden: true });
export const TENT = { x: 21.6, z: 15.4 };
box('hidewall', [20.2, 0, 14.0], [23, 1.8, 14.3], { hidden: true });

// ---- Decor that you bump into ------------------------------------------------
export const BENCHES = [{ x: -7.5, z: -1, rot: Math.PI / 2 }, { x: 7.5, z: -1, rot: -Math.PI / 2 }];
for (const b of BENCHES) box('bench', [b.x - 0.5, 0, b.z - 1.25], [b.x + 0.5, 0.95, b.z + 1.25], { hidden: true });
export const BEACH_BALLS = [[-9.5, 4.5, 1.3], [21.5, -1, 1.6], [-21.5, 15.5, 1.2], [8.5, -15.5, 1.1]];
for (const [x, z, d] of BEACH_BALLS) box('beachball', [x - d * 0.38, 0, z - d * 0.38], [x + d * 0.38, d * 0.9, z + d * 0.38], { hidden: true });
export const POTS = [[-23, -17], [23, -17], [23, 17], [-23, 17], [9, 17], [-12, 17]].map(([x, z]) => [x * 0.97, z * 0.97]);
for (const [x, z] of POTS) box('pot', [x - 0.45, 0, z - 0.45], [x + 0.45, 2.2, z + 0.45], { hidden: true });

// ---- Illuminated floor (Colour Floor minigame comes later) -------------------
export const COLOR_FLOOR = { x: 3, z: 12, cols: 4, rows: 3, tile: 1.8 };

// ---- Ball Rescue baskets ------------------------------------------------------
export const BALL_COLORS = [
  { id: 'coral', color: PALETTE.coral, symbol: '●', name: 'الأحمر' },
  { id: 'turquoise', color: PALETTE.turquoise, symbol: '■', name: 'الفيروزي' },
  { id: 'yellow', color: PALETTE.yellow, symbol: '★', name: 'الأصفر' },
  { id: 'purple', color: PALETTE.purple, symbol: '▲', name: 'البنفسجي' }
];
export const BASKETS = [
  { id: 'coral', x: -5.2, z: 2.6 }, { id: 'turquoise', x: -2.0, z: 4.9 },
  { id: 'yellow', x: 2.0, z: 4.9 }, { id: 'purple', x: 5.2, z: 2.6 }
];
for (const b of BASKETS) box('basket', [b.x - 0.55, 0, b.z - 0.55], [b.x + 0.55, 0.85, b.z + 0.55], { hidden: true });

// Ball spawn spots: mostly in the pit, some around the hall to invite spreading out.
export const BALL_SPOTS = [
  [12, -5], [14, -6.5], [16.5, -5.5], [19.5, -6], [11.5, -8.5], [13.5, -10], [16, -9], [18.5, -8.8],
  [20, -11.5], [12.2, -12.6], [15, -12.8], [17.8, -12.2], [-8, 3], [-10.5, -3], [7.5, -8], [3, -12],
  [-3, -15], [-12, 6], [8, 14], [-1, 9], [21, 1], [-19.5, -4], [6, 2.5], [-6.5, 8]
];

// ---- Activity start pads in the plaza ------------------------------------------
export const PADS = [
  { id: 'race', name: 'سباق الملعب', icon: '🏁', color: PALETTE.coral, x: -3.6, z: -4.2 },
  { id: 'rescue', name: 'إنقاذ الكرات', icon: '🧺', color: PALETTE.yellow, x: 3.6, z: -4.2 }
];

// ---- Playground Race ------------------------------------------------------------
export const RACE = {
  start: { x: -2.2, z: -9, yaw: -Math.PI / 2, spacing: 0.8 },
  checkpoints: [
    { x: -10.8, z: -9, r: 2.2, name: 'النفق' },
    { x: -18.6, z: -7.3, r: 2.4, name: 'الحواجز' },
    { x: -18.6, z: -16.6, r: 2.4, name: 'المنصات' },
    { x: 2, z: -15.8, r: 3.2, name: 'الممر' },
    { x: 7.2, z: 0, r: 3.2, name: 'نحو البرج' },
    { x: 12, z: 8, y: DECK_Y, r: 2, name: 'السلالم' },
    { x: 17.6, z: 8, y: DECK_Y, r: 2.2, name: 'الجسر' }
  ],
  timeLimit: 120
};
export function raceStartSlot(index) {
  const s = RACE.start, offset = (index - 2) * s.spacing;
  return { x: s.x + (index % 2) * 0.9, y: 0, z: s.z + offset, yaw: s.yaw };
}

export function spawnPoint(index) {
  const a = -Math.PI / 2 + (index - 2) * 0.45;
  return { x: Math.cos(a) * 3.4, y: 0, z: Math.sin(a) * 3.4, yaw: 0 };
}
export function celebrationSlot(index, count) {
  const a = Math.PI / 2 + (index - (count - 1) / 2) * 0.62;
  return { x: Math.cos(a) * 1.5, y: STAGE.h, z: -Math.sin(a) * 1.5 + 0.2, yaw: Math.PI };
}

export function inBallPit(x, z) {
  return x > BALL_PIT.minX && x < BALL_PIT.maxX && z > BALL_PIT.minZ && z < BALL_PIT.maxZ;
}
export function inFoamPit(x, z) {
  return x > FOAM_PIT.minX && x < FOAM_PIT.maxX && z > FOAM_PIT.minZ && z < FOAM_PIT.maxZ;
}

export const SOLIDS = solids;
