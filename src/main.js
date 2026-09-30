// Boot: title → create / join / solo → character select → play.
import { Game } from './Game.js';
import { Audio } from './audio/Audio.js';
import { LocalTransport, SocketTransport, resolveServerUrl } from './net/Transport.js';
import { T } from './ui/strings.js';

import { BLOCKY, CHARACTER_SET } from './style.js';
import { applyCharacterSet } from '../shared/characterSets.js';
import { CHARACTERS } from '../shared/characters.js';

// Must run before the game creates any avatar.
applyCharacterSet(CHARACTERS, CHARACTER_SET);

const params = new URLSearchParams(location.search);
document.body.classList.toggle('blocky', BLOCKY);
const canvas = document.getElementById('game');
const ui = document.getElementById('ui');

// Keep the page still: no scrolling, zooming, text selection or long-press menus.
for (const ev of ['gesturestart', 'gesturechange', 'dblclick', 'contextmenu']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', e => { if (!e.target.closest('.scrollable')) e.preventDefault(); }, { passive: false });

function pickQuality() {
  const q = params.get('quality');
  if (q === 'low' || q === 'high') return q;
  const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 4;
  return cores <= 4 || mem <= 3 ? 'low' : 'high';
}

const audio = new Audio();
const game = new Game(canvas, ui, { quality: pickQuality(), audio });
window.lammatna = game; // handy for debugging on devices

const serverUrl = resolveServerUrl();
const presetCode = (params.get('room') || '').replace(/\D/g, '').slice(0, 4);
let menu = null;

function tokenKey(code) { return `lammatna.token.${code}`; }
function savedToken(code) { try { return sessionStorage.getItem(tokenKey(code)); } catch { return null; } }

game.onWelcome = msg => {
  try { sessionStorage.setItem(tokenKey(msg.code), msg.token); } catch { /* storage blocked */ }
  menu?.close(); menu = null;
  const online = game.transport.kind === 'online';
  if (online) {
    game.transport.url = roomUrl({ code: msg.code });
    const url = new URL(location.href); url.searchParams.set('room', msg.code);
    history.replaceState(null, '', url);
  }
  game.hud.setRoom({ code: msg.code, online, onInvite: () => invite(msg.code), onMenu: openMenu });
};

game.onWorldHook = (w, mine) => {
  if (mine && !mine.character) {
    game.hud.showCharacterSelect({
      free: w.free, mine: null,
      onPick: id => { audio.play('tap'); game.highlightPreview(id); game.send({ type: 'pick', character: id }); }
    });
  } else if (mine?.character) game.hud.hideCharacterSelect();
};

function invite(code) {
  const url = new URL(location.href);
  url.search = ''; url.searchParams.set('room', code);
  if (params.get('server')) url.searchParams.set('server', params.get('server'));
  const link = url.toString();
  if (navigator.share) navigator.share({ title: `${T.title} — ${T.subtitle}`, text: `${T.shareText} (${T.room} ${code})`, url: link }).catch(() => {});
  else navigator.clipboard?.writeText(link).then(() => game.hud.toast(T.copied)).catch(() => game.hud.toast(link, 5000));
}

function openMenu() {
  const w = game.world;
  game.hud.showMenu({
    isHost: w?.host === game.me, online: game.transport?.kind === 'online', assist: w?.assist, muted: audio.muted, busy: !!w?.activity,
    onFamily: () => game.send({ type: 'start', activity: 'family' }),
    size: w?.size,
    onAssist: on => game.send({ type: 'settings', assist: on }),
    onSize: size => game.send({ type: 'settings', size }),
    onMute: m => audio.setMuted(m),
    onLeave: () => { game.transport?.close(); location.href = location.pathname; }
  });
}

// Rooms are addressed in the URL too, so hosts can route each room to its own instance.
const roomUrl = msg => `${serverUrl}?${msg.create ? 'create=1' : `code=${encodeURIComponent(msg.code)}`}`;

async function goOnline(joinMsg) {
  menu?.setStatus(T.connecting);
  const transport = new SocketTransport(roomUrl(joinMsg));
  try {
    await transport.connect();
  } catch {
    menu?.setStatus(T.connectFailed);
    return;
  }
  transport.onStatus = s => {
    if (s === 'lost') game.hud.toast(T.lost, 4000);
    if (s === 'reconnected') {
      game.hud.toast(T.reconnected);
      transport.send({ type: 'join', code: game.code, token: savedToken(game.code) });
    }
  };
  game.attach(transport);
  transport.send(joinMsg);
}

function goSolo() {
  const transport = new LocalTransport();
  game.attach(transport);
  transport.send({ type: 'join', create: true });
}

// Is the room server reachable? Without it the lobby offers play on this device.
function checkServer() {
  if (!serverUrl) return Promise.resolve(false);
  const health = serverUrl.replace(/^ws/, 'http').replace(/\/ws$/, '/health');
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 4000);
  return fetch(health, { signal: ctrl.signal, cache: 'no-store' }).then(r => r.ok).catch(() => false).finally(() => clearTimeout(timer));
}
const serverCheck = checkServer();

game.hud.showTitle({
  onStart: async () => {
    audio.unlock();
    const serverAvailable = await serverCheck;
    menu = game.hud.showLobbyMenu({
      serverAvailable, presetCode,
      onCreate: () => goOnline({ type: 'join', create: true }),
      onJoin: code => goOnline({ type: 'join', code, token: savedToken(code) }),
      onSolo: () => { menu.close(); menu = null; goSolo(); }
    });
    if (presetCode && serverAvailable) goOnline({ type: 'join', code: presetCode, token: savedToken(presetCode) });
  }
});
game.onTaken = () => {};
