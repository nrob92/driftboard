/**
 * Server-side image filters for Sharp
 * Ported from client-side Konva filters in CanvasEditor.tsx
 *
 * These operate on raw pixel buffers (RGB, 3 channels per pixel)
 */

import {
  type ColorHSL,
  type SplitToning,
  type ColorGrading,
  type ColorCalibration,
  type EditValues,
} from "@/lib/types";
import { buildLUT } from "./filters/core/lut";
import { hslToRgb, clamp8 } from "./filters/core/color";

export type { EditValues };

// Use shared clamp8 from color core
const clamp = clamp8;

/**
 * Apply all edit values to a raw RGB buffer
 * @param data - Raw RGB pixel buffer (3 bytes per pixel: R, G, B)
 * @param width - Image width
 * @param height - Image height
 * @param edits - Edit values to apply
 */
export function applyEdits(
  data: Buffer,
  width: number,
  height: number,
  edits: EditValues,
): Buffer {
  // Create a copy to work with
  const result = Buffer.from(data);
  const pixelCount = width * height;

  // Apply edits in order (matching client-side pipeline)

  // 1. Curves (if any) – applied at reduced strength so edits are less aggressive
  const CURVES_STRENGTH = 0.6;
  if (edits.curves) {
    const rgbLUT = buildLUT(edits.curves.rgb);
    const redLUT = buildLUT(edits.curves.red);
    const greenLUT = buildLUT(edits.curves.green);
    const blueLUT = buildLUT(edits.curves.blue);
    const s = CURVES_STRENGTH;

    for (let i = 0; i < pixelCount * 3; i += 3) {
      const origR = result[i];
      const origG = result[i + 1];
      const origB = result[i + 2];
      const curvedR = redLUT[rgbLUT[origR]];
      const curvedG = greenLUT[rgbLUT[origG]];
      const curvedB = blueLUT[rgbLUT[origB]];
      result[i] = Math.round((1 - s) * origR + s * curvedR);
      result[i + 1] = Math.round((1 - s) * origG + s * curvedG);
      result[i + 2] = Math.round((1 - s) * origB + s * curvedB);
    }
  }

  // 2. Exposure
  if (edits.exposure && edits.exposure !== 0) {
    const factor = Math.pow(2, edits.exposure);
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      lut[i] = clamp(i * factor);
    }
    for (let i = 0; i < pixelCount * 3; i += 3) {
      result[i] = lut[result[i]];
      result[i + 1] = lut[result[i + 1]];
      result[i + 2] = lut[result[i + 2]];
    }
  }

  // 3. Tonal adjustments (highlights, shadows, whites, blacks)
  if (
    (edits.highlights && edits.highlights !== 0) ||
    (edits.shadows && edits.shadows !== 0) ||
    (edits.whites && edits.whites !== 0) ||
    (edits.blacks && edits.blacks !== 0)
  ) {
    const lut = new Uint8Array(256);
    const highlights = edits.highlights || 0;
    const shadows = edits.shadows || 0;
    const whites = edits.whites || 0;
    const blacks = edits.blacks || 0;

    for (let i = 0; i < 256; i++) {
      let val = i / 255;

      if (val < 0.25) {
        val += blacks * 0.5 * (0.25 - val);
      }
      if (val < 0.5) {
        const shadowMask = Math.sin(val * Math.PI);
        val += shadows * 0.4 * shadowMask * (0.5 - val);
      }
      if (val > 0.5) {
        const highlightMask = Math.sin((val - 0.5) * Math.PI);
        val += highlights * 0.3 * highlightMask * (val - 0.5);
      }
      if (val > 0.75) {
        val += whites * 0.5 * (val - 0.75);
      }

      lut[i] = clamp(val * 255);
    }

    for (let i = 0; i < pixelCount * 3; i += 3) {
      result[i] = lut[result[i]];
      result[i + 1] = lut[result[i + 1]];
      result[i + 2] = lut[result[i + 2]];
    }
  }

  // 4. Temperature
  if (edits.temperature && edits.temperature !== 0) {
    const tempFactor = edits.temperature * 30;
    for (let i = 0; i < pixelCount * 3; i += 3) {
      result[i] = clamp(result[i] + tempFactor); // R
      result[i + 2] = clamp(result[i + 2] - tempFactor); // B
    }
  }

  // 5. Brightness
  if (edits.brightness && edits.brightness !== 0) {
    const factor = 1 + edits.brightness;
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      lut[i] = clamp(i * factor);
    }
    for (let i = 0; i < pixelCount * 3; i += 3) {
      result[i] = lut[result[i]];
      result[i + 1] = lut[result[i + 1]];
      result[i + 2] = lut[result[i + 2]];
    }
  }

  // 6. Contrast
  if (edits.contrast && edits.contrast !== 0) {
    const factor = 1 + edits.contrast;
    for (let i = 0; i < pixelCount * 3; i += 3) {
      result[i] = clamp(128 + (result[i] - 128) * factor);
      result[i + 1] = clamp(128 + (result[i + 1] - 128) * factor);
      result[i + 2] = clamp(128 + (result[i + 2] - 128) * factor);
    }
  }

  // 7. Saturation
  if (edits.saturation && edits.saturation !== 0) {
    const sat = 1 + edits.saturation;
    for (let i = 0; i < pixelCount * 3; i += 3) {
      const r = result[i],
        g = result[i + 1],
        b = result[i + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      result[i] = clamp(gray + (r - gray) * sat);
      result[i + 1] = clamp(gray + (g - gray) * sat);
      result[i + 2] = clamp(gray + (b - gray) * sat);
    }
  }

  // 8. Vibrance
  if (edits.vibrance && edits.vibrance !== 0) {
    const amt = edits.vibrance * 1.5;
    for (let i = 0; i < pixelCount * 3; i += 3) {
      const r = result[i],
        g = result[i + 1],
        b = result[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === 0) continue;

      const saturation = (max - min) / max;
      const factor = 1 + amt * (1 - saturation);
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;

      result[i] = clamp(gray + (r - gray) * factor);
      result[i + 1] = clamp(gray + (g - gray) * factor);
      result[i + 2] = clamp(gray + (b - gray) * factor);
    }
  }

  // 9. Clarity (midtone contrast)
  if (edits.clarity && edits.clarity !== 0) {
    const factor = 1 + edits.clarity * 0.5;
    const midtone = 0.5;
    const lut = new Uint8Array(256);

    for (let i = 0; i < 256; i++) {
      const val = i / 255;
      const diff = val - midtone;
      const newVal = midtone + diff * factor;
      lut[i] = clamp(newVal * 255);
    }

    for (let i = 0; i < pixelCount * 3; i += 3) {
      result[i] = lut[result[i]];
      result[i + 1] = lut[result[i + 1]];
      result[i + 2] = lut[result[i + 2]];
    }
  }

  // 10. Dehaze
  if (edits.dehaze && edits.dehaze !== 0) {
    const contrastBoost = 1 + edits.dehaze * 0.5;
    const satBoost = 1 + edits.dehaze * 0.3;

    for (let i = 0; i < pixelCount * 3; i += 3) {
      let r = result[i],
        g = result[i + 1],
        b = result[i + 2];

      // Contrast
      r = 128 + (r - 128) * contrastBoost;
      g = 128 + (g - 128) * contrastBoost;
      b = 128 + (b - 128) * contrastBoost;

      // Saturation
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * satBoost;
      g = gray + (g - gray) * satBoost;
      b = gray + (b - gray) * satBoost;

      result[i] = clamp(r);
      result[i + 1] = clamp(g);
      result[i + 2] = clamp(b);
    }
  }

  // 11. HSL per-color adjustments
  if (edits.colorHSL) {
    applyHSLColorFilter(result, pixelCount, edits.colorHSL);
  }

  // 12. Split Toning
  if (edits.splitToning) {
    applySplitToning(result, pixelCount, edits.splitToning);
  }

  // 13. Shadow Tint
  if (edits.shadowTint && edits.shadowTint !== 0) {
    applyShadowTint(result, pixelCount, edits.shadowTint);
  }

  // 14. Color Grading
  if (edits.colorGrading) {
    applyColorGrading(result, pixelCount, edits.colorGrading);
  }

  // 15. Color Calibration
  if (edits.colorCalibration) {
    applyColorCalibration(result, pixelCount, edits.colorCalibration);
  }

  // 16. Vignette
  if (edits.vignette && edits.vignette !== 0) {
    applyVignette(result, width, height, edits.vignette);
  }

  // 17. Grain
  if (edits.grain && edits.grain !== 0) {
    applyGrain(result, pixelCount, edits.grain);
  }

  return result;
}

// HSL per-color filter
function applyHSLColorFilter(
  data: Buffer,
  pixelCount: number,
  colorHSL: ColorHSL,
): void {
  const colorCenters: { name: keyof ColorHSL; center: number }[] = [
    { name: "red", center: 0 },
    { name: "orange", center: 30 },
    { name: "yellow", center: 60 },
    { name: "green", center: 120 },
    { name: "aqua", center: 180 },
    { name: "blue", center: 225 },
    { name: "purple", center: 270 },
    { name: "magenta", center: 315 },
  ];

  const getColorWeight = (hue360: number, centerHue: number): number => {
    let diff = Math.abs(hue360 - centerHue);
    if (diff > 180) diff = 360 - diff;
    if (diff <= 15) return 1;
    if (diff >= 45) return 0;
    return 1 - (diff - 15) / 30;
  };

  // Pre-compute LUTs
  const hueLUT = new Float32Array(360);
  const satLUT = new Float32Array(360);
  const lumLUT = new Float32Array(360);

  for (let hue = 0; hue < 360; hue++) {
    let totalHueAdj = 0,
      totalSatAdj = 0,
      totalLumAdj = 0,
      totalWeight = 0;

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

  const satStrength = 0.4;
  const lumStrength = 0.25;

  for (let i = 0; i < pixelCount * 3; i += 3) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) * 0.5;

    if (max === min) continue;

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (s < 0.05) continue;

    let h: number;
    if (max === r) {
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    } else if (max === g) {
      h = ((b - r) / d + 2) / 6;
    } else {
      h = ((r - g) / d + 4) / 6;
    }

    const hueIdx = Math.floor(h * 360) % 360;
    const hueAdj = hueLUT[hueIdx];
    const satAdj = satLUT[hueIdx];
    const lumAdj = lumLUT[hueIdx];

    if (hueAdj === 0 && satAdj === 0 && lumAdj === 0) continue;

    let newH = h + hueAdj / 360;
    if (newH < 0) newH += 1;
    else if (newH > 1) newH -= 1;

    let newS = s;
    if (satAdj > 0) {
      newS = s + (1 - s) * (satAdj / 100) * satStrength;
    } else {
      newS = s * (1 + (satAdj / 100) * satStrength);
    }
    newS = Math.max(0, Math.min(1, newS));

    let newL = l;
    if (lumAdj > 0) {
      newL = l + (1 - l) * (lumAdj / 100) * lumStrength;
    } else if (lumAdj < 0) {
      newL = l * (1 + (lumAdj / 100) * lumStrength);
    }
    newL = Math.max(0, Math.min(1, newL));

    const [newR, newG, newB] = hslToRgb(newH, newS, newL);
    data[i] = clamp(newR);
    data[i + 1] = clamp(newG);
    data[i + 2] = clamp(newB);
  }
}

// Split Toning filter
function applySplitToning(
  data: Buffer,
  pixelCount: number,
  splitToning: SplitToning,
): void {
  for (let i = 0; i < pixelCount * 3; i += 3) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const balanceFactor = (splitToning.balance + 100) / 200;
    const isShadow = lum < balanceFactor;

    const hue = isShadow ? splitToning.shadowHue : splitToning.highlightHue;
    const saturation =
      (isShadow
        ? splitToning.shadowSaturation
        : splitToning.highlightSaturation) / 100;

    if (saturation > 0) {
      const h = hue / 360;
      const [toneR, toneG, toneB] = hslToRgb(h, saturation, lum);

      const blend = isShadow ? 1 - lum : lum;
      const blendAmount = saturation * blend;

      data[i] = clamp(
        (r * (1 - blendAmount) + (toneR / 255) * blendAmount) * 255,
      );
      data[i + 1] = clamp(
        (g * (1 - blendAmount) + (toneG / 255) * blendAmount) * 255,
      );
      data[i + 2] = clamp(
        (b * (1 - blendAmount) + (toneB / 255) * blendAmount) * 255,
      );
    }
  }
}

// Shadow Tint filter
function applyShadowTint(data: Buffer, pixelCount: number, tint: number): void {
  for (let i = 0; i < pixelCount * 3; i += 3) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const shadowStrength = Math.max(0, 1 - lum);
    const tintStrength = (Math.abs(tint) / 100) * shadowStrength * 0.3;

    if (tint > 0) {
      // Magenta tint
      data[i] = clamp(data[i] + tintStrength * 255);
      data[i + 1] = clamp(data[i + 1] - tintStrength * 255);
      data[i + 2] = clamp(data[i + 2] + tintStrength * 255);
    } else {
      // Green tint
      data[i] = clamp(data[i] - tintStrength * 255);
      data[i + 1] = clamp(data[i + 1] + tintStrength * 255);
      data[i + 2] = clamp(data[i + 2] - tintStrength * 255);
    }
  }
}

// Color Grading filter
function applyColorGrading(
  data: Buffer,
  pixelCount: number,
  colorGrading: ColorGrading,
): void {
  const blending = colorGrading.blending / 100;

  for (let i = 0; i < pixelCount * 3; i += 3) {
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    const shadowWeight = Math.max(0, 1 - lum * 2);
    const highlightWeight = Math.max(0, lum * 2 - 1);
    const midtoneWeight = 1 - Math.abs(lum - 0.5) * 2;

    let finalLum = lum;
    finalLum += (colorGrading.shadowLum / 100) * shadowWeight * 0.5;
    finalLum += (colorGrading.midtoneLum / 100) * midtoneWeight * 0.5;
    finalLum += (colorGrading.highlightLum / 100) * highlightWeight * 0.5;
    finalLum += (colorGrading.globalLum / 100) * 0.5;

    const lumChange = finalLum - lum;
    r = clamp((r + lumChange) * 255) / 255;
    g = clamp((g + lumChange) * 255) / 255;
    b = clamp((b + lumChange) * 255) / 255;

    // Apply midtone color
    if (colorGrading.midtoneSat > 0 && midtoneWeight > 0) {
      const h = colorGrading.midtoneHue / 360;
      const s = (colorGrading.midtoneSat / 100) * midtoneWeight;
      const [toneR, toneG, toneB] = hslToRgb(h, s, finalLum);

      r = r * (1 - s * blending) + (toneR / 255) * s * blending;
      g = g * (1 - s * blending) + (toneG / 255) * s * blending;
      b = b * (1 - s * blending) + (toneB / 255) * s * blending;
    }

    // Apply global color
    if (colorGrading.globalSat > 0) {
      const h = colorGrading.globalHue / 360;
      const s = (colorGrading.globalSat / 100) * blending;
      const [toneR, toneG, toneB] = hslToRgb(
        h,
        s,
        0.299 * r + 0.587 * g + 0.114 * b,
      );

      r = r * (1 - s) + (toneR / 255) * s;
      g = g * (1 - s) + (toneG / 255) * s;
      b = b * (1 - s) + (toneB / 255) * s;
    }

    data[i] = clamp(r * 255);
    data[i + 1] = clamp(g * 255);
    data[i + 2] = clamp(b * 255);
  }
}

// Color Calibration filter
function applyColorCalibration(
  data: Buffer,
  pixelCount: number,
  colorCal: ColorCalibration,
): void {
  for (let i = 0; i < pixelCount * 3; i += 3) {
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    if (delta > 0.01) {
      let hue = 0;
      if (max === r) {
        hue = ((g - b) / delta) % 6;
      } else if (max === g) {
        hue = (b - r) / delta + 2;
      } else {
        hue = (r - g) / delta + 4;
      }
      hue = (hue * 60 + 360) % 360;

      const redWeight =
        hue < 60 || hue > 300
          ? 1 - Math.abs(hue < 60 ? hue : hue - 360) / 60
          : 0;
      const greenWeight =
        hue >= 60 && hue < 180 ? 1 - Math.abs(hue - 120) / 60 : 0;
      const blueWeight =
        hue >= 180 && hue < 300 ? 1 - Math.abs(hue - 240) / 60 : 0;

      // Apply saturation adjustments
      const satAdj =
        (redWeight * colorCal.redSaturation +
          greenWeight * colorCal.greenSaturation +
          blueWeight * colorCal.blueSaturation) /
        100;

      if (satAdj !== 0) {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const factor = 1 + satAdj * 0.5;
        r = gray + (r - gray) * factor;
        g = gray + (g - gray) * factor;
        b = gray + (b - gray) * factor;
      }

      data[i] = clamp(r * 255);
      data[i + 1] = clamp(g * 255);
      data[i + 2] = clamp(b * 255);
    }
  }
}

// Vignette filter
function applyVignette(
  data: Buffer,
  width: number,
  height: number,
  vignette: number,
): void {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const maxDistSq = cx * cx + cy * cy;

  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    const dySq = dy * dy;

    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const distSq = (dx * dx + dySq) / maxDistSq;
      const falloff = distSq * vignette;
      const factor = falloff < 1 ? 1 - falloff : 0;

      const i = (y * width + x) * 3;
      data[i] = clamp(data[i] * factor);
      data[i + 1] = clamp(data[i + 1] * factor);
      data[i + 2] = clamp(data[i + 2] * factor);
    }
  }
}

// Grain filter
function applyGrain(data: Buffer, pixelCount: number, grain: number): void {
  const intensity = grain * 50;

  for (let i = 0; i < pixelCount * 3; i += 3) {
    const noise = (Math.random() - 0.5) * intensity;
    data[i] = clamp(data[i] + noise);
    data[i + 1] = clamp(data[i + 1] + noise);
    data[i + 2] = clamp(data[i + 2] + noise);
  }
}
