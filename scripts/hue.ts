/** Tracks mean hue per diet class to spot colour mimicry. Usage: npx tsx scripts/hue.ts seed ticks */
import { BIO, WORLD } from '../src/sim/config';
import { World } from '../src/sim/world';
import { DIET_CLASSES } from '../src/sim/stats';

Object.assign(BIO as Record<string, number>, JSON.parse(process.env.BIO ?? '{}'));
Object.assign(WORLD as Record<string, number>, JSON.parse(process.env.WORLD ?? '{}'));
const world = new World(process.argv[2] ?? 'beta');
const ticks = Number(process.argv[3] ?? 60000);
const circMean = (hs: number[]) => {
  const x = hs.reduce((a, h) => a + Math.cos((h * Math.PI) / 180), 0);
  const y = hs.reduce((a, h) => a + Math.sin((h * Math.PI) / 180), 0);
  return (((Math.atan2(y, x) * 180) / Math.PI + 360) % 360).toFixed(0);
};
for (let t = 1; t <= ticks; t++) {
  world.step();
  if (t % 6000 === 0) {
    const parts = DIET_CLASSES.map((cls) => {
      const hs = world.creatures.filter((c) => c.dietClass === cls).map((c) => c.genome.hue);
      return `${cls.slice(0, 4)} ${String(hs.length).padStart(4)} hue ${hs.length ? circMean(hs).padStart(3) : '  -'}`;
    });
    console.log(`t${String(t).padStart(6)}  ${parts.join('   ')}`);
  }
}
