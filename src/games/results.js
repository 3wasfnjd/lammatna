// Result cards for each activity; badges reflect what players actually did.
import { CHARACTERS } from '../../shared/characters.js';
import { T, arabicDigits } from '../ui/strings.js';
import { TEAM_COLORS, TEAM_NAMES } from '../../shared/games/arcade.js';

const medal = ['', '🥇', '🥈', '🥉', '🎖️', '🎖️'];

function who(players, id) {
  const p = players.find(x => x.id === id);
  return p && CHARACTERS[p.character];
}

function badgeList(badges, players, id) {
  return badges.filter(b => b.id === id).map(b => `<span class="badge">${T.badges[b.badge].icon} ${T.badges[b.badge].name}</span>`).join('');
}

export function resultsHtml(a, players, me) {
  const r = a.data.results || {};
  const badges = r.badges || [];
  if (a.type === 'race') {
    const rows = (r.ranking || []).map(x => {
      const c = who(players, x.id); if (!c) return '';
      const status = x.place ? `${medal[x.place]} ${T.place(x.place)} — ${arabicDigits(x.time.toFixed(1))} ${T.seconds}` : '💪';
      return `<li class="${x.id === me ? 'me' : ''}" style="--c:${c.badgeColor}"><b>${c.name}</b><span>${status}</span><div>${badgeList(badges, players, x.id)}</div></li>`;
    }).join('');
    return `<h3>🏁 ${T.race}</h3><p class="cheer">${T.everyone}</p><ol class="rank">${rows}</ol>`;
  }
  if (a.type === 'rescue') {
    const stars = '⭐'.repeat(r.stars || 0) + '☆'.repeat(3 - (r.stars || 0));
    const rows = players.filter(p => p.character && a.participants.includes(p.id)).map(p => {
      const c = CHARACTERS[p.character], n = r.byPlayer?.[p.id] || 0;
      return `<li class="${p.id === me ? 'me' : ''}" style="--c:${c.badgeColor}"><b>${c.name}</b><span>🧺 ${arabicDigits(n)}</span><div>${badgeList(badges, players, p.id)}</div></li>`;
    }).join('');
    return `<h3>🧺 ${T.rescue}</h3><div class="stars">${stars}</div>
      <p class="cheer">${r.success ? T.success : T.almost} — ${arabicDigits(r.delivered)} / ${arabicDigits(r.target)}</p><ol class="rank plain">${rows}</ol>`;
  }
  const row = (id, right) => {
    const c = who(players, id); if (!c) return '';
    return `<li class="${id === me ? 'me' : ''}" style="--c:${c.badgeColor}"><b>${c.name}</b><span>${right}</span><div>${badgeList(badges, players, id)}</div></li>`;
  };
  const starLine = () => '⭐'.repeat(r.stars || 0) + '☆'.repeat(3 - (r.stars || 0));
  if (a.type === 'colors') {
    const rows = (r.ranking || []).map((x, i) => row(x.id, `${medal[i + 1] || ''} ⭐ ${arabicDigits(x.score)} / ${arabicDigits(r.rounds)}`)).join('');
    return `<h3>🎨 ${T.colors}</h3><p class="cheer">${T.everyone}</p><ol class="rank">${rows}</ol>`;
  }
  if (a.type === 'hide') {
    const rows = a.participants.map(id => row(id, id === r.seeker ? `🔍 ${arabicDigits((r.found || []).length)}` : (r.survivors || []).includes(id) ? '🫥 ✓' : '👀')).join('');
    return `<h3>🙈 ${T.hide}</h3><p class="cheer">${T.everyone}</p><ol class="rank plain">${rows}</ol>`;
  }
  if (a.type === 'hoops' || a.type === 'gallery') {
    const title = a.type === 'hoops' ? `🏀 ${T.hoops}` : `🦆 ${T.gallery}`;
    const rows = (r.ranking || []).map((x, i) => row(x.id, `${medal[i + 1] || ''} ⭐ ${arabicDigits(x.score)}${a.type === 'hoops' ? ` — 🏀 ${arabicDigits(x.made)}/${arabicDigits(x.shots)}` : ` — 🎯 ${arabicDigits(x.hits)}/${arabicDigits(x.shots)}`}`)).join('');
    return `<h3>${title}</h3><p class="cheer">${T.everyone}</p><ol class="rank">${rows}</ol>`;
  }
  if (a.type === 'paint') {
    const banner = r.winner ? `${T.winnerTeam} ${TEAM_NAMES[r.winner]}!` : T.draw;
    const rows = a.participants.map(id => row(id, `<span style="color:${TEAM_COLORS[r.teams?.[id]] || '#333'}">●</span> 🎨 ${arabicDigits(r.hits?.[id] || 0)}`)).join('');
    return `<h3>🎨 ${T.paint}</h3><p class="cheer" style="color:${TEAM_COLORS[r.winner] || 'inherit'}">${banner}</p><p>${arabicDigits(r.score?.A || 0)} — ${arabicDigits(r.score?.B || 0)}</p><ol class="rank plain">${rows}</ol>`;
  }
  if (a.type === 'ball' || a.type === 'builders') {
    const title = a.type === 'ball' ? `⚽ ${T.ball}` : `🧱 ${T.builders}`;
    const detail = r.success ? `${T.success} — ${arabicDigits(r.seconds)} ${T.seconds}` : `${T.almost}${r.placed != null ? ` — ${arabicDigits(r.placed)} / ${arabicDigits(r.total)}` : ''}`;
    const rows = a.participants.map(id => row(id, a.type === 'builders' ? `🧱 ${arabicDigits(r.placedBy?.[id] || 0)}` : '')).join('');
    return `<h3>${title}</h3><div class="stars">${starLine()}</div><p class="cheer">${detail}</p><ol class="rank plain">${rows}</ol>`;
  }
  // Family celebration: everyone who played, with every badge they earned.
  const rows = a.participants.map(id => {
    const c = who(players, id); if (!c) return '';
    const list = badgeList(badges, players, id);
    return `<li class="${id === me ? 'me' : ''}" style="--c:${c.badgeColor}"><b>${c.name}</b><div>${list || `<span class="badge">💛 ${T.everyone}</span>`}</div></li>`;
  }).join('');
  return `<h3>🎉 ${T.celebrate}</h3><p class="cheer">${T.everyone}</p><ol class="rank plain">${rows}</ol>`;
}
