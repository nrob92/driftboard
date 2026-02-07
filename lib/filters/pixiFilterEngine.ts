/**
 * GPU-accelerated image filter engine using PixiJS v8.
 * Replaces the CPU-based per-pixel filter pipeline with WebGL/WebGPU shaders.
 *
 * Architecture:
 * - Singleton PixiJS Application renders selected image + filters offscreen
 * - Output is copied to a 2D canvas via drawImage (fast GPU-GPU copy)
 * - That canvas is passed to Konva's <Image> for display
 * - Filter instances are REUSED across renders; only uniforms change
 */

import {
  Application,
  Sprite,
  Texture,
  Filter,
  GlProgram,
  ColorMatrixFilter,
  BlurFilter,
} from 'pixi.js';
import type { CanvasImage, ChannelCurves, ColorHSL, SplitToning, ColorGrading, ColorCalibration } from '@/lib/types';
import { buildLUT } from '@/lib/filters/clientFilters';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/** Uniforms for the advanced color filter */
interface AdvancedColorUniforms {
  uniforms: {
    uHasHSL: number;
    uHasSplitToning: number;
    uShadowTint: number;
    uHasGrading: number;
    uHasCalibration: number;
    uSplitShadowHue: number;
    uSplitShadowSat: number;
    uSplitHighlightHue: number;
    uSplitHighlightSat: number;
    uSplitBalance: number;
    uGradeShadowLum: number;
    uGradeMidtoneLum: number;
    uGradeHighlightLum: number;
    uGradeMidtoneHue: number;
    uGradeMidtoneSat: number;
    uGradeGlobalHue: number;
    uGradeGlobalSat: number;
    uGradeGlobalLum: number;
    uGradeBlending: number;
    uCalRedHue: number;
    uCalRedSat: number;
    uCalGreenHue: number;
    uCalGreenSat: number;
    uCalBlueHue: number;
    uCalBlueSat: number;
    [key: string]: number | unknown; // Allow texture uniforms
  };
}

// ============================================================================
// GLSL SHADERS
// ============================================================================
// PixiJS v8 uses GLSL 300 ES.

/** Default vertex shader for PixiJS filters */
const DEFAULT_VERTEX = /* glsl */ `
attribute vec2 aPosition;
varying vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main() {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

/** Light adjustments: brightness, exposure, tonal, clarity, contrast */
const LIGHT_FRAG = /* glsl */ `
precision highp float;

varying vec2 vTextureCoord;

uniform sampler2D uTexture;

uniform float uBrightness;
uniform float uExposure;
uniform float uHighlights;
uniform float uShadows;
uniform float uWhites;
uniform float uBlacks;
uniform float uClarity;
uniform float uContrast;

float processTonal(float val) {
  // Blacks: 0-25%
  if (val < 0.25) {
    val += uBlacks * 0.3 * (1.0 - val / 0.25);
  }
  // Shadows: 0-50%
  if (val < 0.5) {
    val += uShadows * 0.12 * sin(val * 3.14159265);
  }
  // Highlights: 50-100%
  if (val > 0.5) {
    val += uHighlights * 0.3 * sin((val - 0.5) * 3.14159265);
  }
  // Whites: 75-100%
  if (val > 0.75) {
    val += uWhites * 0.3 * ((val - 0.75) / 0.25);
  }
  return clamp(val, 0.0, 1.0);
}

void main() {
  vec4 color = texture2D(uTexture, vTextureCoord);

  // Brightness (multiply, matches CPU)
  color.rgb *= (1.0 + uBrightness);

  // Exposure (power curve, matches CPU: factor = 2^exposure)
  color.rgb *= pow(2.0, uExposure);

  // Tonal (per-channel, matches CPU LUT approach)
  color.r = processTonal(color.r);
  color.g = processTonal(color.g);
  color.b = processTonal(color.b);

  // Clarity (midtone contrast, matches CPU)
  float factor = 1.0 + uClarity * 0.5;
  vec3 diff = color.rgb - 0.5;
  vec3 weight = max(vec3(0.0), 1.0 - abs(diff) * 1.5);
  color.rgb = clamp(vec3(0.5) + diff * (1.0 + (factor - 1.0) * weight), 0.0, 1.0);

  // Contrast (Konva exact formula: adjust = ((c*25+100)/100)^2)
  float contrastScaled = uContrast * 25.0;
  float adjust = pow((contrastScaled + 100.0) / 100.0, 2.0);
  color.rgb = clamp((color.rgb - 0.5) * adjust + 0.5, 0.0, 1.0);

  gl_FragColor = color;
}
`;

/** Basic color: temperature, vibrance, HSV matrix */
const BASIC_COLOR_FRAG = /* glsl */ `
precision highp float;

varying vec2 vTextureCoord;

uniform sampler2D uTexture;

uniform float uTempFactor;
uniform float uVibrance;
uniform mat3 uHSVMatrix;
uniform float uHasHSV;

void main() {
  vec4 color = texture2D(uTexture, vTextureCoord);

  // Temperature (red/blue channel shift, matches CPU)
  color.r = clamp(color.r + uTempFactor / 255.0, 0.0, 1.0);
  color.b = clamp(color.b - uTempFactor / 255.0, 0.0, 1.0);

  // HSV matrix (saturation + hue, Konva exact formula)
  if (uHasHSV > 0.5) {
    color.rgb = clamp(uHSVMatrix * color.rgb, 0.0, 1.0);
  }

  // Vibrance (smart saturation, matches CPU)
  if (abs(uVibrance) > 0.001) {
    float amt = uVibrance * 1.5;
    float mx = max(max(color.r, color.g), color.b);
    float mn = min(min(color.r, color.g), color.b);
    if (mx > 0.0) {
      float sat = (mx - mn) / mx;
      float f = 1.0 + amt * (1.0 - sat);
      float gray = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
      color.rgb = clamp(vec3(gray) + (color.rgb - vec3(gray)) * f, 0.0, 1.0);
    }
  }

  gl_FragColor = color;
}
`;

/** Advanced color: HSL color, split toning, shadow tint, color grading, calibration */
const ADVANCED_COLOR_FRAG = /* glsl */ `
precision highp float;

varying vec2 vTextureCoord;

uniform sampler2D uTexture;

// HSL Color (LUT texture: 360x1, RGB = hue/sat/lum adjustments encoded as 0-1)
uniform sampler2D uHSLLut;
uniform float uHasHSL;

// Split Toning
uniform float uSplitShadowHue;
uniform float uSplitShadowSat;
uniform float uSplitHighlightHue;
uniform float uSplitHighlightSat;
uniform float uSplitBalance;
uniform float uHasSplitToning;

// Shadow Tint
uniform float uShadowTint;

// Color Grading
uniform float uGradeShadowLum;
uniform float uGradeMidtoneLum;
uniform float uGradeHighlightLum;
uniform float uGradeMidtoneHue;
uniform float uGradeMidtoneSat;
uniform float uGradeGlobalHue;
uniform float uGradeGlobalSat;
uniform float uGradeGlobalLum;
uniform float uGradeBlending;
uniform float uHasGrading;

// Color Calibration
uniform float uCalRedHue;
uniform float uCalRedSat;
uniform float uCalGreenHue;
uniform float uCalGreenSat;
uniform float uCalBlueHue;
uniform float uCalBlueSat;
uniform float uHasCalibration;

// Helper: HSL <-> RGB conversion
float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(float h, float s, float l) {
  if (s < 0.001) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(
    hue2rgb(p, q, h + 1.0/3.0),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1.0/3.0)
  );
}

vec3 rgb2hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5;
  if (mx == mn) return vec3(0.0, 0.0, l);
  float d = mx - mn;
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  h /= 6.0;
  return vec3(h, s, l);
}

void main() {
  vec4 color = texture2D(uTexture, vTextureCoord);

  // --- HSL Color ---
  if (uHasHSL > 0.5) {
    vec3 hsl = rgb2hsl(color.rgb);
    // Skip grays (low saturation)
    if (hsl.y >= 0.05) {
      float hueNorm = hsl.x; // 0-1
      // Sample LUT at this hue (360x1 texture)
      vec3 adj = texture2D(uHSLLut, vec2(hueNorm, 0.5)).rgb;
      adj = adj * 2.0 - 1.0; // Decode from 0-1 to -1..+1

      float hueAdj = adj.r * 100.0;
      float satAdj = adj.g * 100.0;
      float lumAdj = adj.b * 100.0;

      if (abs(hueAdj) > 0.01 || abs(satAdj) > 0.01 || abs(lumAdj) > 0.01) {
        // Apply hue shift
        float newH = hsl.x + (hueAdj / 100.0) * 0.2;
        if (newH < 0.0) newH += 1.0;
        else if (newH > 1.0) newH -= 1.0;

        // Apply saturation
        float newS = hsl.y;
        if (satAdj > 0.0) newS = hsl.y + (1.0 - hsl.y) * (satAdj / 100.0) * 0.5;
        else newS = hsl.y * (1.0 + (satAdj / 100.0) * 0.5);
        newS = clamp(newS, 0.0, 1.0);

        // Apply luminance
        float newL = hsl.z;
        if (lumAdj > 0.0) newL = hsl.z + (1.0 - hsl.z) * (lumAdj / 100.0) * 0.3;
        else newL = hsl.z * (1.0 + (lumAdj / 100.0) * 0.3);
        newL = clamp(newL, 0.0, 1.0);

        color.rgb = hsl2rgb(newH, newS, newL);
      }
    }
  }

  // --- Split Toning ---
  if (uHasSplitToning > 0.5) {
    float lum = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
    float balanceFactor = (uSplitBalance + 100.0) / 200.0;
    bool isShadow = lum < balanceFactor;

    float hue = isShadow ? uSplitShadowHue / 360.0 : uSplitHighlightHue / 360.0;
    float sat = (isShadow ? uSplitShadowSat : uSplitHighlightSat) / 100.0;

    if (sat > 0.0) {
      float q = lum < 0.5 ? lum * (1.0 + sat) : lum + sat - lum * sat;
      float p = 2.0 * lum - q;
      vec3 tone = vec3(hue2rgb(p, q, hue + 1.0/3.0), hue2rgb(p, q, hue), hue2rgb(p, q, hue - 1.0/3.0));
      float blend = isShadow ? (1.0 - lum) : lum;
      float blendAmt = sat * blend;
      color.rgb = clamp(color.rgb * (1.0 - blendAmt) + tone * blendAmt, 0.0, 1.0);
    }
  }

  // --- Shadow Tint ---
  if (abs(uShadowTint) > 0.01) {
    float lum = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
    float shadowStr = max(0.0, 1.0 - lum);
    float tintStr = (abs(uShadowTint) / 100.0) * shadowStr * 0.3;
    if (uShadowTint > 0.0) {
      // Magenta
      color.r = min(1.0, color.r + tintStr);
      color.g = max(0.0, color.g - tintStr);
      color.b = min(1.0, color.b + tintStr);
    } else {
      // Green
      color.r = max(0.0, color.r - tintStr);
      color.g = min(1.0, color.g + tintStr);
      color.b = max(0.0, color.b - tintStr);
    }
  }

  // --- Color Grading ---
  if (uHasGrading > 0.5) {
    float lum = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
    float blending = uGradeBlending / 100.0;

    float shadowW = max(0.0, 1.0 - lum * 2.0);
    float highlightW = max(0.0, lum * 2.0 - 1.0);
    float midtoneW = 1.0 - abs(lum - 0.5) * 2.0;

    float finalLum = lum;
    finalLum += (uGradeShadowLum / 100.0) * shadowW * 0.5;
    finalLum += (uGradeMidtoneLum / 100.0) * midtoneW * 0.5;
    finalLum += (uGradeHighlightLum / 100.0) * highlightW * 0.5;
    finalLum += (uGradeGlobalLum / 100.0) * 0.5;

    // Apply midtone color
    if (uGradeMidtoneSat > 0.0 && midtoneW > 0.0) {
      float h = uGradeMidtoneHue / 360.0;
      float s = (uGradeMidtoneSat / 100.0) * midtoneW;
      float q = finalLum < 0.5 ? finalLum * (1.0 + s) : finalLum + s - finalLum * s;
      float p = 2.0 * finalLum - q;
      vec3 tone = vec3(hue2rgb(p, q, h + 1.0/3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0/3.0));
      color.rgb = clamp(color.rgb * (1.0 - s * blending) + tone * s * blending, 0.0, 1.0);
    } else {
      float lumChange = finalLum - lum;
      color.rgb = clamp(color.rgb + vec3(lumChange), 0.0, 1.0);
    }

    // Apply global color
    if (uGradeGlobalSat > 0.0) {
      float r = color.r, g = color.g, b = color.b;
      float l2 = 0.299 * r + 0.587 * g + 0.114 * b;
      float h = uGradeGlobalHue / 360.0;
      float s = (uGradeGlobalSat / 100.0) * blending;
      float q = l2 < 0.5 ? l2 * (1.0 + s) : l2 + s - l2 * s;
      float p = 2.0 * l2 - q;
      vec3 tone = vec3(hue2rgb(p, q, h + 1.0/3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0/3.0));
      color.rgb = clamp(vec3(r, g, b) * (1.0 - s) + tone * s, 0.0, 1.0);
    }
  }

  // --- Color Calibration ---
  if (uHasCalibration > 0.5) {
    float mx = max(max(color.r, color.g), color.b);
    float mn = min(min(color.r, color.g), color.b);
    float delta = mx - mn;

    if (delta > 0.01) {
      float hue = 0.0;
      if (mx == color.r) hue = mod((color.g - color.b) / delta, 6.0);
      else if (mx == color.g) hue = (color.b - color.r) / delta + 2.0;
      else hue = (color.r - color.g) / delta + 4.0;
      hue = mod(hue * 60.0 + 360.0, 360.0);

      float redW = (hue < 60.0 || hue > 300.0) ? 1.0 - abs((hue < 60.0 ? hue : hue - 360.0)) / 60.0 : 0.0;
      float greenW = (hue >= 60.0 && hue < 180.0) ? 1.0 - abs(hue - 120.0) / 60.0 : 0.0;
      float blueW = (hue >= 180.0 && hue < 300.0) ? 1.0 - abs(hue - 240.0) / 60.0 : 0.0;

      float hueShift = (redW * uCalRedHue + greenW * uCalGreenHue + blueW * uCalBlueHue) / 100.0 * 30.0;
      float satShift = (redW * uCalRedSat + greenW * uCalGreenSat + blueW * uCalBlueSat) / 100.0;

      float l = (mx + mn) / 2.0;
      float s = delta / (1.0 - abs(2.0 * l - 1.0));
      float newHue = mod(hue + hueShift + 360.0, 360.0);
      float newSat = clamp(s * (1.0 + satShift), 0.0, 1.0);

      float c = (1.0 - abs(2.0 * l - 1.0)) * newSat;
      float x = c * (1.0 - abs(mod(newHue / 60.0, 2.0) - 1.0));
      float m = l - c / 2.0;

      vec3 rgb;
      if (newHue < 60.0) rgb = vec3(c, x, 0.0);
      else if (newHue < 120.0) rgb = vec3(x, c, 0.0);
      else if (newHue < 180.0) rgb = vec3(0.0, c, x);
      else if (newHue < 240.0) rgb = vec3(0.0, x, c);
      else if (newHue < 300.0) rgb = vec3(x, 0.0, c);
      else rgb = vec3(c, 0.0, x);

      color.rgb = clamp(rgb + vec3(m), 0.0, 1.0);
    }
  }

  gl_FragColor = color;
}
`;

/** Effects: dehaze, vignette, grain */
const EFFECTS_FRAG = /* glsl */ `
precision highp float;

varying vec2 vTextureCoord;

uniform sampler2D uTexture;

uniform float uDehaze;
uniform float uVignette;
uniform float uGrain;
uniform float uGrainSeed;

// Simple hash for grain noise
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 color = texture2D(uTexture, vTextureCoord);

  // Dehaze (contrast + saturation boost, matches CPU)
  if (abs(uDehaze) > 0.001) {
    float contrastBoost = 1.0 + uDehaze * 0.5;
    float satBoost = 1.0 + uDehaze * 0.3;
    color.rgb = vec3(128.0/255.0) + (color.rgb - vec3(128.0/255.0)) * contrastBoost;
    float gray = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
    color.rgb = clamp(vec3(gray) + (color.rgb - vec3(gray)) * satBoost, 0.0, 1.0);
  }

  // Vignette (radial darkening, matches CPU)
  if (abs(uVignette) > 0.001) {
    vec2 center = vec2(0.5);
    vec2 delta = vTextureCoord - center;
    float distSq = dot(delta, delta) / 0.5; // maxDistSq = 0.5^2 + 0.5^2 = 0.5
    float falloff = distSq * uVignette;
    float factor = falloff < 1.0 ? 1.0 - falloff : 0.0;
    color.rgb *= factor;
  }

  // Grain (noise, matches CPU behavior)
  if (abs(uGrain) > 0.001) {
    float intensity = uGrain * 50.0 / 255.0;
    float noise = (hash(vTextureCoord * 1000.0 + uGrainSeed) - 0.5) * intensity;
    color.rgb = clamp(color.rgb + vec3(noise), 0.0, 1.0);
  }

  gl_FragColor = color;
}
`;

/** Curves: LUT texture based */
const CURVES_FRAG = /* glsl */ `
precision highp float;

varying vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform sampler2D uCurvesLut;
uniform float uCurvesStrength;

void main() {
  vec4 color = texture2D(uTexture, vTextureCoord);

  // Sample composed LUT: R channel = redLUT[rgbLUT[x]], G = greenLUT[...], B = blueLUT[...]
  float curvedR = texture2D(uCurvesLut, vec2(color.r, 0.5)).r;
  float curvedG = texture2D(uCurvesLut, vec2(color.g, 0.5)).g;
  float curvedB = texture2D(uCurvesLut, vec2(color.b, 0.5)).b;

  color.rgb = mix(color.rgb, vec3(curvedR, curvedG, curvedB), uCurvesStrength);

  gl_FragColor = color;
}
`;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Build composed curves LUT data (256x1 RGBA) for GPU texture */
function buildCurvesLutData(curves: ChannelCurves): Uint8ClampedArray {
  const rgbLUT = buildLUT(curves.rgb);
  const redLUT = buildLUT(curves.red);
  const greenLUT = buildLUT(curves.green);
  const blueLUT = buildLUT(curves.blue);

  const data = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const rgbMapped = rgbLUT[i];
    data[i * 4 + 0] = redLUT[rgbMapped];
    data[i * 4 + 1] = greenLUT[rgbMapped];
    data[i * 4 + 2] = blueLUT[rgbMapped];
    data[i * 4 + 3] = 255;
  }
  return data;
}

/** Build HSL color LUT data (360x1 RGBA) for GPU texture */
function buildHSLLutData(colorHSL: ColorHSL): Uint8ClampedArray {
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

  const getColorWeight = (hue360: number, centerHue: number): number => {
    let diff = Math.abs(hue360 - centerHue);
    if (diff > 180) diff = 360 - diff;
    if (diff <= 15) return 1;
    if (diff >= 45) return 0;
    return 1 - (diff - 15) / 30;
  };

  const data = new Uint8ClampedArray(360 * 4);

  for (let hue = 0; hue < 360; hue++) {
    let totalHueAdj = 0, totalSatAdj = 0, totalLumAdj = 0, totalWeight = 0;

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

    let hueAdj = 0, satAdj = 0, lumAdj = 0;
    if (totalWeight > 0) {
      hueAdj = totalHueAdj / totalWeight;
      satAdj = totalSatAdj / totalWeight;
      lumAdj = totalLumAdj / totalWeight;
    }

    // Encode -100..+100 as 0..255 (128 = zero)
    data[hue * 4 + 0] = Math.round((hueAdj / 100 + 1) * 127.5);
    data[hue * 4 + 1] = Math.round((satAdj / 100 + 1) * 127.5);
    data[hue * 4 + 2] = Math.round((lumAdj / 100 + 1) * 127.5);
    data[hue * 4 + 3] = 255;
  }

  return data;
}

/** Compute HSV matrix (Konva exact formula) */
function computeHSVMatrix(saturation: number, hue: number): Float32Array {
  const s = Math.pow(2, saturation * 2);
  const h = Math.abs(hue * 180 + 360) % 360;
  const vsu = s * Math.cos((h * Math.PI) / 180);
  const vsw = s * Math.sin((h * Math.PI) / 180);

  // Column-major for GLSL mat3
  return new Float32Array([
    0.299 + 0.701 * vsu + 0.167 * vsw,   // col0.x (rr)
    0.299 - 0.299 * vsu - 0.328 * vsw,   // col0.y (gr)
    0.299 - 0.3 * vsu + 1.25 * vsw,      // col0.z (br)

    0.587 - 0.587 * vsu + 0.33 * vsw,    // col1.x (rg)
    0.587 + 0.413 * vsu + 0.035 * vsw,   // col1.y (gg)
    0.587 - 0.586 * vsu - 1.05 * vsw,    // col1.z (bg)

    0.114 - 0.114 * vsu - 0.497 * vsw,   // col2.x (rb)
    0.114 - 0.114 * vsu + 0.293 * vsw,   // col2.y (gb)
    0.114 + 0.886 * vsu - 0.2 * vsw,     // col2.z (bb)
  ]);
}

/** Create a canvas-based texture from raw pixel data */
function createLutTexture(data: Uint8ClampedArray, width: number): { canvas: HTMLCanvasElement; texture: Texture } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, 1);
  imageData.data.set(data);
  ctx.putImageData(imageData, 0, 0);
  const texture = Texture.from({ resource: canvas, antialias: false });
  return { canvas, texture };
}

// ============================================================================
// PIXI FILTER ENGINE
// ============================================================================

const CURVES_STRENGTH = 0.6;

export class PixiFilterEngine {
  private app: Application | null = null;
  private sprite: Sprite | null = null;
  private outputCanvas: HTMLCanvasElement | null = null;
  private outputCtx: CanvasRenderingContext2D | null = null;
  private initialized = false;
  private initPromise: Promise<boolean> | null = null;
  private currentWidth = 0;
  private currentHeight = 0;

  // Render lock — prevents concurrent setImage/render race conditions
  private renderLock: Promise<void> = Promise.resolve();

  // Filter instances (reused, only uniforms change)
  private lightFilter: Filter | null = null;
  private basicColorFilter: Filter | null = null;
  private advancedColorFilter: Filter | null = null;
  private effectsFilter: Filter | null = null;
  private curvesFilter: Filter | null = null;
  private blurFilter: BlurFilter | null = null;
  private legacyFilter: ColorMatrixFilter | null = null;

  // LUT texture caching
  private curvesLutCanvas: HTMLCanvasElement | null = null;
  private curvesLutTexture: Texture | null = null;
  private lastCurvesSig = '';
  private hslLutCanvas: HTMLCanvasElement | null = null;
  private hslLutTexture: Texture | null = null;
  private lastHSLSig = '';

  /** Initialize the PixiJS application and create filters. Returns false if GPU unavailable. */
  async init(width: number, height: number): Promise<boolean> {
    if (this.initialized) {
      if (width !== this.currentWidth || height !== this.currentHeight) {
        this.resize(width, height);
      }
      return true;
    }

    if (this.initPromise) return this.initPromise;

    this.initPromise = this._init(width, height);
    return this.initPromise;
  }

  private async _init(width: number, height: number): Promise<boolean> {
    try {
      if (typeof window === 'undefined') return false;

      this.app = new Application();
      await this.app.init({
        width,
        height,
        backgroundAlpha: 0,
        antialias: false,
        resolution: 1,
        preference: 'webgl',
      });

      // Stop auto-rendering (we render manually)
      this.app.ticker.stop();

      // Create output canvas for Konva
      this.outputCanvas = document.createElement('canvas');
      this.outputCanvas.width = width;
      this.outputCanvas.height = height;
      this.outputCtx = this.outputCanvas.getContext('2d');

      // Create sprite (placeholder, will be updated with actual image)
      this.sprite = new Sprite();
      this.app.stage.addChild(this.sprite);

      // Create filter instances
      this.createFilters();

      this.currentWidth = width;
      this.currentHeight = height;
      this.initialized = true;
      return true;
    } catch (e) {
      console.error('[PixiFilterEngine] Initialization failed:', e);
      this.initialized = false;
      return false;
    }
  }

  /** Create all filter instances (done once, reused across renders) */
  private createFilters(): void {
    // Light filter
    this.lightFilter = new Filter({
      glProgram: new GlProgram({ vertex: DEFAULT_VERTEX, fragment: LIGHT_FRAG }),
      resources: {
        lightUniforms: {
          uBrightness: { value: 0, type: 'f32' },
          uExposure: { value: 0, type: 'f32' },
          uHighlights: { value: 0, type: 'f32' },
          uShadows: { value: 0, type: 'f32' },
          uWhites: { value: 0, type: 'f32' },
          uBlacks: { value: 0, type: 'f32' },
          uClarity: { value: 0, type: 'f32' },
          uContrast: { value: 0, type: 'f32' },
        },
      },
    });

    // Basic color filter
    this.basicColorFilter = new Filter({
      glProgram: new GlProgram({ vertex: DEFAULT_VERTEX, fragment: BASIC_COLOR_FRAG }),
      resources: {
        basicColorUniforms: {
          uTempFactor: { value: 0, type: 'f32' },
          uVibrance: { value: 0, type: 'f32' },
          uHSVMatrix: { value: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), type: 'mat3x3<f32>' },
          uHasHSV: { value: 0, type: 'f32' },
        },
      },
    });

    // Effects filter
    this.effectsFilter = new Filter({
      glProgram: new GlProgram({ vertex: DEFAULT_VERTEX, fragment: EFFECTS_FRAG }),
      resources: {
        effectsUniforms: {
          uDehaze: { value: 0, type: 'f32' },
          uVignette: { value: 0, type: 'f32' },
          uGrain: { value: 0, type: 'f32' },
          uGrainSeed: { value: 0, type: 'f32' },
        },
      },
    });

    // Blur filter (PixiJS built-in)
    this.blurFilter = new BlurFilter({ strength: 0, quality: 4 });

    // Legacy filter (grayscale/sepia/invert)
    this.legacyFilter = new ColorMatrixFilter();

    // Curves and advanced color filters are created lazily when LUT textures are ready
  }

  /** Create or update the curves filter with a new LUT texture */
  private updateCurvesFilter(curves: ChannelCurves): void {
    const sig = JSON.stringify(curves);
    if (sig === this.lastCurvesSig && this.curvesFilter) return;
    this.lastCurvesSig = sig;

    const lutData = buildCurvesLutData(curves);

    if (this.curvesLutCanvas) {
      // Update existing canvas
      const ctx = this.curvesLutCanvas.getContext('2d')!;
      const imageData = ctx.createImageData(256, 1);
      imageData.data.set(lutData);
      ctx.putImageData(imageData, 0, 0);
      if (this.curvesLutTexture) {
        this.curvesLutTexture.source.update();
      }
    } else {
      // Create new
      const result = createLutTexture(lutData, 256);
      this.curvesLutCanvas = result.canvas;
      this.curvesLutTexture = result.texture;
    }

    if (!this.curvesFilter) {
      this.curvesFilter = new Filter({
        glProgram: new GlProgram({ vertex: DEFAULT_VERTEX, fragment: CURVES_FRAG }),
        resources: {
          uCurvesLut: this.curvesLutTexture!.source,
          curvesUniforms: {
            uCurvesStrength: { value: CURVES_STRENGTH, type: 'f32' },
          },
        },
      });
    }
    // Note: Texture uniform is already bound at filter creation.
    // Texture data updates happen via updateCurvesLut() calling texture.source.update()
  }

  /** Create or update the HSL LUT texture for the advanced color filter */
  private updateHSLLut(colorHSL: ColorHSL): void {
    const sig = JSON.stringify(colorHSL);
    if (sig === this.lastHSLSig && this.hslLutTexture) return;
    this.lastHSLSig = sig;

    const lutData = buildHSLLutData(colorHSL);

    if (this.hslLutCanvas) {
      const ctx = this.hslLutCanvas.getContext('2d')!;
      const imageData = ctx.createImageData(360, 1);
      imageData.data.set(lutData);
      ctx.putImageData(imageData, 0, 0);
      if (this.hslLutTexture) {
        this.hslLutTexture.source.update();
      }
    } else {
      const result = createLutTexture(lutData, 360);
      this.hslLutCanvas = result.canvas;
      this.hslLutTexture = result.texture;
    }
  }

  /** Ensure advanced color filter exists with current HSL LUT */
  private ensureAdvancedColorFilter(): void {
    if (this.advancedColorFilter) return;

    // Create with a placeholder HSL LUT (1x1 mid-gray)
    if (!this.hslLutTexture) {
      const result = createLutTexture(new Uint8ClampedArray([128, 128, 128, 255]), 1);
      this.hslLutCanvas = result.canvas;
      this.hslLutTexture = result.texture;
    }

    this.advancedColorFilter = new Filter({
      glProgram: new GlProgram({ vertex: DEFAULT_VERTEX, fragment: ADVANCED_COLOR_FRAG }),
      resources: {
        uHSLLut: this.hslLutTexture!.source,
        advColorUniforms: {
          uHasHSL: { value: 0, type: 'f32' },
          uHasSplitToning: { value: 0, type: 'f32' },
          uShadowTint: { value: 0, type: 'f32' },
          uHasGrading: { value: 0, type: 'f32' },
          uHasCalibration: { value: 0, type: 'f32' },
          // Split toning
          uSplitShadowHue: { value: 0, type: 'f32' },
          uSplitShadowSat: { value: 0, type: 'f32' },
          uSplitHighlightHue: { value: 0, type: 'f32' },
          uSplitHighlightSat: { value: 0, type: 'f32' },
          uSplitBalance: { value: 0, type: 'f32' },
          // Color grading
          uGradeShadowLum: { value: 0, type: 'f32' },
          uGradeMidtoneLum: { value: 0, type: 'f32' },
          uGradeHighlightLum: { value: 0, type: 'f32' },
          uGradeMidtoneHue: { value: 0, type: 'f32' },
          uGradeMidtoneSat: { value: 0, type: 'f32' },
          uGradeGlobalHue: { value: 0, type: 'f32' },
          uGradeGlobalSat: { value: 0, type: 'f32' },
          uGradeGlobalLum: { value: 0, type: 'f32' },
          uGradeBlending: { value: 0, type: 'f32' },
          // Color calibration
          uCalRedHue: { value: 0, type: 'f32' },
          uCalRedSat: { value: 0, type: 'f32' },
          uCalGreenHue: { value: 0, type: 'f32' },
          uCalGreenSat: { value: 0, type: 'f32' },
          uCalBlueHue: { value: 0, type: 'f32' },
          uCalBlueSat: { value: 0, type: 'f32' },
        },
      },
    });
  }

  /** Resize the renderer and output canvas */
  private resize(width: number, height: number): void {
    if (!this.app || !this.outputCanvas) return;
    this.app.renderer.resize(width, height);
    this.outputCanvas.width = width;
    this.outputCanvas.height = height;
    this.currentWidth = width;
    this.currentHeight = height;
  }

  /** Set the source image on the sprite */
  private setImage(imgElement: HTMLImageElement): void {
    if (!this.sprite) return;
    const texture = Texture.from({ resource: imgElement, antialias: false });
    this.sprite.texture = texture;
    this.sprite.width = imgElement.naturalWidth || imgElement.width;
    this.sprite.height = imgElement.naturalHeight || imgElement.height;
  }

  /**
   * Render an image with filters atomically (mutex-protected).
   * Prevents race conditions when multiple ImageNodes render concurrently.
   * Returns a CLONED canvas (caller owns it) or null on failure.
   *
   * @param renderWidth  Optional target width (defaults to source resolution)
   * @param renderHeight Optional target height (defaults to source resolution)
   */
  async renderImage(
    imgElement: HTMLImageElement,
    image: CanvasImage,
    bypassedTabs: Set<string>,
    renderWidth?: number,
    renderHeight?: number,
  ): Promise<HTMLCanvasElement | null> {
    const w = renderWidth || imgElement.naturalWidth || imgElement.width;
    const h = renderHeight || imgElement.naturalHeight || imgElement.height;

    // Acquire render lock — wait for any in-progress render to finish
    let releaseLock: () => void;
    const prevLock = this.renderLock;
    this.renderLock = new Promise<void>((resolve) => { releaseLock = resolve; });
    await prevLock;

    try {
      // Init or resize
      const ok = await this.init(w, h);
      if (!ok) return null;

      // Set image, render, clone — all under the lock
      this.setImage(imgElement);
      const canvas = this.updateAndRender(image, bypassedTabs, w, h);
      if (!canvas) return null;

      // Clone so each image owns its own canvas
      const cloned = document.createElement('canvas');
      cloned.width = canvas.width;
      cloned.height = canvas.height;
      const ctx = cloned.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(canvas, 0, 0);
      return cloned;
    } finally {
      releaseLock!();
    }
  }

  /** Update uniforms and render. Returns the output canvas (shared — do not hold reference). */
  private updateAndRender(
    image: CanvasImage,
    bypassedTabs: Set<string>,
    displayWidth: number,
    displayHeight: number,
  ): HTMLCanvasElement | null {
    if (!this.app || !this.sprite || !this.outputCanvas || !this.outputCtx) return null;

    // Resize if needed
    if (displayWidth !== this.currentWidth || displayHeight !== this.currentHeight) {
      this.resize(displayWidth, displayHeight);
    }

    // Scale sprite to fill renderer
    this.sprite.width = displayWidth;
    this.sprite.height = displayHeight;

    const bypassCurves = bypassedTabs.has('curves');
    const bypassLight = bypassedTabs.has('light');
    const bypassColor = bypassedTabs.has('color');
    const bypassEffects = bypassedTabs.has('effects');

    // Build filter array (only include active filters)
    const filters: Filter[] = [];

    // --- Curves ---
    if (!bypassCurves && this.isCurvesActive(image)) {
      this.updateCurvesFilter(image.curves);
      if (this.curvesFilter) filters.push(this.curvesFilter);
    }

    // --- Light ---
    if (!bypassLight && this.isLightActive(image)) {
      this.updateLightUniforms(image);
      filters.push(this.lightFilter!);
    }

    // --- Basic Color ---
    if (!bypassColor && this.isBasicColorActive(image)) {
      this.updateBasicColorUniforms(image);
      filters.push(this.basicColorFilter!);
    }

    // --- Advanced Color ---
    if (!bypassColor && this.isAdvancedColorActive(image)) {
      this.ensureAdvancedColorFilter();
      this.updateAdvancedColorUniforms(image);
      filters.push(this.advancedColorFilter!);
    }

    // --- Effects ---
    if (!bypassEffects && this.isEffectsActive(image)) {
      this.updateEffectsUniforms(image);
      filters.push(this.effectsFilter!);
    }

    // --- Blur ---
    if (!bypassEffects && image.blur > 0) {
      this.blurFilter!.strength = image.blur * 20;
      filters.push(this.blurFilter!);
    }

    // --- Legacy (grayscale/sepia/invert) ---
    if (this.isLegacyActive(image)) {
      this.updateLegacyFilter(image);
      filters.push(this.legacyFilter!);
    }

    // Apply filters and render
    this.sprite.filters = filters.length > 0 ? filters : null;

    this.app.render();

    // Copy PixiJS WebGL canvas → 2D output canvas (fast GPU-GPU copy)
    this.outputCtx.clearRect(0, 0, displayWidth, displayHeight);
    this.outputCtx.drawImage(this.app.canvas, 0, 0, displayWidth, displayHeight);

    return this.outputCanvas;
  }

  /** Export at full resolution using GPU filters (mutex-protected) */
  async exportFiltered(image: CanvasImage, fullResImg: HTMLImageElement): Promise<Blob> {
    if (!this.app || !this.sprite) {
      throw new Error('PixiFilterEngine not initialized');
    }

    const w = fullResImg.naturalWidth || fullResImg.width;
    const h = fullResImg.naturalHeight || fullResImg.height;

    // Acquire render lock
    let releaseLock: () => void;
    const prevLock = this.renderLock;
    this.renderLock = new Promise<void>((resolve) => { releaseLock = resolve; });
    await prevLock;

    try {
      // Resize to full resolution
      this.resize(w, h);
      this.setImage(fullResImg);

      // Render with no bypass tabs (export = all filters applied)
      const emptyBypass = new Set<string>();
      this.updateAndRender(image, emptyBypass, w, h);

      // Get blob from output canvas
      const blob = await new Promise<Blob>((resolve, reject) => {
        this.outputCanvas!.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
          'image/jpeg',
          0.95,
        );
      });

      return blob;
    } finally {
      releaseLock!();
    }
  }

  // ---- Uniform Update Methods ----

  private updateLightUniforms(image: CanvasImage): void {
    const u = this.lightFilter!.resources.lightUniforms as { uniforms: Record<string, number> };
    u.uniforms.uBrightness = image.brightness;
    u.uniforms.uExposure = image.exposure;
    u.uniforms.uHighlights = image.highlights;
    u.uniforms.uShadows = image.shadows;
    u.uniforms.uWhites = image.whites;
    u.uniforms.uBlacks = image.blacks;
    u.uniforms.uClarity = image.clarity;
    u.uniforms.uContrast = image.contrast;
  }

  private updateBasicColorUniforms(image: CanvasImage): void {
    const u = this.basicColorFilter!.resources.basicColorUniforms as { uniforms: Record<string, number | Float32Array> };
    u.uniforms.uTempFactor = image.temperature * 30;
    u.uniforms.uVibrance = image.vibrance;

    if (image.saturation !== 0 || image.hue !== 0) {
      u.uniforms.uHSVMatrix = computeHSVMatrix(image.saturation, image.hue);
      u.uniforms.uHasHSV = 1;
    } else {
      u.uniforms.uHasHSV = 0;
    }
  }

  private updateAdvancedColorUniforms(image: CanvasImage): void {
    const u = this.advancedColorFilter!.resources.advColorUniforms as AdvancedColorUniforms;

    // HSL Color
    if (image.colorHSL && this.hasActiveHSL(image.colorHSL)) {
      this.updateHSLLut(image.colorHSL);
      u.uniforms.uHasHSL = 1;
      // Note: Texture uniform is already bound at filter creation.
      // Texture data updates happen via updateHSLLut() calling texture.source.update()
    } else {
      u.uniforms.uHasHSL = 0;
    }

    // Split Toning
    if (image.splitToning) {
      u.uniforms.uHasSplitToning = 1;
      u.uniforms.uSplitShadowHue = image.splitToning.shadowHue;
      u.uniforms.uSplitShadowSat = image.splitToning.shadowSaturation;
      u.uniforms.uSplitHighlightHue = image.splitToning.highlightHue;
      u.uniforms.uSplitHighlightSat = image.splitToning.highlightSaturation;
      u.uniforms.uSplitBalance = image.splitToning.balance;
    } else {
      u.uniforms.uHasSplitToning = 0;
    }

    // Shadow Tint
    u.uniforms.uShadowTint = image.shadowTint ?? 0;

    // Color Grading
    if (image.colorGrading) {
      u.uniforms.uHasGrading = 1;
      u.uniforms.uGradeShadowLum = image.colorGrading.shadowLum;
      u.uniforms.uGradeMidtoneLum = image.colorGrading.midtoneLum;
      u.uniforms.uGradeHighlightLum = image.colorGrading.highlightLum;
      u.uniforms.uGradeMidtoneHue = image.colorGrading.midtoneHue;
      u.uniforms.uGradeMidtoneSat = image.colorGrading.midtoneSat;
      u.uniforms.uGradeGlobalHue = image.colorGrading.globalHue;
      u.uniforms.uGradeGlobalSat = image.colorGrading.globalSat;
      u.uniforms.uGradeGlobalLum = image.colorGrading.globalLum;
      u.uniforms.uGradeBlending = image.colorGrading.blending;
    } else {
      u.uniforms.uHasGrading = 0;
    }

    // Color Calibration
    if (image.colorCalibration) {
      u.uniforms.uHasCalibration = 1;
      u.uniforms.uCalRedHue = image.colorCalibration.redHue;
      u.uniforms.uCalRedSat = image.colorCalibration.redSaturation;
      u.uniforms.uCalGreenHue = image.colorCalibration.greenHue;
      u.uniforms.uCalGreenSat = image.colorCalibration.greenSaturation;
      u.uniforms.uCalBlueHue = image.colorCalibration.blueHue;
      u.uniforms.uCalBlueSat = image.colorCalibration.blueSaturation;
    } else {
      u.uniforms.uHasCalibration = 0;
    }
  }

  private updateEffectsUniforms(image: CanvasImage): void {
    const u = this.effectsFilter!.resources.effectsUniforms as { uniforms: Record<string, number> };
    u.uniforms.uDehaze = image.dehaze;
    u.uniforms.uVignette = image.vignette;
    u.uniforms.uGrain = image.grain;
    u.uniforms.uGrainSeed = Math.random() * 1000;
  }

  private updateLegacyFilter(image: CanvasImage): void {
    this.legacyFilter!.reset();
    if (image.filters.includes('grayscale')) this.legacyFilter!.greyscale(1, true);
    if (image.filters.includes('sepia')) this.legacyFilter!.sepia(true);
    if (image.filters.includes('invert')) this.legacyFilter!.negative(true);
  }

  // ---- Active State Checks ----

  private isCurvesActive(image: CanvasImage): boolean {
    if (!image.curves) return false;
    const ch = (points: { x: number; y: number }[]) => {
      if (!points || points.length === 0) return false;
      if (points.length > 2) return true;
      return points.some((p, i) => (i === 0 ? p.x !== 0 || p.y !== 0 : i === points.length - 1 ? p.x !== 255 || p.y !== 255 : true));
    };
    return ch(image.curves.rgb) || ch(image.curves.red) || ch(image.curves.green) || ch(image.curves.blue);
  }

  private isLightActive(image: CanvasImage): boolean {
    return image.brightness !== 0 || image.exposure !== 0 ||
           image.highlights !== 0 || image.shadows !== 0 ||
           image.whites !== 0 || image.blacks !== 0 ||
           image.clarity !== 0 || image.contrast !== 0;
  }

  private isBasicColorActive(image: CanvasImage): boolean {
    return image.temperature !== 0 || image.vibrance !== 0 ||
           image.saturation !== 0 || image.hue !== 0;
  }

  private isAdvancedColorActive(image: CanvasImage): boolean {
    return (image.colorHSL !== undefined && this.hasActiveHSL(image.colorHSL!)) ||
           image.splitToning !== undefined ||
           (image.shadowTint !== undefined && image.shadowTint !== 0) ||
           image.colorGrading !== undefined ||
           image.colorCalibration !== undefined;
  }

  private hasActiveHSL(colorHSL: ColorHSL): boolean {
    return Object.values(colorHSL).some(
      (adj) => adj && ((adj.hue ?? 0) !== 0 || (adj.saturation ?? 0) !== 0 || (adj.luminance ?? 0) !== 0)
    );
  }

  private isEffectsActive(image: CanvasImage): boolean {
    return image.dehaze !== 0 || image.vignette !== 0 || image.grain !== 0;
  }

  private isLegacyActive(image: CanvasImage): boolean {
    return image.filters?.includes('grayscale') ||
           image.filters?.includes('sepia') ||
           image.filters?.includes('invert') || false;
  }

  /** Check if ANY filters are active for this image */
  hasActiveFilters(image: CanvasImage): boolean {
    return this.isLightActive(image) || this.isBasicColorActive(image) ||
           this.isAdvancedColorActive(image) || this.isEffectsActive(image) ||
           this.isCurvesActive(image) || image.blur > 0 || this.isLegacyActive(image);
  }

  /** Cleanup */
  destroy(): void {
    this.curvesLutTexture?.destroy();
    this.hslLutTexture?.destroy();
    this.lightFilter?.destroy();
    this.basicColorFilter?.destroy();
    this.advancedColorFilter?.destroy();
    this.effectsFilter?.destroy();
    this.curvesFilter?.destroy();
    this.blurFilter?.destroy();
    this.legacyFilter?.destroy();
    this.sprite?.destroy();
    this.app?.destroy(true);
    this.app = null;
    this.sprite = null;
    this.outputCanvas = null;
    this.outputCtx = null;
    this.initialized = false;
    this.initPromise = null;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  get canvas(): HTMLCanvasElement | null {
    return this.outputCanvas;
  }
}

// Singleton instance
let engineInstance: PixiFilterEngine | null = null;

export function getPixiFilterEngine(): PixiFilterEngine {
  if (!engineInstance) {
    engineInstance = new PixiFilterEngine();
  }
  return engineInstance;
}

export function destroyPixiFilterEngine(): void {
  engineInstance?.destroy();
  engineInstance = null;
}
