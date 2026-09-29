// Message names shared by the client, the Node server and the in-browser room.
export const MAX_PLAYERS = 5;
export const TICK_MS = 100;          // room logic and transform snapshots, 10 Hz
export const STATE_SEND_MS = 80;     // clients send their own transform, ~12 Hz
export const RECONNECT_GRACE_MS = 30000;
export const ROOM_CODE_DIGITS = 4;

export const C2S = {
  JOIN: 'join', PICK: 'pick', STATE: 'state', OCCUPY: 'occupy', RELEASE: 'release', BALL: 'ball',
  EMOTE: 'emote', START: 'start', RACE: 'race', SETTINGS: 'settings', PING: 'ping'
};
export const S2C = {
  WELCOME: 'welcome', WORLD: 'world', SNAP: 'snap', EVENT: 'event', ERROR: 'error', PONG: 'pong'
};

export function makeRoomCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < ROOM_CODE_DIGITS; i++) code += Math.floor(random() * 10);
  return code[0] === '0' ? '1' + code.slice(1) : code;
}

export function makeToken(random = Math.random) {
  let t = '';
  for (let i = 0; i < 20; i++) t += 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(random() * 32)];
  return t;
}
