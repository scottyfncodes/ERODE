import { describe, expect, it } from 'vitest';
import { statsWanted } from '../src/ui/stats';

// The ?stats performance readout is off unless asked for, and remembers the choice.
describe('the stats readout toggle', () => {
  it('turns on with ?stats, off with ?stats=0, and remembers it', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(statsWanted('')).toBe(false);
    expect(statsWanted('?stats')).toBe(true);
    expect(statsWanted('')).toBe(true);
    expect(statsWanted('?stats=0')).toBe(false);
    expect(statsWanted('?x=1')).toBe(false);
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('still works where storage is unavailable (private browsing)', () => {
    expect(statsWanted('?stats=1')).toBe(true);
    expect(statsWanted('')).toBe(false);
  });
});
