// Minigames implemented as room plugins. Race and Ball Rescue live in Room.js.
import { colors } from './colors.js';
import { hide } from './hide.js';
import { ball } from './ball.js';
import { builders } from './builders.js';
import { hoops } from './hoops.js';
import { gallery } from './gallery.js';
import { paint } from './paint.js';

export const GAMES = { colors, hide, ball, builders, hoops, gallery, paint };
export const ACTIVITY_TYPES = ['race', 'rescue', ...Object.keys(GAMES)];
// Family round order: competitive and cooperative games alternate.
export const FAMILY_QUEUE = ['race', 'colors', 'rescue', 'ball', 'builders'];
