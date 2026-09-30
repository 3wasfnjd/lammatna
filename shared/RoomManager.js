// Room registry and connection glue shared by the Node server and the
// in-browser transport. A connection is anything with `send(message)`.
import { Room } from './Room.js';
import { S2C, TICK_MS, makeRoomCode } from './protocol.js';

export class RoomManager {
  constructor({ now = () => Date.now(), random = Math.random } = {}) {
    this.now = now;
    this.random = random;
    this.rooms = new Map();
    this.links = new Map(); // `${code}:${playerId}` -> connection
  }

  createRoom(fixedCode) {
    let code = fixedCode;
    if (!code) do code = makeRoomCode(this.random); while (this.rooms.has(code));
    const room = new Room(code, {
      now: this.now, random: this.random,
      send: (playerId, msg) => this.links.get(`${code}:${playerId}`)?.send(msg)
    });
    this.rooms.set(code, room);
    return room;
  }

  // msg: { create: true } or { code, token }
  join(conn, msg) {
    let room;
    if (msg.create) room = this.createRoom();
    else room = this.rooms.get(String(msg.code || '').trim());
    if (!room) return conn.send({ type: S2C.ERROR, code: 'no-room' });
    const result = room.join(msg.token);
    if (!result.ok) return conn.send({ type: S2C.ERROR, code: result.error });
    const key = `${room.code}:${result.playerId}`;
    const old = this.links.get(key);
    if (old && old !== conn) old.close?.();
    this.links.set(key, conn);
    conn.room = room; conn.playerId = result.playerId;
    conn.send({ type: S2C.WELCOME, code: room.code, you: result.playerId, token: result.token, rejoined: !!result.rejoined, now: this.now() });
    room.dirty = true;
    room.flush();
  }

  message(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'join') return this.join(conn, msg);
    if (!conn.room) return;
    conn.room.handle(conn.playerId, msg);
  }

  closed(conn) {
    if (!conn.room) return;
    const key = `${conn.room.code}:${conn.playerId}`;
    if (this.links.get(key) === conn) {
      this.links.delete(key);
      conn.room.disconnect(conn.playerId);
    }
    conn.room = null;
  }

  tick() {
    for (const [code, room] of this.rooms) {
      room.tick();
      // Forget rooms nobody has been connected to for ten minutes.
      if (room.isEmpty) {
        room.emptySince ??= this.now();
        if (this.now() - room.emptySince > 600000) this.rooms.delete(code);
      } else room.emptySince = null;
    }
  }

  startTicking() {
    this.timer = setInterval(() => this.tick(), TICK_MS);
    return this;
  }

  stop() { clearInterval(this.timer); }
}
