export interface Point {
  x: number;
  y: number;
}

/**
 * Uniform grid rebuilt from scratch each tick with a counting sort.
 * Turns "who is near me?" from O(n) per creature into a handful of cells.
 */
export class SpatialGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly cellStart: Int32Array;
  private items = new Int32Array(0);
  private cellOf = new Int32Array(0);

  constructor(
    readonly width: number,
    readonly height: number,
    readonly cellSize: number,
  ) {
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.cellStart = new Int32Array(this.cols * this.rows + 1);
  }

  private cellX(x: number): number {
    const c = Math.floor(x / this.cellSize);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private cellY(y: number): number {
    const r = Math.floor(y / this.cellSize);
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }

  rebuild(points: readonly Point[]): void {
    const n = points.length;
    if (this.items.length < n) {
      const cap = Math.max(n, this.items.length * 2, 64);
      this.items = new Int32Array(cap);
      this.cellOf = new Int32Array(cap);
    }
    const start = this.cellStart;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const cell = this.cellY(p.y) * this.cols + this.cellX(p.x);
      this.cellOf[i] = cell;
      start[cell + 1]++;
    }
    for (let c = 1; c < start.length; c++) start[c] += start[c - 1];
    // Fill using a moving cursor per cell, then restore the starts.
    for (let i = 0; i < n; i++) this.items[start[this.cellOf[i]]++] = i;
    for (let c = start.length - 1; c > 0; c--) start[c] = start[c - 1];
    start[0] = 0;
  }

  /**
   * Writes the indices of every point in cells overlapping the circle's bounding
   * box into `out` and returns how many were written. Callers still check exact
   * distance.
   */
  query(x: number, y: number, radius: number, out: number[]): number {
    const x0 = this.cellX(x - radius);
    const x1 = this.cellX(x + radius);
    const y0 = this.cellY(y - radius);
    const y1 = this.cellY(y + radius);
    let count = 0;
    for (let row = y0; row <= y1; row++) {
      const base = row * this.cols;
      const from = this.cellStart[base + x0];
      const to = this.cellStart[base + x1 + 1];
      for (let k = from; k < to; k++) out[count++] = this.items[k];
    }
    return count;
  }
}
