// Screens over the live scene: title, character + outfit + accessory, room
// code. Round translucent buttons, icons first, at most two words of text.
import { CHARACTER_IDS, CHARACTERS, OUTFIT_COLORS, ACCESSORIES, type CharacterId, type Accessory } from '../../../shared/constants';
import type { Look } from '../../../shared/protocol';

const ui = () => document.getElementById('ui')!;
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e;
};
const btn = (icon: string, cls = '', title = '') => { const b = el('button', 'rb ' + cls, icon); if (title) b.setAttribute('aria-label', title); return b; };
const PREVIEW = import.meta.env.DEV ? 'ui/' : 'public/ui/';
const ACC_ICON: Record<Accessory, string> = { none: '🚫', glasses: '👓', sunglasses: '🕶️', cap: '🧢', bow: '🎀', crown: '👑' };

export type Start = { mode: 'solo' } | { mode: 'create' } | { mode: 'join'; code: string };

export function titleScreen(online: boolean, error = ''): Promise<Start> {
  return new Promise(resolve => {
    const s = el('div', 'screen');
    s.append(el('h1', 'title', 'لمّتنا'));
    if (error) s.append(el('div', 'err', error));
    const row = el('div', 'row');
    const play = btn('▶️', 'big', 'العب'), create = btn('🏠', 'big', 'غرفة جديدة'), join = btn('🔑', 'big', 'انضم');
    const col = (b: HTMLElement, t: string) => { const c = el('div'); c.style.display = 'grid'; c.style.justifyItems = 'center'; c.style.gap = '6px'; c.append(b, el('div', 'label', t)); return c; };
    row.append(col(play, 'العب'));
    if (online) row.append(col(create, 'غرفة جديدة'), col(join, 'انضم'));
    s.append(row);
    const codeRow = el('div', 'row hidden');
    const input = el('input', 'code-in') as HTMLInputElement;
    input.inputMode = 'numeric'; input.maxLength = 4; input.placeholder = '• • • •'; input.autocomplete = 'off';
    const go = btn('✔️', '', 'دخول');
    codeRow.append(input, go);
    s.append(codeRow);
    ui().append(s);
    const done = (r: Start) => { s.remove(); resolve(r); };
    play.onclick = () => done({ mode: 'solo' });
    create.onclick = () => done({ mode: 'create' });
    join.onclick = () => { codeRow.classList.remove('hidden'); input.focus(); };
    const submit = () => { const c = input.value.replace(/\D/g, ''); if (c.length === 4) done({ mode: 'join', code: c }); else input.animate([{ transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'none' }], 250); };
    go.onclick = submit;
    input.onkeydown = e => { if (e.key === 'Enter') submit(); };
    input.oninput = () => { input.value = input.value.replace(/\D/g, '').slice(0, 4); if (input.value.length === 4) submit(); };
  });
}

export function characterScreen(saved: Partial<Look> | null): Promise<Look> {
  return new Promise(resolve => {
    let char: CharacterId = (saved?.char && CHARACTER_IDS.includes(saved.char)) ? saved.char : 'najd';
    let color = saved?.color && OUTFIT_COLORS.includes(saved.color) ? saved.color : CHARACTERS[char].color;
    let acc: Accessory = (saved?.acc && ACCESSORIES.includes(saved.acc)) ? saved.acc : 'none';
    const s = el('div', 'screen');
    const name = el('div', 'name');
    const chars = el('div', 'row');
    const swatches = el('div', 'row');
    const accs = el('div', 'row');
    const refresh = () => {
      name.textContent = CHARACTERS[char].name;
      chars.querySelectorAll('.char').forEach(c => c.classList.toggle('sel', (c as HTMLElement).dataset.id === char));
      swatches.querySelectorAll('.swatch').forEach(c => c.classList.toggle('sel', (c as HTMLElement).dataset.c === color));
      accs.querySelectorAll('.rb').forEach(c => c.classList.toggle('sel', (c as HTMLElement).dataset.a === acc));
    };
    for (const id of CHARACTER_IDS) {
      const b = el('button', 'char'); b.dataset.id = id;
      const img = el('img') as HTMLImageElement; img.src = PREVIEW + CHARACTERS[id].model.split('/')[1] + '.png'; img.alt = CHARACTERS[id].name;
      b.append(img);
      b.onclick = () => { char = id; color = CHARACTERS[id].color; refresh(); };
      chars.append(b);
    }
    for (const c of OUTFIT_COLORS) {
      const b = el('button', 'swatch'); b.dataset.c = c; b.style.background = c; b.setAttribute('aria-label', c);
      b.onclick = () => { color = c; refresh(); };
      swatches.append(b);
    }
    for (const a of ACCESSORIES) {
      const b = btn(ACC_ICON[a], 'small'); b.dataset.a = a;
      b.onclick = () => { acc = a; refresh(); };
      accs.append(b);
    }
    const ok = btn('✔️', 'big', 'يلا');
    ok.onclick = () => { s.remove(); resolve({ char, color, acc }); };
    s.append(name, chars, swatches, accs, ok);
    ui().append(s);
    refresh();
  });
}

export function loadingBar() {
  const b = el('div', 'loading'); const i = el('i'); b.append(i); ui().append(b);
  return { set: (f: number) => { i.style.width = Math.round(f * 100) + '%'; }, done: () => b.remove() };
}
export function toast(text: string, ms = 1400) {
  const t = el('div', 'toast', text); ui().append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translate(-50%,-80%)'; }, ms);
  setTimeout(() => t.remove(), ms + 500);
}
export function errorText(code: string) {
  return ({ full: 'الغرفة ممتلئة', notfound: 'الرقم غير صحيح', offline: 'بدون اتصال', bad: 'خطأ' } as Record<string, string>)[code] || 'انقطع الاتصال';
}
