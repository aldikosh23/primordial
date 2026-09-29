import type { Creature, DietClass } from './creature';
import { datan2, dcos, dsin } from './dmath';

export const DIET_CLASSES: readonly DietClass[] = ['herbivore', 'omnivore', 'carnivore'];

export type ChartTrait = 'speed' | 'size' | 'sense';
export const CHART_TRAITS: readonly ChartTrait[] = ['speed', 'size', 'sense'];

export type ClassSeries = Record<DietClass, number[]>;

/** Hue history keeps one sample in this many. */
const HUE_SAMPLE_EVERY = 5;

function emptySeries(): ClassSeries {
  return { herbivore: [], omnivore: [], carnivore: [] };
}

/** Rolling history of the population, sampled every few ticks, for the charts. */
export class Stats {
  readonly ticks: number[] = [];
  readonly population: ClassSeries = emptySeries();
  readonly plants: number[] = [];
  /** Mean trait per diet class; NaN while a class has no members. */
  readonly traits: Record<ChartTrait, ClassSeries> = {
    speed: emptySeries(),
    size: emptySeries(),
    sense: emptySeries(),
  };
  /**
   * Circular mean hue per diet class (degrees; NaN while a class has no members).
   * Sampled less often than the rest so it covers many years of colour drift.
   */
  readonly hue: ClassSeries = emptySeries();
  readonly hueTicks: number[] = [];
  private samples = 0;
  /** Bumped on every sample so views know when to redraw. */
  version = 0;

  constructor(readonly capacity: number) {}

  record(tick: number, creatures: readonly Creature[], plantCount: number): Record<DietClass, number> {
    const counts: Record<DietClass, number> = { herbivore: 0, omnivore: 0, carnivore: 0 };
    const sums: Record<ChartTrait, Record<DietClass, number>> = {
      speed: { herbivore: 0, omnivore: 0, carnivore: 0 },
      size: { herbivore: 0, omnivore: 0, carnivore: 0 },
      sense: { herbivore: 0, omnivore: 0, carnivore: 0 },
    };
    const hueX: Record<DietClass, number> = { herbivore: 0, omnivore: 0, carnivore: 0 };
    const hueY: Record<DietClass, number> = { herbivore: 0, omnivore: 0, carnivore: 0 };
    for (const c of creatures) {
      if (c.dead) continue;
      const cls = c.dietClass;
      counts[cls]++;
      for (const t of CHART_TRAITS) sums[t][cls] += c.genome[t];
      const a = (c.genome.hue * Math.PI) / 180;
      hueX[cls] += dcos(a);
      hueY[cls] += dsin(a);
    }

    this.ticks.push(tick);
    this.plants.push(plantCount);
    const sampleHue = this.samples++ % HUE_SAMPLE_EVERY === 0;
    if (sampleHue) this.hueTicks.push(tick);
    for (const cls of DIET_CLASSES) {
      this.population[cls].push(counts[cls]);
      if (sampleHue) {
        this.hue[cls].push(
          counts[cls] > 0 ? ((datan2(hueY[cls], hueX[cls]) * 180) / Math.PI + 360) % 360 : NaN,
        );
      }
      for (const t of CHART_TRAITS) {
        this.traits[t][cls].push(counts[cls] > 0 ? sums[t][cls] / counts[cls] : NaN);
      }
    }

    if (this.ticks.length > this.capacity) {
      this.ticks.shift();
      this.plants.shift();
      for (const cls of DIET_CLASSES) {
        this.population[cls].shift();
        for (const t of CHART_TRAITS) this.traits[t][cls].shift();
      }
    }
    if (this.hueTicks.length > this.capacity) {
      this.hueTicks.shift();
      for (const cls of DIET_CLASSES) this.hue[cls].shift();
    }
    this.version++;
    return counts;
  }

  latestCount(cls: DietClass): number {
    const s = this.population[cls];
    return s.length ? s[s.length - 1] : 0;
  }
}
