// Lammatna room server: serves the game files and runs private rooms over
// WebSocket at /ws. Usage: node server/server.mjs  (PORT defaults to 8787)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from '../shared/RoomManager.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 8787);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary',
  '.webmanifest': 'application/manifest+json'
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('lammatna/')) path = path.slice('lammatna/'.length);
  if (!path || path.endsWith('/')) path += 'index.html';
  const file = join(root, path);
  if (!file.startsWith(root) || path.startsWith('server') || path.startsWith('tools')) { res.writeHead(404); return res.end(); }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

const manager = new RoomManager().startTicking();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', socket => {
  const conn = {
    send: msg => { if (socket.readyState === 1) socket.send(JSON.stringify(msg)); },
    close: () => socket.close()
  };
  let budget = 60;
  const refill = setInterval(() => { budget = Math.min(60, budget + 30); }, 1000);
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });
  socket.on('message', data => {
    if (--budget < 0) return; // simple flood guard: ~30 messages per second
    try { manager.message(conn, JSON.parse(data)); } catch { /* ignore malformed input */ }
  });
  socket.on('close', () => { clearInterval(refill); manager.closed(conn); });
});
// Drop sockets that silently vanished (phones sleeping, lost Wi-Fi).
setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) { socket.terminate(); continue; }
    socket.isAlive = false; socket.ping();
  }
}, 10000);

server.listen(port, () => console.log(`Lammatna: http://localhost:${port}/  (rooms on ws://localhost:${port}/ws)`));
