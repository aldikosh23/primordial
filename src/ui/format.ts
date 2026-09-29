import { WORLD } from '../sim/config';
import type { Behaviour, DietClass } from '../sim/creature';
import { seasonOf, yearOf, type Season } from '../sim/world';

/** Chart colours per diet class (validated for colour-blind separation on the panel surface). */
export const CLASS_COLOR: Record<DietClass, string> = {
  herbivore: '#199e70',
  omnivore: '#3987e5',
  carnivore: '#d95926',
};

export const CLASS_SINGULAR: Record<DietClass, string> = {
  herbivore: 'Herbivore',
  omnivore: 'Omnivore',
  carnivore: 'Carnivore',
};

export const BEHAVIOUR_LABEL: Record<Behaviour, string> = {
  wander: 'Wandering',
  forage: 'Heading for food',
  hunt: 'Hunting',
  flee: 'Fleeing',
  feed: 'Eating',
};

export const SEASON_LABEL: Record<Season, string> = {
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
  winter: 'Winter',
};

export const SEASON_COLOR: Record<Season, string> = {
  spring: '#7ee29a',
  summer: '#f2c14e',
  autumn: '#e8894a',
  winter: '#9cc9f5',
};

const numberFormat = new Intl.NumberFormat('en-US');

export function formatNumber(n: number): string {
  return numberFormat.format(Math.round(n));
}

/** "1 generation", "12 generations". */
export function plural(n: number, word: string): string {
  return `${formatNumber(n)} ${word}${Math.round(n) === 1 ? '' : 's'}`;
}

export function formatWhen(tick: number): string {
  return `Year ${yearOf(tick)}, ${SEASON_LABEL[seasonOf(tick)].toLowerCase()}`;
}

/** A year is 100 days; days read better than ticks for creature ages. */
export const TICKS_PER_DAY = WORLD.seasonLength / 100;

export function formatDays(ticks: number): string {
  return plural(Math.floor(ticks / TICKS_PER_DAY), 'day');
}

/** Durations: days below a year, then years with one decimal. */
export function formatDuration(ticks: number): string {
  if (ticks < WORLD.seasonLength) return formatDays(ticks);
  const years = Math.round((ticks / WORLD.seasonLength) * 10) / 10;
  return `${years} year${years === 1 ? '' : 's'}`;
}

const SYLLABLES = [
  'ka', 'lo', 'mi', 'zu', 'ra', 'te', 'vi', 'no', 'shi', 'be', 'qua', 'xo', 'ru', 'ne', 'fa', 'do',
  'pi', 'sa', 'go', 'lu', 'ki', 'mo', 'ta', 'ze', 'wa', 'yo', 'ri', 'na', 'ju', 'hel', 'bo', 'ci',
];

/** A stable, pronounceable name for a creature id, e.g. "Mizura". */
export function creatureName(id: number): string {
  // Scramble the id so neighbours don't get similar names.
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  h >>>= 0;
  const count = 2 + (h % 2);
  let name = '';
  for (let i = 0; i < count; i++) {
    name += SYLLABLES[(h >>> (5 + i * 5)) % SYLLABLES.length];
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}
