// Two interchangeable connections to a room: a WebSocket to the room server,
// or the same room logic running inside this page for solo play.
import { RoomManager } from '../../shared/RoomManager.js';

class Emitter {
  constructor() { this.handlers = new Set(); }
  onMessage(fn) { this.handlers.add(fn); }
  emit(msg) { for (const fn of this.handlers) fn(msg); }
}

export class LocalTransport extends Emitter {
  constructor() {
    super();
    this.kind = 'local';
    this.manager = new RoomManager().startTicking();
    this.conn = { send: msg => queueMicrotask(() => this.emit(structuredClone(msg))) };
  }
  connect() { return Promise.resolve(); }
  send(msg) { this.manager.message(this.conn, structuredClone(msg)); }
  close() { this.manager.stop(); }
}

export class SocketTransport extends Emitter {
  constructor(url) {
    super();
    this.kind = 'online';
    this.url = url;
    this.queue = [];
    this.onStatus = () => {};
    this.closedByUser = false;
    this.retry = 0;
  }

  connect(timeout = 6000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(this.url);
      this.socket = socket;
      const timer = setTimeout(() => { if (!settled) { settled = true; socket.close(); reject(new Error('timeout')); } }, timeout);
      socket.onopen = () => {
        clearTimeout(timer);
        this.retry = 0;
        this.onStatus('open');
        for (const msg of this.queue.splice(0)) socket.send(JSON.stringify(msg));
        if (!settled) { settled = true; resolve(); }
      };
      socket.onmessage = e => { try { this.emit(JSON.parse(e.data)); } catch { /* ignore */ } };
      socket.onerror = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('socket')); } };
      socket.onclose = () => {
        if (this.closedByUser) return;
        this.onStatus('lost');
        if (settled) this.reconnectLater();
      };
    });
  }

  reconnectLater() {
    const delay = Math.min(8000, 600 * 2 ** this.retry++);
    setTimeout(() => this.connect().then(() => this.onStatus('reconnected')).catch(() => this.reconnectLater()), delay);
  }

  send(msg) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(msg));
    else if (msg.type !== 'state') this.queue.push(msg);
  }

  close() { this.closedByUser = true; this.socket?.close(); }
}

// Where the room server lives: ?server=… wins, then a saved choice, then the page's own host.
export function resolveServerUrl() {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get('server');
  if (fromQuery) {
    try { localStorage.setItem('lammatna.server', fromQuery); } catch { /* storage blocked */ }
    return normalise(fromQuery);
  }
  let saved = null;
  try { saved = localStorage.getItem('lammatna.server'); } catch { /* storage blocked */ }
  if (saved) return normalise(saved);
  // Served by the Worker or the Node server itself: use the same origin.
  if (location.hostname.endsWith('workers.dev') || location.hostname === 'localhost' || location.hostname === '127.0.0.1') return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const configured = globalThis.LAMMATNA_SERVER;
  if (configured) return normalise(configured);
  if (location.hostname.endsWith('github.io') || location.protocol === 'file:') return null;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

function normalise(url) {
  let u = url.trim();
  if (!/^wss?:\/\//.test(u)) u = u.replace(/^http/, 'ws');
  if (!/^wss?:\/\//.test(u)) u = `wss://${u}`;
  if (!/\/ws\/?$/.test(u)) u = u.replace(/\/?$/, '/ws');
  return u;
}
