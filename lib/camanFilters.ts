/**
 * CamanJS integration for Lightroom-like image filters
 * Loads CamanJS via script tag to avoid bundler issues with native deps
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Caman: any = null;
let camanLoading: Promise<void> | null = null;

/**
 * Dynamically load CamanJS via script tag (browser-only)
 * This avoids bundler trying to resolve canvas/fibers native modules
 */
async function loadCaman(): Promise<void> {
  if (Caman) return;
  if (camanLoading) return camanLoading;

  if (typeof window === 'undefined') {
    throw new Error('CamanJS can only be used in browser');
  }

  // Check if already loaded on window
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).Caman) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Caman = (window as any).Caman;
    return;
  }

  camanLoading = new Promise((resolve, reject) => {
    // Load CamanJS via script tag from node_modules
    const script = document.createElement('script');
    script.src = '/caman/caman.full.min.js';
    script.async = true;

    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Caman = (window as any).Caman;
      if (Caman) {
        resolve();
      } else {
        reject(new Error('CamanJS loaded but not available on window'));
      }
    };

    script.onerror = () => {
      reject(new Error('Failed to load CamanJS script'));
    };

    document.head.appendChild(script);
  });

  return camanLoading;
}

/**
 * Curve point for tone curves
 */
export interface CurvePoint {
  x: number;
  y: number;
}

/**
 * Curves data structure
 */
export interface CurvesData {
  rgb: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
}

/**
 * HSL color adjustment
 */
export interface HSLAdjustment {
  hue?: number;
  saturation?: number;
  luminance?: number;
}

/**
 * Color HSL adjustments per color
 */
export interface ColorHSL {
  red?: HSLAdjustment;
  orange?: HSLAdjustment;
  yellow?: HSLAdjustment;
  green?: HSLAdjustment;
  aqua?: HSLAdjustment;
  blue?: HSLAdjustment;
  purple?: HSLAdjustment;
  magenta?: HSLAdjustment;
}

/**
 * Split toning settings
 */
export interface SplitToning {
  highlightHue?: number;
  highlightSaturation?: number;
  shadowHue?: number;
  shadowSaturation?: number;
  balance?: number;
}

/**
 * Color grading wheel
 */
export interface ColorGradingWheel {
  hue?: number;
  saturation?: number;
  luminance?: number;
}

/**
 * Color grading settings
 */
export interface ColorGrading {
  shadows?: ColorGradingWheel;
  midtones?: ColorGradingWheel;
  highlights?: ColorGradingWheel;
  global?: ColorGradingWheel;
  blending?: number;
  balance?: number;
}

/**
 * Color calibration settings
 */
export interface ColorCalibration {
  shadowTint?: number;
  redPrimaryHue?: number;
  redPrimarySaturation?: number;
  greenPrimaryHue?: number;
  greenPrimarySaturation?: number;
  bluePrimaryHue?: number;
  bluePrimarySaturation?: number;
}

/**
 * Edit values interface matching CanvasEditor
 */
export interface CamanEditValues {
  exposure?: number;      // -5 to +5 (stops)
  contrast?: number;      // -1 to +1
  brightness?: number;    // -1 to +1
  highlights?: number;    // -1 to +1
  shadows?: number;       // -1 to +1
  whites?: number;        // -1 to +1
  blacks?: number;        // -1 to +1
  temperature?: number;   // -1 to +1
  vibrance?: number;      // -1 to +1
  saturation?: number;    // -1 to +1
  clarity?: number;       // -1 to +1
  dehaze?: number;        // -1 to +1
  hue?: number;           // -1 to +1
  sepia?: number;         // 0 to 1
  noise?: number;         // 0 to 1
  sharpen?: number;       // 0 to 1
  vignette?: number;      // -1 to +1
  grain?: number;         // 0 to 1
  blur?: number;          // 0 to 1
  shadowTint?: number;    // -1 to +1
  curves?: CurvesData;
  colorHSL?: ColorHSL;
  splitToning?: SplitToning;
  colorGrading?: ColorGrading;
  colorCalibration?: ColorCalibration;
  filters?: string[];     // legacy filters: grayscale, sepia, invert
}

/**
 * Check if edits have any active adjustments
 */
export function hasActiveEdits(edits: CamanEditValues): boolean {
  return (
    (edits.exposure !== undefined && edits.exposure !== 0) ||
    (edits.contrast !== undefined && edits.contrast !== 0) ||
    (edits.brightness !== undefined && edits.brightness !== 0) ||
    (edits.highlights !== undefined && edits.highlights !== 0) ||
    (edits.shadows !== undefined && edits.shadows !== 0) ||
    (edits.whites !== undefined && edits.whites !== 0) ||
    (edits.blacks !== undefined && edits.blacks !== 0) ||
    (edits.temperature !== undefined && edits.temperature !== 0) ||
    (edits.vibrance !== undefined && edits.vibrance !== 0) ||
    (edits.saturation !== undefined && edits.saturation !== 0) ||
    (edits.clarity !== undefined && edits.clarity !== 0) ||
    (edits.dehaze !== undefined && edits.dehaze !== 0) ||
    (edits.hue !== undefined && edits.hue !== 0) ||
    (edits.vignette !== undefined && edits.vignette !== 0) ||
    (edits.grain !== undefined && edits.grain !== 0) ||
    (edits.blur !== undefined && edits.blur !== 0 && edits.blur! > 0) ||
    (edits.shadowTint !== undefined && edits.shadowTint !== 0) ||
    (edits.sepia !== undefined && edits.sepia !== 0 && edits.sepia! > 0) ||
    (edits.noise !== undefined && edits.noise !== 0 && edits.noise! > 0) ||
    (edits.curves !== undefined && hasCurvesModification(edits.curves)) ||
    (edits.colorHSL !== undefined && hasColorHSLModification(edits.colorHSL)) ||
    (edits.splitToning !== undefined) ||
    (edits.colorGrading !== undefined) ||
    (edits.colorCalibration !== undefined) ||
    (edits.filters !== undefined && edits.filters.length > 0)
  );
}

function hasCurvesModification(curves: CurvesData): boolean {
  const isChannelModified = (points: CurvePoint[]) => {
    if (!points || points.length === 0) return false;
    if (points.length > 2) return true;
    return points.some((p, i) => {
      if (i === 0) return p.x !== 0 || p.y !== 0;
      if (i === points.length - 1) return p.x !== 255 || p.y !== 255;
      return true;
    });
  };
  return (
    isChannelModified(curves.rgb) ||
    isChannelModified(curves.red) ||
    isChannelModified(curves.green) ||
    isChannelModified(curves.blue)
  );
}

function hasColorHSLModification(colorHSL: ColorHSL): boolean {
  return Object.values(colorHSL).some(
    (adj) => adj && ((adj.hue ?? 0) !== 0 || (adj.saturation ?? 0) !== 0 || (adj.luminance ?? 0) !== 0)
  );
}

/**
 * Convert HSL to hex color string for CamanJS colorize
 */
function hslToHex(h: number, s: number, l: number): string {
  // h is 0-360, s and l are 0-100
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
  else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
  else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
  else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
  else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  const toHex = (n: number) => {
    const hex = Math.round((n + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return '#' + toHex(r) + toHex(g) + toHex(b);
}

/**
 * Apply CamanJS filters to a canvas element
 * Returns a promise that resolves when rendering is complete
 */
export async function applyCamanFilters(
  canvas: HTMLCanvasElement,
  edits: CamanEditValues
): Promise<void> {
  await loadCaman();

  return new Promise((resolve, reject) => {
    try {
      Caman(canvas, function(this: typeof Caman) {
        // Reset to original first
        this.revert(false);

        // === CURVES (apply first for tone mapping) ===
        if (edits.curves && hasCurvesModification(edits.curves)) {
          // Apply RGB curves
          if (edits.curves.rgb && edits.curves.rgb.length >= 2) {
            const rgbPoints = edits.curves.rgb.map(p => [p.x, p.y] as [number, number]);
            this.curves('rgb', ...rgbPoints);
          }
          // Apply individual channel curves
          if (edits.curves.red && edits.curves.red.length >= 2) {
            const redPoints = edits.curves.red.map(p => [p.x, p.y] as [number, number]);
            this.curves('r', ...redPoints);
          }
          if (edits.curves.green && edits.curves.green.length >= 2) {
            const greenPoints = edits.curves.green.map(p => [p.x, p.y] as [number, number]);
            this.curves('g', ...greenPoints);
          }
          if (edits.curves.blue && edits.curves.blue.length >= 2) {
            const bluePoints = edits.curves.blue.map(p => [p.x, p.y] as [number, number]);
            this.curves('b', ...bluePoints);
          }
        }

        // === EXPOSURE (primary brightness adjustment) ===
        // Exposure: CamanJS uses -100 to 100, we use stops (-5 to +5)
        // Convert stops to percentage (each stop ~= 20% change)
        if (edits.exposure && edits.exposure !== 0) {
          const exposurePercent = edits.exposure * 20; // -100 to +100
          this.exposure(exposurePercent);
        }

        // === TONAL ADJUSTMENTS ===
        // Highlights: Use gamma for highlight adjustment
        if (edits.highlights && edits.highlights !== 0) {
          // Positive highlights = brighter highlights = lower gamma for bright areas
          const gamma = 1 - (edits.highlights * 0.3);
          this.gamma(gamma);
        }

        // Shadows: Use curves to lift/lower shadows
        if (edits.shadows && edits.shadows !== 0) {
          const shadowLift = edits.shadows * 30;
          if (shadowLift > 0) {
            this.curves('rgb', [0, shadowLift], [128, 128], [255, 255]);
          } else {
            this.curves('rgb', [0, 0], [64, 64 + shadowLift], [255, 255]);
          }
        }

        // Whites: Adjust the white point
        if (edits.whites && edits.whites !== 0) {
          const whitePoint = 255 + (edits.whites * 30);
          this.curves('rgb', [0, 0], [255, Math.min(255, Math.max(200, whitePoint))]);
        }

        // Blacks: Adjust the black point
        if (edits.blacks && edits.blacks !== 0) {
          const blackPoint = edits.blacks * 30;
          this.curves('rgb', [0, Math.max(0, blackPoint)], [255, 255]);
        }

        // === CONTRAST ===
        // Brightness: CamanJS uses -100 to 100, we use -1 to 1
        if (edits.brightness && edits.brightness !== 0) {
          this.brightness(edits.brightness * 100);
        }

        // Contrast: CamanJS uses -100 to 100, we use -1 to 1
        if (edits.contrast && edits.contrast !== 0) {
          this.contrast(edits.contrast * 100);
        }

        // === CLARITY & DEHAZE ===
        // Clarity: Local contrast (simulated with sharpen + contrast)
        if (edits.clarity && edits.clarity !== 0) {
          const clarityAmount = Math.abs(edits.clarity) * 50;
          if (edits.clarity > 0) {
            this.sharpen(clarityAmount * 0.5);
            this.contrast(clarityAmount * 0.3);
          } else {
            // Negative clarity = soften
            this.stackBlur(Math.abs(edits.clarity) * 3);
          }
        }

        // Dehaze: Increase contrast and saturation
        if (edits.dehaze && edits.dehaze !== 0) {
          const dehazeAmount = edits.dehaze * 50;
          this.contrast(dehazeAmount);
          this.vibrance(dehazeAmount * 0.5);
        }

        // === COLOR TEMPERATURE ===
        if (edits.temperature && edits.temperature !== 0) {
          // Positive = warmer (more red/yellow), negative = cooler (more blue)
          const temp = edits.temperature * 30;
          if (temp > 0) {
            this.channels({ red: temp, blue: -temp * 0.5 });
          } else {
            this.channels({ red: temp, blue: -temp * 0.5 });
          }
        }

        // Shadow Tint (green-magenta on shadows)
        if (edits.shadowTint && edits.shadowTint !== 0) {
          const tint = edits.shadowTint * 20;
          // Positive = magenta, negative = green
          this.channels({ green: -tint });
        }

        // === COLOR SATURATION ===
        // Vibrance: Smart saturation
        if (edits.vibrance && edits.vibrance !== 0) {
          this.vibrance(edits.vibrance * 100);
        }

        // Saturation
        if (edits.saturation && edits.saturation !== 0) {
          this.saturation(edits.saturation * 100);
        }

        // Hue rotation
        if (edits.hue && edits.hue !== 0) {
          this.hue(edits.hue * 100);
        }

        // === HSL COLOR ADJUSTMENTS ===
        // CamanJS doesn't have per-color HSL, but we can simulate with colorize
        if (edits.colorHSL && hasColorHSLModification(edits.colorHSL)) {
          // Apply general saturation adjustments based on dominant color shifts
          const colors = edits.colorHSL;
          let totalSatShift = 0;
          let count = 0;
          Object.values(colors).forEach(adj => {
            if (adj?.saturation) {
              totalSatShift += adj.saturation;
              count++;
            }
          });
          if (count > 0) {
            this.saturation(totalSatShift / count * 50);
          }
        }

        // === SPLIT TONING ===
        if (edits.splitToning) {
          const st = edits.splitToning;
          // Apply highlight toning using colorize with hex color
          if (st.highlightSaturation && st.highlightSaturation > 0) {
            const hexColor = hslToHex(st.highlightHue || 0, 100, 50);
            this.colorize(hexColor, st.highlightSaturation * 0.3);
          }
          // Apply shadow toning
          if (st.shadowSaturation && st.shadowSaturation > 0) {
            const hexColor = hslToHex(st.shadowHue || 0, 100, 50);
            this.colorize(hexColor, st.shadowSaturation * 0.2);
          }
        }

        // === COLOR GRADING ===
        if (edits.colorGrading) {
          const cg = edits.colorGrading;
          // Apply global color grade if set
          if (cg.global?.saturation) {
            this.saturation(cg.global.saturation * 30);
          }
          if (cg.global?.luminance) {
            this.brightness(cg.global.luminance * 30);
          }
        }

        // === COLOR CALIBRATION ===
        if (edits.colorCalibration) {
          const cc = edits.colorCalibration;
          const channels: { red?: number; green?: number; blue?: number } = {};
          if (cc.redPrimarySaturation) channels.red = cc.redPrimarySaturation * 0.3;
          if (cc.greenPrimarySaturation) channels.green = cc.greenPrimarySaturation * 0.3;
          if (cc.bluePrimarySaturation) channels.blue = cc.bluePrimarySaturation * 0.3;
          if (Object.keys(channels).length > 0) {
            this.channels(channels);
          }
        }

        // === EFFECTS ===
        // Vignette
        if (edits.vignette && edits.vignette !== 0) {
          const vignetteAmount = Math.abs(edits.vignette) * 100;
          if (edits.vignette > 0) {
            this.vignette(vignetteAmount + '%', 30);
          }
        }

        // Grain/Noise
        if (edits.grain && edits.grain > 0) {
          this.noise(edits.grain * 30);
        }

        // Blur
        if (edits.blur && edits.blur > 0) {
          this.stackBlur(edits.blur * 10);
        }

        // === LEGACY FILTERS ===
        if (edits.filters) {
          if (edits.filters.includes('grayscale')) {
            this.greyscale();
          }
          if (edits.filters.includes('sepia')) {
            this.sepia(100);
          }
          if (edits.filters.includes('invert')) {
            this.invert();
          }
        }

        // Sepia (standalone)
        if (edits.sepia && edits.sepia > 0) {
          this.sepia(edits.sepia * 100);
        }

        // Noise (standalone)
        if (edits.noise && edits.noise > 0) {
          this.noise(edits.noise * 50);
        }

        // Render and resolve
        this.render(() => {
          resolve();
        });
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Apply CamanJS filters to ImageData and return modified ImageData
 */
export async function applyCamanToImageData(
  imageData: ImageData,
  edits: CamanEditValues
): Promise<ImageData> {
  // Create temporary canvas
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);

  // Apply filters
  await applyCamanFilters(canvas, edits);

  // Get result
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Process an image URL with CamanJS filters and return data URL
 */
export async function processCamanImage(
  imageUrl: string,
  edits: CamanEditValues
): Promise<string> {
  await loadCaman();

  return new Promise((resolve, reject) => {
    // Create image element
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      // Create canvas
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      // Apply filters
      applyCamanFilters(canvas, edits)
        .then(() => {
          resolve(canvas.toDataURL('image/jpeg', 0.95));
        })
        .catch(reject);
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageUrl;
  });
}
