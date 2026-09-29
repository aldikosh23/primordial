import { BIO } from './config';
import { dpow } from './dmath';
import { hueDistance, type Genome } from './genome';

export type DietClass = 'herbivore' | 'omnivore' | 'carnivore';
export type Behaviour = 'wander' | 'forage' | 'hunt' | 'flee' | 'feed';
export type DeathCause = 'starved' | 'old age' | 'eaten' | 'meteor';

export const DIET_LABEL: Record<DietClass, string> = {
  herbivore: 'Herbivores',
  omnivore: 'Omnivores',
  carnivore: 'Carnivores',
};

/** Body mass from radius: 1 at size 6, growing with area. */
export function massOf(size: number): number {
  const s = size / 6;
  return s * s;
}

export function dietClass(diet: number): DietClass {
  if (diet >= BIO.carnivoreDiet) return 'carnivore';
  if (diet >= BIO.huntDiet) return 'omnivore';
  return 'herbivore';
}

export class Creature {
  // Derived from the genome once at birth.
  readonly radius: number;
  readonly mass: number;
  readonly maxEnergy: number;
  readonly plantEfficiency: number;
  readonly meatEfficiency: number;
  readonly canHunt: boolean;
  readonly turnRate: number;
  /** Mass^moveMassExponent: bigger bodies move more efficiently per kilo. */
  private readonly moveMass: number;
  /** Fixed per-tick cost of being alive and seeing. */
  readonly idleCost: number;
  readonly dietClass: DietClass;
  readonly maturityAge: number;
  /** How visible this creature is while inside cover (1 = fully visible). */
  readonly coverVisibility: number;

  heading: number;
  velocity = 0;
  /** Smoothly varying turn used while wandering. */
  wanderTurn = 0;
  age = 0;
  /** Current visibility multiplier: coverVisibility inside a patch, 1 in the open. */
  visibility = 1;
  /** Ticks left of standing still while eating. */
  feeding = 0;
  behaviour: Behaviour = 'wander';
  targetX = 0;
  targetY = 0;

  children = 0;
  kills = 0;
  plantsEaten = 0;

  dead = false;
  deathCause: DeathCause | null = null;
  diedAtTick = 0;
  killedBy: number | null = null;

  constructor(
    readonly id: number,
    readonly genome: Genome,
    public x: number,
    public y: number,
    public energy: number,
    readonly generation: number,
    readonly parentId: number | null,
    readonly bornAtTick: number,
    readonly lifespan: number,
    heading: number,
  ) {
    this.heading = heading;
    this.radius = genome.size;
    this.mass = massOf(genome.size);
    this.maxEnergy = BIO.energyPerMass * this.mass;
    this.plantEfficiency = dpow(1 - genome.diet, BIO.dietCurve);
    this.meatEfficiency = dpow(genome.diet, BIO.dietCurve);
    this.canHunt = genome.diet >= BIO.huntDiet;
    // mass^0.25 and mass^0.75 via square roots, which are exact in every engine.
    const quarter = Math.sqrt(Math.sqrt(this.mass));
    this.turnRate = BIO.baseTurnRate / quarter;
    this.moveMass = dpow(this.mass, BIO.moveMassExponent);
    const halfSpeed = genome.speed / 2;
    this.idleCost =
      BIO.basalCost * quarter * quarter * quarter +
      BIO.muscleCost * this.moveMass * halfSpeed * halfSpeed +
      BIO.senseCost * (genome.sense / 100);
    this.dietClass = dietClass(genome.diet);
    this.maturityAge = BIO.maturityAge * dpow(this.mass, BIO.maturityMassExponent);
    this.coverVisibility = Math.min(1, Math.max(BIO.minVisibility, genome.size / BIO.coverSize));
    this.energy = Math.min(energy, this.maxEnergy);
  }

  get energyFraction(): number {
    return this.energy / this.maxEnergy;
  }

  movementCost(): number {
    const v = this.velocity / 2;
    return BIO.moveCost * this.moveMass * v * v;
  }

  /** Can this creature kill and eat `prey`? */
  canEat(prey: Creature): boolean {
    return (
      this.canHunt &&
      this.radius >= prey.radius * BIO.preySizeRatio &&
      hueDistance(this.genome.hue, prey.genome.hue) > BIO.kinHue
    );
  }

  /** Energy this creature would gain from eating `prey`. */
  meatValue(prey: Creature): number {
    return (BIO.meatPerMass * prey.mass + BIO.meatFromEnergy * Math.max(0, prey.energy)) * this.meatEfficiency;
  }

  gain(amount: number): void {
    this.energy = Math.min(this.maxEnergy, this.energy + amount);
  }
}
