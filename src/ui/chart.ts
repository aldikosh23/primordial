export interface Series {
  label: string;
  color: string;
  values: readonly number[];
}

export interface LineChartOptions {
  /** Always include zero on the y axis. */
  zeroBased: boolean;
  /** Number of horizontal gridlines (0 for none). */
  gridLines: number;
  lineWidth: number;
  formatValue: (v: number) => string;
  formatX: (index: number) => string;
  /** Show tick labels on the gridlines. */
  showTicks: boolean;
}

const TICK_FONT = '10px system-ui, -apple-system, sans-serif';
const INK_MUTED = '#7d8692'; // 5:1 on the card surface
const GRID = 'rgba(255, 255, 255, 0.06)';
const CROSSHAIR = 'rgba(255, 255, 255, 0.28)';
const SURFACE = '#101317';

/** Keeps a canvas sized to its box at device-pixel resolution. */
abstract class CanvasView {
  protected readonly canvas: HTMLCanvasElement;
  protected readonly ctx: CanvasRenderingContext2D;
  protected readonly tip: HTMLDivElement;
  protected width = 0;
  protected height = 0;
  protected dpr = 1;
  protected hoverX: number | null = null;
  protected hoverY: number | null = null;
  private dirty = true;

  constructor(protected readonly host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.tip = document.createElement('div');
    this.tip.className = 'chart-tip';
    this.tip.hidden = true;
    host.append(this.canvas, this.tip);

    new ResizeObserver(() => this.invalidate()).observe(host);
    host.addEventListener('pointermove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.hoverX = e.clientX - rect.left;
      this.hoverY = e.clientY - rect.top;
      this.invalidate();
    });
    host.addEventListener('pointerleave', () => {
      this.hoverX = this.hoverY = null;
      this.invalidate();
    });
  }

  invalidate(): void {
    this.dirty = true;
  }

  /** Redraws only when data, size or hover changed since the last call. */
  render(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w !== this.width || h !== this.height || dpr !== this.dpr) {
      this.width = w;
      this.height = h;
      this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(w * dpr));
      this.canvas.height = Math.max(1, Math.round(h * dpr));
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    this.paint();
  }

  protected abstract paint(): void;

  protected showTip(html: string, anchorX: number, anchorY: number): void {
    this.tip.innerHTML = html;
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth;
    const th = this.tip.offsetHeight;
    // Keep the tip inside its card, even when the chart itself is narrower than the tip.
    const own = this.host.getBoundingClientRect();
    const card = (this.host.closest('.card') ?? this.host).getBoundingClientRect();
    const minLeft = card.left - own.left + 6;
    const maxLeft = card.right - own.left - tw - 6;
    // Prefer the right of the anchor; flip left when it would overflow.
    let left = anchorX + 12;
    if (left > maxLeft) left = anchorX - tw - 12;
    left = Math.max(minLeft, Math.min(left, maxLeft));
    const top = Math.max(-th - 4, Math.min(anchorY - th / 2, this.height - th / 2));
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${top}px`;
  }

  protected hideTip(): void {
    this.tip.hidden = true;
  }
}

export function tipRows(rows: { label: string; color: string; value: string }[], head: string): string {
  const body = rows
    .map((r) => `<div class="tip-row"><i style="background:${r.color}"></i>${r.label}<b>${r.value}</b></div>`)
    .join('');
  return `<div class="tip-head">${head}</div>${body}`;
}

export class LineChart extends CanvasView {
  private series: Series[] = [];
  private readonly opts: LineChartOptions;

  constructor(host: HTMLElement, opts: Partial<LineChartOptions> = {}) {
    super(host);
    this.opts = {
      zeroBased: true,
      gridLines: 3,
      lineWidth: 2,
      formatValue: (v) => String(Math.round(v)),
      formatX: (i) => String(i),
      showTicks: true,
      ...opts,
    };
  }

  setSeries(series: Series[]): void {
    this.series = series;
    this.invalidate();
  }

  protected paint(): void {
    const { ctx, width, height, opts } = this;
    const n = Math.max(0, ...this.series.map((s) => s.values.length));
    const padL = opts.showTicks ? 30 : 2;
    const padR = 4;
    const padT = 6;
    const padB = 6;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    if (plotW <= 0 || plotH <= 0) return;

    // Y range from all finite values.
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of this.series) {
      for (const v of s.values) {
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    if (opts.zeroBased) lo = Math.min(0, lo);
    if (hi - lo < 1e-6) {
      hi += 1;
      if (!opts.zeroBased) lo -= 1;
    }
    const span = hi - lo;
    hi += span * 0.08;
    if (!opts.zeroBased) lo -= span * 0.08;

    const xAt = (i: number) => padL + (n <= 1 ? plotW : (i / (n - 1)) * plotW);
    const yAt = (v: number) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

    // Gridlines and ticks: recessive.
    ctx.font = TICK_FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.lineWidth = 1;
    for (let g = 0; g <= opts.gridLines && opts.gridLines > 0; g++) {
      const v = lo + ((hi - lo) * g) / opts.gridLines;
      const y = Math.round(yAt(v)) + 0.5;
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      if (opts.showTicks) {
        ctx.fillStyle = INK_MUTED;
        ctx.fillText(opts.formatValue(v), padL - 6, y);
      }
    }

    // Lines, broken where a series has no value (NaN).
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = opts.lineWidth;
    for (const s of this.series) {
      ctx.strokeStyle = s.color;
      ctx.beginPath();
      let drawing = false;
      s.values.forEach((v, i) => {
        if (!Number.isFinite(v)) {
          drawing = false;
          return;
        }
        const x = xAt(i);
        const y = yAt(v);
        if (drawing) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        drawing = true;
      });
      ctx.stroke();
    }

    // Hover: crosshair, markers with a surface ring, tooltip.
    if (this.hoverX === null || n === 0) {
      this.hideTip();
      return;
    }
    const idx = Math.max(0, Math.min(n - 1, Math.round(((this.hoverX - padL) / plotW) * (n - 1))));
    const x = xAt(idx);
    ctx.strokeStyle = CROSSHAIR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, padT);
    ctx.lineTo(Math.round(x) + 0.5, padT + plotH);
    ctx.stroke();
    const rows: { label: string; color: string; value: string }[] = [];
    for (const s of this.series) {
      const v = s.values[idx];
      rows.push({ label: s.label, color: s.color, value: Number.isFinite(v) ? opts.formatValue(v) : '—' });
      if (!Number.isFinite(v)) continue;
      ctx.fillStyle = s.color;
      ctx.strokeStyle = SURFACE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, yAt(v), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    this.showTip(tipRows(rows, opts.formatX(idx)), x, this.hoverY ?? height / 2);
  }
}

export interface HueTrail {
  label: string;
  color: string;
  hues: readonly number[];
}

/**
 * Polar "colour chase": angle = mean hue, radius = time (older inside, newer at the
 * rim). A ring of the actual hues frames it, so you can read the colour directly.
 */
export class HueSpiral extends CanvasView {
  private trails: HueTrail[] = [];
  private formatX: (i: number) => string = String;

  setTrails(trails: HueTrail[], formatX: (i: number) => string): void {
    this.trails = trails;
    this.formatX = formatX;
    this.invalidate();
  }

  protected paint(): void {
    const { ctx, width, height } = this;
    const cx = width / 2;
    const cy = height / 2;
    const outer = Math.min(width, height) / 2 - 2;
    const ringW = 7;
    const rMax = outer - ringW - 5;
    const rMin = rMax * 0.18;
    if (rMax <= 4) return; // not laid out yet, or far too small to draw
    const n = Math.max(0, ...this.trails.map((t) => t.hues.length));
    // Hue 0° at the top, increasing clockwise.
    const angle = (hue: number) => ((hue - 90) * Math.PI) / 180;
    const radius = (i: number) => (n <= 1 ? rMax : rMin + ((rMax - rMin) * i) / (n - 1));

    const ring = ctx.createConicGradient(angle(0), cx, cy);
    for (let h = 0; h <= 360; h += 30) ring.addColorStop(h / 360, `hsl(${h % 360} 62% 56%)`);
    ctx.strokeStyle = ring;
    ctx.lineWidth = ringW;
    ctx.beginPath();
    ctx.arc(cx, cy, outer - ringW / 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    for (const f of [0.33, 0.66, 1]) {
      ctx.beginPath();
      ctx.arc(cx, cy, rMin + (rMax - rMin) * f, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const t of this.trails) {
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let drawing = false;
      let last = -1;
      t.hues.forEach((h, i) => {
        if (!Number.isFinite(h)) {
          drawing = false;
          return;
        }
        const r = radius(i);
        const x = cx + Math.cos(angle(h)) * r;
        const y = cy + Math.sin(angle(h)) * r;
        if (drawing) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        drawing = true;
        last = i;
      });
      ctx.stroke();
      if (last >= 0) {
        const h = t.hues[last];
        ctx.fillStyle = t.color;
        ctx.strokeStyle = SURFACE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle(h)) * radius(last), cy + Math.sin(angle(h)) * radius(last), 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    if (this.hoverX === null || this.hoverY === null || n === 0) {
      this.hideTip();
      return;
    }
    // Hovering at a radius picks a moment in time.
    const d = Math.hypot(this.hoverX - cx, this.hoverY - cy);
    const idx = Math.max(0, Math.min(n - 1, Math.round(((d - rMin) / (rMax - rMin)) * (n - 1))));
    ctx.strokeStyle = CROSSHAIR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius(idx), 0, Math.PI * 2);
    ctx.stroke();
    const rows: { label: string; color: string; value: string }[] = [];
    for (const t of this.trails) {
      const h = t.hues[idx];
      rows.push({ label: t.label, color: t.color, value: Number.isFinite(h) ? `${Math.round(h)}°` : '—' });
      if (!Number.isFinite(h)) continue;
      ctx.fillStyle = t.color;
      ctx.strokeStyle = SURFACE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle(h)) * radius(idx), cy + Math.sin(angle(h)) * radius(idx), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    this.showTip(tipRows(rows, this.formatX(idx)), this.hoverX, this.hoverY);
  }
}
