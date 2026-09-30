// Visual style: 'blocky' (toy-brick look, default) or 'soft' (the rounded
// cartoon look). ?style=soft switches; the choice is remembered on the device.
function pick() {
  const q = new URLSearchParams(location.search).get('style');
  if (q === 'soft' || q === 'blocky') {
    try { localStorage.setItem('lammatna.style', q); } catch { /* storage blocked */ }
    return q;
  }
  try { return localStorage.getItem('lammatna.style') || 'blocky'; } catch { return 'blocky'; }
}
export const STYLE = typeof location === 'undefined' ? 'blocky' : pick();
export const BLOCKY = STYLE === 'blocky';

// Optional character model set: ?chars=kenney (remembered), ?chars=default to go back.
function pickChars() {
  const q = new URLSearchParams(location.search).get('chars');
  if (q) {
    try { localStorage.setItem('lammatna.chars', q); } catch { /* storage blocked */ }
    return q;
  }
  try { return localStorage.getItem('lammatna.chars') || 'default'; } catch { return 'default'; }
}
export const CHARACTER_SET = typeof location === 'undefined' ? 'default' : pickChars();
