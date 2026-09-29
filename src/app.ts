import { DEFAULT_SETTINGS, WORLD, type SimSettings } from './sim/config';
import type { Creature } from './sim/creature';
import { randomSeedString } from './sim/rng';
import { World } from './sim/world';
import { FEED_RADIUS, METEOR_RADIUS, Renderer, type Tool } from './render/renderer';
import { $ } from './ui/dom';
import { formatDuration, plural } from './ui/format';
import { Inspector } from './ui/inspector';
import { narrowScreen } from './ui/media';
import { Panel } from './ui/panel';

/** Simulation ticks per millisecond at 1× (60 ticks per second on any display). */
const TICKS_PER_MS = 0.06;
/** Max milliseconds of simulation per animation frame, so the page stays responsive. */
const SIM_BUDGET_MS = 14;
const SPEED_KEYS: Record<string, number> = { Digit1: 1, Digit2: 3, Digit3: 10, Digit4: 30 };
/** Chosen with scripts/featured.ts: hunters survive ten years and colours circle the wheel twice. */
const FEATURED_SEED = 'jade-grove-555';
const MAX_WARMUP = 60_000;
const DRAG_THRESHOLD = 5;
const FEED_EVERY_MS = 70;
/** Following a creature zooms in at least this far, so the camera can actually move. */
const FOLLOW_ZOOM = 1.6;
/** After selecting on a phone, glide the creature above the inspector card for this long. */
const REVEAL_MS = 700;

type XY = { x: number; y: number };

/** Anything you type into: shortcuts must leave these alone. */
function isTextField(el: EventTarget | null): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !['range', 'checkbox', 'radio', 'button', 'submit'].includes(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

/** A number from the URL, or null when missing, empty or not a number. */
function numberParam(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key)?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Settings from the URL, clamped to what the sliders allow. */
function settingsFromUrl(params: URLSearchParams): Partial<SimSettings> {
  const out: Partial<SimSettings> = {};
  const food = numberParam(params, 'food');
  if (food !== null) out.foodRate = Math.min(2.5, Math.max(0.25, food));
  const mut = numberParam(params, 'mut');
  if (mut !== null) out.mutationRate = Math.min(0.2, Math.max(0, mut));
  if (params.get('seasons') === '0') out.seasons = false;
  return out;
}

/** Latin letter of a key press: the typed letter on Latin layouts (AZERTY, Dvorak…), the physical key otherwise (Cyrillic…). */
function letterOf(e: KeyboardEvent): string {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase();
  return e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : '';
}

export class App {
  private world!: World;
  private readonly renderer: Renderer;
  private readonly panel: Panel;
  private readonly inspector: Inspector;
  private readonly stage = $('stage');
  private readonly canvas = $<HTMLCanvasElement>('world');
  private readonly settings: SimSettings;

  private paused = false;
  private speed = 1;
  private tool: Tool = 'inspect';
  private selected: Creature | null = null;
  private hovered: Creature | null = null;
  private following = false;
  private pointerWorld: XY | null = null;
  private extinctShown = false;
  private toastTimer = 0;
  private urlTimer = 0;

  // Frame timing.
  private lastFrame = 0;
  private tickDebt = 0;
  /** Smoothed ticks actually simulated per 1× tick of wall time. */
  private achievedSpeed = 1;
  private warmupLeft = 0;
  private warmupTotal = 0;
  private warmupShown = -1;
  private revealUntil = 0;
  private lagging = false;
  private lastTextUpdate = 0;
  private lastChartUpdate = 0;
  private lastInspectorUpdate = 0;

  // Pointer gesture state.
  private readonly pointers = new Map<number, XY>();
  /** A tap waiting for its click event before selecting (see the click handler). */
  private pendingTap: XY | null = null;
  private dragStart: XY | null = null;
  private dragged = false;
  private pinchDistance = 0;
  private lastFeed = 0;

  constructor() {
    const params = new URLSearchParams(location.search);
    this.settings = { ...DEFAULT_SETTINGS, ...settingsFromUrl(params) };
    this.renderer = new Renderer(this.canvas, WORLD.width, WORLD.height);
    this.panel = new Panel({
      setFoodRate: (v) => this.changeSetting('foodRate', v),
      setMutationRate: (v) => this.changeSetting('mutationRate', v),
      setSeasons: (on) => this.changeSetting('seasons', on),
      loadSeed: (seed) => this.startWorld(seed || randomSeedString()),
      newWorld: () => this.startWorld(randomSeedString()),
      share: () => this.share(),
    });
    this.inspector = new Inspector({
      select: (c) => this.select(c),
      close: () => this.select(null),
      toggleFollow: () => this.setFollowing(!this.following),
    });

    // First visit: a hand-picked world with a long predator–prey story. "New world" rolls dice.
    this.startWorld(params.get('seed')?.trim() || FEATURED_SEED);
    // ?warmup=N fast-forwards N ticks, a few milliseconds per frame (handy for screenshots).
    this.warmupTotal = this.warmupLeft = Math.min(Math.max(0, Math.floor(Number(params.get('warmup')) || 0)), MAX_WARMUP);

    this.bindControls();
    this.bindPointer();
    this.bindKeyboard();
    new ResizeObserver(() => this.renderer.resize()).observe(this.stage);
    // A small handle for tinkering in the dev console (and for scripts/capture.mjs).
    const app = this;
    Object.assign(window, {
      primordial: {
        get world() {
          return app.world;
        },
        camera: this.renderer.camera,
        select: (c: Creature | null) => this.select(c),
      },
    });
    window.setTimeout(() => $('hint').classList.add('gone'), 9000);
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------ world

  private startWorld(seed: string): void {
    const world = new World(seed, { ...this.settings });
    world.onDeath = (c) => {
      if (this.showLifeEffects()) this.renderer.addDeath(c, performance.now());
    };
    world.onBirth = (c) => {
      if (this.showLifeEffects()) this.renderer.addBirth(c, performance.now());
    };
    this.world = world;
    this.select(null);
    this.renderer.clearEffects();
    this.panel.attach(world);
    this.extinctShown = false;
    this.warmupLeft = 0;
    $('warmup').hidden = true;
    $('extinct').hidden = true;
    this.setPaused(false);
    this.syncUrl(true);
    document.title = `Primordial · ${seed}`;
  }

  private changeSetting<K extends keyof SimSettings>(key: K, value: SimSettings[K]): void {
    this.settings[key] = value;
    this.world.settings[key] = value;
    this.syncUrl(false);
  }

  /**
   * Keep the address bar shareable: seed plus any non-default settings. Debounced,
   * because Safari throttles history.replaceState during slider drags.
   */
  private syncUrl(now: boolean): void {
    window.clearTimeout(this.urlTimer);
    const write = () => {
      const url = new URL(location.href);
      const { foodRate, mutationRate, seasons } = this.settings;
      url.searchParams.set('seed', this.world.seed);
      url.searchParams.delete('warmup');
      const set = (key: string, value: string, isDefault: boolean) =>
        isDefault ? url.searchParams.delete(key) : url.searchParams.set(key, value);
      set('food', String(foodRate), foodRate === DEFAULT_SETTINGS.foodRate);
      set('mut', String(mutationRate), mutationRate === DEFAULT_SETTINGS.mutationRate);
      set('seasons', '0', seasons === DEFAULT_SETTINGS.seasons);
      history.replaceState(null, '', url);
    };
    if (now) write();
    else this.urlTimer = window.setTimeout(write, 300);
  }

  /** Birth/death ripples are lovely at normal speed and just noise when racing ahead. */
  private showLifeEffects(): boolean {
    if (this.warmupLeft > 0) return false;
    return this.speed <= 3 || Math.random() < 3 / this.speed;
  }

  // ------------------------------------------------------------ loop

  private readonly frame = (now: number): void => {
    // Schedule first, so an exception in one frame can't stop the loop for good.
    requestAnimationFrame(this.frame);
    const dt = this.lastFrame ? Math.min(now - this.lastFrame, 250) : 1000 / 60;
    this.lastFrame = now;
    const world = this.world;

    if (this.warmupLeft > 0) {
      this.warmUp();
    } else if (!this.paused && world.creatures.length > 0) {
      // Fixed-rate simulation: 60 ticks per second at 1× whether the screen runs at 60 or 120 Hz.
      this.tickDebt = Math.min(this.tickDebt + dt * TICKS_PER_MS * this.speed, this.speed * 2 + 1);
      const start = performance.now();
      let steps = 0;
      while (this.tickDebt >= 1 && world.creatures.length > 0) {
        world.step();
        this.tickDebt--;
        steps++;
        if (performance.now() - start > SIM_BUDGET_MS) {
          // Can't keep up: drop the backlog instead of snowballing.
          this.tickDebt = Math.min(this.tickDebt, 1);
          break;
        }
      }
      this.achievedSpeed += (steps / (dt * TICKS_PER_MS) - this.achievedSpeed) * 0.05;
    } else {
      this.tickDebt = 0;
      this.achievedSpeed = this.speed;
    }

    if (this.selected?.dead) this.following = false;
    this.updateCameraInsets();
    if (this.selected && (this.following || now < this.revealUntil)) {
      // Centre the creature in the part of the stage the inspector card leaves free.
      const cam = this.renderer.camera;
      const x = this.selected.x - cam.insetLeft / 2 / cam.zoom;
      const y = this.selected.y + cam.insetBottom / 2 / cam.zoom;
      cam.follow(x, y, this.following ? 0.12 : 0.15);
    }
    if (this.hovered?.dead) this.setHovered(null);

    this.renderer.draw(world, {
      selected: this.selected,
      hovered: this.tool === 'inspect' ? this.hovered : null,
      tool: this.tool,
      pointer: this.pointerWorld,
      now,
    });

    if (now - this.lastTextUpdate > 150) {
      this.lastTextUpdate = now;
      this.panel.updateText(world);
      this.updateSpeedHint();
    }
    if (now - this.lastChartUpdate > 200) {
      this.lastChartUpdate = now;
      this.panel.refreshCharts(world);
    }
    this.panel.renderCharts();
    if (this.selected && now - this.lastInspectorUpdate > 120) {
      this.lastInspectorUpdate = now;
      this.inspector.update(this.following);
    }
    if (world.creatures.length === 0 && !this.extinctShown && this.warmupLeft === 0) this.showExtinction();
  };

  /** On phones the inspector card covers part of the stage: tell the camera which part. */
  private updateCameraInsets(): void {
    const cam = this.renderer.camera;
    let left = 0;
    let bottom = 0;
    const card = this.selected && narrowScreen.matches ? this.inspector.rect() : null;
    if (card) {
      const stage = this.stage.getBoundingClientRect();
      const sideCard = card.width < stage.width * 0.6 && card.height > stage.height * 0.5;
      if (sideCard) left = card.right - stage.left; // landscape: card down the left side
      else bottom = stage.bottom - card.top; // portrait: card along the bottom
    }
    cam.insetLeft = left;
    cam.insetBottom = bottom;
  }

  private warmUp(): void {
    const world = this.world;
    const start = performance.now();
    while (this.warmupLeft > 0 && world.creatures.length > 0 && performance.now() - start < 12) {
      world.step();
      this.warmupLeft--;
    }
    if (world.creatures.length === 0) this.warmupLeft = 0;
    const done = this.warmupLeft === 0;
    $('warmup').hidden = done;
    // Update in 10% steps: the chip is a live region and shouldn't chatter every frame.
    const pct = Math.floor((1 - this.warmupLeft / this.warmupTotal) * 10) * 10;
    if (!done && pct !== this.warmupShown) {
      this.warmupShown = pct;
      $('warmup-pct').textContent = `${pct}%`;
    }
  }

  private updateSpeedHint(): void {
    // Hysteresis, so the badge doesn't flicker when the speed hovers around the threshold.
    const ratio = this.achievedSpeed / this.speed;
    const running = !this.paused && this.speed > 1;
    this.lagging = running && (this.lagging ? ratio < 0.9 : ratio < 0.8);
    const hint = $('speed-real');
    hint.hidden = !this.lagging;
    if (this.lagging) hint.textContent = `≈${Math.max(1, Math.round(this.achievedSpeed))}×`;
  }

  private showExtinction(): void {
    this.extinctShown = true;
    const w = this.world;
    $('extinct-text').textContent =
      `Life lasted ${formatDuration(w.tick)} and ${plural(w.maxGeneration, 'generation')} ` +
      `(${plural(w.totalBirths, 'birth')}).`;
    $('extinct').hidden = false;
  }

  // ------------------------------------------------------------ controls

  private setPaused(paused: boolean): void {
    this.paused = paused;
    const btn = $('play');
    btn.classList.toggle('paused', paused);
    btn.title = paused ? 'Play (Space)' : 'Pause (Space)';
    btn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  }

  private setSpeed(speed: number): void {
    this.speed = speed;
    this.achievedSpeed = speed;
    for (const b of $('speed').querySelectorAll<HTMLButtonElement>('button')) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed));
    }
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.stage.dataset.tool = tool;
    for (const b of $('tools').querySelectorAll<HTMLButtonElement>('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    }
    if (tool !== 'inspect') this.setHovered(null);
  }

  private select(c: Creature | null): void {
    this.selected = c;
    this.following = false;
    if (c) this.inspector.show(c, this.world);
    else this.inspector.hide();
    // On phones the card would cover the creature you just tapped: glide it into view.
    this.revealUntil = c && narrowScreen.matches ? performance.now() + REVEAL_MS : 0;
  }

  /** The viewer took the camera: stop following and stop gliding. */
  private releaseCamera(): void {
    this.following = false;
    this.revealUntil = 0;
  }

  private setFollowing(on: boolean): void {
    this.following = on && !!this.selected && !this.selected.dead;
    if (this.following) {
      // At the overview zoom the whole world fits, so there is nothing to pan: zoom in first.
      const cam = this.renderer.camera;
      if (cam.zoom < FOLLOW_ZOOM) cam.zoomAt(cam.viewW / 2, cam.viewH / 2, FOLLOW_ZOOM / cam.zoom);
    }
    this.inspector.update(this.following);
  }

  private setHovered(c: Creature | null): void {
    this.hovered = c;
    this.stage.classList.toggle('over-creature', !!c);
  }

  private async share(): Promise<void> {
    this.syncUrl(true);
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      this.toast('Link copied. It opens the same starting world, with your settings.');
    } catch {
      this.toast(url);
    }
  }

  private toast(text: string): void {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (el.hidden = true), 3200);
  }

  private bindControls(): void {
    $('play').addEventListener('click', () => this.setPaused(!this.paused));
    for (const b of $('speed').querySelectorAll<HTMLButtonElement>('button')) {
      b.addEventListener('click', () => this.setSpeed(Number(b.dataset.speed)));
    }
    for (const b of $('tools').querySelectorAll<HTMLButtonElement>('button')) {
      b.addEventListener('click', () => this.setTool(b.dataset.tool as Tool));
    }
    $('extinct-new').addEventListener('click', () => this.startWorld(randomSeedString()));
    $('extinct-replay').addEventListener('click', () => this.startWorld(this.world.seed));
    // A mouse click shouldn't leave focus on a button: Space would press it again
    // instead of pausing. Keyboard activation (detail 0) keeps focus where it is.
    document.addEventListener('click', (e) => {
      const el = (e.target as Element | null)?.closest('button, summary, label');
      if (e.detail > 0 && el instanceof HTMLElement) {
        el.blur();
        if (el instanceof HTMLLabelElement) el.querySelector('input')?.blur();
      }
    });
    this.setSpeed(1);
    this.setTool('inspect');
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (isTextField(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      // Digits by physical key (AZERTY's number row needs Shift otherwise).
      const speed = SPEED_KEYS[e.code.replace('Numpad', 'Digit')];
      const letter = letterOf(e);
      if (e.code === 'Space') {
        // A control focused from the keyboard handles Space itself.
        if (target.closest('button, summary, input[type="checkbox"]') && target.matches(':focus-visible')) return;
        e.preventDefault();
        if (!e.repeat) this.setPaused(!this.paused); // holding Space shouldn't strobe
      } else if (speed) {
        this.setSpeed(speed);
      } else if (letter === 'i') {
        this.setTool('inspect');
      } else if (letter === 'f') {
        this.setTool('feed');
      } else if (letter === 'm') {
        this.setTool('meteor');
      } else if (e.code === 'Escape') {
        if (this.selected) this.select(null);
        else this.setTool('inspect');
      } else if (e.code === 'Digit0' || e.code === 'Numpad0') {
        this.renderer.camera.fit();
        this.releaseCamera();
      }
    });
  }

  // ------------------------------------------------------------ pointer

  private localPoint(e: MouseEvent): XY {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private updatePointerWorld(p: XY): void {
    const cam = this.renderer.camera;
    this.pointerWorld = { x: cam.toWorldX(p.x), y: cam.toWorldY(p.y) };
  }

  private pickRadius(): number {
    return 14 / this.renderer.camera.zoom;
  }

  private bindPointer(): void {
    const cam = this.renderer.camera;
    const canvas = this.canvas;

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return; // right/middle clicks do nothing
      this.pendingTap = null;
      this.revealUntil = 0; // a new touch takes over from the glide
      canvas.setPointerCapture(e.pointerId);
      const p = this.localPoint(e);
      this.pointers.set(e.pointerId, p);
      $('hint').classList.add('gone');
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
        this.dragged = true; // a pinch is never a click
        return;
      }
      this.dragStart = p;
      this.dragged = false;
      this.updatePointerWorld(p);
      if (this.tool === 'feed') this.feedAt(performance.now());
    });

    canvas.addEventListener('pointermove', (e) => {
      const p = this.localPoint(e);
      this.updatePointerWorld(p);
      const prev = this.pointers.get(e.pointerId);

      if (prev && this.pointers.size === 2) {
        this.pointers.set(e.pointerId, p);
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDistance > 0) cam.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / this.pinchDistance);
        this.pinchDistance = dist;
        this.releaseCamera();
        return;
      }

      if (prev && this.dragStart) {
        const moved = Math.hypot(p.x - this.dragStart.x, p.y - this.dragStart.y);
        if (this.tool === 'feed') {
          if (performance.now() - this.lastFeed > FEED_EVERY_MS) this.feedAt(performance.now());
        } else if (moved > DRAG_THRESHOLD || this.dragged) {
          if (!this.dragged) this.stage.classList.add('dragging');
          this.dragged = true;
          this.releaseCamera();
          cam.pan(p.x - prev.x, p.y - prev.y);
        }
        this.pointers.set(e.pointerId, p);
        return;
      }

      if (this.tool === 'inspect' && e.pointerType === 'mouse' && this.pointerWorld) {
        this.setHovered(this.world.creatureAt(this.pointerWorld.x, this.pointerWorld.y, this.pickRadius()));
      }
    });

    const end = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size > 0) return;
      this.stage.classList.remove('dragging');
      const wasClick = !this.dragged && e.type === 'pointerup';
      this.dragStart = null;
      this.dragged = false;
      this.pinchDistance = 0;
      const at = this.pointerWorld;
      // Touch has no hover: don't leave the tool's preview circle behind.
      if (e.pointerType !== 'mouse') this.pointerWorld = null;
      if (!wasClick || !at) return;
      if (this.tool === 'inspect') {
        // Select on the click that follows, not now: after a tap the browser fires a click at
        // the same spot, which would land on the card this selection is about to open.
        this.pendingTap = at;
      } else if (this.tool === 'meteor') {
        this.world.meteor(at.x, at.y, METEOR_RADIUS);
        this.renderer.addMeteor(at.x, at.y, performance.now());
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('click', () => {
      const at = this.pendingTap;
      this.pendingTap = null;
      if (at && this.tool === 'inspect') this.select(this.world.creatureAt(at.x, at.y, this.pickRadius()));
    });
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.pointers.size) {
        this.pointerWorld = null;
        this.setHovered(null);
      }
    });

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = this.localPoint(e);
        // Trackpad pinch arrives as ctrl+wheel with small deltas; mouse wheels send big ones.
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        cam.zoomAt(p.x, p.y, Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015)));
        this.revealUntil = 0;
        this.updatePointerWorld(p);
        $('hint').classList.add('gone');
      },
      { passive: false },
    );

    canvas.addEventListener('dblclick', (e) => {
      if (this.tool !== 'inspect') return;
      const p = this.localPoint(e);
      if (!this.world.creatureAt(cam.toWorldX(p.x), cam.toWorldY(p.y), this.pickRadius())) {
        cam.fit();
        this.releaseCamera();
      }
    });
  }

  private feedAt(now: number): void {
    if (!this.pointerWorld) return;
    const { x, y } = this.pointerWorld;
    this.world.sprinkleFood(x, y, FEED_RADIUS, 14);
    this.renderer.addFood(x, y, now);
    this.lastFeed = now;
  }
}
