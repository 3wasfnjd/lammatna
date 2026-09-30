// Glue between sockets and a Room, shared by the Durable Object and the Node dev server.
import { Room } from '../shared/room';
import { decode, type ClientMsg, type ServerMsg } from '../shared/protocol';

export interface Sock { send(s: string): void; close(code?: number, reason?: string): void }

export class RoomHost {
  room: Room;
  socks = new Map<string, Sock>();       // player id → socket
  ids = new Map<Sock, string>();
  lastSeen = new Map<string, number>();
  constructor(code: string) {
    this.room = new Room(code, (id, m) => this.sendTo(id, m));
  }
  sendTo(id: string, m: ServerMsg) {
    const s = this.socks.get(id);
    if (s) try { s.send(JSON.stringify(m)); } catch { /* closed */ }
  }
  get connected() { return this.socks.size; }
  // Returns the player id once the socket said hello (or null).
  message(sock: Sock, raw: string, idHint?: string): string | null {
    const m = decode<ClientMsg>(raw);
    if (!m) return null;
    let id = this.ids.get(sock) || idHint;
    if (id && !this.room.players.has(id)) id = undefined;
    if (!id) {
      if (m.t !== 'hello') return null;
      const r = this.room.join(m);
      if (!r.ok) { sock.send(JSON.stringify({ t: 'err', code: r.code } satisfies ServerMsg)); sock.close(4001, r.code); return null; }
      id = r.id;
      this.ids.set(sock, id); this.socks.set(id, sock);
      this.room.welcome(id);
    } else if (!this.ids.has(sock)) { this.ids.set(sock, id); this.socks.set(id, sock); }
    this.lastSeen.set(id, Date.now());
    if (m.t !== 'hello') this.room.message(id, m);
    return id;
  }
  close(sock: Sock) {
    const id = this.ids.get(sock);
    this.ids.delete(sock);
    if (!id) return;
    if (this.socks.get(id) === sock) this.socks.delete(id);
    this.room.disconnect(id);
  }
  // Players whose socket has been gone for a while leave the room.
  sweep(graceMs = 20000) {
    const now = Date.now();
    for (const [id, p] of this.room.players) if (!p.connected && now - (this.lastSeen.get(id) || 0) > graceMs) this.room.leave(id);
  }
}
