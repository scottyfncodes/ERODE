import type { Plan } from '../src/levels/types';
const deg = Math.PI / 180;
type Mod = (p: Plan, j: number) => void;
const set = (p: Plan, id: string, v: object) => Object.assign(p[id], v);
// j ∈ [-0.5, 0.5] is a small perturbation so we test neighbourhoods, not single points
export const SOLUTIONS: Record<string, Mod> = {
  'FAIL default': () => {},
  'FAIL log open': (p, j) => set(p, 'log-a', { yaw: (90 + j * 8) * deg, x: -3 + j }),
  'FAIL log open + branches': (p, j) => {
    set(p, 'log-a', { yaw: (90 + j * 8) * deg, x: -3 + j });
    set(p, 'branches', { removed: true });
  },
  'R: log open + branches + logB': (p, j) => {
    set(p, 'log-a', { yaw: (90 + j * 8) * deg, x: -3 + j });
    set(p, 'branches', { removed: true });
    set(p, 'log-b', { yaw: (95 + j * 10) * deg });
  },
  'FAIL? log deflect only': (p, j) => {
    set(p, 'log-a', { yaw: (-45 + j * 8) * deg, z: -18.5, x: 1.5 + j * 0.6 });
  },
  'FAIL? tree across only': (p, j) => {
    set(p, 'log-a', { yaw: (90 + j * 8) * deg, x: -3 + j });
    set(p, 'tree', { felled: 'across' });
  },
  'L: log deflect + dig': (p, j) => {
    set(p, 'log-a', { yaw: (-45 + j * 8) * deg, z: -18.5, x: 1.5 + j * 0.6 });
    set(p, 'soil', { dug: true });
  },
  'L: log deflect + water': (p, j) => {
    set(p, 'log-a', { yaw: (-45 + j * 8) * deg, z: -18.5, x: 1.5 + j * 0.6 });
    set(p, 'gate', { option: 'left' });
  },
  'L: log open + spur + water': (p, j) => {
    set(p, 'log-a', { yaw: (90 + j * 8) * deg, x: -3 + j });
    set(p, 'spur', { split: true });
    set(p, 'gate', { option: 'left' });
  },
  'L: log open + tree across + dig': (p, j) => {
    set(p, 'log-a', { yaw: (90 + j * 8) * deg, x: -3 + j });
    set(p, 'tree', { felled: 'across' });
    set(p, 'soil', { dug: true });
  },
};
