import { BIO, WORLD } from '../sim/config';
import type { Creature } from '../sim/creature';
import type { World } from '../sim/world';
import { Camera } from './camera';

export type Tool = 'inspect' | 'feed' | 'meteor';

export const FEED_RADIUS = 60;
export const METEOR_RADIUS = 130;

interface Look {
  body: string;
  dark: string;
  light: string;
  glow: HTMLCanvasElement;
}

interface Effect {
  kind: 'death' | 'birth' | 'meteor' | 'food';
  x: number;
  y: number;
  r: number;
  color: string;
  start: number;
  duration: number;
}

export interface DrawOptions {
  selected: Creature | null;
  hovered: Creature | null;
  tool: Tool;
  /** Pointer position in world units, or null when the pointer is outside the stage. */
  pointer: { x: number; y: number } | null;
  now: number;
}

const MAX_EFFECTS = 260;
const SIDES = [-1, 1] as const;
const GLOW_BUCKET = 10;
const TAU = Math.PI * 2;

export class Renderer {
  readonly camera: Camera;
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private readonly looks = new WeakMap<Creature, Look>();
  private readonly glows = new Map<number, HTMLCanvasElement>();
  private effects: Effect[] = [];
  private shakeUntil = 0;
  private shakeStrength = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly worldW: number,
    private readonly worldH: number,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
    this.camera = new Camera(worldW, worldH);
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.camera.resize(w, h);
  }

  // ------------------------------------------------------------- effects

  addDeath(c: Creature, now: number): void {
    if (c.deathCause === 'meteor' || this.effects.length >= MAX_EFFECTS) return;
    this.pushEffect({ kind: 'death', x: c.x, y: c.y, r: c.radius, color: this.look(c).light, start: now, duration: 700 });
  }

  addBirth(c: Creature, now: number): void {
    // Births are frequent at high speed; keep them from crowding out the rest.
    if (this.effects.length >= MAX_EFFECTS * 0.6) return;
    this.pushEffect({ kind: 'birth', x: c.x, y: c.y, r: c.radius, color: this.look(c).light, start: now, duration: 450 });
  }

  addMeteor(x: number, y: number, now: number): void {
    this.pushEffect({ kind: 'meteor', x, y, r: METEOR_RADIUS, color: '#ffb46b', start: now, duration: 1100 });
    this.shakeUntil = now + 380;
    this.shakeStrength = 7;
  }

  addFood(x: number, y: number, now: number): void {
    this.pushEffect({ kind: 'food', x, y, r: FEED_RADIUS, color: '#7ee29a', start: now, duration: 500 });
  }

  clearEffects(): void {
    this.effects = [];
  }

  /** Drop finished effects in place (no new array per frame). */
  private pruneEffects(now: number): void {
    const list = this.effects;
    let keep = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (now - e.start < e.duration) list[keep++] = e;
    }
    list.length = keep;
  }

  private pushEffect(e: Effect): void {
    this.effects.push(e);
    if (this.effects.length > MAX_EFFECTS) this.effects.shift();
  }

  // ------------------------------------------------------------- colours

  look(c: Creature): Look {
    let look = this.looks.get(c);
    if (!look) {
      const h = Math.round(c.genome.hue);
      look = {
        body: `hsl(${h} 62% 56%)`,
        dark: `hsl(${h} 52% 36%)`,
        light: `hsl(${h} 80% 80%)`,
        glow: this.glow(h),
      };
      this.looks.set(c, look);
    }
    return look;
  }

  private glow(hue: number): HTMLCanvasElement {
    const bucket = (Math.round(hue / GLOW_BUCKET) * GLOW_BUCKET) % 360;
    let sprite = this.glows.get(bucket);
    if (!sprite) {
      sprite = document.createElement('canvas');
      sprite.width = sprite.height = 64;
      const g = sprite.getContext('2d')!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, `hsla(${bucket}, 90%, 62%, 0.55)`);
      grad.addColorStop(0.35, `hsla(${bucket}, 90%, 55%, 0.18)`);
      grad.addColorStop(1, `hsla(${bucket}, 90%, 50%, 0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      this.glows.set(bucket, sprite);
    }
    return sprite;
  }

  // ---------------------------------------------------------------- draw

  draw(world: World, opts: DrawOptions): void {
    const { ctx, camera, dpr } = this;
    const { now } = opts;
    const zoom = camera.zoom;

    let shakeX = 0;
    let shakeY = 0;
    if (now < this.shakeUntil) {
      const k = (this.shakeUntil - now) / 380;
      shakeX = (Math.random() - 0.5) * this.shakeStrength * k * dpr;
      shakeY = (Math.random() - 0.5) * this.shakeStrength * k * dpr;
    }

    // World → device pixels: scale by zoom, then centre the camera.
    const s = dpr * zoom;
    const tx = dpr * (camera.viewW / 2 - camera.x * zoom) + shakeX;
    const ty = dpr * (camera.viewH / 2 - camera.y * zoom) + shakeY;
    const setWorld = () => ctx.setTransform(s, 0, 0, s, tx, ty);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Visible world rectangle (with a margin) for culling.
    const pad = 40;
    const vx0 = camera.toWorldX(0) - pad;
    const vy0 = camera.toWorldY(0) - pad;
    const vx1 = camera.toWorldX(camera.viewW) + pad;
    const vy1 = camera.toWorldY(camera.viewH) + pad;

    this.pruneEffects(now);

    setWorld();
    this.drawFloor(world, zoom);
    this.drawPlants(world, vx0, vy0, vx1, vy1, zoom);
    this.drawEffects(now, 'under', zoom);
    this.drawCreatures(world, vx0, vy0, vx1, vy1, s, tx, ty, zoom);
    setWorld();
    if (opts.hovered && opts.hovered !== opts.selected && !opts.hovered.dead) this.drawHover(opts.hovered, zoom);
    if (opts.selected) this.drawSelection(opts.selected, zoom);
    this.drawEffects(now, 'over', zoom);
    if (opts.pointer && opts.tool !== 'inspect') this.drawToolPreview(opts.tool, opts.pointer, zoom, now);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  private drawFloor(world: World, zoom: number): void {
    const { ctx } = this;
    const W = this.worldW;
    const H = this.worldH;

    ctx.fillStyle = '#081018';
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 24);
    ctx.fill();

    // Faint lab grid: gives a sense of scale when zooming.
    if (zoom > 0.25) {
      ctx.strokeStyle = 'rgba(160, 200, 255, 0.035)';
      ctx.lineWidth = 1 / zoom;
      ctx.beginPath();
      for (let x = 100; x < W; x += 100) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
      }
      for (let y = 100; y < H; y += 100) {
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.stroke();
    }

    // Fertile patches: soft green haze where plants grow and small creatures hide.
    for (const p of world.patches) {
      const r = p.radius * 1.35;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, 'rgba(56, 206, 140, 0.16)');
      grad.addColorStop(0.55, 'rgba(46, 180, 130, 0.07)');
      grad.addColorStop(1, 'rgba(40, 160, 120, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
      // Edge of the cover zone.
      ctx.strokeStyle = 'rgba(120, 230, 180, 0.07)';
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([4 / zoom, 8 / zoom]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * BIO.coverShare, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = 'rgba(160, 210, 255, 0.10)';
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 24);
    ctx.stroke();
  }

  private drawPlants(world: World, x0: number, y0: number, x1: number, y1: number, zoom: number): void {
    const { ctx } = this;
    const r = Math.max(WORLD.plantRadius * 0.75, 0.9 / zoom);
    const glowR = r * 2.4;

    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(80, 200, 120, 0.06)';
    ctx.beginPath();
    for (const p of world.plants) {
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      ctx.moveTo(p.x + glowR, p.y);
      ctx.arc(p.x, p.y, glowR, 0, TAU);
    }
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = 'rgba(98, 205, 134, 0.8)';
    ctx.beginPath();
    for (const p of world.plants) {
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, TAU);
    }
    ctx.fill();
  }

  private drawCreatures(
    world: World,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    s: number,
    tx: number,
    ty: number,
    zoom: number,
  ): void {
    const { ctx } = this;
    const list = world.creatures;
    // Zoomed out, creatures are drawn a little larger than life so they stay readable.
    const boost = 1 + Math.min(1, Math.max(0, (1.1 - zoom) * 1.3));

    // Pass 1: additive glow halos.
    ctx.setTransform(s, 0, 0, s, tx, ty);
    ctx.globalCompositeOperation = 'lighter';
    for (const c of list) {
      if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue;
      const size = c.radius * 5.2 * boost;
      ctx.globalAlpha = 0.55 * this.alphaOf(c);
      ctx.drawImage(this.look(c).glow, c.x - size / 2, c.y - size / 2, size, size);
    }
    ctx.globalCompositeOperation = 'source-over';

    // Pass 2: bodies, drawn in each creature's own rotated frame.
    for (const c of list) {
      if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue;
      const look = this.look(c);
      const r = c.radius;
      const grow = Math.min(1, 0.45 + (world.tick - c.bornAtTick) / 60);
      const pulse = c.feeding > 0 ? 1 + 0.07 * Math.sin(c.feeding * 0.9) : 1;
      const k = s * grow * pulse * boost;
      const cos = Math.cos(c.heading) * k;
      const sin = Math.sin(c.heading) * k;
      ctx.setTransform(cos, sin, -sin, cos, tx + c.x * s, ty + c.y * s);
      ctx.globalAlpha = this.alphaOf(c);

      if (r * zoom * boost < 2.2) {
        // Too small on screen for details.
        ctx.fillStyle = look.body;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.fill();
        continue;
      }

      // Tail, wiggling faster when moving.
      const phase = c.age * (0.18 + c.velocity * 0.12) + c.id;
      const wig = Math.sin(phase);
      ctx.strokeStyle = look.dark;
      ctx.lineWidth = r * 0.3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, 0);
      ctx.quadraticCurveTo(-r * 1.55, wig * r * 0.55, -r * 2.15, Math.sin(phase - 1.3) * r * 0.75);
      ctx.stroke();

      // Jaws for anything that hunts; bigger and sharper the more carnivorous.
      if (c.canHunt) {
        const reach = r * (1.05 + 0.45 * c.genome.diet);
        const open = c.behaviour === 'hunt' ? 0.34 : 0.14;
        ctx.fillStyle = look.light;
        for (const side of SIDES) {
          ctx.beginPath();
          ctx.moveTo(r * 0.7, side * r * 0.2);
          ctx.lineTo(reach, side * r * open);
          ctx.lineTo(r * 0.82, side * r * 0.62);
          ctx.closePath();
          ctx.fill();
        }
      }

      ctx.fillStyle = look.body;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.1, r * 0.9, 0, 0, TAU);
      ctx.fill();

      ctx.fillStyle = look.light;
      ctx.globalAlpha *= 0.85;
      ctx.beginPath();
      ctx.arc(-r * 0.18, 0, r * 0.4, 0, TAU);
      ctx.fill();

      ctx.globalAlpha = this.alphaOf(c);
      ctx.fillStyle = '#071017';
      const eye = Math.max(r * 0.16, 0.9 / (zoom * grow * boost));
      ctx.beginPath();
      ctx.arc(r * 0.52, -r * 0.36, eye, 0, TAU);
      ctx.moveTo(r * 0.52 + eye, r * 0.36);
      ctx.arc(r * 0.52, r * 0.36, eye, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Starving creatures fade; hidden ones are translucent. */
  private alphaOf(c: Creature): number {
    const vitality = 0.45 + 0.55 * Math.min(1, c.energyFraction * 1.5);
    return c.visibility < 1 ? vitality * 0.72 : vitality;
  }

  private drawHover(c: Creature, zoom: number): void {
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.radius * 1.9 + 3 / zoom, 0, TAU);
    ctx.stroke();
  }

  private drawSelection(c: Creature, zoom: number): void {
    const { ctx } = this;
    const look = this.look(c);
    if (!c.dead) {
      // Vision range.
      ctx.strokeStyle = look.light;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1.2 / zoom;
      ctx.setLineDash([5 / zoom, 6 / zoom]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.genome.sense, 0, TAU);
      ctx.stroke();

      if (c.behaviour === 'hunt' || c.behaviour === 'forage') {
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(c.targetX, c.targetY);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = c.dead ? 'rgba(230, 103, 103, 0.9)' : '#ffffff';
    ctx.lineWidth = 2 / zoom;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.radius * 1.9 + 4 / zoom, 0, TAU);
    ctx.stroke();
  }

  private drawEffects(now: number, layer: 'under' | 'over', zoom: number): void {
    const { ctx } = this;
    for (const e of this.effects) {
      const t = (now - e.start) / e.duration;
      const isOver = e.kind === 'meteor';
      if ((layer === 'over') !== isOver || t < 0 || t >= 1) continue;
      const ease = 1 - (1 - t) * (1 - t);
      switch (e.kind) {
        case 'death': {
          ctx.globalAlpha = 0.7 * (1 - t);
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 1.5 / zoom;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r * (1 + 2.2 * ease), 0, TAU);
          ctx.stroke();
          break;
        }
        case 'birth': {
          ctx.globalAlpha = 0.5 * (1 - t);
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 1 / zoom;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r * (0.5 + 1.6 * ease), 0, TAU);
          ctx.stroke();
          break;
        }
        case 'food': {
          ctx.globalAlpha = 0.45 * (1 - t);
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 2 / zoom;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r * (0.6 + 0.5 * ease), 0, TAU);
          ctx.stroke();
          break;
        }
        case 'meteor': {
          // Flash, then a shockwave ring.
          const flash = Math.max(0, 1 - t * 2.2);
          if (flash > 0) {
            const grad = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r);
            grad.addColorStop(0, `rgba(255, 236, 200, ${0.9 * flash})`);
            grad.addColorStop(0.45, `rgba(255, 150, 70, ${0.55 * flash})`);
            grad.addColorStop(1, 'rgba(255, 90, 40, 0)');
            ctx.globalAlpha = 1;
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.r, 0, TAU);
            ctx.fill();
          }
          ctx.globalAlpha = 0.8 * (1 - t);
          ctx.strokeStyle = e.color;
          ctx.lineWidth = (4 * (1 - t) + 1) / zoom;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r * (0.3 + 1.4 * ease), 0, TAU);
          ctx.stroke();
          // Scorch mark that lingers.
          ctx.globalAlpha = 0.35 * (1 - t);
          ctx.fillStyle = '#1a0d06';
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r * 0.6, 0, TAU);
          ctx.fill();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawToolPreview(tool: Tool, p: { x: number; y: number }, zoom: number, now: number): void {
    const { ctx } = this;
    const r = tool === 'feed' ? FEED_RADIUS : METEOR_RADIUS;
    ctx.strokeStyle = tool === 'feed' ? 'rgba(126, 226, 154, 0.7)' : 'rgba(255, 170, 100, 0.75)';
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([6 / zoom, 5 / zoom]);
    ctx.lineDashOffset = (-now / 60) / zoom;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    if (tool === 'meteor') {
      const t = 8 / zoom;
      ctx.beginPath();
      ctx.moveTo(p.x - t, p.y);
      ctx.lineTo(p.x + t, p.y);
      ctx.moveTo(p.x, p.y - t);
      ctx.lineTo(p.x, p.y + t);
      ctx.stroke();
    }
  }
}
