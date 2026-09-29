/**
 * Detailed look at one world: mean genes, energy and behaviour per diet class,
 * plus death causes. Usage: npx tsx scripts/diag.ts [seed] [ticks] [every]
 */
import { BIO, WORLD } from '../src/sim/config';
import { DIET_CLASSES } from '../src/sim/stats';
import { World } from '../src/sim/world';

Object.assign(BIO as Record<string, number>, JSON.parse(process.env.BIO ?? '{}'));
Object.assign(WORLD as Record<string, number>, JSON.parse(process.env.WORLD ?? '{}'));

const seed = process.argv[2] ?? 'gamma';
const ticks = Number(process.argv[3] ?? 15000);
const every = Number(process.argv[4] ?? 1500);
const world = new World(seed);
const deaths: Record<string, number> = {};
world.onDeath = (c) => {
  const key = `${c.dietClass[0]}:${c.deathCause}`;
  deaths[key] = (deaths[key] ?? 0) + 1;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

for (let t = 1; t <= ticks; t++) {
  world.step();
  if (t % every !== 0) continue;
  console.log(`t${t} plants ${world.plants.length}`);
  for (const cls of DIET_CLASSES) {
    const cs = world.creatures.filter((c) => c.dietClass === cls);
    if (!cs.length) continue;
    const f = (k: 'speed' | 'size' | 'sense' | 'diet') => mean(cs.map((c) => c.genome[k])).toFixed(2);
    const e = mean(cs.map((c) => c.energyFraction)).toFixed(2);
    const beh = ['hunt', 'forage', 'flee', 'wander'].map((b) => cs.filter((c) => c.behaviour === b).length).join('/');
    const kills = mean(cs.map((c) => c.kills)).toFixed(2);
    console.log(
      `  ${cls.padEnd(9)} ${String(cs.length).padStart(4)} spd ${f('speed')} size ${f('size')} sense ${f('sense')} ` +
        `diet ${f('diet')} energy ${e} kills ${kills} [hunt/forage/flee/wander ${beh}]`,
    );
  }
  console.log('  deaths', JSON.stringify(deaths));
}
