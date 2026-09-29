import type { Rng } from './rng';

export interface Genome {
  /** Top speed, world units per tick. */
  speed: number;
  /** Body radius. */
  size: number;
  /** Vision radius. */
  sense: number;
  /** 0 = eats only plants, 1 = eats only meat. */
  diet: number;
  /** Colour in degrees. Drifts over generations and doubles as a species marker. */
  hue: number;
}

export type TraitKey = 'speed' | 'size' | 'sense' | 'diet';

export const TRAIT_KEYS: readonly TraitKey[] = ['speed', 'size', 'sense', 'diet'];

export const GENE_RANGES: Record<TraitKey, { min: number; max: number }> = {
  speed: { min: 0.5, max: 4 },
  size: { min: 3, max: 14 },
  sense: { min: 20, max: 240 },
  diet: { min: 0, max: 1 },
};

/** Hue drift per generation relative to mutationRate (degrees). */
const HUE_MUTATION_SCALE = 60;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function wrapHue(h: number): number {
  return ((h % 360) + 360) % 360;
}

/** Shortest distance between two hues, 0..180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(wrapHue(a) - wrapHue(b));
  return d > 180 ? 360 - d : d;
}

export function mutate(parent: Genome, rng: Rng, rate: number): Genome {
  const child = { ...parent };
  for (const key of TRAIT_KEYS) {
    const { min, max } = GENE_RANGES[key];
    child[key] = clamp(parent[key] + rng.gauss() * rate * (max - min), min, max);
  }
  child.hue = wrapHue(parent.hue + rng.gauss() * rate * HUE_MUTATION_SCALE);
  return child;
}

/** A founder genome: a species template plus a little individual variety. */
export function founderGenome(rng: Rng, template: Genome, spread = 0.04): Genome {
  return mutate(template, rng, spread);
}

export const HERBIVORE_TEMPLATE: Genome = { speed: 1.8, size: 5.5, sense: 90, diet: 0.08, hue: 150 };
export const CARNIVORE_TEMPLATE: Genome = { speed: 2.0, size: 8.5, sense: 110, diet: 0.85, hue: 8 };
