/**
 * How often does a fresh world go wrong early? Runs many seeds for a short time and
 * counts total collapses and hunter extinctions.
 *
 *   npx tsx scripts/early.ts <firstSeed> <count> [ticks]
 */
import { BIO, WORLD } from '../src/sim/config';
import { CARNIVORE_TEMPLATE, HERBIVORE_TEMPLATE } from '../src/sim/genome';
import { World } from '../src/sim/world';

Object.assign(BIO as Record<string, number>, JSON.parse(process.env.BIO ?? '{}'));
Object.assign(WORLD as Record<string, number>, JSON.parse(process.env.WORLD ?? '{}'));
Object.assign(HERBIVORE_TEMPLATE, JSON.parse(process.env.HERB ?? '{}'));
Object.assign(CARNIVORE_TEMPLATE, JSON.parse(process.env.CARN ?? '{}'));

const first = Number(process.argv[2] ?? 0);
const count = Number(process.argv[3] ?? 6);
const ticks = Number(process.argv[4] ?? 12000);

let collapses = 0;
let noHunters = 0;
for (let i = first; i < first + count; i++) {
  const world = new World(`early-${i}`);
  for (let t = 0; t < ticks && world.creatures.length > 0; t++) world.step();
  if (world.creatures.length === 0) collapses++;
  else if (!world.creatures.some((c) => c.canHunt)) noHunters++;
}
console.log(`${count} ${collapses} ${noHunters}`);
