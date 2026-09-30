// Local multiplayer without Cloudflare: the same RoomHost over the 'ws' package.
//   npx tsx server/node-server.ts [port]     →  ws://localhost:8788/ws?create=1
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { initPhysics } from '../shared/rapier';
import { RoomHost } from './host';
import { makeRoomCode } from '../shared/protocol';

await initPhysics();
const port = +(process.argv[2] || process.env.PORT || 8788);
const rooms = new Map<string, RoomHost>();
const emptySince = new Map<string, number>();
const http = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url?.startsWith('/health')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ game: 'lammatna-v3', status: 'ready', rooms: rooms.size })); return; }
  res.end('Lammatna 3 room server');
});
const wss = new WebSocketServer({ server: http, path: '/ws' });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', 'http://x');
  let code = (url.searchParams.get('code') || '').replace(/\D/g, '').slice(0, 4);
  if (url.searchParams.get('create')) {
    do code = makeRoomCode(); while (rooms.has(code) && rooms.get(code)!.room.count > 0);
    rooms.set(code, new RoomHost(code));
  }
  const host = rooms.get(code);
  if (!host) { ws.send(JSON.stringify({ t: 'err', code: 'notfound' })); ws.close(4004, 'notfound'); return; }
  ws.on('message', raw => host.message(ws as any, raw.toString()));
  ws.on('close', () => host.close(ws as any));
});
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  for (const [code, h] of rooms) {
    h.room.update(now - last);
    h.sweep();
    // Forget rooms that stayed empty for a minute.
    if (h.room.count > 0) emptySince.delete(code);
    else if (!emptySince.has(code)) emptySince.set(code, now);
    else if (now - emptySince.get(code)! > 60000) { rooms.delete(code); emptySince.delete(code); }
  }
  last = now;
}, 1000 / 30);
http.listen(port, () => console.log(`Lammatna 3 rooms on ws://localhost:${port}/ws`));
