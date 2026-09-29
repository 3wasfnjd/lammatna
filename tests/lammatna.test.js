import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, PHASE_MS, rescueTarget, rescueStars } from '../shared/Room.js';
import { RoomManager } from '../shared/RoomManager.js';
import { createBody, stepBody, raycastSolids } from '../shared/physics.js';
import { CHARACTERS, CHARACTER_IDS, MOVEMENT, characterModel } from '../shared/characters.js';
import { SWINGS, SLIDE, BASKETS, RACE, DECK_Y, STAIRS, BALL_PIT, slidePoint } from '../shared/playground.js';
import { RECONNECT_GRACE_MS } from '../shared/protocol.js';

function makeRoom() {
  let t = 1000;
  const inbox = new Map();
  const room = new Room('1234', { now: () => t, random: mulberry(1), send: (id, msg) => { if (!inbox.has(id)) inbox.set(id, []); inbox.get(id).push(msg); } });
  return { room, inbox, advance: ms => { t += ms; room.tick(); }, now: () => t };
}
function mulberry(seed) { return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }
function joinAs(room, character) {
  const r = room.join();
  room.handle(r.playerId, { type: 'pick', character });
  return room.players.get(r.playerId);
}
const at = (room, p, x, y, z) => room.handle(p.id, { type: 'state', p: [x, y, z], r: 0, a: 0 });

test('five unique characters, a sixth player is refused', () => {
  const { room } = makeRoom();
  const players = CHARACTER_IDS.map(id => joinAs(room, id));
  assert.deepEqual(players.map(p => p.character), CHARACTER_IDS);
  assert.equal(room.join().ok, false);
  assert.equal(room.world().free.length, 0);
});

test('a taken character cannot be picked twice', () => {
  const { room, inbox } = makeRoom();
  joinAs(room, 'najd');
  const r = room.join();
  room.handle(r.playerId, { type: 'pick', character: 'najd' });
  assert.equal(room.players.get(r.playerId).character, null);
  assert.ok(inbox.get(r.playerId).some(m => m.type === 'error' && m.code === 'taken'));
});

test('every character shares one movement profile regardless of visual height', () => {
  const heights = CHARACTER_IDS.map(id => CHARACTERS[id].look.height);
  assert.ok(Math.max(...heights) - Math.min(...heights) > 0.5);
  // Gameplay code has one MOVEMENT profile; characters carry no speed/jump overrides.
  for (const id of CHARACTER_IDS) assert.equal(Object.keys(CHARACTERS[id]).filter(k => /speed|jump|reach|radius/i.test(k)).length, 0);
  assert.equal(characterModel('papa').type, 'placeholder');
});

test('swing seats are exclusive and freed when a player disconnects', () => {
  const { room } = makeRoom();
  const a = joinAs(room, 'papa'), b = joinAs(room, 'joud');
  const s = SWINGS[0];
  at(room, a, s.x, 0, s.z); at(room, b, s.x, 0, s.z + 0.5);
  room.handle(a.id, { type: 'occupy', id: s.id });
  room.handle(b.id, { type: 'occupy', id: s.id });
  assert.equal(room.equipment[s.id].occupant, a.id);
  room.disconnect(a.id);
  assert.equal(room.equipment[s.id], null);
  room.handle(b.id, { type: 'occupy', id: s.id });
  assert.equal(room.equipment[s.id].occupant, b.id);
});

test('the slide frees itself after the ride', () => {
  const { room, advance } = makeRoom();
  const a = joinAs(room, 'nasser');
  at(room, a, SLIDE.entrance.x, DECK_Y, SLIDE.entrance.z);
  room.handle(a.id, { type: 'occupy', id: SLIDE.id });
  assert.equal(room.equipment[SLIDE.id].occupant, a.id);
  advance(SLIDE.duration * 1000 + 800);
  assert.equal(room.equipment[SLIDE.id], null);
  assert.equal(a.equipment, null);
});

test('reconnecting with the token keeps the same player and character', () => {
  const { room, advance } = makeRoom();
  const a = joinAs(room, 'mama');
  const token = a.token;
  room.disconnect(a.id);
  advance(5000);
  const again = room.join(token);
  assert.equal(again.playerId, a.id);
  assert.equal(room.players.size, 1);
  assert.equal(room.players.get(a.id).character, 'mama');
});

test('an abandoned slot is released after the grace period', () => {
  const { room, advance } = makeRoom();
  const a = joinAs(room, 'mama'); joinAs(room, 'papa');
  room.disconnect(a.id);
  advance(RECONNECT_GRACE_MS + 200);
  assert.equal(room.players.has(a.id), false);
  assert.ok(room.world().free.includes('mama'));
});

test('ball rescue: carry one ball, pass, deliver to the matching basket, win with stars', () => {
  const { room, advance } = makeRoom();
  const a = joinAs(room, 'papa'), b = joinAs(room, 'najd');
  room.handle(a.id, { type: 'start', activity: 'rescue' });
  assert.equal(room.activity.phase, 'intro');
  advance(PHASE_MS.intro + 10); advance(PHASE_MS.countdown + 10);
  assert.equal(room.activity.phase, 'play');
  const target = room.activity.data.target;
  assert.equal(target, rescueTarget(2));
  // Picking a second ball while carrying is refused.
  const [first, second] = room.balls;
  at(room, a, first.x, 0, first.z);
  room.handle(a.id, { type: 'ball', op: 'pickup', id: first.id });
  assert.equal(a.carrying, first.id);
  at(room, a, second.x, 0, second.z);
  room.handle(a.id, { type: 'ball', op: 'pickup', id: second.id });
  assert.equal(second.holder, null);
  // Pass to Najd, who delivers.
  at(room, b, a.x + 1, 0, a.z);
  room.handle(a.id, { type: 'ball', op: 'pass', to: b.id });
  assert.equal(b.carrying, first.id);
  assert.equal(a.carrying, null);
  const wrong = BASKETS.find(k => k.id !== first.color), right = BASKETS.find(k => k.id === first.color);
  at(room, b, wrong.x, 0, wrong.z);
  room.handle(b.id, { type: 'ball', op: 'deliver', basket: wrong.id });
  assert.equal(room.activity.data.delivered, 0);
  at(room, b, right.x, 0, right.z);
  room.handle(b.id, { type: 'ball', op: 'deliver', basket: right.id });
  assert.equal(room.activity.data.delivered, 1);
  // Deliver the rest quickly.
  for (const ball of room.balls.filter(x => !x.done)) {
    if (room.activity.phase !== 'play') break;
    at(room, a, ball.x, 0, ball.z);
    room.handle(a.id, { type: 'ball', op: 'pickup', id: ball.id });
    const k = BASKETS.find(x => x.id === ball.color);
    at(room, a, k.x, 0, k.z);
    room.handle(a.id, { type: 'ball', op: 'deliver', basket: k.id });
  }
  assert.equal(room.activity.phase, 'results');
  assert.equal(room.activity.data.results.success, true);
  assert.equal(room.activity.data.results.stars, 3);
  const badges = room.activity.data.results.badges;
  assert.ok(badges.some(x => x.id === a.id && x.badge === 'collector'));
  assert.ok(badges.some(x => x.id === a.id && x.badge === 'helper'));
});

test('rescue target scales with the family and stars reward finishing early', () => {
  assert.ok(rescueTarget(1) < rescueTarget(5));
  assert.equal(rescueStars(false, 90), 0);
  assert.equal(rescueStars(true, 5), 1);
  assert.equal(rescueStars(true, 60), 3);
});

test('race: checkpoints in order, ranking by finish order, far reports rejected', () => {
  const { room, advance } = makeRoom();
  const a = joinAs(room, 'joud'), b = joinAs(room, 'papa');
  room.handle(b.id, { type: 'start', activity: 'race' });
  advance(PHASE_MS.intro + 10); advance(PHASE_MS.countdown + 10);
  const run = p => RACE.checkpoints.forEach((cp, i) => { at(room, p, cp.x, cp.y || 0, cp.z); room.handle(p.id, { type: 'race', op: 'cp', i }); });
  at(room, a, 0, 0, 0);
  room.handle(a.id, { type: 'race', op: 'cp', i: 0 });
  assert.equal(room.activity.data.progress[a.id], 0, 'far checkpoint report ignored');
  run(a);
  at(room, a, BALL_PIT.minX + 2, 0, BALL_PIT.minZ + 2);
  advance(4000);
  room.handle(a.id, { type: 'race', op: 'finish' });
  run(b);
  at(room, b, BALL_PIT.minX + 3, 0, BALL_PIT.minZ + 3);
  room.handle(b.id, { type: 'race', op: 'finish' });
  assert.equal(room.activity.phase, 'results');
  const ranking = room.activity.data.results.ranking;
  assert.deepEqual(ranking.map(r => r.id), [a.id, b.id]);
  assert.ok(room.activity.data.results.badges.some(x => x.id === a.id && x.badge === 'fastest'));
});

test('family round runs race, rescue, then a celebration with badges, and returns to free play', () => {
  const { room, advance } = makeRoom();
  const a = joinAs(room, 'papa'), b = joinAs(room, 'nasser');
  room.handle(b.id, { type: 'start', activity: 'family' });
  assert.equal(room.activity, null, 'only the host starts a family round');
  room.handle(a.id, { type: 'start', activity: 'family' });
  assert.equal(room.activity.type, 'race');
  let guard = 0;
  while (room.activity && room.activity.type !== 'celebrate' && guard++ < 20) advance(room.activity.phaseEnd - 0 + 1);
  assert.equal(room.activity.type, 'celebrate');
  assert.ok(room.activity.teleport[a.id]);
  advance(PHASE_MS.celebrate + 10);
  assert.equal(room.activity, null);
  assert.equal(room.mode, 'free');
});

test('room manager: codes, joining, invalid rooms', () => {
  const manager = new RoomManager({ random: mulberry(3) });
  const out = [];
  const conn = { send: m => out.push(m) };
  manager.message(conn, { type: 'join', create: true });
  const welcome = out.find(m => m.type === 'welcome');
  assert.match(welcome.code, /^\d{4}$/);
  const out2 = [];
  manager.message({ send: m => out2.push(m) }, { type: 'join', code: '0000' });
  assert.equal(out2[0].code, 'no-room');
  const out3 = [];
  const conn3 = { send: m => out3.push(m) };
  manager.message(conn3, { type: 'join', code: welcome.code });
  assert.equal(out3.find(m => m.type === 'welcome').code, welcome.code);
  manager.closed(conn3);
  assert.equal(manager.rooms.get(welcome.code).players.get(conn3.playerId).connected, false);
});

test('physics: walls stop the player, stairs lead up to the deck, jumping clears a low barrier', () => {
  const body = createBody(0, 0, 17);
  for (let i = 0; i < 120; i++) stepBody(body, { x: 0, z: 1 }, 1 / 60);
  assert.ok(body.z <= 18 - MOVEMENT.radius + 0.01);
  const climber = createBody(STAIRS.minX - 1, 0, (STAIRS.minZ + STAIRS.maxZ) / 2);
  for (let i = 0; i < 200; i++) stepBody(climber, { x: 1, z: 0 }, 1 / 60);
  assert.ok(Math.abs(climber.y - DECK_Y) < 0.05, `reached deck height, got ${climber.y}`);
  const jumper = createBody(-11, 0, -9);
  let jumped = false;
  for (let i = 0; i < 90; i++) {
    stepBody(jumper, { x: -1, z: 0 }, 1 / 60 );
    if (!jumped && jumper.x < -11.3) { stepBody(jumper, { x: -1, z: 0, jump: true }, 1 / 60); jumped = true; }
  }
  assert.ok(jumper.x < -13, `cleared the barrier, x=${jumper.x}`);
});

test('camera ray hits the hall walls', () => {
  assert.ok(raycastSolids(0, 1.5, 0, 0, 0, 1, 50) < 18.5);
  assert.equal(raycastSolids(0, 1.5, 0, 0, 0, 1, 5), 5);
});

test('slide path starts on the deck and ends in the ball pit', () => {
  const s = slidePoint(0), e = slidePoint(1);
  assert.ok(s.y > DECK_Y - 0.1);
  assert.ok(e.x > BALL_PIT.minX && e.x < BALL_PIT.maxX && e.z > BALL_PIT.minZ && e.z < BALL_PIT.maxZ);
});

test('GLB inspection tool reads size, clips and suggests a mapping', async () => {
  const { sampleGlb } = await import('../tools/make-sample-glb.mjs');
  const { parseGlb, summarise, suggestMapping } = await import('../tools/inspect-glb.mjs');
  const info = summarise(parseGlb(sampleGlb()));
  assert.equal(Math.round(info.size[1]), 170);
  assert.deepEqual(info.animations, ['Idle', 'Walk']);
  assert.deepEqual(suggestMapping(['Armature|Idle_Loop', 'Run_Fast', 'Wave_Hello', 'Victory']), { idle: 'Armature|Idle_Loop', run: 'Run_Fast', wave: 'Wave_Hello', celebrate: 'Victory' });
});
