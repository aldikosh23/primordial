import type { World } from './world';

function fnv1a(text: string, seed: number): string {
  let h = seed;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * A short hash of the complete simulation state. Two worlds with the same fingerprint
 * are bit-for-bit identical; used to check that every JavaScript engine grows the same
 * world from the same seed.
 */
export function fingerprint(world: World): string {
  const parts: string[] = [String(world.tick), String(world.totalBirths), String(world.totalDeaths)];
  for (const c of world.creatures) {
    const g = c.genome;
    parts.push(
      [c.id, c.x, c.y, c.heading, c.velocity, c.energy, c.age, c.feeding, g.speed, g.size, g.sense, g.diet, g.hue].join(),
    );
  }
  for (const p of world.plants) parts.push(`${p.x},${p.y}`);
  for (const p of world.patches) parts.push(`${p.x},${p.y},${p.vx},${p.vy}`);
  const text = parts.join(';');
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x01234567);
}
