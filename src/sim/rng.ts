import { dcos, dlog, dsin } from './dmath';

/**
 * Seeded pseudo-random generator (mulberry32). The whole simulation draws from
 * one instance, so the same seed always replays the same world.
 */
export class Rng {
  private state: number;
  private spareGauss: number | null = null;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal sample (Box–Muller, caching the second value). */
  gauss(): number {
    if (this.spareGauss !== null) {
      const v = this.spareGauss;
      this.spareGauss = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const mag = Math.sqrt(-2 * dlog(u));
    this.spareGauss = mag * dsin(2 * Math.PI * v);
    return mag * dcos(2 * Math.PI * v);
  }
}

/** FNV-1a hash: turns any seed string into a 32-bit integer. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const SEED_WORDS_A = [
  'amber', 'azure', 'coral', 'crimson', 'dusky', 'ember', 'feral', 'frost', 'golden', 'hollow',
  'ivory', 'jade', 'lunar', 'misty', 'nova', 'ochre', 'primal', 'quiet', 'rust', 'solar',
  'tidal', 'umber', 'velvet', 'wild',
];
const SEED_WORDS_B = [
  'reef', 'marsh', 'delta', 'lagoon', 'basin', 'tundra', 'grove', 'shoal', 'mire', 'fjord',
  'steppe', 'atoll', 'canyon', 'bayou', 'dune', 'glade', 'estuary', 'crater', 'pond', 'vent',
];

/** Human-friendly random seed like "tidal-reef-418" (UI only, not part of the sim). */
export function randomSeedString(): string {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
  const n = Math.floor(Math.random() * 900) + 100;
  return `${pick(SEED_WORDS_A)}-${pick(SEED_WORDS_B)}-${n}`;
}
