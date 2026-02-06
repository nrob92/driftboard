/**
 * Client-side filter pipeline for LoginSandbox (in-memory only).
 * Mirrors the main app's Light / Curves / Color / Effects order.
 */

import { type CurvePoint, type ChannelCurves } from '@/lib/types';

export type { CurvePoint, ChannelCurves };

export interface SandboxImageFilters {
  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  whites?: number;
  blacks?: number;
  temperature?: number;
  vibrance?: number;
  saturation?: number;
  clarity?: number;
  dehaze?: number;
  vignette?: number;
  grain?: number;
  curves?: ChannelCurves;
}

function buildLUT(points: CurvePoint[]): Uint8Array {
  const lut = new Uint8Array(256);
  if (points.length === 2) {
    const sorted = [...points].sort((a, b) => a.x - b.x);
    if (sorted[0].x === 0 && sorted[0].y === 0 && sorted[1].x === 255 && sorted[1].y === 255) {
      for (let i = 0; i < 256; i++) lut[i] = i;
      return lut;
    }
  }
  const sorted = [...points].sort((a, b) => a.x - b.x);

  const interpolate = (x: number): number => {
    if (sorted.length === 0) return x;
    if (sorted.length === 1) return sorted[0].y;
    if (x <= sorted[0].x) return sorted[0].y;
    if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;

    let i = 0;
    while (i < sorted.length - 1 && sorted[i + 1].x < x) i++;

    const p0 = sorted[Math.max(0, i - 1)];
    const p1 = sorted[i];
    const p2 = sorted[Math.min(sorted.length - 1, i + 1)];
    const p3 = sorted[Math.min(sorted.length - 1, i + 2)];

    const t = (x - p1.x) / (p2.x - p1.x || 1);
    const t2 = t * t;
    const t3 = t2 * t;

    const y = 0.5 * (
      (2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    );

    return Math.max(0, Math.min(255, Math.round(y)));
  };

  for (let i = 0; i < 256; i++) {
    lut[i] = interpolate(i);
  }
  return lut;
}

const CURVES_STRENGTH = 0.6;

function createCurvesFilter(curves: ChannelCurves) {
  const rgbLUT = buildLUT(curves.rgb);
  const redLUT = buildLUT(curves.red);
  const greenLUT = buildLUT(curves.green);
  const blueLUT = buildLUT(curves.blue);
  const s = CURVES_STRENGTH;

  return function (imageData: ImageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const origR = data[i];
      const origG = data[i + 1];
      const origB = data[i + 2];
      const curvedR = redLUT[rgbLUT[origR]];
      const curvedG = greenLUT[rgbLUT[origG]];
      const curvedB = blueLUT[rgbLUT[origB]];
      data[i] = Math.round((1 - s) * origR + s * curvedR);
      data[i + 1] = Math.round((1 - s) * origG + s * curvedG);
      data[i + 2] = Math.round((1 - s) * origB + s * curvedB);
    }
  };
}

function createExposureFilter(exposure: number) {
  const lut = new Uint8ClampedArray(256);
  const factor = Math.pow(2, exposure);
  for (let i = 0; i < 256; i++) {
    lut[i] = i * factor;
  }
  return function (imageData: ImageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
  };
}

function createTonalFilter(highlights: number, shadows: number, whites: number, blacks: number) {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let val = i / 255;
    if (val < 0.25) {
      const blackMask = 1 - val / 0.25;
      val += blacks * 0.3 * blackMask;
    }
    const shadowMask = val < 0.5 ? Math.sin(val * Math.PI) : 0;
    val += shadows * 0.12 * shadowMask;
    const highlightMask = val > 0.5 ? Math.sin((val - 0.5) * Math.PI) : 0;
    val += highlights * 0.3 * highlightMask;
    if (val > 0.75) {
      const whiteMask = (val - 0.75) / 0.25;
      val += whites * 0.3 * whiteMask;
    }
    lut[i] = Math.max(0, Math.min(1, val)) * 255;
  }
  return function (imageData: ImageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
  };
}

function createContrastFilterParam(konvaContrastValue: number) {
  const adjust = Math.pow((konvaContrastValue + 100) / 100, 2);
  return function (imageData: ImageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i] / 255 - 0.5; r = (r * adjust + 0.5) * 255; data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      let g = data[i + 1] / 255 - 0.5; g = (g * adjust + 0.5) * 255; data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      let b = data[i + 2] / 255 - 0.5; b = (b * adjust + 0.5) * 255; data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  };
}

function createTemperatureFilter(temperature: number) {
  const tempFactor = temperature * 30;
  const redLut = new Uint8ClampedArray(256);
  const blueLut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    redLut[i] = i + tempFactor;
    blueLut[i] = i - tempFactor;
  }
  return function (imageData: ImageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = redLut[data[i]];
      data[i + 2] = blueLut[data[i + 2]];
    }
  };
}

function createHSVFilterParam(saturationValue: number, hueValue: number) {
  const v = Math.pow(2, 0);
  const s = Math.pow(2, saturationValue);
  const h = Math.abs(hueValue + 360) % 360;
  const vsu = v * s * Math.cos((h * Math.PI) / 180);
  const vsw = v * s * Math.sin((h * Math.PI) / 180);
  const rr = 0.299 * v + 0.701 * vsu + 0.167 * vsw;
  const rg = 0.587 * v - 0.587 * vsu + 0.33 * vsw;
  const rb = 0.114 * v - 0.114 * vsu - 0.497 * vsw;
  const gr = 0.299 * v - 0.299 * vsu - 0.328 * vsw;
  const gg = 0.587 * v + 0.413 * vsu + 0.035 * vsw;
  const gb = 0.114 * v - 0.114 * vsu + 0.293 * vsw;
  const br = 0.299 * v - 0.3 * vsu + 1.25 * vsw;
  const bg = 0.587 * v - 0.586 * vsu - 1.05 * vsw;
  const bb = 0.114 * v + 0.886 * vsu - 0.2 * vsw;
  return function (imageData: ImageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const nr = rr * r + rg * g + rb * b;
      const ng = gr * r + gg * g + gb * b;
      const nb = br * r + bg * g + bb * b;
      data[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
      data[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
      data[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
    }
  };
}

function createVibranceFilter(vibrance: number) {
  const amt = vibrance * 1.5;
  const rCoef = 0.299, gCoef = 0.587, bCoef = 0.114;
  return function (imageData: ImageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
      if (max === 0) continue;
      const sat = (max - min) / max;
      const factor = 1 + amt * (1 - sat);
      const gray = rCoef * r + gCoef * g + bCoef * b;
      const nr = gray + (r - gray) * factor;
      const ng = gray + (g - gray) * factor;
      const nb = gray + (b - gray) * factor;
      data[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
      data[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
      data[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
    }
  };
}

function createClarityFilter(clarity: number) {
  const lut = new Uint8ClampedArray(256);
  const factor = 1 + clarity * 0.5;
  for (let i = 0; i < 256; i++) {
    const val = i / 255;
    const diff = val - 0.5;
    const weight = 1 - Math.abs(diff) * 1.5;
    const newVal = 0.5 + diff * (1 + (factor - 1) * Math.max(0, weight));
    lut[i] = Math.max(0, Math.min(1, newVal)) * 255;
  }
  return function (imageData: ImageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
  };
}

function createDehazeFilter(dehaze: number) {
  const contrastBoost = 1 + dehaze * 0.5;
  const satBoost = 1 + dehaze * 0.3;
  const rCoef = 0.299, gCoef = 0.587, bCoef = 0.114;
  return function (imageData: ImageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i], g = data[i + 1], b = data[i + 2];
      let nr = 128 + (r - 128) * contrastBoost;
      let ng = 128 + (g - 128) * contrastBoost;
      let nb = 128 + (b - 128) * contrastBoost;
      const ngray = rCoef * nr + gCoef * ng + bCoef * nb;
      nr = ngray + (nr - ngray) * satBoost;
      ng = ngray + (ng - ngray) * satBoost;
      nb = ngray + (nb - ngray) * satBoost;
      data[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
      data[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
      data[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
    }
  };
}

function createVignetteFilter(vignette: number) {
  let falloffMap: Float32Array | null = null;
  let lastW = 0, lastH = 0;
  return function (imageData: ImageData) {
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    if (w !== lastW || h !== lastH) {
      lastW = w;
      lastH = h;
      falloffMap = new Float32Array(w * h);
      const cx = w * 0.5, cy = h * 0.5;
      const maxDistSq = cx * cx + cy * cy;
      for (let y = 0; y < h; y++) {
        const dy = y - cy;
        const rowOffset = y * w;
        for (let x = 0; x < w; x++) {
          const dx = x - cx;
          const distSq = (dx * dx + dy * dy) / maxDistSq;
          const falloff = distSq * vignette;
          falloffMap![rowOffset + x] = falloff < 1 ? 1 - falloff : 0;
        }
      }
    }
    const map = falloffMap!;
    const pixelCount = w * h;
    for (let p = 0; p < pixelCount; p++) {
      const i = p * 4;
      const factor = map[p];
      data[i] *= factor;
      data[i + 1] *= factor;
      data[i + 2] *= factor;
    }
  };
}

function createGrainFilter(grain: number) {
  const intensity = grain * 50;
  const patternSize = 4096;
  const noisePattern = new Int8Array(patternSize);
  for (let i = 0; i < patternSize; i++) {
    noisePattern[i] = ((Math.random() - 0.5) * intensity) | 0;
  }
  return function (imageData: ImageData) {
    const data = imageData.data;
    let offset = (Math.random() * patternSize) | 0;
    for (let i = 0; i < data.length; i += 4) {
      const noise = noisePattern[offset];
      offset = (offset + 1) % patternSize;
      const r = data[i] + noise;
      const g = data[i + 1] + noise;
      const b = data[i + 2] + noise;
      data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  };
}

function isCurvesModified(curves: ChannelCurves | undefined): boolean {
  if (!curves) return false;
  const ch = (points: CurvePoint[]) => {
    if (!points || points.length === 0) return false;
    if (points.length > 2) return true;
    return points.some((p, i) =>
      i === 0 ? p.x !== 0 || p.y !== 0 : i === points.length - 1 ? p.x !== 255 || p.y !== 255 : true
    );
  };
  return ch(curves.rgb) || ch(curves.red) || ch(curves.green) || ch(curves.blue);
}

/** Build filter list in same order as main app: curves → light → color → effects. */
export function buildSandboxFilterList(img: SandboxImageFilters): ((imageData: ImageData) => void)[] {
  const list: ((imageData: ImageData) => void)[] = [];

  if (isCurvesModified(img.curves) && img.curves) {
    list.push(createCurvesFilter(img.curves));
  }
  if ((img.exposure ?? 0) !== 0) {
    list.push(createExposureFilter(img.exposure!));
  }
  if ((img.highlights ?? 0) !== 0 || (img.shadows ?? 0) !== 0 || (img.whites ?? 0) !== 0 || (img.blacks ?? 0) !== 0) {
    list.push(createTonalFilter(
      img.highlights ?? 0,
      img.shadows ?? 0,
      img.whites ?? 0,
      img.blacks ?? 0
    ));
  }
  if ((img.clarity ?? 0) !== 0) {
    list.push(createClarityFilter(img.clarity!));
  }
  if ((img.contrast ?? 0) !== 0) {
    list.push(createContrastFilterParam((img.contrast ?? 0) * 25));
  }
  if ((img.temperature ?? 0) !== 0) {
    list.push(createTemperatureFilter(img.temperature!));
  }
  if ((img.saturation ?? 0) !== 0) {
    list.push(createHSVFilterParam((img.saturation ?? 0) * 2, 0));
  }
  if ((img.vibrance ?? 0) !== 0) {
    list.push(createVibranceFilter(img.vibrance!));
  }
  if ((img.dehaze ?? 0) !== 0) {
    list.push(createDehazeFilter(img.dehaze!));
  }
  if ((img.vignette ?? 0) !== 0) {
    list.push(createVignetteFilter(img.vignette!));
  }
  if ((img.grain ?? 0) !== 0) {
    list.push(createGrainFilter(img.grain!));
  }

  return list;
}
