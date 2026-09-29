/**
 * Scores candidate seeds for the default "featured" world: hunters should survive the
 * whole run and the colour chase should travel far.
 *
 *   npx tsx scripts/featured.ts seed1,seed2,... [ticks]
 */
import { World } from '../src/sim/world';

const seeds = (process.argv[2] ?? 'tidal-reef-418').split(',');
const ticks = Number(process.argv[3] ?? 60000);

for (const seed of seeds) {
  const world = new World(seed);
  let minHunters = Infinity;
  let hueTravel = 0;
  let lastHue: number | null = null;
  for (let t = 1; t <= ticks && world.creatures.length > 0; t++) {
    world.step();
    if (t % 1500 !== 0) continue;
    const hunters = world.creatures.filter((c) => c.canHunt).length;
    if (t >= 3000) minHunters = Math.min(minHunters, hunters);
    const grazers = world.creatures.filter((c) => !c.canHunt);
    if (grazers.length) {
      const x = grazers.reduce((a, c) => a + Math.cos((c.genome.hue * Math.PI) / 180), 0);
      const y = grazers.reduce((a, c) => a + Math.sin((c.genome.hue * Math.PI) / 180), 0);
      const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
      if (lastHue !== null) {
        const d = Math.abs(hue - lastHue);
        hueTravel += d > 180 ? 360 - d : d;
      }
      lastHue = hue;
    }
  }
  const events = world.events.filter((e) => e.kind === 'emerged' || e.kind === 'extinct').length;
  console.log(
    `${seed.padEnd(22)} alive ${String(world.creatures.length).padStart(4)} ` +
      `minHunters ${String(minHunters === Infinity ? 0 : minHunters).padStart(3)} ` +
      `hueTravel ${String(Math.round(hueTravel)).padStart(4)} gen ${world.maxGeneration} events ${events}`,
  );
}
