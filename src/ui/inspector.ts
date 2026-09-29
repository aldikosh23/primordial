import type { Creature } from '../sim/creature';
import { GENE_RANGES, type TraitKey } from '../sim/genome';
import type { World } from '../sim/world';
import { $ } from './dom';
import {
  BEHAVIOUR_LABEL,
  CLASS_SINGULAR,
  TICKS_PER_DAY,
  creatureName,
  formatDays,
  formatNumber,
  formatWhen,
} from './format';
import { narrowScreen } from './media';

const GENE_ROWS: { key: TraitKey; label: string; format: (v: number) => string }[] = [
  { key: 'speed', label: 'Speed', format: (v) => v.toFixed(2) },
  { key: 'size', label: 'Size', format: (v) => v.toFixed(1) },
  { key: 'sense', label: 'Vision', format: (v) => String(Math.round(v)) },
  {
    key: 'diet',
    label: 'Diet',
    format: (v) => (v < 0.5 ? `${Math.round((1 - v) * 100)}% plant` : `${Math.round(v * 100)}% meat`),
  },
];

export interface InspectorActions {
  select(c: Creature): void;
  close(): void;
  toggleFollow(): void;
}

function deathText(c: Creature, world: World): { html: string; plain: string } {
  let cause: string;
  let plainCause: string;
  switch (c.deathCause) {
    case 'eaten': {
      const killer = world.creatures.find((x) => x.id === c.killedBy);
      const killerName = `${creatureName(c.killedBy ?? 0)} (#${c.killedBy})`;
      plainCause = `Eaten by ${killerName}`;
      cause = killer ? `Eaten by <button class="link" data-id="${killer.id}">${killerName}</button>` : plainCause;
      break;
    }
    case 'starved':
      cause = plainCause = 'Starved';
      break;
    case 'old age':
      cause = plainCause = 'Died of old age';
      break;
    case 'meteor':
      cause = plainCause = 'Killed by a meteor';
      break;
    default:
      cause = plainCause = 'Died';
  }
  const tail = ` · ${formatWhen(c.diedAtTick)}, aged ${formatDays(c.age)}`;
  return { html: `<span class="dead">${cause}</span>${tail}`, plain: `${plainCause}${tail}` };
}

/** The floating card describing the selected creature. */
export class Inspector {
  private readonly root = $('inspector');
  private readonly swatch = $('insp-swatch');
  private readonly name = $('insp-name');
  private readonly sub = $('insp-sub');
  private readonly status = $('insp-status');
  private readonly energy = $('insp-energy');
  private readonly energyTrack = $('insp-energy-track');
  private readonly energyVal = $('insp-energy-val');
  private readonly age = $('insp-age');
  private readonly ageTrack = $('insp-age-track');
  private readonly ageVal = $('insp-age-val');
  private readonly more = $<HTMLDetailsElement>('insp-more');
  private readonly genes = $('insp-genes');
  private readonly counts = $('insp-counts');
  private readonly follow = $<HTMLButtonElement>('insp-follow');
  private readonly parent = $<HTMLButtonElement>('insp-parent');
  private readonly live = $('sr-live');
  private creature: Creature | null = null;
  private world: World | null = null;
  // Last written markup: the card refreshes several times a second, and rewriting
  // unchanged HTML would swap buttons out from under a click in progress.
  private lastStatus = '';
  private lastCounts = '';
  private announcedDeath = false;

  constructor(actions: InspectorActions) {
    $('insp-close').addEventListener('click', () => actions.close());
    this.follow.addEventListener('click', () => actions.toggleFollow());
    this.parent.addEventListener('click', () => {
      const p = this.findParent();
      if (p) actions.select(p);
    });
    this.status.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
      if (!target || !this.world) return;
      const id = Number(target.dataset.id);
      const c = this.world.creatures.find((x) => x.id === id);
      if (c) actions.select(c);
    });
  }

  /** Where the card is on screen, or null while it's hidden. */
  rect(): DOMRect | null {
    return this.root.hidden ? null : this.root.getBoundingClientRect();
  }

  show(c: Creature, world: World): void {
    const wasHidden = this.root.hidden;
    this.creature = c;
    this.world = world;
    this.lastStatus = '';
    this.lastCounts = '';
    this.announcedDeath = c.dead;
    this.root.hidden = false;
    // On a phone the details would cover the creature; start them folded there.
    if (wasHidden) this.more.open = !narrowScreen.matches;
    const hue = Math.round(c.genome.hue);
    this.swatch.style.setProperty('--swatch', `hsl(${hue} 62% 56%)`);
    this.name.textContent = creatureName(c.id);
    this.sub.textContent = `#${c.id} · ${CLASS_SINGULAR[c.dietClass]} · generation ${c.generation}`;
    this.genes.innerHTML = GENE_ROWS.map(({ key, label, format }) => {
      const { min, max } = GENE_RANGES[key];
      const pos = ((c.genome[key] - min) / (max - min)) * 100;
      return (
        `<dt>${label}</dt>` +
        `<div class="gene-bar${key === 'diet' ? ' diet' : ''}" aria-hidden="true"><span style="left:${pos.toFixed(1)}%"></span></div>` +
        `<dd>${format(c.genome[key])}</dd>`
      );
    }).join('');
    this.update(false);
  }

  hide(): void {
    this.creature = null;
    this.root.hidden = true;
  }

  update(following: boolean): void {
    const c = this.creature;
    const world = this.world;
    if (!c || !world) return;

    let status: string;
    if (c.dead) {
      const text = deathText(c, world);
      status = text.html;
      if (!this.announcedDeath) {
        this.announcedDeath = true;
        this.live.textContent = `${creatureName(c.id)}: ${text.plain}`;
      }
    } else {
      const hidden = c.visibility < 1 ? ' · hiding in cover' : '';
      status = `<b>${BEHAVIOUR_LABEL[c.behaviour]}</b>${hidden}`;
    }
    if (status !== this.lastStatus) {
      this.status.innerHTML = status;
      this.lastStatus = status;
    }

    const energy = Math.round(Math.max(0, c.energyFraction) * 100);
    this.energy.style.width = `${energy}%`;
    this.energyVal.textContent = `${energy}%`;
    this.energyTrack.setAttribute('aria-valuenow', String(energy));
    const agePct = Math.round(Math.min(1, c.age / c.lifespan) * 100);
    this.age.style.width = `${agePct}%`;
    this.ageVal.textContent = `${formatDays(c.age)} of ~${Math.round(c.lifespan / TICKS_PER_DAY)}`;
    this.ageTrack.setAttribute('aria-valuenow', String(agePct));

    const counts =
      `<span><b>${formatNumber(c.children)}</b>children</span>` +
      `<span><b>${formatNumber(c.kills)}</b>kills</span>` +
      `<span><b>${formatNumber(c.plantsEaten)}</b>plants eaten</span>`;
    if (counts !== this.lastCounts) {
      this.counts.innerHTML = counts;
      this.lastCounts = counts;
    }

    this.follow.disabled = c.dead;
    this.follow.setAttribute('aria-pressed', String(following && !c.dead));
    this.follow.textContent = following && !c.dead ? 'Following' : 'Follow';
    const parent = this.findParent();
    this.parent.disabled = !parent;
    this.parent.title = parent
      ? `Select ${creatureName(parent.id)}`
      : c.parentId === null
        ? 'One of the first creatures'
        : 'Parent is no longer alive';
  }

  private findParent(): Creature | null {
    const c = this.creature;
    if (!c || c.parentId === null || !this.world) return null;
    return this.world.creatures.find((x) => x.id === c.parentId) ?? null;
  }
}
