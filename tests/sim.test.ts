import { describe, expect, it } from 'vitest';
import { BIO, WORLD } from '../src/sim/config';
import { Creature, dietClass } from '../src/sim/creature';
import { fingerprint } from '../src/sim/fingerprint';
import { GENE_RANGES, TRAIT_KEYS, hueDistance, mutate, wrapHue, type Genome } from '../src/sim/genome';
import { Rng, hashSeed } from '../src/sim/rng';
import { SpatialGrid } from '../src/sim/spatial';
import { World } from '../src/sim/world';

function makeCreature(genome: Partial<Genome>, x = 100, y = 100): Creature {
  const g: Genome = { speed: 2, size: 6, sense: 100, diet: 0.1, hue: 120, ...genome };
  return new Creature(1, g, x, y, 50, 0, null, 0, 3000, 0);
}

describe('Rng', () => {
  it('replays the same sequence for the same seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it('stays within [0, 1)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces standard normal samples', () => {
    const rng = new Rng(123);
    const n = 20000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = rng.gauss();
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.sqrt(sumSq / n - mean * mean)).toBeCloseTo(1, 1);
  });

  it('hashes seed strings stably', () => {
    expect(hashSeed('tidal-reef-418')).toBe(hashSeed('tidal-reef-418'));
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
  });
});

describe('genome', () => {
  it('keeps mutated traits inside their ranges', () => {
    const rng = new Rng(1);
    let g: Genome = { speed: 3.9, size: 13.9, sense: 239, diet: 0.99, hue: 355 };
    for (let i = 0; i < 2000; i++) {
      g = mutate(g, rng, 0.2);
      for (const key of TRAIT_KEYS) {
        expect(g[key]).toBeGreaterThanOrEqual(GENE_RANGES[key].min);
        expect(g[key]).toBeLessThanOrEqual(GENE_RANGES[key].max);
      }
      expect(g.hue).toBeGreaterThanOrEqual(0);
      expect(g.hue).toBeLessThan(360);
    }
  });

  it('does not change anything at zero mutation', () => {
    const g: Genome = { speed: 2, size: 5, sense: 80, diet: 0.3, hue: 200 };
    expect(mutate(g, new Rng(5), 0)).toEqual(g);
  });

  it('measures hue distance around the colour wheel', () => {
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
    expect(wrapHue(-30)).toBe(330);
    expect(wrapHue(725)).toBe(5);
  });
});

describe('Creature', () => {
  it('classifies diets', () => {
    expect(dietClass(0.1)).toBe('herbivore');
    expect(dietClass(0.5)).toBe('omnivore');
    expect(dietClass(0.9)).toBe('carnivore');
  });

  it('only lets big enough, meat-eating strangers hunt', () => {
    const prey = makeCreature({ size: 5, diet: 0.05, hue: 150 });
    expect(makeCreature({ size: 8, diet: 0.9, hue: 10 }).canEat(prey)).toBe(true);
    // Plant eaters never hunt.
    expect(makeCreature({ size: 8, diet: 0.1, hue: 10 }).canEat(prey)).toBe(false);
    // Too small.
    expect(makeCreature({ size: 4, diet: 0.9, hue: 10 }).canEat(prey)).toBe(false);
    // Kin: similar colour.
    expect(makeCreature({ size: 8, diet: 0.9, hue: 150 + BIO.kinHue - 1 }).canEat(prey)).toBe(false);
  });

  it('pays more to run fast and to be big', () => {
    const small = makeCreature({ size: 4 });
    const big = makeCreature({ size: 10 });
    small.velocity = 3;
    big.velocity = 3;
    expect(big.movementCost()).toBeGreaterThan(small.movementCost());
    expect(big.idleCost).toBeGreaterThan(small.idleCost);
    small.velocity = 1;
    const slow = small.movementCost();
    small.velocity = 3;
    expect(small.movementCost()).toBeGreaterThan(slow);
  });
});

describe('SpatialGrid', () => {
  it('finds every point inside the query radius', () => {
    const rng = new Rng(99);
    const points = Array.from({ length: 500 }, () => ({ x: rng.range(0, 1000), y: rng.range(0, 600) }));
    const grid = new SpatialGrid(1000, 600, 50);
    grid.rebuild(points);
    const out: number[] = [];
    for (let q = 0; q < 100; q++) {
      const x = rng.range(-50, 1050);
      const y = rng.range(-50, 650);
      const r = rng.range(5, 200);
      const n = grid.query(x, y, r, out);
      const found = new Set(out.slice(0, n));
      points.forEach((p, i) => {
        if (Math.hypot(p.x - x, p.y - y) <= r) expect(found.has(i)).toBe(true);
      });
    }
  });

  it('handles an empty rebuild', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.rebuild([]);
    expect(grid.query(50, 50, 30, [])).toBe(0);
  });
});

describe('World', () => {
  it('is deterministic for a given seed', () => {
    const a = new World('determinism');
    const b = new World('determinism');
    for (let i = 0; i < 1500; i++) {
      a.step();
      b.step();
    }
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('differs between seeds', () => {
    const a = new World('one');
    const b = new World('two');
    for (let i = 0; i < 200; i++) {
      a.step();
      b.step();
    }
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('keeps every creature valid and inside the world', () => {
    const world = new World('bounds');
    for (let i = 0; i < 3000; i++) world.step();
    expect(world.creatures.length).toBeGreaterThan(0);
    expect(world.creatures.length).toBeLessThanOrEqual(WORLD.maxCreatures);
    for (const c of world.creatures) {
      expect(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.energy)).toBe(true);
      expect(c.dead).toBe(false);
      expect(c.energy).toBeGreaterThan(0);
      expect(c.energy).toBeLessThanOrEqual(c.maxEnergy + 1e-9);
      expect(c.x).toBeGreaterThanOrEqual(c.radius);
      expect(c.x).toBeLessThanOrEqual(world.width - c.radius);
      expect(c.y).toBeGreaterThanOrEqual(c.radius);
      expect(c.y).toBeLessThanOrEqual(world.height - c.radius);
    }
    expect(world.plants.every((p) => !p.eaten)).toBe(true);
    expect(world.plants.length).toBeLessThanOrEqual(WORLD.maxPlants);
  });

  it('records history for the charts', () => {
    const world = new World('stats');
    for (let i = 0; i < WORLD.statsInterval * 10; i++) world.step();
    const { stats } = world;
    expect(stats.ticks.length).toBe(11); // initial sample + 10
    const total = stats.latestCount('herbivore') + stats.latestCount('omnivore') + stats.latestCount('carnivore');
    expect(total).toBe(world.creatures.length);
  });

  it('meteor wipes out everything in its radius', () => {
    const world = new World('meteor');
    const target = world.creatures[0];
    const victims = world.meteor(target.x, target.y, 120);
    expect(victims).toBeGreaterThan(0);
    expect(target.dead).toBe(true);
    expect(target.deathCause).toBe('meteor');
    for (const c of world.creatures) expect(Math.hypot(c.x - target.x, c.y - target.y)).toBeGreaterThan(120);
    expect(world.events.some((e) => e.kind === 'meteor')).toBe(true);
  });

  it('records a meteor extinction in the stats and the chronicle', () => {
    const world = new World('wipeout');
    world.meteor(world.width / 2, world.height / 2, 10_000);
    expect(world.creatures.length).toBe(0);
    expect(world.stats.latestCount('herbivore') + world.stats.latestCount('carnivore')).toBe(0);
    expect(world.events.at(-1)?.kind).toBe('collapse');
    // Stepping an empty world doesn't repeat the event or sample every tick.
    const samples = world.stats.ticks.length;
    for (let i = 0; i < 10; i++) world.step();
    expect(world.events.filter((e) => e.kind === 'collapse').length).toBe(1);
    expect(world.stats.ticks.length).toBe(samples);
  });

  it('records a natural extinction on the tick it happens', () => {
    const world = new World('last-breath');
    for (let i = 0; i < 7; i++) world.step(); // off the regular sampling schedule
    for (const c of world.creatures) c.age = c.lifespan; // everyone dies of old age this tick
    world.step();
    expect(world.creatures.length).toBe(0);
    expect(world.stats.ticks.at(-1)).toBe(world.tick);
    expect(world.stats.latestCount('herbivore')).toBe(0);
    expect(world.events.at(-1)?.kind).toBe('collapse');
  });

  it('never grows past the population cap', () => {
    const world = new World('crowded');
    const template = world.creatures[0];
    world.creatures = Array.from({ length: WORLD.maxCreatures }, (_, i) => {
      const c = new Creature(10_000 + i, template.genome, 100 + (i % 40) * 40, 100 + Math.floor(i / 40) * 30, 1e9, 1, null, 0, 5000, 0);
      c.age = 1000; // mature, and energy is full: everyone wants to reproduce
      return c;
    });
    world.step();
    expect(world.creatures.length).toBeLessThanOrEqual(WORLD.maxCreatures);
    expect(world.totalBirths).toBe(0);
  });

  it('samples hue history every fifth stats sample', () => {
    const world = new World('hue-cadence');
    for (let i = 0; i < WORLD.statsInterval * 10; i++) world.step();
    expect(world.stats.ticks.length).toBe(11);
    expect(world.stats.hueTicks).toEqual([0, 5, 10].map((k) => world.stats.ticks[k]));
    expect(world.stats.hue.herbivore.length).toBe(3);
  });

  it('grows the exact same world in every JavaScript engine (golden fingerprint)', () => {
    // If you change the simulation on purpose, update this value
    // (npx tsx scripts/fingerprint.ts jade-grove-555 3000). CI also checks V8 against Bun.
    const world = new World('jade-grove-555');
    for (let i = 0; i < 3000; i++) world.step();
    expect(fingerprint(world)).toBe('16368207c353353d');
  });

  it('caps hand-placed food', () => {
    const world = new World('food');
    for (let i = 0; i < 100; i++) world.sprinkleFood(1200, 750, 300, 200);
    expect(world.plants.length).toBeLessThanOrEqual(WORLD.maxPlants * WORLD.godPlantHeadroom);
  });

  it('reports seasons across a year', () => {
    const world = new World('seasons');
    const seen = new Set<string>();
    for (let t = 0; t < WORLD.seasonLength; t += WORLD.seasonLength / 8) {
      world.tick = t;
      seen.add(world.season);
    }
    expect(seen).toEqual(new Set(['spring', 'summer', 'autumn', 'winter']));
    world.settings.seasons = false;
    expect(world.seasonFactor).toBe(1);
  });
});
