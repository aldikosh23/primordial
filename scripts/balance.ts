/**
 * Headless balance check: runs one world without rendering and prints how each
 * population fares.
 *
 *   npx tsx scripts/balance.ts <seed> [ticks]
 *   BIO='{"moveCost":0.05}' WORLD='{"plantSpawnRate":3}' npx tsx scripts/balance.ts alpha
 *
 * BIO / WORLD env vars override config values, for quick tuning experiments.
 */
import { BIO, WORLD } from '../src/sim/config';
import { World } from '../src/sim/world';

Object.assign(BIO as Record<string, number>, JSON.parse(process.env.BIO ?? '{}'));
Object.assign(WORLD as Record<string, number>, JSON.parse(process.env.WORLD ?? '{}'));

const seed = process.argv[2] ?? 'alpha';
const ticks = Number(process.argv[3] ?? 60000);
const every = Number(process.argv[4] ?? 3000);

const world = new World(seed);
const started = performance.now();
const rows: string[] = [];
let peak = 0;
const pad = (n: number, w = 4) => String(n).padStart(w);

for (let t = 1; t <= ticks; t++) {
  world.step();
  peak = Math.max(peak, world.creatures.length);
  if (t % every === 0) {
    const s = world.stats;
    const hunters = world.creatures.filter((c) => c.canHunt);
    const meanSpeed = (list: typeof hunters) =>
      list.length ? (list.reduce((a, c) => a + c.genome.speed, 0) / list.length).toFixed(1) : ' - ';
    const grazers = world.creatures.filter((c) => !c.canHunt);
    rows.push(
      `t${pad(t, 6)} herb ${pad(s.latestCount('herbivore'))} omni ${pad(s.latestCount('omnivore'))} ` +
        `carn ${pad(s.latestCount('carnivore'))} plants ${pad(world.plants.length, 5)} ` +
        `spd grazers ${meanSpeed(grazers)} hunters ${meanSpeed(hunters)}`,
    );
  }
  if (world.creatures.length === 0) {
    rows.push(`collapse at tick ${t}`);
    break;
  }
}

const ms = performance.now() - started;
const hunters = world.creatures.filter((c) => c.canHunt).length;
console.log(
  `== ${seed}: ${(ms / world.tick).toFixed(3)} ms/tick, peak ${peak}, gen ${world.maxGeneration}, ` +
    `alive ${world.creatures.length}, hunters ${hunters}`,
);
console.log(rows.join('\n'));
const events = world.events.filter((e) => e.kind !== 'generation').map((e) => `t${e.tick} ${e.text}`);
if (events.length) console.log('events:', events.join(' | '));
