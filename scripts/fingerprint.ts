/**
 * Prints the state fingerprint of a world after N ticks. Run it under different
 * JavaScript engines to check they grow the identical world:
 *
 *   npx tsx scripts/fingerprint.ts jade-grove-555 20000   # V8 (Chrome, Node)
 *   bun scripts/fingerprint.ts jade-grove-555 20000       # JavaScriptCore (Safari)
 */
import { fingerprint } from '../src/sim/fingerprint';
import { World } from '../src/sim/world';

const seed = process.argv[2] ?? 'jade-grove-555';
const ticks = Number(process.argv[3] ?? 20000);
const world = new World(seed);
for (let i = 0; i < ticks; i++) world.step();
console.log(`${seed} @${ticks}: ${fingerprint(world)} (${world.creatures.length} creatures)`);
