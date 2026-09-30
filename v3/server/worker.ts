// Lammatna 3 rooms on Cloudflare: one Durable Object per 4-digit room code.
// WebSocket: /ws?create=1 (new room) or /ws?code=1234 (join). /health for the client.
import { DurableObject } from 'cloudflare:workers';
import { initPhysics } from '../shared/rapier';
import { RoomHost } from './host';
import { makeRoomCode } from '../shared/protocol';

interface Env { LAMMATNA3_ROOMS: DurableObjectNamespace<Lammatna3Room> }
const ALLOWED = ['https://3wasfnjd.github.io', 'http://localhost:5173', 'http://localhost:4173'];
const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ game: 'lammatna-v3', status: 'ready' }, { headers: cors });
    if (url.pathname !== '/ws') return new Response('Lammatna 3 room server', { headers: cors });
    const origin = request.headers.get('Origin');
    if (origin && !ALLOWED.includes(origin) && origin !== url.origin) return new Response('Origin denied', { status: 403 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    if (url.searchParams.get('create')) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = makeRoomCode();
        const target = new URL(url); target.searchParams.set('code', code);
        const res = await env.LAMMATNA3_ROOMS.getByName(code).fetch(new Request(target, request));
        if (res.status !== 409) return res;
      }
      return new Response('No free room code', { status: 503 });
    }
    const code = (url.searchParams.get('code') || '').replace(/\D/g, '').slice(0, 4);
    if (code.length !== 4) return new Response('Room code required', { status: 400 });
    return env.LAMMATNA3_ROOMS.getByName(code).fetch(request);
  }
};

export class Lammatna3Room extends DurableObject<Env> {
  host: RoomHost | null = null;
  timer: ReturnType<typeof setInterval> | null = null;
  last = 0;
  idle = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // An evicted room lost its world: ask old sockets to reconnect.
    for (const ws of ctx.getWebSockets()) { try { ws.close(4003, 'restart'); } catch { /* ignore */ } }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get('code') || '0000';
    const create = !!url.searchParams.get('create');
    await initPhysics();
    if (create) {
      if (this.host && this.host.room.count > 0) return new Response('busy', { status: 409 });
      this.host = new RoomHost(code);
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    if (!this.host) {
      server.send(JSON.stringify({ t: 'err', code: 'notfound' }));
      server.close(4004, 'notfound');
      return new Response(null, { status: 101, webSocket: client });
    }
    if (!this.timer) { this.last = Date.now(); this.timer = setInterval(() => this.tick(), 1000 / 30); }
    return new Response(null, { status: 101, webSocket: client });
  }

  tick() {
    if (!this.host) return;
    const now = Date.now();
    this.host.room.update(now - this.last);
    this.last = now;
    if (now % 1000 < 40) this.host.sweep();
    if (this.host.room.count === 0) {
      if (++this.idle > 30 * 60) { clearInterval(this.timer!); this.timer = null; this.host = null; this.idle = 0; }
    } else this.idle = 0;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (!this.host) { ws.close(4004, 'notfound'); return; }
    const hint = (ws.deserializeAttachment() as { id?: string } | null)?.id;
    const id = this.host.message(ws, typeof raw === 'string' ? raw : new TextDecoder().decode(raw), hint);
    if (id && id !== hint) ws.serializeAttachment({ id });
  }
  async webSocketClose(ws: WebSocket) { this.host?.close(ws); }
  async webSocketError(ws: WebSocket) { this.host?.close(ws); }
}
