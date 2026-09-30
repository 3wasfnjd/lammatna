// Writes world/layout.json — the data file the game, the room server and the
// tests read. This script only saves typing for repeated placements (chairs,
// trees, balls); edit either the script (then re-run it) or the JSON directly.
//   node tools/make-layout.mjs
import { writeFile } from 'node:fs/promises';

const P = [];                 // placements
let n = 0;
const id = (base) => `${base}-${++n}`;
const add = (o) => { P.push({ id: o.id || id(o.model ? o.model.split('/')[1] : o.shape), ...o }); return o; };

// ------------------------------------------------------------------ world frame
// Hall: x −42…42, z −32…32 (north = +z). A 14 m gate in the north wall opens onto
// the garden: x −42…42, z 32…90.
const walls = [
  { from: [-42.5, -32.5], to: [42.5, -32.5], height: 8, thickness: 1, kind: 'wall' },
  { from: [-42.5, -32.5], to: [-42.5, 32.5], height: 8, thickness: 1, kind: 'wall' },
  { from: [42.5, -32.5], to: [42.5, 32.5], height: 8, thickness: 1, kind: 'wall' },
  { from: [-42.5, 32.5], to: [-7, 32.5], height: 8, thickness: 1, kind: 'wall' },
  { from: [7, 32.5], to: [42.5, 32.5], height: 8, thickness: 1, kind: 'wall' },
  { from: [-42.5, 32.5], to: [-42.5, 90.5], height: 2.4, thickness: 1, kind: 'hedge' },
  { from: [42.5, 32.5], to: [42.5, 90.5], height: 2.4, thickness: 1, kind: 'hedge' },
  { from: [-42.5, 90.5], to: [42.5, 90.5], height: 2.4, thickness: 1, kind: 'hedge' }
];

const zones = [
  { id: 'plaza', icon: '⛲', color: '#FFD166', center: [0, -19], size: [20, 20], shape: 'circle', sound: 'plaza', stage: 'hall' },
  { id: 'trampoline', icon: '🤸', color: '#4CC9F0', center: [-27, -17], size: [26, 26], shape: 'rect', sound: 'boing', stage: 'hall' },
  { id: 'adventure', icon: '🏰', color: '#F77F00', center: [-27, 15], size: [26, 30], shape: 'hex', sound: 'adventure', stage: 'hall' },
  { id: 'arcade', icon: '🕹️', color: '#9D4EDD', center: [27, 15], size: [26, 30], shape: 'rect', sound: 'arcade', stage: 'hall' },
  { id: 'cafe', icon: '☕', color: '#06D6A0', center: [27, -17], size: [26, 26], shape: 'rect', sound: 'cafe', stage: 'hall' },
  { id: 'swings', icon: '🎠', color: '#FF70A6', center: [0, 15], size: [24, 26], shape: 'circle', sound: 'swings', stage: 'hall' },
  { id: 'garden', icon: '🌳', color: '#90BE6D', center: [0, 61], size: [84, 58], shape: 'lawn', sound: 'garden', stage: 'garden' }
];

// ------------------------------------------------------------------ plaza
add({ id: 'fountain', shape: 'pool', zone: 'plaza', pos: [0, 0, -27], size: [6, 0.35, 6], color: '#48CAE4', collider: 'none', behaviour: { type: 'water', circle: true } });
add({ id: 'giant-ball', shape: 'ball', zone: 'plaza', pos: [0, 0, -20], size: [2.4, 2.4, 2.4], color: '#FF595E', collider: 'dynamic', mass: 12, behaviour: { tag: 'giant', restitution: 0.55 } });
for (const [x, z, c] of [[4.5, -15.5, '#FFCA3A'], [-4.5, -16.5, '#8AC926'], [4, -24, '#1982C4']])
  add({ shape: 'ball', zone: 'plaza', pos: [x, 0, z], size: [0.6, 0.6, 0.6], color: c, collider: 'dynamic', mass: 0.8, behaviour: { tag: 'ball', restitution: 0.75 } });
for (const [x, rot] of [[-9.5, 90], [9.5, -90]])
  add({ id: `goal-${x < 0 ? 'w' : 'e'}`, shape: 'goal', zone: 'plaza', pos: [x, 0, -20], rot, size: [3.4, 2.2, 1.2], collider: 'none',
    behaviour: { type: 'area', posts: [[-1.75, 0, -0.1, -1.55, 2.2, 0.1], [1.55, 0, -0.1, 1.75, 2.2, 0.1]] } });
// Soft steps up to the first trampoline (the guided first experience).
add({ id: 'step-low', shape: 'block', zone: 'trampoline', pos: [-17.9, 0, -19.3], size: [0.7, 0.4, 2.2], color: '#FFD166', collider: 'box' });
add({ id: 'step-high', shape: 'block', zone: 'trampoline', pos: [-18.55, 0, -19.3], size: [0.6, 0.8, 2.2], color: '#FFB703', collider: 'box' });

// ------------------------------------------------------------------ trampoline park (starter scene)
add({
  id: 'trampoline-park', model: 'scn/trampoline', zone: 'trampoline', pos: [-21, 0, -16], rot: 0, collider: 'children',
  children: [
    { match: 'floor-tile|ceiling-truss|toddler-play-mat', collider: 'none' },
    { match: 'safety-sign-set|briefing-screen|grip-sock-display', collider: 'exclude' },
    { match: 'trampoline-bed-module|performance-trampoline|angled-trampoline|airbag-landing-block|tumble-track|wall-trampoline', collider: 'bounce' },
    { match: 'basketball-dunk-hoop', collider: 'none', behaviour: { type: 'hoop', ringOffset: [0, 2.35, 0.5], r: 0.26, shootDist: 1.2 } },
    { match: 'foam-pit', collider: 'none', behaviour: { type: 'softPit' } },
    { match: 'ball-pit', collider: 'none', behaviour: { type: 'ballPit' } },
    { match: 'spinner-seat', collider: 'none', behaviour: { type: 'spinner', axis: 'y', seat: true, damping: 0.8 } },
    { match: 'roller-slide', collider: 'none', behaviour: { type: 'slide', width: 0.7,
      path: [[-1, 1.15, -0.35], [-1, 0.95, 0.3], [-1, 0.62, 1.2], [-1, 0.38, 2.0], [-1, 0.22, 2.7], [-1, 0.12, 3.2]], entry: [-1, 0, -0.95], posts: [] } },
    { match: 'soft-play-frame-tower', collider: 'none', behaviour: { type: 'climb', top: 2.3, inset: 0.3 } },
    { match: 'crawl-tunnel', collider: 'none', behaviour: { type: 'solid', solids: [] } },
    { match: 'waste-bin|cleaning-trolley', collider: 'dynamic', behaviour: { mass: 10 } }
  ]
});

// ------------------------------------------------------------------ adventure tower
add({ id: 'big-slide', model: 'tt/slide_B', zone: 'adventure', pos: [-33, 0, 21], collider: 'joint',
  behaviour: { type: 'slide', width: 0.9,
    path: [[0, 2.95, 0.9], [0, 2.7, 1.8], [0, 1.9, 2.45], [0, 1.05, 2.95], [0, 0.55, 3.55], [0, 0.35, 4.1], [0, 0.2, 4.7]],
    entry: [-2.6, 0, -0.2],
    deck: [-1.3, 0, -1.4, 1.3, 2.95, 0.75],
    posts: [[-2.2, 0, -2.0, -1.7, 5.5, -1.5], [1.5, 0, -2.0, 2.0, 5.5, -1.5], [-2.2, 0, 1.4, -1.7, 5.5, 1.9], [1.5, 0, 1.4, 2.0, 5.5, 1.9]] } });
add({ id: 'small-slide', model: 'tt/slide_A', zone: 'adventure', pos: [-36, 0, 8], collider: 'joint',
  behaviour: { type: 'slide', width: 0.8,
    path: [[-0.18, 2.1, 1.0], [-0.18, 1.95, 1.7], [-0.18, 1.5, 2.3], [-0.18, 0.95, 2.85], [-0.18, 0.55, 3.5], [-0.18, 0.3, 4.1], [-0.18, 0.15, 4.6]],
    entry: [-0.18, 0, -2.1],
    deck: [-1.3, 0, -1.3, 0.95, 2.1, 0.95],
    posts: [] } });
add({ id: 'ball-pit', shape: 'pit', zone: 'adventure', pos: [-20, 0, 10], size: [6, 0.55, 6], color: '#FB8500', collider: 'none',
  behaviour: { type: 'ballPit', walls: [[-3, 0, -3, 3, 0.35, -2.8], [-3, 0, 2.8, 3, 0.35, 3], [-3, 0, -3, -2.8, 0.35, 3], [2.8, 0, -3, 3, 0.35, 3]] } });
add({ id: 'bars', model: 'tt/monkeybar_A', zone: 'adventure', pos: [-24, 0, 22], collider: 'joint', behaviour: { type: 'hang' } });
add({ id: 'arch-climber', model: 'tt/monkeybar_B', zone: 'adventure', pos: [-17, 0, 22], rot: 90, collider: 'joint', behaviour: { type: 'climb', inset: 0.35 } });
for (const [x, z, m] of [[-29, 5, 'tt/tire_blue'], [-27.5, 4.2, 'tt/tire_pink'], [-30.5, 3.8, 'tt/tire_yellow']])
  add({ model: m, zone: 'adventure', pos: [x, 0, z], rot: 30, collider: 'dynamic', mass: 6 });
for (const [x, z] of [[-30, 13], [-28.6, 14.2], [-27.2, 13.2], [-25.8, 14.4]])
  add({ model: 'tt/stepping_stumps_B_large', zone: 'adventure', pos: [x, 0, z], collider: 'box' });
// Lost balls around the tower: the ball-rescue game brings them home to the basket.
for (const [x, z, c] of [[-22, 18, '#FF595E'], [-33, 12.5, '#FFCA3A'], [-18, 26, '#8AC926'], [-35, 27, '#1982C4'], [-15, 14, '#6A4C93'], [-24, 28, '#FF924C'], [-38.5, 16, '#52A675'], [-19, 4, '#F15BB5']])
  add({ shape: 'ball', zone: 'adventure', pos: [x, 0, z], size: [0.55, 0.55, 0.55], color: c, collider: 'dynamic', mass: 0.7, behaviour: { tag: 'rescue', restitution: 0.7 } });
add({ id: 'rescue-basket', shape: 'basket', zone: 'adventure', pos: [-26, 0, 3], size: [3.6, 0.3, 3.6], color: '#FFB703', collider: 'none', behaviour: { type: 'area' } });

// ------------------------------------------------------------------ swings area
add({ id: 'swing-big', model: 'tt/swing_A_large', zone: 'swings', pos: [-7.5, 0, 22], collider: 'joint', behaviour: { type: 'swing', seats: ['seat_A', 'seat_B'] } });
add({ id: 'swing-small', model: 'tt/swing_B_small', zone: 'swings', pos: [-7.5, 0, 14], collider: 'joint', behaviour: { type: 'swing', seats: ['seat'] } });
add({ id: 'seesaw-big', model: 'tt/seesaw_large', zone: 'swings', pos: [6, 0, 22], collider: 'joint', behaviour: { type: 'seesaw', part: 'seat' } });
add({ id: 'seesaw-small', model: 'tt/seesaw_small', zone: 'swings', pos: [9.5, 0, 22], collider: 'joint', behaviour: { type: 'seesaw', part: 'seat' } });
add({ id: 'merry', model: 'tt/merry_go_round', zone: 'swings', pos: [7.5, 0, 12], collider: 'joint', behaviour: { type: 'roundabout', radius: 1.9, deckY: 0.32 } });
add({ id: 'horse-a', model: 'tt/spring_horse_A', zone: 'swings', pos: [-10, 0, 6], scale: 0.55, collider: 'joint', behaviour: { type: 'springRider', part: 'seat', seatAt: 0.5 } });
add({ id: 'horse-b', model: 'tt/spring_horse_B', zone: 'swings', pos: [-6, 0, 6], scale: 0.55, collider: 'joint', behaviour: { type: 'springRider', part: 'seat', seatAt: 0.5 } });

// ------------------------------------------------------------------ arcade lounge (Kenney Mini Arcade ×2.4)
const A = 2.4;
for (const z of [6, 8.5, 11]) add({ model: 'arc/arcade-machine', zone: 'arcade', pos: [38.8, 0, z], rot: -90, scale: A, collider: 'box', behaviour: { type: 'machine', kind: 'arcade' } });
for (const z of [15, 17.5]) add({ model: 'arc/pinball', zone: 'arcade', pos: [38.8, 0, z], rot: -90, scale: A, collider: 'box', behaviour: { type: 'machine', kind: 'pinball' } });
for (const x of [30, 34]) add({ model: 'arc/dance-machine', zone: 'arcade', pos: [x, 0, 28.5], rot: 180, scale: A, collider: 'box', behaviour: { type: 'machine', kind: 'dance', frontGap: 0.1 } });
for (const x of [18, 21]) add({ model: 'arc/claw-machine', zone: 'arcade', pos: [x, 0, 28.5], rot: 180, scale: A, collider: 'box', behaviour: { type: 'claw', part: '(%ignore)' } });
for (const z of [20, 4.5]) add({ model: 'arc/air-hockey', zone: 'arcade', pos: [32, 0, z], scale: A, collider: 'joint', behaviour: { type: 'airHockey', surfaceY: 0.25, parts: ['puck', 'player-a', 'player-b'] } });
for (const z of [22, 16]) {
  add({ model: 'arc/basketball-game', zone: 'arcade', pos: [15.3, 0, z], rot: 90, scale: A, collider: 'joint',
    behaviour: { type: 'hoop', ring: [0, 0.72, -0.28], r: 0.14, rScale: 1.6, parts: ['ball'], solids: [[-0.325, 0, -0.5, 0.325, 0.42, 0.513], [-0.325, 0.42, -0.5, 0.325, 0.8, -0.42]] } });
  for (const dz of [-0.5, 0.5]) add({ shape: 'ball', zone: 'arcade', pos: [18.6, 0, z + dz], size: [0.42, 0.42, 0.42], color: '#F3722C', collider: 'dynamic', mass: 0.6, behaviour: { tag: 'basketball', restitution: 0.7 } });
}
add({ model: 'arc/prize-wheel', zone: 'arcade', pos: [25.5, 0, 30.8], rot: 180, scale: A, collider: 'box', behaviour: { type: 'spinner', part: 'rotate-z', axis: 'z' } });
add({ model: 'arc/ticket-machine', zone: 'arcade', pos: [28, 0, 31], rot: 180, scale: A, collider: 'box', behaviour: { type: 'machine', kind: 'ticket' } });
add({ id: 'color-floor', shape: 'colorFloor', zone: 'arcade', pos: [22, 0, 8], size: [9, 0.06, 9], collider: 'none', behaviour: { type: 'area', cells: 6 } });
for (const [x, z] of [[16, 3], [16, 5.5], [27.5, 1.5]]) add({ model: 'fur/pillowBlueLong', zone: 'arcade', pos: [x, 0, z], rot: 90, scale: 2.4, collider: 'dynamic', mass: 2 });
add({ model: 'arc/column', zone: 'arcade', pos: [14.5, 0, 0.5], scale: A, collider: 'box' });

// ------------------------------------------------------------------ family café (Kenney Furniture ×2.2)
const F = 2.2;
for (const [x, z] of [[22, -11], [30, -11], [22, -21], [30, -21]]) {
  add({ id: id('rug'), model: 'fur/rugRound', zone: 'cafe', pos: [x, 0, z], scale: 3, collider: 'none' });
  add({ model: 'fur/tableRound', zone: 'cafe', pos: [x, 0, z], scale: F, collider: 'dynamic', mass: 18 });
  for (const [dx, dz, r] of [[-1.5, 0, 90], [1.5, 0, -90], [0, 1.6, 180], [0, -1.6, 0]])
    add({ model: 'fur/chairCushion', zone: 'cafe', pos: [x + dx, 0, z + dz], rot: r, scale: F, collider: 'dynamic', mass: 4 });
}
for (const z of [-28.5, -27.5, -26.5, -25.5, -24.5]) add({ model: 'fur/kitchenCabinet', zone: 'cafe', pos: [39.3, 0, z], rot: -90, scale: F, collider: 'box' });
add({ model: 'fur/kitchenFridgeLarge', zone: 'cafe', pos: [39.3, 0, -22.5], rot: -90, scale: F, collider: 'box' });
add({ model: 'fur/kitchenCoffeeMachine', zone: 'cafe', pos: [39.2, 1.0, -27], rot: -90, scale: F, collider: 'dynamic', mass: 3 });
add({ model: 'fur/toaster', zone: 'cafe', pos: [39.2, 1.0, -25.2], rot: -90, scale: F, collider: 'dynamic', mass: 2 });
add({ model: 'arc/cash-register', zone: 'cafe', pos: [39.2, 1.0, -28.5], rot: -90, scale: 1.4, collider: 'box' });
add({ model: 'fur/loungeSofaLong', zone: 'cafe', pos: [16.5, 0, -8], rot: 90, scale: F, collider: 'box' });
add({ model: 'fur/loungeSofa', zone: 'cafe', pos: [16.5, 0, -26], rot: 90, scale: F, collider: 'box' });
add({ model: 'fur/tableCoffee', zone: 'cafe', pos: [19, 0, -8], rot: 90, scale: F, collider: 'dynamic', mass: 8 });
for (const [x, z, m] of [[16.8, -9, 'fur/pillow'], [16.8, -7, 'fur/pillowBlue'], [17, -25.5, 'fur/pillowLong'], [19, -26, 'fur/pillow']])
  add({ model: m, zone: 'cafe', pos: [x, 1.1, z], rot: 90, scale: F, collider: 'dynamic', mass: 1 });
for (const [x, z] of [[18.5, -14], [25, -28]]) add({ model: 'fur/bear', zone: 'cafe', pos: [x, 0, z], scale: F, collider: 'dynamic', mass: 2 });
for (const [x, z] of [[15.2, -5], [15.2, -29.5], [37, -6]]) add({ model: 'fur/pottedPlant', zone: 'cafe', pos: [x, 0, z], scale: F, collider: 'box' });
for (const [x, z] of [[15.3, -12.5], [15.3, -20]]) add({ model: 'fur/lampRoundFloor', zone: 'cafe', pos: [x, 0, z], scale: F, collider: 'trunk' });
add({ model: 'fur/bookcaseOpen', zone: 'cafe', pos: [26, 0, -29.9], scale: F, collider: 'box' });
add({ model: 'arc/vending-machine', zone: 'cafe', pos: [39, 0, -9], rot: -90, scale: A, collider: 'box', behaviour: { type: 'machine', kind: 'vending' } });
add({ model: 'fur/stoolBar', zone: 'cafe', pos: [37.4, 0, -26.5], scale: F, collider: 'dynamic', mass: 3 });
add({ model: 'fur/stoolBar', zone: 'cafe', pos: [37.4, 0, -24.8], scale: F, collider: 'dynamic', mass: 3 });
add({ model: 'fur/cardboardBoxClosed', zone: 'cafe', pos: [34, 0, -29.6], scale: F, collider: 'dynamic', mass: 2 });

// ------------------------------------------------------------------ garden: city park starter scene (rotated so the fenced playground faces the gate)
add({
  id: 'park', model: 'scn/park', zone: 'garden', pos: [5, 0, 62], rot: 180, collider: 'children',
  children: [
    { match: 'lawn-tile|path-tile|safety-surface-tile|shrub-clump', collider: 'none' },
    { match: 'duck-pond-edge', collider: 'none', behaviour: { type: 'water' } },
    { match: 'playground-sign|notice-board', collider: 'exclude' },
    { match: 'playground-fence-gate', collider: 'none', behaviour: { type: 'door', hinge: 'minX' } },
    { match: 'park-gate-with-piers', collider: 'none', behaviour: { type: 'door', hinge: 'minZ', posts: [] } },
    { match: 'swing-set', collider: 'none', behaviour: { type: 'swing', seats: ['seat-left', 'seat-right'] } },
    { match: 'play-tower-with-roof', collider: 'none', behaviour: { type: 'climb', solid: [-9.53, 0.05, -7.13, -7.67, 1.96, -5.27], inset: 0 } },
    { match: 'climbing-frame|rope-net-climber', collider: 'none', behaviour: { type: 'climb' } },
    { match: 'monkey-bars', collider: 'none', behaviour: { type: 'hang' } },
    { match: 'sandpit', collider: 'none', behaviour: { type: 'sandbox' } },
    { match: 'playground-slide', collider: 'none', behaviour: { type: 'slide', width: 0.6,
      path: [[-11, 1.62, -3.2], [-11, 1.4, -3.9], [-11, 0.9, -4.8], [-11, 0.45, -5.7], [-11, 0.25, -6.5], [-11, 0.15, -6.9]],
      entry: [-11, 0.05, -1.3], deck: [-11.5, 0.05, -3.5, -10.5, 1.55, -2.5] } },
    { match: 'roundabout', collider: 'none', behaviour: { type: 'roundabout', part: 'deck', deckY: 0.46, radius: 1.45 } },
    { match: 'seesaw', collider: 'none', behaviour: { type: 'seesaw', part: 'beam' } },
    { match: 'spring-rocker', collider: 'none', behaviour: { type: 'springRider', part: 'rocker', seatAt: 0.5 } },
    { match: 'park-tree', collider: 'none', behaviour: { type: 'tree', radius: 0.25 } },
    { match: 'lamp-post|bollard', collider: 'trunk' },
    { match: 'park-bandstand', collider: 'none', behaviour: { type: 'solid',
      solids: [[-15.5, 0, 1.3, -10.5, 0.46, 7.85]],
      posts: [[-15.5, 0, 1.35, -15.1, 3.2, 1.75], [-10.9, 0, 1.35, -10.5, 3.2, 1.75], [-15.5, 0, 6.65, -15.1, 3.2, 7.05], [-10.9, 0, 6.65, -10.5, 3.2, 7.05]] } },
    { match: 'pergola', collider: 'none', behaviour: { type: 'solid',
      posts: [[-19.1, 0, -11.2, -18.8, 3, -10.9], [-15.7, 0, -11.2, -15.4, 3, -10.9], [-19.1, 0, -8.8, -18.8, 3, -8.5], [-15.7, 0, -8.8, -15.4, 3, -8.5]] } },
    { match: 'drinking-fountain', collider: 'box', behaviour: { type: 'water', tap: true } },
    { match: 'litter-bin|dog-waste-bin', collider: 'dynamic', behaviour: { mass: 8 } }
  ]
});
add({ id: 'pond', shape: 'pond', zone: 'garden', pos: [1, 0, 66], size: [4, 0.2, 4], color: '#48CAE4', collider: 'none', behaviour: { type: 'water', circle: true } });

// Garden extras (Tiny Treats).
add({ id: 'sandbox', model: 'tt/sandbox_square_decorated', zone: 'garden', pos: [-22, 0, 49], collider: 'none', behaviour: { type: 'sandbox' } });
for (const [x, z, m] of [[-21, 48.5, 'tt/bucket_A'], [-23, 50, 'tt/shovel_A'], [-22.5, 48, 'tt/sandcastle_B']])
  add({ model: m, zone: 'garden', pos: [x, m.includes('shovel') ? 0.8 : 0, z], scale: 0.6, collider: 'dynamic', mass: 1.5 });
add({ model: 'tt/cart', zone: 'garden', pos: [-6, 0, 46], rot: 40, collider: 'dynamic', mass: 12 });
for (const [x, z] of [[-14, 78], [-6, 82]]) add({ model: 'tt/picnic_table', zone: 'garden', pos: [x, 0, z], collider: 'box' });
const trees = [[-38, 36, 'L'], [-39, 50, 'S'], [-38, 72, 'L'], [-40, 86, 'S'], [-26, 87, 'L'], [-2, 88, 'S'], [14, 87, 'L'], [30, 88, 'S'],
  [39, 76, 'L'], [39, 62, 'S'], [37, 45, 'L'], [26, 39, 'S'], [-30, 56, 'S'], [-14, 56, 'L'], [-33, 78, 'S'], [34, 70, 'S'], [-16, 36, 'S'], [18, 36, 'L']];
for (const [x, z, s] of trees) add({ model: s === 'L' ? 'tt/tree_large' : 'tt/tree_small', zone: 'garden', pos: [x, 0, z], rot: (x * 37) % 360, collider: 'none', behaviour: { type: 'tree', radius: s === 'L' ? 0.3 : 0.22, trunk: [-0.3, 0, -0.3, 0.3, 1.6, 0.3] } });
for (const [x, z, r] of [[33, 84, 0], [37, 80, 90], [28, 78, 0]]) add({ model: 'tt/fence_straight_long', zone: 'garden', pos: [x, 0, z], rot: r, collider: 'box' });
for (const [x, z] of [[-37, 67], [-36, 69.5], [-37.5, 72]]) add({ model: 'tt/stepping_stumps_B_large', zone: 'garden', pos: [x, 0, z], collider: 'box' });
add({ model: 'tt/spring_horse_B', zone: 'garden', pos: [-4, 0, 74], rot: 180, scale: 0.55, collider: 'joint', behaviour: { type: 'springRider', part: 'seat', seatAt: 0.5 } });
add({ model: 'tt/seesaw_small', zone: 'garden', pos: [-30, 0, 44], rot: 90, collider: 'joint', behaviour: { type: 'seesaw', part: 'seat' } });
add({ id: 'paint-arena', shape: 'paintFloor', zone: 'garden', pos: [-22, 0, 64], size: [12, 0.05, 12], collider: 'none', behaviour: { type: 'area', cells: 10 } });
add({ id: 'race-start', shape: 'ring', zone: 'garden', pos: [-10, 0, 40], size: [4, 0.05, 4], color: '#FFFFFF', collider: 'none', behaviour: { type: 'area' } });
add({ id: 'hide-spot', shape: 'ring', zone: 'garden', pos: [31, 0, 80], size: [4, 0.05, 4], color: '#6A4C93', collider: 'none', behaviour: { type: 'area' } });
add({ id: 'garden-ball', shape: 'ball', zone: 'garden', pos: [4, 0, 44], size: [0.6, 0.6, 0.6], color: '#FF924C', collider: 'dynamic', mass: 0.8, behaviour: { tag: 'ball', restitution: 0.75 } });

// ------------------------------------------------------------------ stars, games, guide
const stars = [[-33, 3.5, 20.3], [-20, 0.7, 10], [-24.7, 2.9, -16.2], [38, 0.9, -30.5], [18, 1.3, 57.8], [10.4, 2.6, 68.4],
  [-39.5, 0.9, 88.5], [-7.5, 0.9, 22], [-29, 3.4, -21], [36.5, 0.9, 30.5], [1, 0.7, 66], [13.6, 2.5, 68.2]];
const games = [
  { id: 'race', zone: 'garden', spot: [-10, 40], radius: 2, checkpoints: [[-30, 42], [-37, 63], [-30, 84], [-10, 86], [-9, 62]], area: 'race-start' },
  { id: 'rescue', zone: 'adventure', spot: [-26, 3], radius: 1.9, area: 'rescue-basket' },
  { id: 'colorFloor', zone: 'arcade', spot: [22, 8], radius: 4.5, area: 'color-floor' },
  { id: 'hideSeek', zone: 'garden', spot: [31, 80], radius: 2, area: 'hide-spot' },
  { id: 'giantBall', zone: 'plaza', spot: [0, -20], radius: 2.8, ball: 'giant-ball', goals: ['goal-w', 'goal-e'] },
  { id: 'paint', zone: 'garden', spot: [-22, 64], radius: 6, area: 'paint-arena' }
];
const guide = [[-2, -15], [-5.5, -15.8], [-9, -16.8], [-12.5, -17.8], [-15.5, -18.8], [-17.6, -19.3]];

const layout = {
  version: 3,
  spawn: [0, 0, -14],
  spawnYaw: 0,
  bounds: { min: [-42, -32], max: [42, 90] },
  gate: { x: [-7, 7], z: 32.5 },
  walls, zones, placements: P, stars, games, guide,
  alwaysLoad: ['chr/character-male-b', 'chr/character-female-d', 'chr/character-male-f', 'chr/character-female-c', 'chr/character-female-b', 'chr/aid-glasses', 'chr/aid-sunglasses']
};
await writeFile(new URL('../world/layout.json', import.meta.url), JSON.stringify(layout, null, 1) + '\n');
console.log(`world/layout.json: ${P.length} placements`);
