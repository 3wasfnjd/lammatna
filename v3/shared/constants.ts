// Numbers shared by the client, the room server and the tests.

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
export const NET_HZ = 20;                 // snapshots per second
export const STEPS_PER_SNAPSHOT = SIM_HZ / NET_HZ;
export const MAX_PLAYERS = 5;
export const INTERP_DELAY_MS = 110;       // remote players / bodies are shown this far in the past

// One body for everyone: visual height never changes speed, jump or reach.
export const MOVE = Object.freeze({
  speed: 5.2,
  accel: 30,
  airAccel: 10,
  jumpVelocity: 7.4,
  gravity: 20,
  radius: 0.32,
  halfHeight: 0.38,      // capsule cylinder half height → total 1.40 m
  stepHeight: 0.45,
  maxSlope: 50 * Math.PI / 180,
  snap: 0.35,
  reach: 1.7,            // interact distance
  climbSpeed: 2.2,
  hangSpeed: 1.8,
  bounceVelocity: 11.5,  // trampoline: fixed push back up (apex ≈ 3.3 m)
  sandSpeed: 0.55,
  pitSpeed: 0.6
});
export const BODY_HEIGHT = 2 * (MOVE.halfHeight + MOVE.radius);

export const CHARACTER_IDS = ['abboudi', 'mami', 'nasser', 'joud', 'najd'] as const;
export type CharacterId = typeof CHARACTER_IDS[number];

export const CHARACTERS: Record<CharacterId, { name: string; model: string; height: number; color: string }> = {
  abboudi: { name: 'عبودي', model: 'chr/character-male-b', height: 1.78, color: '#2BB5B0' },
  mami: { name: 'مامي', model: 'chr/character-female-d', height: 1.64, color: '#F2735F' },
  nasser: { name: 'ناصر', model: 'chr/character-male-f', height: 1.34, color: '#F5B82E' },
  joud: { name: 'جود', model: 'chr/character-female-c', height: 1.24, color: '#9C6BD1' },
  najd: { name: 'نجد', model: 'chr/character-female-b', height: 1.0, color: '#FF8FB8' }
};

export const OUTFIT_COLORS = ['#26B3AE', '#F2735F', '#F7BE2F', '#9C6BD1', '#FF8FB8', '#3E7BE0', '#5BBF5A', '#FFFFFF'];
export const ACCESSORIES = ['none', 'glasses', 'sunglasses', 'cap', 'bow', 'crown'] as const;
export type Accessory = typeof ACCESSORIES[number];
export const EMOJIS = ['😄', '👋', '❤️', '👏', '😮', '🎉'];

// Input buttons (bit flags).
export const BTN = { jump: 1, interact: 2 } as const;

// Collision groups: membership in the high 16 bits, filter in the low 16.
export const G = { STATIC: 1, PLAYER: 2, DYNAMIC: 4, TOY: 8, PUCK: 16, SENSOR: 32, RIM: 64 } as const;
export const groups = (member: number, filter: number) => (member << 16) | filter;
