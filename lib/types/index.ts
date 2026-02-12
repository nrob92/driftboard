/**
 * Shared type definitions for Driftboard
 * Single source of truth - imported by CanvasEditor, EditPanel, serverFilters, sandboxFilters
 */

// --- Curves ---

export interface CurvePoint {
  x: number; // 0-255 input
  y: number; // 0-255 output
}

export interface ChannelCurves {
  rgb: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
}

export const DEFAULT_CURVES: ChannelCurves = {
  rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  red: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
};

// --- HSL / Color ---

export interface HSLAdjustments {
  hue: number;        // -100 to +100
  saturation: number; // -100 to +100
  luminance: number;  // -100 to +100
}

export interface ColorHSL {
  red: HSLAdjustments;
  orange: HSLAdjustments;
  yellow: HSLAdjustments;
  green: HSLAdjustments;
  aqua: HSLAdjustments;
  blue: HSLAdjustments;
  purple: HSLAdjustments;
  magenta: HSLAdjustments;
}

export interface SplitToning {
  shadowHue: number;           // 0-360
  shadowSaturation: number;    // 0-100
  highlightHue: number;        // 0-360
  highlightSaturation: number; // 0-100
  balance: number;             // -100 to +100
}

export interface ColorGrading {
  shadowLum: number;     // -100 to +100
  midtoneLum: number;    // -100 to +100
  highlightLum: number;  // -100 to +100
  midtoneHue: number;    // 0-360
  midtoneSat: number;    // 0-100
  globalHue: number;     // 0-360
  globalSat: number;     // 0-100
  globalLum: number;     // -100 to +100
  blending: number;      // 0-100
}

export interface ColorCalibration {
  redHue: number;          // -100 to +100
  redSaturation: number;   // -100 to +100
  greenHue: number;        // -100 to +100
  greenSaturation: number; // -100 to +100
  blueHue: number;         // -100 to +100
  blueSaturation: number;  // -100 to +100
}

// --- Canvas Objects ---

export interface CanvasImage {
  id: string;
  userId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
  storagePath?: string;
  folderId?: string;
  rotation: number;
  scaleX: number;
  scaleY: number;
  // Light adjustments
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  texture?: number;
  // Color adjustments
  temperature: number;
  vibrance: number;
  saturation: number;
  shadowTint?: number;
  colorHSL?: ColorHSL;
  splitToning?: SplitToning;
  colorGrading?: ColorGrading;
  colorCalibration?: ColorCalibration;
  // Effects
  clarity: number;
  dehaze: number;
  vignette: number;
  grain: number;
  grainSize?: number;
  grainRoughness?: number;
  // Curves
  curves: ChannelCurves;
  // Legacy
  brightness: number;
  hue: number;
  blur: number;
  filters: string[];
  // DNG/RAW support
  originalStoragePath?: string;
  thumbnailPath?: string;
  isRaw?: boolean;
  originalWidth?: number;
  originalHeight?: number;
  originalDngBuffer?: ArrayBuffer;
  // Metadata
  takenAt?: string;
  cameraMake?: string;
  cameraModel?: string;
  labels?: string[];
  // Border
  borderWidth?: number;
  borderColor?: string;
}

export interface CanvasText {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fill: string;
  rotation: number;
}

export interface PhotoFolder {
  id: string;
  userId?: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height?: number;
  imageIds: string[];
  color: string;
  type?: 'folder' | 'social_layout';
  pageCount?: number;
  backgroundColor?: string;
}

// --- Edit Keys ---

export const EDIT_KEYS: (keyof CanvasImage)[] = [
  'rotation', 'scaleX', 'scaleY',
  'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture',
  'temperature', 'vibrance', 'saturation', 'shadowTint', 'colorHSL', 'splitToning', 'colorGrading', 'colorCalibration',
  'clarity', 'dehaze', 'vignette', 'grain', 'grainSize', 'grainRoughness',
  'curves', 'brightness', 'hue', 'blur', 'filters',
];

// --- Utility Functions ---

/** Deep-clone nested edit values so undo snapshots are independent */
export function cloneEditValue(key: keyof CanvasImage, v: unknown): unknown {
  if (v === undefined || v === null) return v;
  if (key === 'curves' && typeof v === 'object') return structuredClone(v);
  if ((key === 'colorHSL' || key === 'splitToning' || key === 'colorGrading' || key === 'colorCalibration') && typeof v === 'object') return structuredClone(v);
  if (key === 'filters' && Array.isArray(v)) return [...v];
  return v;
}

// --- Server Filter Types ---

/** Edit values subset for server-side Sharp processing */
export interface EditValues {
  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  whites?: number;
  blacks?: number;
  brightness?: number;
  temperature?: number;
  vibrance?: number;
  saturation?: number;
  clarity?: number;
  dehaze?: number;
  vignette?: number;
  grain?: number;
  curves?: ChannelCurves;
  colorHSL?: ColorHSL;
  splitToning?: SplitToning;
  shadowTint?: number;
  colorGrading?: ColorGrading;
  colorCalibration?: ColorCalibration;
}

// --- UI Types (used by EditPanel) ---

export type ActivePanel = 'curves' | 'light' | 'color' | 'effects' | 'presets' | null;
export type BypassTab = 'curves' | 'light' | 'color' | 'effects';

export interface Preset {
  id: string;
  name: string;
  settings: Partial<CanvasImage>;
}
