// Cloudflare Worker: serves the game and runs each private room in its own
// Durable Object. WebSocket: /ws?create=1 (new room) or /ws?code=1234 (join).
import { DurableObject } from 'cloudflare:workers';
import { RoomHost } from './RoomHost.js';
import { makeRoomCode, TICK_MS } from '../shared/protocol.js';

const ALLOWED = ['https://3wasfnjd.github.io'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ game: 'lammatna', status: 'ready' }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/ws') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin && !ALLOWED.includes(origin)) return new Response('Origin denied', { status: 403 });
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
      if (url.searchParams.get('create')) {
        // Pick a free 4-digit code; a busy room answers 409 and we try another.
        for (let attempt = 0; attempt < 8; attempt++) {
          const code = makeRoomCode();
          const target = new URL(url); target.searchParams.set('code', code);
          const response = await env.LAMMATNA_ROOMS.getByName(code).fetch(new Request(target, request));
          if (response.status !== 409) return response;
        }
        return new Response('No free room code', { status: 503 });
      }
      const code = (url.searchParams.get('code') || '').replace(/\D/g, '').slice(0, 4);
      if (code.length !== 4) return new Response('Room code required', { status: 400 });
      return env.LAMMATNA_ROOMS.getByName(code).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

export class LammatnaRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.host = new RoomHost();
    this.timer = null;
    // After an eviction the in-memory room is gone: let old sockets reconnect.
    for (const ws of ctx.getWebSockets()) { try { ws.close(4003, 'restart'); } catch { /* ignore */ } }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    if (this.host.accept(code, !!url.searchParams.get('create')) === 'busy') return new Response('busy', { status: 409 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    this.host.open(server);
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  tick() {
    this.host.tick();
    if (!this.host.sockets && this.timer) {
      // Keep ticking through the reconnect grace period, then rest.
      this.idleTicks = (this.idleTicks || 0) + 1;
      if (this.idleTicks > 400) { clearInterval(this.timer); this.timer = null; this.idleTicks = 0; }
    } else this.idleTicks = 0;
  }

  async webSocketMessage(ws, raw) { this.host.message(ws, typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); }
  async webSocketClose(ws) { this.host.close(ws); }
  async webSocketError(ws) { this.host.close(ws); }
}
