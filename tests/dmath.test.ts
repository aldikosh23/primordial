import { describe, expect, it } from 'vitest';
import { datan, datan2, dcos, dexp, dhypot, dlog, dpow, dsin } from '../src/sim/dmath';
import { Rng } from '../src/sim/rng';

/** Error relative to the size of the value, with an absolute floor near zero. */
function closeTo(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
}

describe('deterministic math', () => {
  const rng = new Rng(2026);
  const samples = (n: number, min: number, max: number) => Array.from({ length: n }, () => rng.range(min, max));

  it('matches Math.sin and Math.cos', () => {
    for (const x of [...samples(5000, -20, 20), 0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI, 1e-9, 1000]) {
      expect(closeTo(dsin(x), Math.sin(x), 4e-16), `sin(${x})`).toBe(true);
      expect(closeTo(dcos(x), Math.cos(x), 4e-16), `cos(${x})`).toBe(true);
    }
  });

  it('matches Math.atan and Math.atan2 in every quadrant', () => {
    for (const x of [...samples(3000, -50, 50), 0.4375, 0.6875, 1.1875, 2.4375, 1e-12, 1e30]) {
      expect(closeTo(datan(x), Math.atan(x), 4e-16), `atan(${x})`).toBe(true);
    }
    for (let i = 0; i < 5000; i++) {
      const y = rng.range(-10, 10);
      const x = rng.range(-10, 10);
      expect(closeTo(datan2(y, x), Math.atan2(y, x), 4e-16), `atan2(${y}, ${x})`).toBe(true);
    }
    expect(datan2(0, 0)).toBe(0);
    expect(datan2(1, 0)).toBe(Math.PI / 2);
    expect(datan2(-1, 0)).toBe(-Math.PI / 2);
    expect(datan2(0, -1)).toBe(Math.PI);
    expect(datan2(0, 1)).toBe(0);
  });

  it('matches Math.log, Math.exp and powers', () => {
    for (const x of [...samples(3000, 1e-9, 1), ...samples(2000, 1, 1e6), 2.328306436538696e-10, 1, 2, Math.E]) {
      expect(closeTo(dlog(x), Math.log(x), 4e-16), `log(${x})`).toBe(true);
    }
    expect(dlog(0)).toBe(-Infinity);
    expect(Number.isNaN(dlog(-1))).toBe(true);
    expect(closeTo(dlog(5e-324), Math.log(5e-324), 1e-15)).toBe(true);

    for (const x of [...samples(3000, -40, 40), 0, 1, -1]) {
      expect(closeTo(dexp(x), Math.exp(x), 4e-16), `exp(${x})`).toBe(true);
    }
    for (let i = 0; i < 3000; i++) {
      const b = rng.range(0, 6);
      const e = rng.range(0.1, 2);
      expect(closeTo(dpow(b, e), b ** e, 2e-15), `${b}^${e}`).toBe(true);
    }
    expect(dpow(0, 1.3)).toBe(0);
    expect(dpow(3, 2)).toBe(9);
    expect(dpow(2, 0.5)).toBe(Math.SQRT2);
    expect(dhypot(3, 4)).toBe(5);
  });
});
