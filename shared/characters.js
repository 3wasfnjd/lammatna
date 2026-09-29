// Central character configuration. Gameplay code refers to characters only by
// their stable id; everything visual lives under `look` (placeholder) and
// `model` (final GLB). Swapping a placeholder for a GLB is a config change here.

export const CHARACTER_IDS = ['papa', 'mama', 'nasser', 'joud', 'najd'];

// One movement profile for everyone: visual height never changes speed, jump,
// reach or the collision body, so the smallest character is never at a disadvantage.
export const MOVEMENT = Object.freeze({
  walkSpeed: 2.6,
  runSpeed: 5.4,
  jumpVelocity: 6.4,
  gravity: 19,
  radius: 0.36,
  bodyHeight: 1.45,
  stepHeight: 0.45,
  reach: 1.9,        // pick up / interact distance
  assistReach: 2.8   // with "help for young players"
});

// Animation states the controllers produce. A GLB maps these names to its own clips.
export const ANIMATION_STATES = ['idle', 'walk', 'run', 'jump', 'fall', 'land', 'sit', 'swing', 'slide',
  'carry', 'carryWalk', 'wave', 'laugh', 'clap', 'celebrate'];
export const ANIM_CODE = Object.fromEntries(ANIMATION_STATES.map((name, i) => [name, i]));

export const EMOTES = [
  { id: 'wave', label: 'تلويح', icon: '👋' },
  { id: 'laugh', label: 'ضحك', icon: '😄' },
  { id: 'clap', label: 'تصفيق', icon: '👏' },
  { id: 'celebrate', label: 'احتفال', icon: '🎉' }
];

const glbDefaults = { scale: 1, targetHeight: null, rotationY: 0, offset: [0, 0, 0], animations: {}, attach: {} };

export const CHARACTERS = {
  papa: {
    id: 'papa', name: 'بابا', role: 'الأب', badgeColor: '#2BB5B0',
    look: {
      height: 1.86, build: 1.18, headScale: 0.9,
      skin: '#E6B08A', hair: '#2B211C', shirt: '#26B3AE', pants: '#39486A', shoes: '#6A4636', accent: '#FFFFFF',
      hairStyle: 'short', beard: true, glasses: true
    },
    model: { type: 'placeholder' }
  },
  mama: {
    id: 'mama', name: 'ماما', role: 'الأم', badgeColor: '#F2735F',
    look: {
      height: 1.7, build: 1.0, headScale: 0.95,
      skin: '#F0C09B', hair: '#3A2622', shirt: '#F2735F', pants: '#F2735F', shoes: '#8E5BB5', accent: '#9C6BD1',
      hairStyle: 'scarf', dress: true
    },
    model: { type: 'placeholder' }
  },
  nasser: {
    id: 'nasser', name: 'ناصر', role: 'الابن', badgeColor: '#F5B82E',
    look: {
      height: 1.46, build: 0.95, headScale: 1.05,
      skin: '#E3AA82', hair: '#231A16', shirt: '#F7BE2F', pants: '#2F6FB5', shoes: '#F2735F', accent: '#2BB5B0',
      hairStyle: 'cap'
    },
    model: { type: 'placeholder' }
  },
  joud: {
    id: 'joud', name: 'جود', role: 'الابنة الكبرى', badgeColor: '#9C6BD1',
    look: {
      height: 1.34, build: 0.9, headScale: 1.1,
      skin: '#EDBB95', hair: '#4A2E22', shirt: '#9C6BD1', pants: '#2BB5B0', shoes: '#FFFFFF', accent: '#F5B82E',
      hairStyle: 'ponytail'
    },
    model: { type: 'placeholder' }
  },
  najd: {
    id: 'najd', name: 'نجد', role: 'الابنة الصغرى', badgeColor: '#FF8FB8',
    look: {
      height: 1.04, build: 0.85, headScale: 1.25,
      skin: '#F3C6A2', hair: '#5A3423', shirt: '#FF8FB8', pants: '#FF8FB8', shoes: '#F5B82E', accent: '#FFFFFF',
      hairStyle: 'buns', dress: true
    },
    model: { type: 'placeholder' }
    // Final asset example:
    // model: { type: 'glb', url: 'assets/characters/najd.glb', targetHeight: 1.04, rotationY: Math.PI,
    //          animations: { idle: 'Idle', walk: 'Walk', run: 'Run', jump: 'Jump', sit: 'Sit', ... },
    //          attach: { carry: 'RightHand' } }
  }
};

export function characterModel(id) {
  const model = CHARACTERS[id]?.model || { type: 'placeholder' };
  return model.type === 'glb' ? { ...glbDefaults, ...model } : model;
}

export function isCharacterId(id) {
  return CHARACTER_IDS.includes(id);
}
