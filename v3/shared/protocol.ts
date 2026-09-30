// Messages between clients and a room (Durable Object, or the in-page solo room).
import type { CharacterId, Accessory } from './constants';

export interface Look { char: CharacterId; color: string; acc: Accessory; name?: string }

export type ClientMsg =
  | { t: 'hello'; look: Look; resume?: string }
  | { t: 'in'; f: [number, number, number, number][] }       // [seq, mx, mz, buttons]
  | { t: 'emoji'; e: number }
  | { t: 'look'; look: Look }
  | { t: 'ch'; toy: string; ok: boolean }                      // arcade mini-challenge result
  | { t: 'ping'; c: number };

export interface PlayerInfo { id: string; look: Look; stars: number[]; tickets: number; color: string }

export type ServerMsg =
  | { t: 'welcome'; id: string; code: string; solo: boolean; players: PlayerInfo[]; snap: Snapshot }
  | { t: 'info'; players: PlayerInfo[] }
  | { t: 's'; snap: Snapshot }
  | { t: 'err'; code: 'full' | 'notfound' | 'bad' }
  | { t: 'pong'; c: number; s: number };

export interface Snapshot {
  k: number;                       // sim tick
  time: number;
  pl: any[];                       // Sim.playerState() for each player
  pr: number[];                    // props: [index, x, y, z, qx, qy, qz, qw] …
  ty: Record<string, number[]>;    // toy states
  g: GameView[];
  ev: any[];
}

export interface GameView {
  id: string;
  phase: 'idle' | 'countdown' | 'running' | 'result';
  t: number;                       // seconds left in this phase
  spot: [number, number];
  inSpot: number;
  need: number;
  players: string[];
  scores: Record<string, number>;
  x?: any;                         // game-specific view data
}

export const encode = (m: ClientMsg | ServerMsg) => JSON.stringify(m);
export const decode = <T>(s: string): T | null => { try { return JSON.parse(s) as T; } catch { return null; } };

export function makeRoomCode(rand = Math.random) {
  return String(1000 + Math.floor(rand() * 9000));
}
