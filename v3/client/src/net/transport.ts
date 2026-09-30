// Two ways to reach a room: a WebSocket to the Durable Object, or the same
// Room code running inside the page (solo play, no server).
import { Room } from '../../../shared/room';
import { initPhysics } from '../../../shared/rapier';
import type { ClientMsg, ServerMsg } from '../../../shared/protocol';
import { makeRoomCode } from '../../../shared/protocol';

export interface Transport {
  send(m: ClientMsg): void;
  onMessage: (m: ServerMsg) => void;
  onClose: (reason: string) => void;
  close(): void;
  readonly solo: boolean;
}

export class LocalTransport implements Transport {
  solo = true;
  onMessage: (m: ServerMsg) => void = () => { };
  onClose: (reason: string) => void = () => { };
  room!: Room;
  id = '';
  timer: ReturnType<typeof setInterval> | null = null;
  last = 0;
  static async create() {
    await initPhysics();
    const t = new LocalTransport();
    t.room = new Room(makeRoomCode(), (_id, m) => queueMicrotask(() => t.onMessage(m)), true);
    t.last = performance.now();
    t.timer = setInterval(() => { const now = performance.now(); t.room.update(now - t.last); t.last = now; }, 1000 / 60);
    return t;
  }
  send(m: ClientMsg) {
    if (m.t === 'hello') {
      const r = this.room.join(m);
      if (r.ok) { this.id = r.id; this.room.welcome(r.id); } else this.onMessage({ t: 'err', code: r.code });
      return;
    }
    if (this.id) this.room.message(this.id, m);
  }
  close() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

export class WsTransport implements Transport {
  solo = false;
  onMessage: (m: ServerMsg) => void = () => { };
  onClose: (reason: string) => void = () => { };
  ws: WebSocket;
  private queue: string[] = [];
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => { for (const q of this.queue) this.ws.send(q); this.queue = []; };
    this.ws.onmessage = e => { try { this.onMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
    this.ws.onclose = e => this.onClose(e.reason || String(e.code));
    this.ws.onerror = () => { /* onclose follows */ };
  }
  send(m: ClientMsg) {
    const s = JSON.stringify(m);
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(s); else if (this.ws.readyState === WebSocket.CONNECTING) this.queue.push(s);
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

// Room server address: ?server= (remembered) → window.LAMMATNA3_SERVER → same host in dev.
export function serverUrl(): string | null {
  const q = new URLSearchParams(location.search).get('server');
  if (q) { try { localStorage.setItem('lm3-server', q); } catch { /* private mode */ } }
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  let u = q || (() => { try { return localStorage.getItem('lm3-server'); } catch { return null; } })()
    || (local ? `ws://${location.hostname}:8788` : (window as any).LAMMATNA3_SERVER) || '';
  if (!u) return null;
  u = u.replace(/^http/, 'ws').replace(/\/$/, '');
  if (!/^wss?:\/\//.test(u)) u = 'wss://' + u;
  return u.endsWith('/ws') ? u : u + '/ws';
}
export async function serverAlive(url: string, ms = 3500): Promise<boolean> {
  const health = url.replace(/^ws/, 'http').replace(/\/ws$/, '/health');
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    const r = await fetch(health, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}
