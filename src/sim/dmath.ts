/**
 * Deterministic math for the simulation.
 *
 * `Math.sin`, `Math.cos`, `Math.atan2`, `Math.log`, `Math.exp`, `**` and `Math.hypot` are
 * only approximately specified, so V8 (Chrome) and JavaScriptCore (Safari) can disagree in
 * the last bit, and a world grown from the same seed slowly drifts apart between browsers.
 * These versions use only +, −, ×, ÷, `Math.sqrt` and exact bit manipulation, all of which
 * IEEE 754 defines exactly, so every engine computes identical results. The polynomials
 * are the classic fdlibm ones (accurate to about one unit in the last place).
 */

const view = new DataView(new ArrayBuffer(8));

// ------------------------------------------------------------------ sin / cos

const TWO_OVER_PI = 0.6366197723675814;
// π/2 split for Cody–Waite range reduction: HI has only 33 significant bits, so n·HI is exact.
const PIO2_HI = 1.5707963267341256;
const PIO2_LO = 6.077100506506192e-11;

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

/** sin on [−π/4, π/4]. */
function kernelSin(x: number): number {
  const z = x * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + z * x * (S1 + z * r);
}

/** cos on [−π/4, π/4]. */
function kernelCos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  return 1 - (0.5 * z - z * r);
}

/** Remainder written by reduce(), read right after it by dsin/dcos. */
let reduced = 0;

/** Reduces x to r in [−π/4, π/4] with x = n·π/2 + r; stores r in `reduced`, returns n mod 4. */
function reduce(x: number): number {
  const n = Math.round(x * TWO_OVER_PI);
  reduced = x - n * PIO2_HI - n * PIO2_LO;
  return ((n % 4) + 4) % 4;
}

export function dsin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const q = reduce(x);
  const r = reduced;
  switch (q) {
    case 0:
      return kernelSin(r);
    case 1:
      return kernelCos(r);
    case 2:
      return -kernelSin(r);
    default:
      return -kernelCos(r);
  }
}

export function dcos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const q = reduce(x);
  const r = reduced;
  switch (q) {
    case 0:
      return kernelCos(r);
    case 1:
      return -kernelSin(r);
    case 2:
      return -kernelCos(r);
    default:
      return kernelSin(r);
  }
}

// ------------------------------------------------------------------ atan / atan2

const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;
const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, HALF_PI];
const ATAN_LO = [
  2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17,
];
const AT0 = 3.33333333333329318027e-1;
const AT1 = -1.99999999998764832476e-1;
const AT2 = 1.42857142725034663711e-1;
const AT3 = -1.1111110405462355788e-1;
const AT4 = 9.09088713343650656196e-2;
const AT5 = -7.69187620504482999495e-2;
const AT6 = 6.66107313738753120669e-2;
const AT7 = -5.83357013379057348645e-2;
const AT8 = 4.97687799461593236017e-2;
const AT9 = -3.6531572744216915527e-2;
const AT10 = 1.62858201153657823623e-2;

export function datan(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const negative = x < 0;
  let ax = negative ? -x : x;
  if (ax >= 7.378697629483821e19) return negative ? -HALF_PI : HALF_PI; // 2^66
  let id: number;
  if (ax < 0.4375) {
    if (ax < 3.725290298461914e-9) return x; // 2^-28: atan(x) = x
    id = -1;
  } else if (ax < 1.1875) {
    if (ax < 0.6875) {
      id = 0;
      ax = (2 * ax - 1) / (2 + ax);
    } else {
      id = 1;
      ax = (ax - 1) / (ax + 1);
    }
  } else if (ax < 2.4375) {
    id = 2;
    ax = (ax - 1.5) / (1 + 1.5 * ax);
  } else {
    id = 3;
    ax = -1 / ax;
  }
  const z = ax * ax;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  if (id < 0) return x - x * (s1 + s2);
  const result = ATAN_HI[id] - (ax * (s1 + s2) - ATAN_LO[id] - ax);
  return negative ? -result : result;
}

export function datan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 0) {
    if (y === 0) return 0;
    return y > 0 ? HALF_PI : -HALF_PI;
  }
  if (y === 0) return x > 0 ? y : Object.is(y, -0) ? -PI : PI;
  const z = datan(Math.abs(y / x));
  if (x > 0) return y > 0 ? z : -z;
  return y > 0 ? PI - z : z - PI;
}

// ------------------------------------------------------------------ log / exp / pow

const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const LG1 = 6.666666666666735130e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

const MIN_NORMAL = 2.2250738585072014e-308;
const TWO54 = 18014398509481984;

/** Natural logarithm. */
export function dlog(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let k = 0;
  if (x < MIN_NORMAL) {
    // Subnormal: scale into the normal range first.
    x *= TWO54;
    k = -54;
  }
  // Split x = 2^k · m with m in [1, 2) by reading and rewriting the exponent bits.
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  k += ((hi >>> 20) & 0x7ff) - 1023;
  view.setUint32(0, (hi & 0x000fffff) | 0x3ff00000);
  let m = view.getFloat64(0);
  // Centre m on 1 (range [√½, √2)) so the series converges fast.
  if (m > 1.4142135623730951) {
    m *= 0.5;
    k += 1;
  }
  const f = m - 1;
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const r = t2 + t1;
  const hfsq = 0.5 * f * f;
  return k * LN2_HI - (hfsq - (s * (hfsq + r) + k * LN2_LO) - f);
}

const INV_LN2 = 1.4426950408889634;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6;
const P5 = 4.13813679705723846039e-8;

/** y · 2^k, exactly (barring overflow/underflow), by building 2^k from its bits. */
function scale(y: number, k: number): number {
  if (k > 1023) return scale(y * 8.98846567431158e307, k - 1023); // 2^1023
  if (k < -1022) return scale(y * 2.2250738585072014e-308, k + 1022); // 2^-1022
  view.setUint32(0, (k + 1023) << 20);
  view.setUint32(4, 0);
  return y * view.getFloat64(0);
}

export function dexp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  const k = Math.round(x * INV_LN2);
  const hi = x - k * LN2_HI;
  const lo = k * LN2_LO;
  const r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const y = 1 - (lo - (r * c) / (2 - c) - hi);
  return k === 0 ? y : scale(y, k);
}

/** base^exponent for base ≥ 0. Whole-number exponents 0–4 multiply directly. */
export function dpow(base: number, exponent: number): number {
  if (Number.isNaN(base) || Number.isNaN(exponent) || base < 0) return NaN;
  switch (exponent) {
    case 0:
      return 1;
    case 1:
      return base;
    case 2:
      return base * base;
    case 3:
      return base * base * base;
    case 4: {
      const sq = base * base;
      return sq * sq;
    }
    case 0.5:
      return Math.sqrt(base);
  }
  if (base === 0) return exponent > 0 ? 0 : Infinity;
  if (base === 1) return 1;
  return dexp(exponent * dlog(base));
}

/** √(x² + y²) without Math.hypot (which is not exactly specified). */
export function dhypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
