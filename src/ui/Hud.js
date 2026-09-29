// HTML overlay: menus, room bar, activity HUD, demos, results, labels, toasts.
import { CHARACTERS, CHARACTER_IDS } from '../../shared/characters.js';
import { BALL_COLORS } from '../../shared/playground.js';
import { T, arabicDigits } from './strings.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class Hud {
  constructor(root) {
    this.root = root;
    this.labels = new Map();
    root.insertAdjacentHTML('beforeend', `
      <div class="labels"></div>
      <div class="topbar hidden">
        <button class="chip room-chip"><span class="room-code"></span><span class="invite">🔗 ${T.invite}</span></button>
        <div class="roster"></div>
        <button class="chip menu-btn" aria-label="${T.menu}">☰</button>
      </div>
      <div class="activity-hud hidden"><div class="act-title"></div><div class="act-timer"></div><div class="act-progress"><div class="bar"><i></i></div><span></span></div></div>
      <div class="countdown hidden"></div>
      <div class="toast hidden"></div>
      <div class="panel demo hidden"></div>
      <div class="panel results hidden"></div>
      <div class="panel menu hidden"></div>
      <div class="fade"></div>`);
    this.topbar = $('.topbar', root);
    this.actHud = $('.activity-hud', root);
    this.countdownEl = $('.countdown', root);
    this.toastEl = $('.toast', root);
    this.demoEl = $('.panel.demo', root);
    this.resultsEl = $('.panel.results', root);
    this.menuEl = $('.panel.menu', root);
    this.labelsEl = $('.labels', root);
    this.fadeEl = $('.fade', root);
  }

  // ---- start screens -------------------------------------------------------------
  showTitle({ onStart }) {
    const el = document.createElement('div');
    el.className = 'screen title-screen';
    el.innerHTML = `<div class="logo"><div class="logo-main">${T.title}</div><div class="logo-sub">${T.subtitle}</div><div class="logo-en">Lammatna — Family Playhouse</div></div>
      <button class="big-btn pulse">${T.tapToStart}</button>`;
    this.root.appendChild(el);
    $('button', el).addEventListener('click', () => { el.remove(); onStart(); }, { once: true });
  }

  showLobbyMenu({ serverAvailable, presetCode, onCreate, onJoin, onSolo }) {
    const el = document.createElement('div');
    el.className = 'screen lobby-screen';
    el.innerHTML = `<div class="card">
        <div class="logo small"><div class="logo-main">${T.title}</div><div class="logo-sub">${T.subtitle}</div></div>
        <div class="row ${serverAvailable ? '' : 'hidden'}"><button class="big-btn create">🏠 ${T.createRoom}</button></div>
        <div class="row join-row ${serverAvailable ? '' : 'hidden'}">
          <input class="code" inputmode="numeric" maxlength="4" placeholder="${T.codePlaceholder}" value="${esc(presetCode || '')}" dir="ltr">
          <button class="big-btn alt join">${T.join}</button>
        </div>
        <p class="note ${serverAvailable ? 'hidden' : ''}">${T.noServer}</p>
        <div class="row"><button class="big-btn ${serverAvailable ? 'ghost' : ''} solo">🧸 ${T.solo}</button></div>
        <p class="status"></p>
      </div>`;
    this.root.appendChild(el);
    const input = $('.code', el), status = $('.status', el);
    input.addEventListener('input', () => { input.value = normaliseDigits(input.value).replace(/\D/g, '').slice(0, 4); });
    $('.create', el).addEventListener('click', () => onCreate());
    $('.join', el).addEventListener('click', () => { if (input.value.length === 4) onJoin(input.value); else input.focus(); });
    $('.solo', el).addEventListener('click', () => onSolo());
    this.lobbyEl = el;
    return { setStatus: text => { status.textContent = text || ''; }, close: () => el.remove() };
  }

  showCharacterSelect({ free, mine, onPick }) {
    let el = $('.select-screen', this.root);
    if (!el) {
      el = document.createElement('div');
      el.className = 'screen select-screen';
      el.innerHTML = `<h2>${T.chooseCharacter}</h2><div class="cards"></div>`;
      this.root.appendChild(el);
    }
    const cards = $('.cards', el);
    cards.innerHTML = CHARACTER_IDS.map(id => {
      const c = CHARACTERS[id], L = c.look, taken = !free.includes(id) && mine !== id;
      return `<button class="char-card ${taken ? 'taken' : ''} ${mine === id ? 'mine' : ''}" data-id="${id}" style="--c:${c.badgeColor};--skin:${L.skin};--hair:${L.hair};--shirt:${L.shirt}" ${taken ? 'disabled' : ''}>
        <span class="face" style="--h:${Math.round(40 + L.height * 30)}px"><i class="hair ${L.hairStyle}"></i><i class="eyes"></i><i class="mouth"></i></span>
        <b>${c.name}</b><small>${taken ? T.taken : c.role}</small></button>`;
    }).join('');
    for (const b of cards.querySelectorAll('button:not([disabled])')) b.addEventListener('click', () => onPick(b.dataset.id));
    this.selectEl = el;
  }
  hideCharacterSelect() { this.selectEl?.remove(); this.selectEl = null; }

  // ---- room bar ------------------------------------------------------------------
  setRoom({ code, online, onInvite, onMenu }) {
    this.topbar.classList.remove('hidden');
    $('.room-code', this.topbar).textContent = online ? `${T.room} ${code}` : T.solo;
    $('.invite', this.topbar).classList.toggle('hidden', !online);
    $('.room-chip', this.topbar).onclick = online ? onInvite : null;
    $('.menu-btn', this.topbar).onclick = onMenu;
  }

  setRoster(players, me) {
    $('.roster', this.topbar).innerHTML = players.filter(p => p.character).map(p => {
      const c = CHARACTERS[p.character];
      return `<span class="who ${p.connected ? '' : 'away'} ${p.id === me ? 'me' : ''}" style="--c:${c.badgeColor}" title="${p.connected ? '' : T.away}">${c.name}${p.id === me ? ' ★' : ''}</span>`;
    }).join('');
  }

  showMenu({ isHost, online, assist, muted, busy, onFamily, onAssist, onMute, onLeave }) {
    const el = this.menuEl;
    el.innerHTML = `<button class="close">✕</button><h3>${T.menu}</h3>
      <button class="big-btn family" ${isHost && !busy ? '' : 'disabled'}>🎉 ${T.familyRound}</button>
      ${isHost ? '' : `<p class="note">${T.hostOnly}</p>`}
      <label class="toggle"><input type="checkbox" class="assist" ${assist ? 'checked' : ''} ${isHost ? '' : 'disabled'}> ${T.assist}</label>
      <label class="toggle"><input type="checkbox" class="mute" ${muted ? '' : 'checked'}> ${T.sound}</label>
      <button class="big-btn ghost leave">${T.leave}</button>`;
    el.classList.remove('hidden');
    const close = () => el.classList.add('hidden');
    $('.close', el).onclick = close;
    $('.family', el).onclick = () => { close(); onFamily(); };
    $('.assist', el).onchange = e => onAssist(e.target.checked);
    $('.mute', el).onchange = e => onMute(!e.target.checked);
    $('.leave', el).onclick = () => { close(); onLeave(); };
  }

  // ---- activity HUD --------------------------------------------------------------
  setActivityHud(info) {
    if (!info) { this.actHud.classList.add('hidden'); return; }
    this.actHud.classList.remove('hidden');
    $('.act-title', this.actHud).textContent = info.title;
    $('.act-timer', this.actHud).textContent = info.timer != null ? `⏱ ${arabicDigits(Math.max(0, Math.ceil(info.timer)))}` : '';
    const prog = $('.act-progress', this.actHud);
    prog.classList.toggle('hidden', info.progress == null);
    if (info.progress != null) {
      $('i', prog).style.width = `${Math.min(100, info.progress * 100)}%`;
      $('span', prog).textContent = info.progressText || '';
    }
    this.actHud.classList.toggle('urgent', info.timer != null && info.timer < 10);
  }

  showCountdown(text) {
    if (!text) { this.countdownEl.classList.add('hidden'); this.lastCount = null; return; }
    if (text === this.lastCount) return;
    this.lastCount = text;
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove('hidden');
    this.countdownEl.classList.remove('pop'); void this.countdownEl.offsetWidth; this.countdownEl.classList.add('pop');
  }

  // Short visual demonstration before each minigame (minimal text).
  showDemo(type) {
    if (!type) { this.demoEl.classList.add('hidden'); this.demoType = null; return; }
    if (this.demoType === type) return;
    this.demoType = type;
    const el = this.demoEl;
    if (type === 'race') {
      el.innerHTML = `<h3>🏁 ${T.race}</h3><div class="demo-race">${T.raceDemo.map((w, i) => `<div class="step" style="--i:${i}"><span>${['🕳️', '🦘', '🪜', '🛝'][i]}</span><small>${w}</small></div>`).join('<b class="arrow">←</b>')}
        <div class="step goal" style="--i:4"><span>🟡</span><small>${T.raceGoal}</small></div></div>`;
    } else if (type === 'rescue') {
      el.innerHTML = `<h3>🧺 ${T.rescue}</h3><div class="demo-rescue">${BALL_COLORS.map((c, i) => `<div class="pair" style="--c:${c.color};--i:${i}"><span class="ball">${c.symbol}</span><b class="arrow">←</b><span class="basket">${c.symbol}</span></div>`).join('')}</div>
        <p>${T.rescueDemo}</p><p class="hint">🤝 ${T.passTo}…</p>`;
    }
    el.classList.remove('hidden');
  }

  showResults(html, low = false) {
    if (!html) { this.resultsEl.classList.add('hidden'); return; }
    this.resultsEl.innerHTML = html;
    this.resultsEl.classList.toggle('low', low);
    this.resultsEl.classList.remove('hidden');
  }

  toast(text, ms = 1800) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }

  fade(on) { this.fadeEl.classList.toggle('on', on); }

  // ---- name labels and emote bubbles ------------------------------------------------
  label(id, text, color) {
    let l = this.labels.get(id);
    if (!l) {
      l = document.createElement('div');
      l.className = 'name-label';
      l.innerHTML = '<span class="bubble"></span><span class="name"></span>';
      this.labelsEl.appendChild(l);
      this.labels.set(id, l);
    }
    l.querySelector('.name').textContent = text;
    l.style.setProperty('--c', color);
    return l;
  }
  removeLabel(id) { this.labels.get(id)?.remove(); this.labels.delete(id); }
  bubble(id, icon) {
    const l = this.labels.get(id);
    if (!l) return;
    const b = l.querySelector('.bubble');
    b.textContent = icon; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }
}

export function normaliseDigits(s) {
  return String(s).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
}
export { esc };
