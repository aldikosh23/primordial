import { DIET_LABEL, type DietClass } from '../sim/creature';
import { CHART_TRAITS, DIET_CLASSES, type ChartTrait } from '../sim/stats';
import { yearOf, type SimEventKind, type World } from '../sim/world';
import { HueSpiral, LineChart } from './chart';
import { $ } from './dom';
import { CLASS_COLOR, SEASON_COLOR, SEASON_LABEL, formatDuration, formatNumber, formatWhen } from './format';

const EVENT_ICON: Record<SimEventKind, string> = {
  extinct: '✕',
  collapse: '✕',
  emerged: '✦',
  generation: '◆',
  meteor: '☄',
};

const TRAIT_FORMAT: Record<ChartTrait, (v: number) => string> = {
  speed: (v) => v.toFixed(1),
  size: (v) => v.toFixed(1),
  sense: (v) => String(Math.round(v)),
};

export interface PanelActions {
  setFoodRate(v: number): void;
  setMutationRate(v: number): void;
  setSeasons(on: boolean): void;
  loadSeed(seed: string): void;
  newWorld(): void;
  share(): void;
}

/** Everything in the side panel plus the clock chip: stats, charts, chronicle, settings. */
export class Panel {
  private readonly tiles = {
    pop: $('t-pop'),
    plants: $('t-plants'),
    gen: $('t-gen'),
    births: $('t-births'),
  };
  private readonly clockYear = $('clock-year');
  private readonly clockSeason = $('clock-season');
  private readonly seasonDot = $('season-dot');
  private readonly legend = $('legend');
  private readonly popWindow = $('pop-window');
  private readonly events = $<HTMLOListElement>('events');
  private readonly seedInput = $<HTMLInputElement>('seed-input');
  private readonly popChart: LineChart;
  private readonly traitCharts: Record<ChartTrait, LineChart>;
  private readonly hueChart: HueSpiral;
  private statsVersion = -1;
  private lastEventKey = '';
  private world: World | null = null;

  constructor(actions: PanelActions) {
    const formatSample = (i: number) => (this.world ? formatWhen(this.world.stats.ticks[i] ?? 0) : '');
    this.popChart = new LineChart($('chart-pop'), {
      zeroBased: true,
      gridLines: 3,
      formatValue: (v) => formatNumber(v),
      formatX: formatSample,
    });
    this.traitCharts = {} as Record<ChartTrait, LineChart>;
    for (const t of CHART_TRAITS) {
      this.traitCharts[t] = new LineChart($(`chart-${t}`), {
        zeroBased: false,
        gridLines: 0,
        lineWidth: 1.75,
        showTicks: false,
        formatValue: TRAIT_FORMAT[t],
        formatX: formatSample,
      });
    }
    this.hueChart = new HueSpiral($('chart-hue'));

    this.legend.innerHTML = DIET_CLASSES.map(
      (cls) => `<li><i style="background:${CLASS_COLOR[cls]}"></i>${DIET_LABEL[cls]} <b data-count="${cls}">0</b></li>`,
    ).join('');

    const food = $<HTMLInputElement>('food');
    const foodVal = $<HTMLOutputElement>('food-val');
    food.addEventListener('input', () => {
      const v = Number(food.value);
      foodVal.textContent = `${Math.round(v * 100)}%`;
      actions.setFoodRate(v);
    });
    const mutation = $<HTMLInputElement>('mutation');
    const mutVal = $<HTMLOutputElement>('mut-val');
    mutation.addEventListener('input', () => {
      const v = Number(mutation.value);
      mutVal.textContent = `${(v * 100).toFixed(v * 100 < 10 && v > 0 ? 1 : 0).replace(/\.0$/, '')}%`;
      actions.setMutationRate(v);
    });
    const seasons = $<HTMLInputElement>('seasons');
    seasons.addEventListener('change', () => actions.setSeasons(seasons.checked));

    $<HTMLFormElement>('seed-form').addEventListener('submit', (e) => {
      e.preventDefault();
      actions.loadSeed(this.seedInput.value.trim());
    });
    $('new-world').addEventListener('click', () => actions.newWorld());
    $('share').addEventListener('click', () => actions.share());
  }

  /** Point the panel at a (new) world and sync the controls with its settings. */
  attach(world: World): void {
    this.world = world;
    this.statsVersion = -1;
    this.lastEventKey = '';
    this.seedInput.value = world.seed;
    const { foodRate, mutationRate, seasons } = world.settings;
    const food = $<HTMLInputElement>('food');
    food.value = String(foodRate);
    food.dispatchEvent(new Event('input'));
    const mutation = $<HTMLInputElement>('mutation');
    mutation.value = String(mutationRate);
    mutation.dispatchEvent(new Event('input'));
    $<HTMLInputElement>('seasons').checked = seasons;
    this.events.innerHTML = '<li class="events-empty">Nothing notable yet.</li>';
  }

  /** Cheap text updates; call a few times per second. */
  updateText(world: World): void {
    this.tiles.pop.textContent = formatNumber(world.creatures.length);
    this.tiles.plants.textContent = formatNumber(world.plants.length);
    this.tiles.gen.textContent = formatNumber(world.maxGeneration);
    this.tiles.births.textContent = formatNumber(world.totalBirths);
    this.clockYear.textContent = `Year ${world.year}`;
    this.clockSeason.textContent = world.settings.seasons ? SEASON_LABEL[world.season] : 'No seasons';
    this.seasonDot.style.background = world.settings.seasons ? SEASON_COLOR[world.season] : '#8c95a1';
    this.seasonDot.style.color = this.seasonDot.style.background;
    // Live counts, so the legend always agrees with the "Creatures" tile.
    const counts: Record<DietClass, number> = { herbivore: 0, omnivore: 0, carnivore: 0 };
    for (const c of world.creatures) counts[c.dietClass]++;
    for (const cls of DIET_CLASSES) {
      const el = this.legend.querySelector<HTMLElement>(`[data-count="${cls}"]`);
      if (el) el.textContent = formatNumber(counts[cls]);
    }
    this.updateEvents(world);
  }

  /** Feed new samples to the charts (only when the history changed). */
  refreshCharts(world: World): void {
    const { stats } = world;
    if (stats.version !== this.statsVersion) {
      this.statsVersion = stats.version;
      const span = stats.ticks.length > 1 ? stats.ticks[stats.ticks.length - 1] - stats.ticks[0] : 0;
      this.popWindow.textContent = span > 0 ? `last ${formatDuration(span)}` : '';

      this.popChart.setSeries(
        DIET_CLASSES.map((cls) => ({ label: DIET_LABEL[cls], color: CLASS_COLOR[cls], values: stats.population[cls] })),
      );
      for (const t of CHART_TRAITS) {
        this.traitCharts[t].setSeries(
          DIET_CLASSES.map((cls) => ({
            label: DIET_LABEL[cls],
            color: CLASS_COLOR[cls],
            values: stats.traits[t][cls],
          })),
        );
      }
      this.hueChart.setTrails(
        DIET_CLASSES.map((cls) => ({ label: DIET_LABEL[cls], color: CLASS_COLOR[cls], hues: stats.hue[cls] })),
        (i) => formatWhen(stats.hueTicks[i] ?? 0),
      );
    }
  }

  /** Draw the charts if anything changed (data, size or hover). Cheap to call every frame. */
  renderCharts(): void {
    this.popChart.render();
    for (const t of CHART_TRAITS) this.traitCharts[t].render();
    this.hueChart.render();
  }

  private updateEvents(world: World): void {
    const list = world.events;
    const last = list[list.length - 1];
    const key = last ? `${list.length}:${last.tick}:${last.text}` : '';
    if (key === this.lastEventKey) return;
    const previous = this.lastEventKey;
    this.lastEventKey = key;
    if (!list.length) return;
    const shown = list.slice(-30).reverse();
    this.events.innerHTML = shown
      .map((e, i) => {
        const fresh = previous !== '' && i === 0 ? ' fresh' : '';
        return (
          `<li class="ev-${e.kind}${fresh}"><span class="ev-icon" aria-hidden="true">${EVENT_ICON[e.kind]}</span>` +
          `<span>${e.text}</span><time>Y${yearOf(e.tick)}</time></li>`
        );
      })
      .join('');
  }
}
