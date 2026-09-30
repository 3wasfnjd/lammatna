// Optional model sets. Each set only changes the look (shared/characters.js
// `model` blocks); gameplay, collision and multiplayer roles never change.
//
// 'kenney': Kenney Mini Characters (CC0, www.kenney.nl), customised per family
// member with part-specific recolouring and blocky accessories (see
// src/characters/glbCustomize.js). Head accessory coordinates are in the head
// bone's space: origin at the neck, +y up, +z forward, head ≈ 0.30 wide.

const K = 'assets/characters/kenney/';
const ANIMS = {
  idle: 'idle', walk: 'walk', run: 'sprint', jump: 'jump', fall: 'fall', land: 'idle', sit: 'sit', swing: 'sit', slide: 'sit',
  carry: 'holding-both', carryWalk: 'holding-both', wave: 'interact-right', laugh: 'emote-yes', clap: 'emote-yes', celebrate: 'emote-yes'
};
const box = (size, color, position) => ({ bone: 'head', size, color, position });
const scarf = (c, band) => [
  box([0.4, 0.07, 0.36], c, [0, 0.3, 0]), box([0.04, 0.36, 0.36], c, [0.195, 0.11, 0]), box([0.04, 0.36, 0.36], c, [-0.195, 0.11, 0]),
  box([0.4, 0.42, 0.06], c, [0, 0.1, -0.17]), box([0.42, 0.1, 0.24], c, [0, -0.06, -0.08]), box([0.42, 0.035, 0.03], band, [0, 0.265, 0.18])
];
// Kenney eyes sit on the face plane; keep them when recolouring dark hair.
const EYES = { min: [-1, 0.39, 0.15], max: [1, 0.53, 1] };

export const CHARACTER_SETS = {
  kenney: {
    papa: { type: 'glb', url: K + 'character-male-b.glb', targetHeight: 1.3, animations: ANIMS,
      recolor: [{ part: 'head', from: '#CF7A55', to: '#2B211C' }, { part: 'body', from: '#EB6246', to: '#26B3AE' }],
      accessories: [{ bone: 'head', kind: 'glb', url: K + 'aid-glasses.glb', position: [0, 0.06, 0.085] }] },
    mama: { type: 'glb', url: K + 'character-female-d.glb', targetHeight: 1.2, animations: ANIMS,
      recolor: [{ part: 'body', from: '#6D738A', to: '#F2735F' }, { part: 'head', from: '#CF7A55', to: '#9C6BD1' }],
      accessories: scarf('#9C6BD1', '#F2735F') },
    nasser: { type: 'glb', url: K + 'character-male-f.glb', targetHeight: 1.05, animations: ANIMS,
      recolor: [{ part: 'body', from: '#3FA87A', to: '#F7BE2F' }],
      accessories: [box([0.38, 0.11, 0.35], '#2BB5B0', [0, 0.3, 0]), box([0.3, 0.03, 0.16], '#2BB5B0', [0, 0.255, 0.23])] },
    joud: { type: 'glb', url: K + 'character-female-c.glb', targetHeight: 0.95, animations: ANIMS,
      recolor: [{ part: 'body', from: '#5F74CB', to: '#9C6BD1' }, { part: 'head', from: '#6D738A', to: '#4A2E22' }] },
    najd: { type: 'glb', url: K + 'character-female-b.glb', targetHeight: 0.8, animations: ANIMS,
      recolor: [{ part: 'body', from: '#FFB54A', to: '#FF8FB8' }, { part: 'head', from: '#CF7A55', to: '#5A3423' }] }
  }
};

export function applyCharacterSet(characters, name) {
  const set = CHARACTER_SETS[name];
  if (!set) return false;
  for (const [id, model] of Object.entries(set)) if (characters[id]) characters[id].model = model;
  return true;
}
