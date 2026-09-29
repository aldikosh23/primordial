/** Knobs the viewer can change while the world is running. */
export interface SimSettings {
  /** Multiplier on plant growth. */
  foodRate: number;
  /** Mutation strength: std-dev of a gene change, as a fraction of the gene's range. */
  mutationRate: number;
  /** Plant growth rises and falls over a yearly cycle. */
  seasons: boolean;
}

export const DEFAULT_SETTINGS: SimSettings = {
  foodRate: 1,
  mutationRate: 0.05,
  seasons: true,
};

export const WORLD = {
  width: 1800,
  height: 1260,
  maxCreatures: 1260,
  maxPlants: 1650,
  /** Hand-placed food may overshoot the natural cap by this factor. */
  godPlantHeadroom: 1.5,
  initialPlants: 760,
  initialHerbivores: 60,
  initialCarnivores: 6,
  /** Plants per tick at foodRate 1. */
  plantSpawnRate: 3.8,
  /** Share of new plants that grow inside fertile patches. */
  patchShare: 0.75,
  patchCount: 5,
  plantRadius: 2.5,
  plantEnergy: 10,
  /** Ticks per in-game year. */
  seasonLength: 6000,
  seasonAmplitude: 0.45,
  statsInterval: 30,
  historyLength: 400,
  maxEvents: 40,
} as const;

/** Biology: how genes turn into costs, abilities and offspring. */
export const BIO = {
  /** Resting energy burn per tick, scaled by mass^0.75. */
  basalCost: 0.025,
  /** Movement burn per tick: moveCost * mass^moveMassExponent * (velocity / 2)^2. */
  moveCost: 0.06,
  /** Upkeep of a fast body even at rest: muscleCost * mass^moveMassExponent * (top speed / 2)^2. */
  muscleCost: 0.015,
  /** Below 1, big bodies pay less per unit of mass to move (as in real animals). */
  moveMassExponent: 0.7,
  /** Vision burn per tick per 100 units of sense radius. */
  senseCost: 0.015,
  energyPerMass: 120,
  /** Reproduce once energy reaches this fraction of max. */
  reproduceAt: 0.8,
  /** Fraction of max energy handed to a child... */
  childShare: 0.45,
  /** ...of which this fraction survives the birth. */
  birthEfficiency: 0.9,
  maturityAge: 200,
  lifespan: 3000,
  lifespanJitter: 0.2,
  /** Diet at or above this can hunt. */
  huntDiet: 0.35,
  /** Diet at or above this counts as a carnivore (below huntDiet: herbivore). */
  carnivoreDiet: 0.65,
  /** A hunter must be at least this many times the prey's radius. */
  preySizeRatio: 1,
  /** Creatures whose hue is this close (degrees) are kin and never eat each other. */
  kinHue: 20,
  meatPerMass: 60,
  /** Share of the prey's stored energy the hunter gets. */
  meatFromEnergy: 0.5,
  /** Diet efficiency curve exponent (>1 favours specialists). */
  dietCurve: 1.3,
  baseTurnRate: 0.22,
  /** Hunters within this gap of their prey burst to pounceBoost × top speed. */
  pounceRange: 50,
  pounceBoost: 1.8,
  /** Ticks spent standing still after eating a plant / a kill. Grazers can't flee meanwhile. */
  plantHandling: 6,
  meatHandling: 25,
  /** Share of vision range at which prey start fleeing from a hunter. */
  fleeDistance: 0.6,
  /**
   * Fertile patches are dense cover: inside one (within coverShare of its radius) a
   * creature can only be seen from visibility × the viewer's sense range, where
   * visibility = clamp(size / coverSize, minVisibility, 1). Small bodies hide best.
   */
  coverShare: 0.8,
  coverSize: 10,
  minVisibility: 0.25,
  /** Bigger bodies mature later and live longer: age × mass^exponent. */
  maturityMassExponent: 0.5,
  lifespanMassExponent: 0.25,
  /** Creatures ignore plants unless they digest them at least this well. */
  minPlantEfficiency: 0.2,
} as const;
