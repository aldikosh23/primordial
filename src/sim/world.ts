import { BIO, DEFAULT_SETTINGS, WORLD, type SimSettings } from './config';
import { Creature, DIET_LABEL, massOf, type DeathCause, type DietClass } from './creature';
import { datan2, dcos, dhypot, dpow, dsin } from './dmath';
import {
  CARNIVORE_TEMPLATE,
  HERBIVORE_TEMPLATE,
  founderGenome,
  mutate,
  type Genome,
} from './genome';
import { Rng, hashSeed } from './rng';
import { SpatialGrid } from './spatial';
import { DIET_CLASSES, Stats } from './stats';

export interface Plant {
  x: number;
  y: number;
  eaten: boolean;
}

/** A drifting blob of fertile ground where most plants sprout. */
export interface Patch {
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
}

export type SimEventKind = 'extinct' | 'emerged' | 'generation' | 'meteor' | 'collapse';

export interface SimEvent {
  tick: number;
  kind: SimEventKind;
  text: string;
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** In-game year of a tick, starting at 1. */
export function yearOf(tick: number): number {
  return Math.floor(tick / WORLD.seasonLength) + 1;
}

/** 0..1 position of a tick within its year. */
export function yearPhaseOf(tick: number): number {
  return (tick % WORLD.seasonLength) / WORLD.seasonLength;
}

export function seasonOf(tick: number): Season {
  return SEASONS[Math.floor(yearPhaseOf(tick) * 4) % 4];
}
/** A class counts as "present" again once it reaches this many members. */
const EMERGENCE_THRESHOLD = 3;
const GENERATION_MILESTONE = 25;
/** The creature grid holds start-of-tick positions; pad queries for movement since. */
const STALE_PAD = 8;
const WALL_MARGIN = 50;

function wrapAngle(a: number): number {
  return a > Math.PI ? a - Math.PI * 2 : a < -Math.PI ? a + Math.PI * 2 : a;
}

export class World {
  readonly width = WORLD.width;
  readonly height = WORLD.height;
  readonly seed: string;
  readonly settings: SimSettings;
  readonly rng: Rng;
  readonly stats: Stats;

  tick = 0;
  creatures: Creature[] = [];
  plants: Plant[] = [];
  patches: Patch[] = [];
  events: SimEvent[] = [];

  maxGeneration = 0;
  totalBirths = 0;
  totalDeaths = 0;

  private nextId = 1;
  private births: Creature[] = [];
  private readonly creatureGrid: SpatialGrid;
  private readonly plantGrid: SpatialGrid;
  private readonly buffer: number[] = [];
  private readonly present: Record<DietClass, boolean> = { herbivore: false, omnivore: false, carnivore: false };
  private nextGenerationMilestone = GENERATION_MILESTONE;
  private collapsed = false;
  /** Called for every death, e.g. to draw an effect. */
  onDeath: ((c: Creature) => void) | null = null;
  onBirth: ((c: Creature) => void) | null = null;

  constructor(seed: string, settings: Partial<SimSettings> = {}) {
    this.seed = seed;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.rng = new Rng(hashSeed(seed));
    this.stats = new Stats(WORLD.historyLength);
    this.creatureGrid = new SpatialGrid(this.width, this.height, 80);
    this.plantGrid = new SpatialGrid(this.width, this.height, 80);
    this.populate();
  }

  // ---------------------------------------------------------------- setup

  private populate(): void {
    const { rng } = this;
    for (let i = 0; i < WORLD.patchCount; i++) {
      const angle = rng.range(0, Math.PI * 2);
      const speed = rng.range(0.03, 0.08);
      this.patches.push({
        x: rng.range(this.width * 0.15, this.width * 0.85),
        y: rng.range(this.height * 0.15, this.height * 0.85),
        radius: rng.range(140, 260),
        vx: dcos(angle) * speed,
        vy: dsin(angle) * speed,
      });
    }
    for (let i = 0; i < WORLD.initialPlants; i++) this.growPlant();

    for (let i = 0; i < WORLD.initialHerbivores; i++) {
      const home = this.patches[i % this.patches.length];
      this.spawnFounder(HERBIVORE_TEMPLATE, home.x + rng.gauss() * home.radius, home.y + rng.gauss() * home.radius);
    }
    for (let i = 0; i < WORLD.initialCarnivores; i++) {
      this.spawnFounder(CARNIVORE_TEMPLATE, rng.range(0, this.width), rng.range(0, this.height));
    }
    this.recordStats();
  }

  private spawnFounder(template: Genome, x: number, y: number): void {
    const genome = founderGenome(this.rng, template);
    const c = this.makeCreature(genome, x, y, 0, 0, null);
    c.energy = c.maxEnergy * this.rng.range(0.45, 0.7);
    // Founders start at staggered ages so they don't all die of old age at once.
    c.age = Math.floor(this.rng.range(0, BIO.maturityAge * 2));
    this.creatures.push(c);
  }

  private makeCreature(
    genome: Genome,
    x: number,
    y: number,
    energy: number,
    generation: number,
    parentId: number | null,
  ): Creature {
    const lifespan =
      BIO.lifespan *
      dpow(massOf(genome.size), BIO.lifespanMassExponent) *
      (1 + this.rng.range(-BIO.lifespanJitter, BIO.lifespanJitter));
    return new Creature(
      this.nextId++,
      genome,
      this.clampX(x, genome.size),
      this.clampY(y, genome.size),
      energy,
      generation,
      parentId,
      this.tick,
      Math.round(lifespan),
      this.rng.range(-Math.PI, Math.PI),
    );
  }

  private clampX(x: number, r: number): number {
    return Math.min(this.width - r, Math.max(r, x));
  }

  private clampY(y: number, r: number): number {
    return Math.min(this.height - r, Math.max(r, y));
  }

  // ---------------------------------------------------------------- seasons

  get year(): number {
    return yearOf(this.tick);
  }

  get season(): Season {
    return seasonOf(this.tick);
  }

  /** Plant growth multiplier from the season: peaks mid-summer, bottoms out mid-winter. */
  get seasonFactor(): number {
    if (!this.settings.seasons) return 1;
    return 1 + WORLD.seasonAmplitude * dsin(2 * Math.PI * (yearPhaseOf(this.tick) - 0.125));
  }

  // ---------------------------------------------------------------- plants

  private growPlant(): void {
    const { rng } = this;
    let x: number;
    let y: number;
    if (rng.chance(WORLD.patchShare)) {
      const p = this.patches[Math.floor(rng.next() * this.patches.length)];
      x = p.x + rng.gauss() * p.radius * 0.6;
      y = p.y + rng.gauss() * p.radius * 0.6;
    } else {
      x = rng.range(0, this.width);
      y = rng.range(0, this.height);
    }
    if (x < 0 || y < 0 || x > this.width || y > this.height) return;
    this.plants.push({ x, y, eaten: false });
  }

  private updatePatches(): void {
    for (const p of this.patches) {
      // Slow random walk that bounces off the world's edges.
      p.vx += this.rng.gauss() * 0.004;
      p.vy += this.rng.gauss() * 0.004;
      const speed = dhypot(p.vx, p.vy);
      if (speed > 0.1) {
        p.vx *= 0.1 / speed;
        p.vy *= 0.1 / speed;
      }
      p.x += p.vx;
      p.y += p.vy;
      // Always point back inwards at an edge, so a patch can't get stuck oscillating there.
      const margin = p.radius * 0.5;
      if (p.x < margin) p.vx = Math.abs(p.vx);
      else if (p.x > this.width - margin) p.vx = -Math.abs(p.vx);
      if (p.y < margin) p.vy = Math.abs(p.vy);
      else if (p.y > this.height - margin) p.vy = -Math.abs(p.vy);
    }
  }

  private spawnPlants(): void {
    if (this.plants.length >= WORLD.maxPlants) return;
    const expected = WORLD.plantSpawnRate * this.settings.foodRate * this.seasonFactor;
    let count = Math.floor(expected);
    if (this.rng.chance(expected - count)) count++;
    count = Math.min(count, WORLD.maxPlants - this.plants.length);
    for (let i = 0; i < count; i++) this.growPlant();
  }

  // ---------------------------------------------------------------- main loop

  step(): void {
    this.tick++;
    this.updatePatches();
    this.spawnPlants();
    this.creatureGrid.rebuild(this.creatures);
    this.plantGrid.rebuild(this.plants);
    this.updateCover();

    const list = this.creatures;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.dead) this.updateCreature(c);
    }

    this.creatures = list.filter((c) => !c.dead);
    if (this.births.length > 0) {
      for (const b of this.births) this.creatures.push(b);
      this.births = [];
    }
    this.plants = this.plants.filter((p) => !p.eaten);

    // Sample on schedule, and once more the moment the last creature dies.
    if (this.tick % WORLD.statsInterval === 0 || (this.creatures.length === 0 && !this.collapsed)) {
      this.recordStats();
    }
  }

  /** Who is currently hidden in a fertile patch. */
  private updateCover(): void {
    const patches = this.patches;
    for (const c of this.creatures) {
      c.visibility = 1;
      for (let i = 0; i < patches.length; i++) {
        const p = patches[i];
        const dx = c.x - p.x;
        const dy = c.y - p.y;
        const r = p.radius * BIO.coverShare;
        if (dx * dx + dy * dy < r * r) {
          c.visibility = c.coverVisibility;
          break;
        }
      }
    }
  }

  private updateCreature(c: Creature): void {
    if (c.feeding > 0) {
      // Busy eating: stands still and can't react, which is when hunters strike.
      c.feeding--;
      c.behaviour = 'feed';
      c.velocity *= 0.5;
    } else {
      this.steer(c);
      this.eat(c);
    }
    if (!c.dead) this.metabolise(c);
  }

  /** Perceive the neighbourhood, pick a goal and move towards (or away from) it. */
  private steer(c: Creature): void {
    const g = c.genome;
    const buf = this.buffer;
    const senseSq = g.sense * g.sense;
    const fleeSq = senseSq * BIO.fleeDistance * BIO.fleeDistance;

    let fleeX = 0;
    let fleeY = 0;
    let threatened = false;
    let bestScore = 0;
    let preyTarget: Creature | null = null;
    let plantTarget: Plant | null = null;

    const n = this.creatureGrid.query(c.x, c.y, g.sense, buf);
    for (let k = 0; k < n; k++) {
      const o = this.creatures[buf[k]];
      if (o === c || o.dead) continue;
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      const dSq = dx * dx + dy * dy;
      // Hidden creatures are only spotted up close.
      if (dSq > senseSq * o.visibility * o.visibility) continue;
      if (o.canEat(c)) {
        // Prey only bolts once a threat is within its flight distance.
        if (dSq > fleeSq) continue;
        // Away-vector weighted by 1/d: closer threats push harder.
        const d = Math.sqrt(dSq) + 1e-6;
        fleeX -= dx / (d * d);
        fleeY -= dy / (d * d);
        threatened = true;
      } else if (!threatened && c.canEat(o)) {
        const d = Math.sqrt(dSq);
        const catchable = o.feeding > 0 || o.genome.speed < g.speed ? 1 : 0.4;
        const score = (c.meatValue(o) / (d + 20)) * catchable;
        if (score > bestScore) {
          bestScore = score;
          preyTarget = o;
        }
      }
    }

    if (!threatened && c.plantEfficiency >= BIO.minPlantEfficiency) {
      const plantValue = WORLD.plantEnergy * c.plantEfficiency;
      const m = this.plantGrid.query(c.x, c.y, g.sense, buf);
      for (let k = 0; k < m; k++) {
        const p = this.plants[buf[k]];
        if (p.eaten) continue;
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const dSq = dx * dx + dy * dy;
        if (dSq > senseSq) continue;
        const score = plantValue / (Math.sqrt(dSq) + 20);
        if (score > bestScore) {
          bestScore = score;
          plantTarget = p;
          preyTarget = null;
        }
      }
    }

    let dirX: number;
    let dirY: number;
    let topSpeedShare: number;
    if (threatened) {
      c.behaviour = 'flee';
      dirX = fleeX;
      dirY = fleeY;
      topSpeedShare = 1;
    } else if (preyTarget) {
      c.behaviour = 'hunt';
      c.targetX = preyTarget.x;
      c.targetY = preyTarget.y;
      dirX = preyTarget.x - c.x;
      dirY = preyTarget.y - c.y;
      // Close in, then pounce: a short, expensive burst of extra speed.
      const pounceRange = c.radius + preyTarget.radius + BIO.pounceRange;
      topSpeedShare = dirX * dirX + dirY * dirY < pounceRange * pounceRange ? BIO.pounceBoost : 1;
    } else if (plantTarget) {
      c.behaviour = 'forage';
      c.targetX = plantTarget.x;
      c.targetY = plantTarget.y;
      dirX = plantTarget.x - c.x;
      dirY = plantTarget.y - c.y;
      topSpeedShare = 0.8;
    } else {
      c.behaviour = 'wander';
      c.wanderTurn = c.wanderTurn * 0.9 + this.rng.gauss() * 0.03;
      dirX = dcos(c.heading + c.wanderTurn);
      dirY = dsin(c.heading + c.wanderTurn);
      topSpeedShare = 0.4;
    }

    // Walls push creatures back towards the middle.
    const len = dhypot(dirX, dirY) || 1;
    dirX /= len;
    dirY /= len;
    if (c.x < WALL_MARGIN) dirX += (WALL_MARGIN - c.x) / WALL_MARGIN;
    else if (c.x > this.width - WALL_MARGIN) dirX -= (c.x - (this.width - WALL_MARGIN)) / WALL_MARGIN;
    if (c.y < WALL_MARGIN) dirY += (WALL_MARGIN - c.y) / WALL_MARGIN;
    else if (c.y > this.height - WALL_MARGIN) dirY -= (c.y - (this.height - WALL_MARGIN)) / WALL_MARGIN;

    let turn = datan2(dirY, dirX) - c.heading;
    if (turn > Math.PI) turn -= Math.PI * 2;
    else if (turn < -Math.PI) turn += Math.PI * 2;
    if (turn > c.turnRate) turn = c.turnRate;
    else if (turn < -c.turnRate) turn = -c.turnRate;
    c.heading = wrapAngle(c.heading + turn);

    c.velocity += (g.speed * topSpeedShare - c.velocity) * 0.25;
    c.x += dcos(c.heading) * c.velocity;
    c.y += dsin(c.heading) * c.velocity;
    const r = c.radius;
    if (c.x < r || c.x > this.width - r) {
      c.x = this.clampX(c.x, r);
      c.heading = wrapAngle(Math.PI - c.heading);
    }
    if (c.y < r || c.y > this.height - r) {
      c.y = this.clampY(c.y, r);
      c.heading = -c.heading;
    }
  }

  /** Eat the first thing within reach: a kill beats a plant. Eating starts a feeding pause. */
  private eat(c: Creature): void {
    const buf = this.buffer;
    const r = c.radius;
    if (c.canHunt) {
      const m = this.creatureGrid.query(c.x, c.y, r * 2 + STALE_PAD, buf);
      for (let k = 0; k < m; k++) {
        const o = this.creatures[buf[k]];
        if (o === c || o.dead || !c.canEat(o)) continue;
        const reach = r + o.radius;
        const dx = o.x - c.x;
        const dy = o.y - c.y;
        if (dx * dx + dy * dy <= reach * reach) {
          c.gain(c.meatValue(o));
          c.kills++;
          c.feeding = BIO.meatHandling;
          this.kill(o, 'eaten', c.id);
          return;
        }
      }
    }
    if (c.plantEfficiency >= BIO.minPlantEfficiency) {
      const reach = r + WORLD.plantRadius;
      const reachSq = reach * reach;
      // Plants never move, so their grid is exact: no padding needed.
      const m = this.plantGrid.query(c.x, c.y, reach, buf);
      for (let k = 0; k < m; k++) {
        const p = this.plants[buf[k]];
        if (p.eaten) continue;
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        if (dx * dx + dy * dy <= reachSq) {
          p.eaten = true;
          c.plantsEaten++;
          c.gain(WORLD.plantEnergy * c.plantEfficiency);
          c.feeding = BIO.plantHandling;
          return;
        }
      }
    }
  }

  /** Pay the energy bill, age, and maybe die or reproduce. */
  private metabolise(c: Creature): void {
    c.energy -= c.idleCost + c.movementCost();
    c.age++;
    if (c.energy <= 0) {
      this.kill(c, 'starved', null);
      return;
    }
    if (c.age >= c.lifespan) {
      this.kill(c, 'old age', null);
      return;
    }
    if (
      c.age >= c.maturityAge &&
      c.energy >= c.maxEnergy * BIO.reproduceAt &&
      this.creatures.length + this.births.length < WORLD.maxCreatures
    ) {
      this.reproduce(c);
    }
  }

  private reproduce(parent: Creature): void {
    const gift = parent.maxEnergy * BIO.childShare;
    parent.energy -= gift;
    parent.children++;
    const genome = mutate(parent.genome, this.rng, this.settings.mutationRate);
    const angle = this.rng.range(-Math.PI, Math.PI);
    const offset = parent.radius + genome.size;
    const child = this.makeCreature(
      genome,
      parent.x + dcos(angle) * offset,
      parent.y + dsin(angle) * offset,
      gift * BIO.birthEfficiency,
      parent.generation + 1,
      parent.id,
    );
    this.births.push(child);
    this.totalBirths++;
    if (child.generation > this.maxGeneration) this.maxGeneration = child.generation;
    this.onBirth?.(child);
  }

  private kill(c: Creature, cause: DeathCause, killerId: number | null): void {
    c.dead = true;
    c.deathCause = cause;
    c.killedBy = killerId;
    c.diedAtTick = this.tick;
    this.totalDeaths++;
    this.onDeath?.(c);
  }

  // ---------------------------------------------------------------- stats & events

  private recordStats(): void {
    const counts = this.stats.record(this.tick, this.creatures, this.plants.length);

    for (const cls of DIET_CLASSES) {
      const count = counts[cls];
      if (this.present[cls] && count === 0) {
        this.present[cls] = false;
        if (this.creatures.length > 0) this.pushEvent('extinct', `${DIET_LABEL[cls]} went extinct`);
      } else if (!this.present[cls] && count >= EMERGENCE_THRESHOLD) {
        this.present[cls] = true;
        if (this.tick > 0) this.pushEvent('emerged', `${DIET_LABEL[cls]} ${cls === 'omnivore' ? 'evolved' : 'are back'}`);
      }
    }

    while (this.maxGeneration >= this.nextGenerationMilestone) {
      this.pushEvent('generation', `Generation ${this.nextGenerationMilestone} was born`);
      this.nextGenerationMilestone += GENERATION_MILESTONE;
    }

    if (this.creatures.length === 0 && !this.collapsed) {
      this.collapsed = true;
      this.pushEvent('collapse', 'All life has ended');
    } else if (this.creatures.length > 0) {
      this.collapsed = false;
    }
  }

  private pushEvent(kind: SimEventKind, text: string): void {
    this.events.push({ tick: this.tick, kind, text });
    if (this.events.length > WORLD.maxEvents) this.events.shift();
  }

  // ---------------------------------------------------------------- god tools

  /** Scatter food around a point. */
  sprinkleFood(x: number, y: number, radius: number, count: number): void {
    const cap = WORLD.maxPlants * WORLD.godPlantHeadroom;
    for (let i = 0; i < count && this.plants.length < cap; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * radius;
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d;
      if (px < 0 || py < 0 || px > this.width || py > this.height) continue;
      this.plants.push({ x: px, y: py, eaten: false });
    }
  }

  /** Wipe out everything in a radius. Returns how many creatures died. */
  meteor(x: number, y: number, radius: number): number {
    const rSq = radius * radius;
    let victims = 0;
    for (const c of this.creatures) {
      if (c.dead) continue;
      const dx = c.x - x;
      const dy = c.y - y;
      if (dx * dx + dy * dy <= rSq) {
        this.kill(c, 'meteor', null);
        victims++;
      }
    }
    for (const p of this.plants) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy <= rSq) p.eaten = true;
    }
    this.creatures = this.creatures.filter((c) => !c.dead);
    this.plants = this.plants.filter((p) => !p.eaten);
    this.pushEvent('meteor', victims === 1 ? 'Meteor strike: 1 creature perished' : `Meteor strike: ${victims} creatures perished`);
    // Update the charts right away (and catch extinctions the strike caused).
    this.recordStats();
    return victims;
  }

  /** Closest living creature to a point, within `maxDist`. */
  creatureAt(x: number, y: number, maxDist: number): Creature | null {
    let best: Creature | null = null;
    let bestD = maxDist;
    for (const c of this.creatures) {
      const d = dhypot(c.x - x, c.y - y) - c.radius;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }
}
