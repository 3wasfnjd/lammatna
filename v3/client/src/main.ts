// Start-up: the hall loads behind the menus; pick solo / new room / join,
// pick a family member, and play. ?room=1234 joins directly; ?auto=solo skips
// the menus (used by the automated browser test).
import './style.css';
import { Game } from './Game';
import { NetClient } from './net/NetClient';
import { LocalTransport, WsTransport, serverUrl, serverAlive, type Transport } from './net/transport';
import { titleScreen, characterScreen, loadingBar, toast, errorText, type Start } from './ui/Screens';
import { CHARACTER_IDS, type CharacterId } from '../../shared/constants';
import type { Look } from '../../shared/protocol';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
const bar = loadingBar();
game.onProgress = f => bar.set(f);
game.hallReady.then(() => bar.done()).catch(e => console.warn('hall', e));

const q = new URLSearchParams(location.search);
const url = serverUrl();

function savedLook(): Partial<Look> | null {
  try { return JSON.parse(localStorage.getItem('lm3-look') || 'null'); } catch { return null; }
}

async function connect(start: Start, look: Look): Promise<NetClient> {
  let t: Transport;
  if (start.mode === 'solo') t = await LocalTransport.create();
  else t = new WsTransport(`${url}?${start.mode === 'create' ? 'create=1' : 'code=' + start.code}`);
  await game.hallReady;
  const net = new NetClient(t, game.sim);
  await net.join(look);
  return net;
}

function keepAlive(net: NetClient, look: Look) {
  if (net.solo) return;
  let tries = 0;
  net.onClosed = reason => {
    if (reason === 'full' || reason === 'notfound') return;
    if (tries++ > 5) { toast('📡'); return; }
    // Reconnect to the same room as the same player.
    setTimeout(() => {
      const t = new WsTransport(`${url}?code=${net.code}`);
      net.t = t;
      t.onMessage = m => net.handle(m);
      t.onClose = r => net.onClosed(r);
      t.send({ t: 'hello', look, resume: net.myId });
    }, 800 * tries);
  };
}

async function main() {
  const online = !!url && await serverAlive(url);
  let error = '';
  for (;;) {
    let start: Start;
    let look: Look;
    if (q.get('auto') === 'solo') {
      start = { mode: 'solo' };
      const char = (q.get('char') as CharacterId) || 'najd';
      look = { char: CHARACTER_IDS.includes(char) ? char : 'najd', color: q.get('color') || '#FF8FB8', acc: (q.get('acc') as any) || 'bow' };
    } else {
      const room = q.get('room');
      start = room && online && !error ? { mode: 'join', code: room.replace(/\D/g, '').slice(0, 4) } : await titleScreen(online, error);
      look = await characterScreen(savedLook());
      try { localStorage.setItem('lm3-look', JSON.stringify(look)); } catch { /* private mode */ }
    }
    try {
      const net = await connect(start, look);
      keepAlive(net, look);
      await game.begin(net);
      if (!net.solo) history.replaceState(null, '', `?room=${net.code}`);
      return;
    } catch (e: any) {
      error = errorText(e?.message || 'offline');
      console.warn('join failed', e);
      if (q.get('auto')) return;
    }
  }
}
main();
