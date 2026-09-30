// In-game HUD: only the joystick and jump button are always there; the
// interact button appears when something nearby can be used, showing its icon.
import { el } from './Screens';
import { EMOJIS } from '../../../shared/constants';
import type { GameView, PlayerInfo } from '../../../shared/protocol';

const GAME_ICON: Record<string, string> = { race: '🏁', rescue: '🧺', colorFloor: '🌈', hideSeek: '🙈', giantBall: '⚽', paint: '🎨' };
const GRID_COLORS = ['#FF595E', '#1982C4', '#FFCA3A', '#8AC926'];

export class Hud {
  root = document.getElementById('ui')!;
  jump: HTMLButtonElement; act: HTMLButtonElement; emo: HTMLButtonElement;
  emoList: HTMLDivElement; chip: HTMLDivElement; stars: HTMLDivElement; bar: HTMLDivElement;
  onEmoji: (i: number) => void = () => { };
  private lastAct = '';

  constructor() {
    this.jump = el('button', 'rb big jump', '⤒') as HTMLButtonElement; this.jump.setAttribute('aria-label', 'قفز');
    this.act = el('button', 'rb big act hidden', '🤚') as HTMLButtonElement; this.act.setAttribute('aria-label', 'استخدم');
    this.emo = el('button', 'rb small emo', '😊') as HTMLButtonElement;
    this.emoList = el('div', 'emo-list hidden') as HTMLDivElement;
    EMOJIS.forEach((e, i) => {
      const b = el('button', 'rb small', e);
      b.onclick = ev => { ev.stopPropagation(); this.onEmoji(i); this.emoList.classList.add('hidden'); };
      this.emoList.append(b);
    });
    this.emo.onclick = () => this.emoList.classList.toggle('hidden');
    this.chip = el('div', 'chip') as HTMLDivElement;
    this.stars = el('div', 'stars') as HTMLDivElement;
    this.bar = el('div', 'gamebar') as HTMLDivElement;
    this.root.append(this.jump, this.act, this.emo, this.emoList, this.chip, this.stars, this.bar);
  }
  setAct(icon: string | null) {
    if (!icon) { this.act.classList.add('hidden'); this.lastAct = ''; return; }
    this.act.classList.remove('hidden');
    if (icon !== this.lastAct) { this.act.textContent = icon; this.lastAct = icon; }
  }
  setRoom(code: string, solo: boolean, players: PlayerInfo[], myId: string) {
    this.chip.innerHTML = '';
    if (!solo) this.chip.append(el('span', '', '🔑 ' + code));
    for (const p of players) {
      const d = el('span', 'dot'); d.style.background = p.color;
      if (p.id === myId) d.style.boxShadow = '0 0 0 3px rgba(255,255,255,0.8)';
      this.chip.append(d);
    }
  }
  setStars(n: number, total: number, tickets: number) {
    this.stars.innerHTML = `<span>⭐ ${n}/${total}</span>${tickets ? `<span>🎟️ ${tickets}</span>` : ''}`;
  }
  setGame(g: GameView | undefined, myId: string, players: PlayerInfo[]) {
    if (!g || (g.phase !== 'running' && g.phase !== 'result')) { this.bar.style.opacity = '0'; return; }
    this.bar.style.opacity = '1';
    const parts: string[] = [GAME_ICON[g.id] || '🎲'];
    if (g.phase === 'running') parts.push(`⏱ ${Math.ceil(g.t)}`);
    if (g.id === 'colorFloor' && g.x?.target != null && g.phase === 'running') parts.push(`<span class="bigcolor" style="background:${GRID_COLORS[g.x.target]}"></span>`);
    if (g.id === 'hideSeek' && g.x?.seeker) parts.push(g.x.seeker === myId ? '🙈' : g.x.phase === 'hide' ? '🤫' : '👀');
    if (g.id === 'giantBall' && g.x?.goals) parts.push(`<span style="color:#FF595E">${g.x.goals[0]}</span> : <span style="color:#4CC9F0">${g.x.goals[1]}</span>`);
    else for (const id of g.players) {
      const info = players.find(p => p.id === id);
      parts.push(`<span class="dot" style="background:${info?.color || '#fff'}"></span>${g.scores[id] ?? 0}`);
    }
    if (g.phase === 'result') parts.push(g.x?.winners?.includes(myId) ? '🏆' : '👏');
    this.bar.innerHTML = parts.join(' ');
  }
  show(on: boolean) { for (const e of [this.jump, this.emo, this.chip, this.stars]) e.style.display = on ? '' : 'none'; if (!on) this.setAct(null); }
}
