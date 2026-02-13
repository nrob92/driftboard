/**
 * Client-side image filter creators for Konva canvas rendering.
 * Each function returns a closure that processes ImageData pixels.
 * Pre-computes LUTs where possible for maximum per-frame performance.
 */

import Konva from 'konva';
import type { CurvePoint, ChannelCurves, ColorHSL, SplitToning, ColorGrading, ColorCalibration, CanvasImage } from '@/lib/types';
import { buildLUT, isCurvesModified } from './core';

// Custom brightness filter that multiplies instead of adds (prevents black screens)
// Uses pre-computed LUT for maximum performance
export const createBrightnessFilter = (brightness: number) => {
  // Pre-compute 256-entry lookup table
  const lut = new Uint8ClampedArray(256);
  const factor = 1 + brightness;
  for (let i = 0; i < 256; i++) {
    lut[i] = i * factor; // Uint8ClampedArray auto-clamps to 0-255
  }

  return function (imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
  };
};

// Exposure filter - like brightness but uses power curve for more natural look
// Uses pre-computed LUT for maximum performance
export const createExposureFilter = (exposure: number) => {
  // Pre-compute 256-entry lookup table
  const lut = new Uint8ClampedArray(256);
  const factor = Math.pow(2, exposure);
  for (let i = 0; i < 256; i++) {
    lut[i] = i * factor; // Uint8ClampedArray auto-clamps to 0-255
  }

  return function (imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
  };
};

// Tonal filter for highlights, shadows, whites, blacks
export const createTonalFilter = (highlights: number, shadows: number, whites: number, blacks: number) => {
  const lut = new Uint8ClampedArray(256);

  for (let i = 0; i < 256; i++) {
    let val = i / 255;

    // Blacks: 0-25%
    if (val < 0.25) {
      const blackMask = 1 - val / 0.25;
      val += blacks * 0.3 * blackMask;
    }

    // Shadows: 0-50% (slightly more aggressive than other tonals)
    const shadowMask = val < 0.5 ? Math.sin(val * Math.PI) : 0;
    val += shadows * 0.12 * shadowMask;

    // Highlights: 50-100%
    const highlightMask = val > 0.5 ? Math.sin((val - 0.5) * Math.PI) : 0;
    val += highlights * 0.3 * highlightMask;

    // Whites: 75-100%
    if (val > 0.75) {
      const whiteMask = (val - 0.75) / 0.25;
      val += whites * 0.3 * whiteMask;
    }

    lut[i] = Math.max(0, Math.min(1, val)) * 255;
  }

  return function (imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
  };
};

// Temperature filter - warm/cool white balance
export const createTemperatureFilter = (temperature: number) => {
  const tempFactor = temperature * 30;
  const redLut = new Uint8ClampedArray(256);
  const blueLut = new Uint8ClampedArray(256);

  for (let i = 0; i < 256; i++) {
    redLut[i] = i + tempFactor;
    blueLut[i] = i - tempFactor;
  }

  return function (imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      data[i] = redLut[data[i]];
      data[i + 2] = blueLut[data[i + 2]];
    }
  };
};

// Vibrance filter - smart saturation (boosts muted colors more)
export const createVibranceFilter = (vibrance: number) => {
  const amt = vibrance * 1.5;
  const rCoef = 0.299;
  const gCoef = 0.587;
  const bCoef = 0.114;

  return function (imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
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
};

// Clarity filter - midtone contrast
export const createClarityFilter = (clarity: number) => {
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
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
  };
};

// Dehaze filter - contrast and saturation boost
export const createDehazeFilter = (dehaze: number) => {
  const contrastBoost = 1 + dehaze * 0.5;
  const satBoost = 1 + dehaze * 0.3;
  const rCoef = 0.299, gCoef = 0.587, bCoef = 0.114;

  return function (imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];

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
};

// Vignette filter - darken edges
export const createVignetteFilter = (vignette: number) => {
  let falloffMap: Float32Array | null = null;
  let lastWidth = 0;
  let lastHeight = 0;

  return function (imageData: ImageData) {
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;

    if (w !== lastWidth || h !== lastHeight) {
      lastWidth = w;
      lastHeight = h;
      falloffMap = new Float32Array(w * h);

      const cx = w * 0.5;
      const cy = h * 0.5;
      const maxDistSq = cx * cx + cy * cy;

      for (let y = 0; y < h; y++) {
        const dy = y - cy;
        const dySq = dy * dy;
        const rowOffset = y * w;

        for (let x = 0; x < w; x++) {
          const dx = x - cx;
          const distSq = (dx * dx + dySq) / maxDistSq;
          const falloff = distSq * vignette;
          falloffMap[rowOffset + x] = falloff < 1 ? 1 - falloff : 0;
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
};

// Grain filter - add noise
export const createGrainFilter = (grain: number) => {
  const intensity = grain * 50;
  const patternSize = 4096;
  const noisePattern = new Int8Array(patternSize);
  for (let i = 0; i < patternSize; i++) {
    noisePattern[i] = ((Math.random() - 0.5) * intensity) | 0;
  }

  return function (imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;
    let offset = (Math.random() * patternSize) | 0;

    for (let i = 0; i < len; i += 4) {
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
};

// Re-export buildLUT for backward compatibility
export { buildLUT } from './core';

// Curve strength: 1 = full effect, lower = gentler (blend with original)
const CURVES_STRENGTH = 0.6;

// Custom curves filter using lookup tables for RGB + individual channels
export const createCurvesFilter = (curves: ChannelCurves) => {
  // Pre-compute lookup tables for each channel
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
};

// Konva Contrast exact formula: adjust = ((contrast+100)/100)^2, then (val/255-0.5)*adjust+0.5. Node gets contrast in -100..100; we pass image.contrast*25.
export const createContrastFilterParam = (konvaContrastValue: number) => {
  const adjust = Math.pow((konvaContrastValue + 100) / 100, 2);
  return function (imageData: ImageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i] / 255 - 0.5; r = (r * adjust + 0.5) * 255; data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      let g = data[i + 1] / 255 - 0.5; g = (g * adjust + 0.5) * 255; data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      let b = data[i + 2] / 255 - 0.5; b = (b * adjust + 0.5) * 255; data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  };
};

// Konva HSV exact formula: 3x3 RGB matrix from v=2^value(), s=2^saturation(), h=hue°; we only set saturation and hue (value=0). Node: saturation = image.saturation*2, hue = image.hue*180.
export const createHSVFilterParam = (saturationValue: number, hueValue: number) => {
  const v = Math.pow(2, 0); // value not set on node
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
};

// Build filter list for export - same order and logic as canvas display (no Konva node, no bypass). Omit blur; applied via ctx.filter.
export function buildExportFilterList(image: CanvasImage): ((imageData: ImageData) => void)[] {
  const list: ((imageData: ImageData) => void)[] = [];
  const isCurvesModified = (): boolean => {
    if (!image.curves) return false;
    const ch = (points: CurvePoint[]) => {
      if (!points || points.length === 0) return false;
      if (points.length > 2) return true;
      return points.some((p, i) => (i === 0 ? p.x !== 0 || p.y !== 0 : i === points.length - 1 ? p.x !== 255 || p.y !== 255 : true));
    };
    return ch(image.curves.rgb) || ch(image.curves.red) || ch(image.curves.green) || ch(image.curves.blue);
  };
  if (isCurvesModified() && image.curves) list.push(createCurvesFilter(image.curves));
  if (image.exposure !== 0) list.push(createExposureFilter(image.exposure));
  if (image.highlights !== 0 || image.shadows !== 0 || image.whites !== 0 || image.blacks !== 0)
    list.push(createTonalFilter(image.highlights, image.shadows, image.whites, image.blacks));
  if (image.clarity !== 0) list.push(createClarityFilter(image.clarity));
  if (image.brightness !== 0) list.push(createBrightnessFilter(image.brightness));
  if (image.contrast !== 0) list.push(createContrastFilterParam(image.contrast * 25));
  if (image.temperature !== 0) list.push(createTemperatureFilter(image.temperature));
  if (image.saturation !== 0 || image.hue !== 0) list.push(createHSVFilterParam(image.saturation * 2, image.hue * 180));
  if (image.vibrance !== 0) list.push(createVibranceFilter(image.vibrance));
  if (image.colorHSL && Object.values(image.colorHSL).some((a) => a && ((a.hue ?? 0) !== 0 || (a.saturation ?? 0) !== 0 || (a.luminance ?? 0) !== 0)))
    list.push(createHSLColorFilter(image.colorHSL));
  if (image.splitToning) list.push(createSplitToningFilter(image.splitToning));
  if (image.shadowTint !== undefined && image.shadowTint !== 0) list.push(createShadowTintFilter(image.shadowTint));
  if (image.colorGrading) list.push(createColorGradingFilter(image.colorGrading));
  if (image.colorCalibration) list.push(createColorCalibrationFilter(image.colorCalibration));
  if (image.dehaze !== 0) list.push(createDehazeFilter(image.dehaze));
  if (image.vignette !== 0) list.push(createVignetteFilter(image.vignette));
  if (image.grain !== 0) list.push(createGrainFilter(image.grain));
  // Blur: use Konva's exact Gaussian blur (same as canvas) instead of ctx.filter
  if (image.blur > 0) {
    const radius = Math.round(image.blur * 20);
    list.push((imageData: ImageData) => {
      const mock = { blurRadius: () => radius };
      (Konva.Filters.Blur as (this: { blurRadius(): number }, id: ImageData) => void).call(mock, imageData);
    });
  }
  if (image.filters?.includes('grayscale')) list.push((id: ImageData) => { (Konva.Filters.Grayscale as (id: ImageData) => void)(id); });
  if (image.filters?.includes('sepia')) list.push((id: ImageData) => { (Konva.Filters.Sepia as (id: ImageData) => void)(id); });
  if (image.filters?.includes('invert')) list.push((id: ImageData) => { (Konva.Filters.Invert as (id: ImageData) => void)(id); });
  return list;
}

// Export using the same filter pipeline as the canvas (WYSIWYG). Load image from URL, apply filters, return JPEG blob.
export async function exportWithCanvasFilters(image: CanvasImage, imageUrl: string): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Failed to load image'));
    el.src = imageUrl;
  });
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not available');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const filters = buildExportFilterList(image);
  for (const f of filters) f(imageData);
  ctx.putImageData(imageData, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.95);
  });
}

// HSL color adjustment filter - applies hue/sat/lum shifts with smooth color blending like Lightroom
// Optimized with pre-computed lookup tables for all 360 hue values
export const createHSLColorFilter = (colorHSL: ColorHSL) => {
  // Color center hues (in degrees) - matches Lightroom's HSL panel
  const colorCenters: { name: keyof ColorHSL; center: number }[] = [
    { name: 'red', center: 0 },
    { name: 'orange', center: 30 },
    { name: 'yellow', center: 60 },
    { name: 'green', center: 120 },
    { name: 'aqua', center: 180 },
    { name: 'blue', center: 225 },
    { name: 'purple', center: 270 },
    { name: 'magenta', center: 315 },
  ];

  // Calculate weight for a color based on hue distance (smooth falloff)
  const getColorWeight = (hue360: number, centerHue: number): number => {
    let diff = Math.abs(hue360 - centerHue);
    if (diff > 180) diff = 360 - diff; // Handle wrap-around
    // Use a smooth falloff - full weight within 15°, fades to 0 at 45°
    if (diff <= 15) return 1;
    if (diff >= 45) return 0;
    return 1 - (diff - 15) / 30; // Linear falloff between 15° and 45°
  };

  // PRE-COMPUTE: Build lookup tables for all 360 hue values
  // This moves the expensive per-color weight calculation out of the hot loop
  const hueLUT = new Float32Array(360); // Pre-computed hue adjustments
  const satLUT = new Float32Array(360); // Pre-computed saturation adjustments
  const lumLUT = new Float32Array(360); // Pre-computed luminance adjustments

  for (let hue = 0; hue < 360; hue++) {
    let totalHueAdj = 0;
    let totalSatAdj = 0;
    let totalLumAdj = 0;
    let totalWeight = 0;

    for (const { name, center } of colorCenters) {
      const weight = getColorWeight(hue, center);
      if (weight <= 0) continue;

      const adj = colorHSL[name];
      if (!adj) continue;

      totalHueAdj += (adj.hue ?? 0) * weight;
      totalSatAdj += (adj.saturation ?? 0) * weight;
      totalLumAdj += (adj.luminance ?? 0) * weight;
      totalWeight += weight;
    }

    if (totalWeight > 0) {
      hueLUT[hue] = totalHueAdj / totalWeight;
      satLUT[hue] = totalSatAdj / totalWeight;
      lumLUT[hue] = totalLumAdj / totalWeight;
    }
  }

  // Basic strength values
  const hueStrength = 0.2;
  const satStrength = 0.5;
  const lumStrength = 0.3;

  return function (imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;

      // Convert RGB to HSL (optimized)
      const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const l = (max + min) * 0.5;

      if (max === min) continue; // Skip grays

      const d = max - min;
      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      // Skip low-saturation pixels
      if (s < 0.05) continue;

      let h: number;
      if (max === r) {
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      } else if (max === g) {
        h = ((b - r) / d + 2) / 6;
      } else {
        h = ((r - g) / d + 4) / 6;
      }

      // Use integer hue for LUT lookup (0-359)
      const hueIdx = (h * 360) | 0; // Fast floor using bitwise OR

      // Get pre-computed adjustments from LUT
      const hueAdj = hueLUT[hueIdx];
      const satAdj = satLUT[hueIdx];
      const lumAdj = lumLUT[hueIdx];

      // Skip if adjustments are negligible
      if (hueAdj === 0 && satAdj === 0 && lumAdj === 0) continue;

      // Apply hue shift
      let newH = h + (hueAdj / 100) * hueStrength;
      if (newH < 0) newH += 1;
      else if (newH > 1) newH -= 1;

      // Apply saturation adjustment
      let newS = s;
      if (satAdj > 0) {
        newS = s + (1 - s) * (satAdj / 100) * satStrength;
      } else {
        newS = s * (1 + (satAdj / 100) * satStrength);
      }
      // Clamp saturation
      if (newS < 0) newS = 0;
      else if (newS > 1) newS = 1;

      // Apply luminance adjustment
      let newL = l;
      if (lumAdj > 0) {
        newL = l + (1 - l) * (lumAdj / 100) * lumStrength;
      } else if (lumAdj < 0) {
        newL = l * (1 + (lumAdj / 100) * lumStrength);
      }
      // Clamp luminance
      if (newL < 0) newL = 0;
      else if (newL > 1) newL = 1;

      // Convert HSL back to RGB (optimized)
      let newR: number, newG: number, newB: number;
      if (newS === 0) {
        newR = newG = newB = newL;
      } else {
        const q = newL < 0.5 ? newL * (1 + newS) : newL + newS - newL * newS;
        const p = 2 * newL - q;

        // Inline hue2rgb for performance
        let t = newH + 1 / 3;
        if (t > 1) t -= 1;
        if (t < 1 / 6) newR = p + (q - p) * 6 * t;
        else if (t < 1 / 2) newR = q;
        else if (t < 2 / 3) newR = p + (q - p) * (2 / 3 - t) * 6;
        else newR = p;

        t = newH;
        if (t < 1 / 6) newG = p + (q - p) * 6 * t;
        else if (t < 1 / 2) newG = q;
        else if (t < 2 / 3) newG = p + (q - p) * (2 / 3 - t) * 6;
        else newG = p;

        t = newH - 1 / 3;
        if (t < 0) t += 1;
        if (t < 1 / 6) newB = p + (q - p) * 6 * t;
        else if (t < 1 / 2) newB = q;
        else if (t < 2 / 3) newB = p + (q - p) * (2 / 3 - t) * 6;
        else newB = p;
      }

      data[i] = newR * 255;
      data[i + 1] = newG * 255;
      data[i + 2] = newB * 255;
    }
  };
};

// Split Toning filter - adds color to shadows and highlights
export const createSplitToningFilter = (splitToning: SplitToning) => {
  return function (imageData: ImageData) {
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;

      // Calculate luminance
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // Determine if this is shadow or highlight based on balance
      const balanceFactor = (splitToning.balance + 100) / 200; // -100 to +100 -> 0 to 1
      const isShadow = lum < balanceFactor;

      const hue = isShadow ? splitToning.shadowHue : splitToning.highlightHue;
      const saturation = (isShadow ? splitToning.shadowSaturation : splitToning.highlightSaturation) / 100;

      if (saturation > 0) {
        // Convert hue to RGB
        const h = hue / 360;
        const hue2rgb = (p: number, q: number, t: number) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };

        const q = lum < 0.5 ? lum * (1 + saturation) : lum + saturation - lum * saturation;
        const p = 2 * lum - q;

        const toneR = hue2rgb(p, q, h + 1 / 3);
        const toneG = hue2rgb(p, q, h);
        const toneB = hue2rgb(p, q, h - 1 / 3);

        // Blend with original based on saturation strength
        const blend = isShadow ? (1 - lum) : lum; // Stronger effect in shadows or highlights
        const blendAmount = saturation * blend;

        data[i] = Math.max(0, Math.min(255, (r * (1 - blendAmount) + toneR * blendAmount) * 255));
        data[i + 1] = Math.max(0, Math.min(255, (g * (1 - blendAmount) + toneG * blendAmount) * 255));
        data[i + 2] = Math.max(0, Math.min(255, (b * (1 - blendAmount) + toneB * blendAmount) * 255));
      }
    }
  };
};

// Shadow Tint filter - adds green/magenta tint to shadows
export const createShadowTintFilter = (tint: number) => {
  return function (imageData: ImageData) {
    const data = imageData.data;
    const tintAmount = tint; // -100 to +100 (green to magenta)

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;

      // Calculate luminance
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // Apply tint more strongly to darker pixels
      const shadowStrength = Math.max(0, 1 - lum); // 0 in highlights, 1 in shadows
      const tintStrength = (Math.abs(tintAmount) / 100) * shadowStrength * 0.3; // Max 30% shift

      if (tintAmount > 0) {
        // Magenta tint (add red and blue, reduce green)
        data[i] = Math.min(255, data[i] + tintStrength * 255);
        data[i + 1] = Math.max(0, data[i + 1] - tintStrength * 255);
        data[i + 2] = Math.min(255, data[i + 2] + tintStrength * 255);
      } else {
        // Green tint (add green, reduce red and blue)
        data[i] = Math.max(0, data[i] - tintStrength * 255);
        data[i + 1] = Math.min(255, data[i + 1] + tintStrength * 255);
        data[i + 2] = Math.max(0, data[i + 2] - tintStrength * 255);
      }
    }
  };
};

// Color Grading filter - applies color grading to shadows, midtones, and highlights
export const createColorGradingFilter = (colorGrading: ColorGrading) => {
  return function (imageData: ImageData) {
    const data = imageData.data;
    const blending = colorGrading.blending / 100; // 0-100 -> 0-1

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;

      // Calculate luminance
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // Determine shadow/midtone/highlight weights using smooth curves
      const shadowWeight = Math.max(0, 1 - lum * 2); // Peaks at 0, fades by 0.5
      const highlightWeight = Math.max(0, lum * 2 - 1); // Peaks at 1, fades by 0.5
      const midtoneWeight = 1 - Math.abs(lum - 0.5) * 2; // Peaks at 0.5

      // Apply luminance adjustments
      let finalLum = lum;
      finalLum += (colorGrading.shadowLum / 100) * shadowWeight * 0.5;
      finalLum += (colorGrading.midtoneLum / 100) * midtoneWeight * 0.5;
      finalLum += (colorGrading.highlightLum / 100) * highlightWeight * 0.5;
      finalLum += (colorGrading.globalLum / 100) * 0.5;

      // Apply midtone color if saturation > 0
      if (colorGrading.midtoneSat > 0 && midtoneWeight > 0) {
        const h = colorGrading.midtoneHue / 360;
        const s = (colorGrading.midtoneSat / 100) * midtoneWeight;

        const hue2rgb = (p: number, q: number, t: number) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };

        const q = finalLum < 0.5 ? finalLum * (1 + s) : finalLum + s - finalLum * s;
        const p = 2 * finalLum - q;

        const toneR = hue2rgb(p, q, h + 1 / 3);
        const toneG = hue2rgb(p, q, h);
        const toneB = hue2rgb(p, q, h - 1 / 3);

        data[i] = Math.max(0, Math.min(255, (r * (1 - s * blending) + toneR * s * blending) * 255));
        data[i + 1] = Math.max(0, Math.min(255, (g * (1 - s * blending) + toneG * s * blending) * 255));
        data[i + 2] = Math.max(0, Math.min(255, (b * (1 - s * blending) + toneB * s * blending) * 255));
      } else {
        // Just apply luminance changes
        const lumChange = finalLum - lum;
        data[i] = Math.max(0, Math.min(255, (r + lumChange) * 255));
        data[i + 1] = Math.max(0, Math.min(255, (g + lumChange) * 255));
        data[i + 2] = Math.max(0, Math.min(255, (b + lumChange) * 255));
      }

      // Apply global color if saturation > 0
      if (colorGrading.globalSat > 0) {
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        const h = colorGrading.globalHue / 360;
        const s = (colorGrading.globalSat / 100) * blending;

        const hue2rgb = (p: number, q: number, t: number) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };

        const q = lum < 0.5 ? lum * (1 + s) : lum + s - lum * s;
        const p = 2 * lum - q;

        const toneR = hue2rgb(p, q, h + 1 / 3);
        const toneG = hue2rgb(p, q, h);
        const toneB = hue2rgb(p, q, h - 1 / 3);

        data[i] = Math.max(0, Math.min(255, (r * (1 - s) + toneR * s) * 255));
        data[i + 1] = Math.max(0, Math.min(255, (g * (1 - s) + toneG * s) * 255));
        data[i + 2] = Math.max(0, Math.min(255, (b * (1 - s) + toneB * s) * 255));
      }
    }
  };
};

// Color Calibration filter - adjusts the hue and saturation of RGB primaries
export const createColorCalibrationFilter = (colorCal: ColorCalibration) => {
  return function (imageData: ImageData) {
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i] / 255;
      let g = data[i + 1] / 255;
      let b = data[i + 2] / 255;

      // Determine which primary color is dominant
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;

      if (delta > 0.01) { // Only apply to non-gray pixels
        // Calculate hue (0-360)
        let hue = 0;
        if (max === r) {
          hue = ((g - b) / delta) % 6;
        } else if (max === g) {
          hue = (b - r) / delta + 2;
        } else {
          hue = (r - g) / delta + 4;
        }
        hue = (hue * 60 + 360) % 360;

        // Determine which primary this pixel belongs to and blend weights
        const redWeight = hue < 60 || hue > 300 ? 1 - Math.abs((hue < 60 ? hue : hue - 360) - 0) / 60 : 0;
        const greenWeight = hue >= 60 && hue < 180 ? 1 - Math.abs(hue - 120) / 60 : 0;
        const blueWeight = hue >= 180 && hue < 300 ? 1 - Math.abs(hue - 240) / 60 : 0;

        // Apply hue shifts
        const hueShift = (redWeight * colorCal.redHue +
          greenWeight * colorCal.greenHue +
          blueWeight * colorCal.blueHue) / 100 * 30; // Scale to reasonable range

        // Apply saturation adjustments
        const satShift = (redWeight * colorCal.redSaturation +
          greenWeight * colorCal.greenSaturation +
          blueWeight * colorCal.blueSaturation) / 100;

        // Convert to HSL
        const l = (max + min) / 2;
        const s = delta / (1 - Math.abs(2 * l - 1));

        // Apply adjustments
        const newHue = (hue + hueShift + 360) % 360;
        const newSat = Math.max(0, Math.min(1, s * (1 + satShift)));

        // Convert back to RGB
        const c = (1 - Math.abs(2 * l - 1)) * newSat;
        const x = c * (1 - Math.abs(((newHue / 60) % 2) - 1));
        const m = l - c / 2;

        let r1 = 0, g1 = 0, b1 = 0;
        if (newHue < 60) { r1 = c; g1 = x; b1 = 0; }
        else if (newHue < 120) { r1 = x; g1 = c; b1 = 0; }
        else if (newHue < 180) { r1 = 0; g1 = c; b1 = x; }
        else if (newHue < 240) { r1 = 0; g1 = x; b1 = c; }
        else if (newHue < 300) { r1 = x; g1 = 0; b1 = c; }
        else { r1 = c; g1 = 0; b1 = x; }

        r = r1 + m;
        g = g1 + m;
        b = b1 + m;
      }

      data[i] = Math.max(0, Math.min(255, r * 255));
      data[i + 1] = Math.max(0, Math.min(255, g * 255));
      data[i + 2] = Math.max(0, Math.min(255, b * 255));
    }
  };
};
