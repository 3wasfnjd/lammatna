// One room behind one address, for hosts that route each room code to its
// own instance (Cloudflare Durable Objects). Wraps the shared RoomManager so
// the rules are identical to the Node server and the in-page solo room.
import { RoomManager } from '../shared/RoomManager.js';
import { S2C } from '../shared/protocol.js';

export class RoomHost {
  constructor(options = {}) {
    this.manager = new RoomManager(options);
    this.conns = new Map(); // socket -> connection
    this.code = null;
  }

  // Called before accepting a socket. A "create" may only claim an empty code.
  accept(code, create) {
    this.code = code;
    const room = this.manager.rooms.get(code);
    const inUse = room && [...room.players.values()].some(p => p.connected || p.awayUntil > this.manager.now());
    if (create) {
      if (inUse) return 'busy';
      this.manager.rooms.delete(code);
      this.manager.createRoom(code);
    }
    return 'ok';
  }

  open(socket) {
    const conn = { send: msg => { try { socket.send(JSON.stringify(msg)); } catch { /* socket gone */ } }, close: () => { try { socket.close(4002, 'replaced'); } catch { /* already closed */ } } };
    this.conns.set(socket, conn);
    return conn;
  }

  message(socket, raw) {
    const conn = this.conns.get(socket);
    if (!conn || typeof raw !== 'string' || raw.length > 16384) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg?.type === 'join') {
      // The room code comes from the address, never from a "create" inside the message.
      if (!this.manager.rooms.has(this.code)) return conn.send({ type: S2C.ERROR, code: 'no-room' });
      msg = { type: 'join', code: this.code, token: msg.token };
    }
    this.manager.message(conn, msg);
  }

  close(socket) {
    const conn = this.conns.get(socket);
    this.conns.delete(socket);
    if (conn) this.manager.closed(conn);
  }

  tick() { this.manager.tick(); }
  get sockets() { return this.conns.size; }
}
