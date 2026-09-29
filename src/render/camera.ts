/** Maps world units to CSS pixels: pan by moving the centre, zoom around a point. */
export class Camera {
  /** World point at the centre of the view. */
  x = 0;
  y = 0;
  /** CSS pixels per world unit. */
  zoom = 1;
  viewW = 1;
  viewH = 1;
  minZoom = 0.05;
  maxZoom = 6;
  /** Once the viewer pans or zooms, stop auto-fitting on resize. */
  userMoved = false;
  /**
   * Screen pixels covered by UI along the left / bottom edge (the inspector card on
   * phones). The camera may pan that much further, so a creature can sit beside it.
   */
  insetLeft = 0;
  insetBottom = 0;

  constructor(
    private readonly worldW: number,
    private readonly worldH: number,
  ) {
    this.x = worldW / 2;
    this.y = worldH / 2;
  }

  /** Zoom at which the whole world fits the view. */
  get containZoom(): number {
    return Math.min(this.viewW / this.worldW, this.viewH / this.worldH) * 0.94;
  }

  /**
   * Starting zoom: the whole world on landscape screens; on tall phone screens fill
   * the height instead (the sides can be panned) so creatures aren't specks.
   */
  get fitZoom(): number {
    if (this.viewW >= this.viewH) return this.containZoom;
    const cover = Math.max(this.viewW / this.worldW, this.viewH / this.worldH) * 0.94;
    return Math.min(cover, this.containZoom * 1.8);
  }

  resize(viewW: number, viewH: number): void {
    this.viewW = Math.max(1, viewW);
    this.viewH = Math.max(1, viewH);
    this.minZoom = this.containZoom * 0.75;
    if (this.userMoved) this.clamp();
    else this.fit();
  }

  fit(): void {
    this.zoom = this.fitZoom;
    this.x = this.worldW / 2;
    this.y = this.worldH / 2;
    this.userMoved = false;
  }

  toWorldX(sx: number): number {
    return (sx - this.viewW / 2) / this.zoom + this.x;
  }

  toWorldY(sy: number): number {
    return (sy - this.viewH / 2) / this.zoom + this.y;
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const wx = this.toWorldX(sx);
    const wy = this.toWorldY(sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    // Keep the world point under the cursor where it was.
    this.x = wx - (sx - this.viewW / 2) / this.zoom;
    this.y = wy - (sy - this.viewH / 2) / this.zoom;
    this.userMoved = true;
    this.clamp();
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.userMoved = true;
    this.clamp();
  }

  /** Ease towards a world point (used when following a creature). */
  follow(wx: number, wy: number, amount: number): void {
    this.x += (wx - this.x) * amount;
    this.y += (wy - this.y) * amount;
    this.clamp();
  }

  /** Keep the world on screen: centre it when it fits, otherwise limit panning. */
  clamp(): void {
    const halfW = this.viewW / 2 / this.zoom;
    const halfH = this.viewH / 2 / this.zoom;
    const margin = 60;
    const loX = halfW - margin - this.insetLeft / this.zoom;
    const hiX = this.worldW + margin - halfW;
    const loY = halfH - margin;
    const hiY = this.worldH + margin - halfH + this.insetBottom / this.zoom;
    this.x = loX > hiX ? (loX + hiX) / 2 : Math.min(hiX, Math.max(loX, this.x));
    this.y = loY > hiY ? (loY + hiY) / 2 : Math.min(hiY, Math.max(loY, this.y));
  }
}
