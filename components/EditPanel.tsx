'use client';

import { useCallback, useState, useRef, useEffect } from 'react';
import { CurvesEditor } from './CurvesEditor';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

interface CurvePoint {
  x: number;
  y: number;
}

interface ChannelCurves {
  rgb: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
}

interface HSLAdjustments {
  hue: number;
  saturation: number;
  luminance: number;
}

interface ColorHSL {
  red: HSLAdjustments;
  orange: HSLAdjustments;
  yellow: HSLAdjustments;
  green: HSLAdjustments;
  aqua: HSLAdjustments;
  blue: HSLAdjustments;
  purple: HSLAdjustments;
  magenta: HSLAdjustments;
}

interface SplitToning {
  shadowHue: number;
  shadowSaturation: number;
  highlightHue: number;
  highlightSaturation: number;
  balance: number;
}

interface ColorGrading {
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

interface ColorCalibration {
  redHue: number;        // -100 to +100
  redSaturation: number; // -100 to +100
  greenHue: number;      // -100 to +100
  greenSaturation: number; // -100 to +100
  blueHue: number;       // -100 to +100
  blueSaturation: number; // -100 to +100
}

const DEFAULT_CURVES: ChannelCurves = {
  rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  red: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
};

type CanvasImage = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
  rotation: number;
  scaleX: number;
  scaleY: number;
  // Light
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  texture?: number;
  // Color
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
};

type CanvasText = {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fill: string;
  rotation: number;
};

type ActivePanel = 'curves' | 'light' | 'color' | 'effects' | 'presets' | null;

interface Preset {
  id: string;
  name: string;
  settings: Partial<CanvasImage>;
}

interface EditPanelProps {
  object: CanvasImage | CanvasText;
  onUpdate: (updates: Partial<CanvasImage | CanvasText>) => void;
  onDelete: () => void;
  onResetToOriginal?: () => void;
  onSave?: () => void;
}

// Slider component with double-click reset
function Slider({ 
  label, 
  value, 
  min, 
  max, 
  step, 
  defaultValue,
  onChange 
}: { 
  label: string; 
  value: number; 
  min: number; 
  max: number; 
  step: number; 
  defaultValue: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-[#888] w-20">{label}</span>
      <div className="flex items-center gap-2 flex-1">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onDoubleClick={() => onChange(defaultValue)}
          className="flex-1 h-1 bg-[#333] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#3ECF8E] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125"
        />
        <span className="text-[10px] text-[#666] w-8 text-right tabular-nums">
          {value > 0 ? '+' : ''}{Math.round(value * 100)}
        </span>
      </div>
    </div>
  );
}

export function EditPanel({ object, onUpdate, onDelete, onResetToOriginal, onSave }: EditPanelProps) {
  const isImage = 'src' in object;
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [renamingPresetId, setRenamingPresetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isHSLExpanded, setIsHSLExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  // Load presets from database on mount
  useEffect(() => {
    const loadPresets = async () => {
      if (!user) return;

      const { data, error } = await supabase
        .from('presets')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading presets:', error);
        return;
      }

      if (data) {
        const loadedPresets: Preset[] = data.map((row) => ({
          id: row.id,
          name: row.name,
          settings: row.settings as Partial<CanvasImage>,
        }));
        setPresets(loadedPresets);
      }
    };

    loadPresets();
  }, [user]);

  const handleCurvesChange = useCallback(
    (curves: ChannelCurves) => {
      onUpdate({ curves });
    },
    [onUpdate]
  );

  // Check if any curve channel is modified from default
  const isCurveModified = (points: CurvePoint[]) => {
    if (!points || points.length === 0) return false;
    if (points.length > 2) return true;
    return points.some((p, i) => {
      if (i === 0) return p.x !== 0 || p.y !== 0;
      if (i === points.length - 1) return p.x !== 255 || p.y !== 255;
      return true;
    });
  };

  const img = object as CanvasImage;
  
  const isCurvesModified = isImage && img.curves && (
    isCurveModified(img.curves.rgb) ||
    isCurveModified(img.curves.red) ||
    isCurveModified(img.curves.green) ||
    isCurveModified(img.curves.blue)
  );

  const isLightModified = isImage && (
    img.exposure !== 0 ||
    img.contrast !== 0 ||
    img.highlights !== 0 ||
    img.shadows !== 0 ||
    img.whites !== 0 ||
    img.blacks !== 0
  );

  const isColorModified = isImage && (
    img.temperature !== 0 ||
    img.vibrance !== 0 ||
    img.saturation !== 0
  );

  const isEffectsModified = isImage && (
    img.clarity !== 0 ||
    img.dehaze !== 0 ||
    img.vignette !== 0 ||
    img.grain !== 0
  );

  const togglePanel = (panel: ActivePanel) => {
    setActivePanel(activePanel === panel ? null : panel);
  };

  // Parse XMP file (enhanced implementation)
  const parseXMP = (xmpContent: string): Partial<CanvasImage> => {
    const settings: Partial<CanvasImage> = {};

    // Extract common adjustment values from XMP
    const extractValue = (key: string) => {
      const match = xmpContent.match(new RegExp(`crs:${key}="([^"]+)"`));
      return match ? parseFloat(match[1]) : null;
    };

    // Light adjustments
    const exposure = extractValue('Exposure2012');
    const contrast = extractValue('Contrast2012');
    const highlights = extractValue('Highlights2012');
    const shadows = extractValue('Shadows2012');
    const whites = extractValue('Whites2012');
    const blacks = extractValue('Blacks2012');
    const texture = extractValue('Texture');

    // Color adjustments
    const temperature = extractValue('Temperature');
    const vibrance = extractValue('Vibrance');
    const saturation = extractValue('Saturation');
    const shadowTint = extractValue('ShadowTint');

    // Effects
    const clarity = extractValue('Clarity2012');
    const dehaze = extractValue('Dehaze');
    const vignette = extractValue('PostCropVignetteAmount');
    const grain = extractValue('GrainAmount');
    const grainSize = extractValue('GrainSize');
    const grainRoughness = extractValue('GrainFrequency');

    // Apply basic adjustments
    if (exposure !== null) settings.exposure = exposure / 100;
    if (contrast !== null) settings.contrast = contrast / 100;
    if (highlights !== null) settings.highlights = highlights / 100;
    if (shadows !== null) settings.shadows = shadows / 100;
    if (whites !== null) settings.whites = whites / 100;
    if (blacks !== null) settings.blacks = blacks / 100;
    if (texture !== null) settings.texture = texture / 100;
    if (temperature !== null) settings.temperature = (temperature - 5500) / 5500;
    if (vibrance !== null) settings.vibrance = vibrance / 100;
    if (saturation !== null) settings.saturation = saturation / 100;
    if (shadowTint !== null) settings.shadowTint = shadowTint / 100;
    if (clarity !== null) settings.clarity = clarity / 100;
    if (dehaze !== null) settings.dehaze = dehaze / 100;
    if (vignette !== null) settings.vignette = Math.abs(vignette) / 100;
    if (grain !== null) settings.grain = grain / 100;
    if (grainSize !== null) settings.grainSize = grainSize / 100;
    if (grainRoughness !== null) settings.grainRoughness = grainRoughness / 100;

    // Extract HSL adjustments for each color
    const colors: Array<keyof ColorHSL> = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
    const colorHSL: Partial<ColorHSL> = {};
    let hasHSL = false;

    for (const color of colors) {
      const colorCap = color.charAt(0).toUpperCase() + color.slice(1);
      const hue = extractValue(`HueAdjustment${colorCap}`);
      const sat = extractValue(`SaturationAdjustment${colorCap}`);
      const lum = extractValue(`LuminanceAdjustment${colorCap}`);

      if (hue !== null || sat !== null || lum !== null) {
        hasHSL = true;
        colorHSL[color] = {
          hue: hue ?? 0,
          saturation: sat ?? 0,
          luminance: lum ?? 0,
        };
      }
    }

    if (hasHSL) {
      settings.colorHSL = colorHSL as ColorHSL;
    }

    // Extract Split Toning
    const splitShadowHue = extractValue('SplitToningShadowHue');
    const splitShadowSat = extractValue('SplitToningShadowSaturation');
    const splitHighlightHue = extractValue('SplitToningHighlightHue');
    const splitHighlightSat = extractValue('SplitToningHighlightSaturation');
    const splitBalance = extractValue('SplitToningBalance');

    if (splitShadowHue !== null || splitShadowSat !== null || splitHighlightHue !== null || splitHighlightSat !== null) {
      settings.splitToning = {
        shadowHue: splitShadowHue ?? 0,
        shadowSaturation: splitShadowSat ?? 0,
        highlightHue: splitHighlightHue ?? 0,
        highlightSaturation: splitHighlightSat ?? 0,
        balance: splitBalance ?? 0,
      };
    }

    // Extract Color Grading
    const colorGradeShadowLum = extractValue('ColorGradeShadowLum');
    const colorGradeMidtoneLum = extractValue('ColorGradeMidtoneLum');
    const colorGradeHighlightLum = extractValue('ColorGradeHighlightLum');
    const colorGradeMidtoneHue = extractValue('ColorGradeMidtoneHue');
    const colorGradeMidtoneSat = extractValue('ColorGradeMidtoneSat');
    const colorGradeGlobalHue = extractValue('ColorGradeGlobalHue');
    const colorGradeGlobalSat = extractValue('ColorGradeGlobalSat');
    const colorGradeGlobalLum = extractValue('ColorGradeGlobalLum');
    const colorGradeBlending = extractValue('ColorGradeBlending');

    if (colorGradeShadowLum !== null || colorGradeMidtoneLum !== null || colorGradeHighlightLum !== null ||
        colorGradeMidtoneHue !== null || colorGradeMidtoneSat !== null || colorGradeGlobalHue !== null ||
        colorGradeGlobalSat !== null || colorGradeGlobalLum !== null || colorGradeBlending !== null) {
      settings.colorGrading = {
        shadowLum: colorGradeShadowLum ?? 0,
        midtoneLum: colorGradeMidtoneLum ?? 0,
        highlightLum: colorGradeHighlightLum ?? 0,
        midtoneHue: colorGradeMidtoneHue ?? 0,
        midtoneSat: colorGradeMidtoneSat ?? 0,
        globalHue: colorGradeGlobalHue ?? 0,
        globalSat: colorGradeGlobalSat ?? 0,
        globalLum: colorGradeGlobalLum ?? 0,
        blending: colorGradeBlending ?? 100,
      };
    }

    // Extract Color Calibration
    const redHue = extractValue('RedHue');
    const redSat = extractValue('RedSaturation');
    const greenHue = extractValue('GreenHue');
    const greenSat = extractValue('GreenSaturation');
    const blueHue = extractValue('BlueHue');
    const blueSat = extractValue('BlueSaturation');

    if (redHue !== null || redSat !== null || greenHue !== null || greenSat !== null || blueHue !== null || blueSat !== null) {
      settings.colorCalibration = {
        redHue: redHue ?? 0,
        redSaturation: redSat ?? 0,
        greenHue: greenHue ?? 0,
        greenSaturation: greenSat ?? 0,
        blueHue: blueHue ?? 0,
        blueSaturation: blueSat ?? 0,
      };
    }

    // Detect Adobe Monochrome Look for B&W conversion
    const isMonochrome = xmpContent.match(/crs:Name="Adobe Monochrome"/);
    if (isMonochrome) {
      settings.filters = ['grayscale'];
      settings.saturation = -1;
    }

    // Extract tone curves
    const extractCurve = (channelName: string): CurvePoint[] => {
      // Match the ToneCurvePV2012 sequence in XMP
      const tagName = channelName ? `ToneCurvePV2012${channelName}` : 'ToneCurvePV2012';
      const pattern = new RegExp(`<crs:${tagName}>\\s*<rdf:Seq>([\\s\\S]*?)<\\/rdf:Seq>\\s*<\\/crs:${tagName}>`, 'i');
      const match = xmpContent.match(pattern);

      if (!match) {
        // Return default linear curve
        return [{ x: 0, y: 0 }, { x: 255, y: 255 }];
      }

      // Extract all <rdf:li> elements
      const liMatches = match[1].matchAll(/<rdf:li>([^<]+)<\/rdf:li>/g);
      const curvePoints: CurvePoint[] = [];

      for (const liMatch of liMatches) {
        const [xStr, yStr] = liMatch[1].split(',').map(s => s.trim());
        const x = parseInt(xStr);
        const y = parseInt(yStr);

        if (!isNaN(x) && !isNaN(y)) {
          curvePoints.push({ x, y });
        }
      }

      // If we got valid points, return them; otherwise return default
      return curvePoints.length >= 2 ? curvePoints : [{ x: 0, y: 0 }, { x: 255, y: 255 }];
    };

    // Extract curves for all channels
    const rgbCurve = extractCurve('');
    const redCurve = extractCurve('Red');
    const greenCurve = extractCurve('Green');
    const blueCurve = extractCurve('Blue');

    // Only set curves if at least one channel has a non-default curve
    const hasCustomCurves =
      rgbCurve.length > 2 ||
      redCurve.length > 2 ||
      greenCurve.length > 2 ||
      blueCurve.length > 2;

    if (hasCustomCurves) {
      settings.curves = {
        rgb: rgbCurve,
        red: redCurve,
        green: greenCurve,
        blue: blueCurve,
      };
    }

    return settings;
  };

  // Handle preset file upload
  const handlePresetFiles = useCallback(async (files: FileList) => {
    const xmpFiles = Array.from(files).filter(f => f.name.endsWith('.xmp'));

    for (const file of xmpFiles) {
      const text = await file.text();
      const settings = parseXMP(text);
      const name = file.name.replace('.xmp', '');

      // Save to database if user is logged in
      if (user) {
        const { data, error } = await supabase
          .from('presets')
          .insert({
            user_id: user.id,
            name: name,
            settings: settings,
          })
          .select()
          .single();

        if (error) {
          console.error('Error saving preset:', error);
          // Still add to local state even if DB save fails
          const preset: Preset = {
            id: `preset-${Date.now()}-${Math.random()}`,
            name: name,
            settings: settings,
          };
          setPresets(prev => [...prev, preset]);
        } else if (data) {
          const preset: Preset = {
            id: data.id,
            name: data.name,
            settings: data.settings as Partial<CanvasImage>,
          };
          setPresets(prev => [...prev, preset]);
        }
      } else {
        // Not logged in - just add to local state
        const preset: Preset = {
          id: `preset-${Date.now()}-${Math.random()}`,
          name: name,
          settings: settings,
        };
        setPresets(prev => [...prev, preset]);
      }
    }
  }, [user]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files) {
      handlePresetFiles(e.dataTransfer.files);
    }
  }, [handlePresetFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handlePresetFiles(e.target.files);
    }
  }, [handlePresetFiles]);

  const applyPreset = useCallback((preset: Preset) => {
    // Reset all adjustments to defaults, then apply preset
    const resetSettings: Partial<CanvasImage> = {
      // Light
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      texture: 0,
      // Color
      temperature: 0,
      vibrance: 0,
      saturation: 0,
      hue: 0,
      shadowTint: 0,
      colorHSL: undefined,
      splitToning: undefined,
      colorGrading: undefined,
      colorCalibration: undefined,
      // Effects
      clarity: 0,
      dehaze: 0,
      vignette: 0,
      grain: 0,
      grainSize: 0,
      grainRoughness: 0,
      // Curves
      curves: { ...DEFAULT_CURVES },
      // Filters
      filters: [],
      // Legacy
      brightness: 0,
      blur: 0,
      // Apply preset on top of defaults
      ...preset.settings,
    };
    onUpdate(resetSettings);
  }, [onUpdate]);

  const deletePreset = useCallback(async (presetId: string) => {
    // Delete from database if user is logged in
    if (user) {
      const { error } = await supabase
        .from('presets')
        .delete()
        .eq('id', presetId)
        .eq('user_id', user.id);

      if (error) {
        console.error('Error deleting preset:', error);
      }
    }

    // Remove from local state
    setPresets(prev => prev.filter(p => p.id !== presetId));
  }, [user]);

  const handlePresetDoubleClick = useCallback((preset: Preset) => {
    setRenamingPresetId(preset.id);
    setRenameValue(preset.name);
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingPresetId || !renameValue.trim()) {
      setRenamingPresetId(null);
      return;
    }

    const newName = renameValue.trim();

    // Update in database if user is logged in
    if (user) {
      const { error } = await supabase
        .from('presets')
        .update({ name: newName })
        .eq('id', renamingPresetId)
        .eq('user_id', user.id);

      if (error) {
        console.error('Error renaming preset:', error);
      }
    }

    // Update local state
    setPresets(prev =>
      prev.map(p => (p.id === renamingPresetId ? { ...p, name: newName } : p))
    );

    setRenamingPresetId(null);
    setRenameValue('');
  }, [renamingPresetId, renameValue, user]);

  const handleRenameCancel = useCallback(() => {
    setRenamingPresetId(null);
    setRenameValue('');
  }, []);

  return (
    <>
      {/* Curves Editor Popup */}
      {activePanel === 'curves' && isImage && (
        <CurvesEditor
          curves={img.curves || DEFAULT_CURVES}
          onChange={handleCurvesChange}
          onClose={() => setActivePanel(null)}
        />
      )}

      {/* Light Panel Popup */}
      {activePanel === 'light' && isImage && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 p-4 w-72">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white">Light</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onUpdate({ exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 })}
                  className="text-xs text-[#888] hover:text-white transition-colors cursor-pointer"
                >
                  Reset
                </button>
                <button
                  onClick={() => setActivePanel(null)}
                  className="p-1 text-[#888] hover:text-white transition-colors cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="space-y-3">
              <Slider label="Exposure" value={img.exposure} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => onUpdate({ exposure: v })} />
              <Slider label="Contrast" value={img.contrast} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => onUpdate({ contrast: v })} />
              <Slider label="Highlights" value={img.highlights} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => onUpdate({ highlights: v })} />
              <Slider label="Shadows" value={img.shadows} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => onUpdate({ shadows: v })} />
              <Slider label="Whites" value={img.whites} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => onUpdate({ whites: v })} />
              <Slider label="Blacks" value={img.blacks} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => onUpdate({ blacks: v })} />
            </div>
          </div>
        </div>
      )}

      {/* Color Panel Popup */}
      {activePanel === 'color' && isImage && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 p-4 w-80">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white">Color</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const defaultHSL: ColorHSL = {
                      red: { hue: 0, saturation: 0, luminance: 0 },
                      orange: { hue: 0, saturation: 0, luminance: 0 },
                      yellow: { hue: 0, saturation: 0, luminance: 0 },
                      green: { hue: 0, saturation: 0, luminance: 0 },
                      aqua: { hue: 0, saturation: 0, luminance: 0 },
                      blue: { hue: 0, saturation: 0, luminance: 0 },
                      purple: { hue: 0, saturation: 0, luminance: 0 },
                      magenta: { hue: 0, saturation: 0, luminance: 0 },
                    };
                    onUpdate({ temperature: 0, vibrance: 0, saturation: 0, colorHSL: defaultHSL });
                  }}
                  className="text-xs text-[#888] hover:text-white transition-colors cursor-pointer"
                >
                  Reset
                </button>
                <button
                  onClick={() => setActivePanel(null)}
                  className="p-1 text-[#888] hover:text-white transition-colors cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto space-y-3 pr-2">
              {/* Basic Color Adjustments */}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-[#888] w-20">Temp</span>
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-[10px] text-[#74c0fc]">Cool</span>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={img.temperature}
                    onChange={(e) => onUpdate({ temperature: parseFloat(e.target.value) })}
                    onDoubleClick={() => onUpdate({ temperature: 0 })}
                    className="flex-1 h-1 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer"
                    style={{ background: 'linear-gradient(to right, #74c0fc, #ff9f43)' }}
                  />
                  <span className="text-[10px] text-[#ff9f43]">Warm</span>
                </div>
              </div>
              <Slider label="Vibrance" value={img.vibrance} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => onUpdate({ vibrance: v })} />
              <Slider label="Saturation" value={img.saturation} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => onUpdate({ saturation: v })} />

              {/* HSL Color Adjustments */}
              <div className="border-t border-[#2a2a2a] pt-3 mt-4">
                <button
                  onClick={() => setIsHSLExpanded(!isHSLExpanded)}
                  className="w-full flex items-center justify-between mb-3 text-xs font-medium text-white hover:text-[#3ECF8E] transition-colors cursor-pointer"
                >
                  <span>HSL / Color</span>
                  <svg
                    className={`w-4 h-4 transition-transform ${isHSLExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isHSLExpanded && (
                  <>
                    {/* Red */}
                    <div className="mb-4">
                  <div className="text-[11px] font-medium text-[#ff6b6b] mb-2">Red</div>
                  <Slider
                    label="Hue"
                    value={img.colorHSL?.red?.hue ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, red: { ...img.colorHSL?.red, hue: v, saturation: img.colorHSL?.red?.saturation ?? 0, luminance: img.colorHSL?.red?.luminance ?? 0 } } as ColorHSL })}
                  />
                  <Slider
                    label="Saturation"
                    value={img.colorHSL?.red?.saturation ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, red: { ...img.colorHSL?.red, saturation: v, hue: img.colorHSL?.red?.hue ?? 0, luminance: img.colorHSL?.red?.luminance ?? 0 } } as ColorHSL })}
                  />
                  <Slider
                    label="Luminance"
                    value={img.colorHSL?.red?.luminance ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, red: { ...img.colorHSL?.red, luminance: v, hue: img.colorHSL?.red?.hue ?? 0, saturation: img.colorHSL?.red?.saturation ?? 0 } } as ColorHSL })}
                  />
                </div>

                {/* Orange */}
                <div className="mb-4">
                  <div className="text-[11px] font-medium text-[#ff9f43] mb-2">Orange</div>
                  <Slider
                    label="Hue"
                    value={img.colorHSL?.orange?.hue ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, orange: { ...img.colorHSL?.orange, hue: v, saturation: img.colorHSL?.orange?.saturation ?? 0, luminance: img.colorHSL?.orange?.luminance ?? 0 } } as ColorHSL })}
                  />
                  <Slider
                    label="Saturation"
                    value={img.colorHSL?.orange?.saturation ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, orange: { ...img.colorHSL?.orange, saturation: v, hue: img.colorHSL?.orange?.hue ?? 0, luminance: img.colorHSL?.orange?.luminance ?? 0 } } as ColorHSL })}
                  />
                  <Slider
                    label="Luminance"
                    value={img.colorHSL?.orange?.luminance ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, orange: { ...img.colorHSL?.orange, luminance: v, hue: img.colorHSL?.orange?.hue ?? 0, saturation: img.colorHSL?.orange?.saturation ?? 0 } } as ColorHSL })}
                  />
                </div>

                {/* Yellow */}
                <div className="mb-4">
                  <div className="text-[11px] font-medium text-[#ffd93d] mb-2">Yellow</div>
                  <Slider
                    label="Hue"
                    value={img.colorHSL?.yellow?.hue ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, yellow: { ...img.colorHSL?.yellow, hue: v, saturation: img.colorHSL?.yellow?.saturation ?? 0, luminance: img.colorHSL?.yellow?.luminance ?? 0 } } as ColorHSL })}
                  />
                  <Slider
                    label="Saturation"
                    value={img.colorHSL?.yellow?.saturation ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, yellow: { ...img.colorHSL?.yellow, saturation: v, hue: img.colorHSL?.yellow?.hue ?? 0, luminance: img.colorHSL?.yellow?.luminance ?? 0 } } as ColorHSL })}
                  />
                  <Slider
                    label="Luminance"
                    value={img.colorHSL?.yellow?.luminance ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, yellow: { ...img.colorHSL?.yellow, luminance: v, hue: img.colorHSL?.yellow?.hue ?? 0, saturation: img.colorHSL?.yellow?.saturation ?? 0 } } as ColorHSL })}
                  />
                </div>

                {/* Green */}
                <div className="mb-4">
                  <div className="text-[11px] font-medium text-[#6bcf7f] mb-2">Green</div>
                  <Slider
                    label="Hue"
                    value={img.colorHSL?.green?.hue ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, green: { ...img.colorHSL?.green, hue: v, saturation: img.colorHSL?.green?.saturation ?? 0, luminance: img.colorHSL?.green?.luminance ?? 0 } } as ColorHSL })}
                  />
                  <Slider
                    label="Saturation"
                    value={img.colorHSL?.green?.saturation ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, green: { ...img.colorHSL?.green, saturation: v, hue: img.colorHSL?.green?.hue ?? 0, luminance: img.colorHSL?.green?.luminance ?? 0 } } as ColorHSL })}
                  />
                  <Slider
                    label="Luminance"
                    value={img.colorHSL?.green?.luminance ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, green: { ...img.colorHSL?.green, luminance: v, hue: img.colorHSL?.green?.hue ?? 0, saturation: img.colorHSL?.green?.saturation ?? 0 } } as ColorHSL })}
                  />
                </div>

                {/* Aqua */}
                <div className="mb-4">
                  <div className="text-[11px] font-medium text-[#4ecdc4] mb-2">Aqua</div>
                  <Slider
                    label="Hue"
                    value={img.colorHSL?.aqua?.hue ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, aqua: { ...img.colorHSL?.aqua, hue: v, saturation: img.colorHSL?.aqua?.saturation ?? 0, luminance: img.colorHSL?.aqua?.luminance ?? 0 } } as ColorHSL })}
                  />
                  <Slider
                    label="Saturation"
                    value={img.colorHSL?.aqua?.saturation ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, aqua: { ...img.colorHSL?.aqua, saturation: v, hue: img.colorHSL?.aqua?.hue ?? 0, luminance: img.colorHSL?.aqua?.luminance ?? 0 } } as ColorHSL })}
                  />
                  <Slider
                    label="Luminance"
                    value={img.colorHSL?.aqua?.luminance ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, aqua: { ...img.colorHSL?.aqua, luminance: v, hue: img.colorHSL?.aqua?.hue ?? 0, saturation: img.colorHSL?.aqua?.saturation ?? 0 } } as ColorHSL })}
                  />
                </div>

                {/* Blue */}
                <div className="mb-4">
                  <div className="text-[11px] font-medium text-[#4d96ff] mb-2">Blue</div>
                  <Slider
                    label="Hue"
                    value={img.colorHSL?.blue?.hue ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, blue: { ...img.colorHSL?.blue, hue: v, saturation: img.colorHSL?.blue?.saturation ?? 0, luminance: img.colorHSL?.blue?.luminance ?? 0 } } as ColorHSL })}
                  />
                  <Slider
                    label="Saturation"
                    value={img.colorHSL?.blue?.saturation ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, blue: { ...img.colorHSL?.blue, saturation: v, hue: img.colorHSL?.blue?.hue ?? 0, luminance: img.colorHSL?.blue?.luminance ?? 0 } } as ColorHSL })}
                  />
                  <Slider
                    label="Luminance"
                    value={img.colorHSL?.blue?.luminance ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, blue: { ...img.colorHSL?.blue, luminance: v, hue: img.colorHSL?.blue?.hue ?? 0, saturation: img.colorHSL?.blue?.saturation ?? 0 } } as ColorHSL })}
                  />
                </div>

                {/* Purple */}
                <div className="mb-4">
                  <div className="text-[11px] font-medium text-[#a78bfa] mb-2">Purple</div>
                  <Slider
                    label="Hue"
                    value={img.colorHSL?.purple?.hue ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, purple: { ...img.colorHSL?.purple, hue: v, saturation: img.colorHSL?.purple?.saturation ?? 0, luminance: img.colorHSL?.purple?.luminance ?? 0 } } as ColorHSL })}
                  />
                  <Slider
                    label="Saturation"
                    value={img.colorHSL?.purple?.saturation ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, purple: { ...img.colorHSL?.purple, saturation: v, hue: img.colorHSL?.purple?.hue ?? 0, luminance: img.colorHSL?.purple?.luminance ?? 0 } } as ColorHSL })}
                  />
                  <Slider
                    label="Luminance"
                    value={img.colorHSL?.purple?.luminance ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, purple: { ...img.colorHSL?.purple, luminance: v, hue: img.colorHSL?.purple?.hue ?? 0, saturation: img.colorHSL?.purple?.saturation ?? 0 } } as ColorHSL })}
                  />
                </div>

                {/* Magenta */}
                <div className="mb-4">
                  <div className="text-[11px] font-medium text-[#f472b6] mb-2">Magenta</div>
                  <Slider
                    label="Hue"
                    value={img.colorHSL?.magenta?.hue ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, magenta: { ...img.colorHSL?.magenta, hue: v, saturation: img.colorHSL?.magenta?.saturation ?? 0, luminance: img.colorHSL?.magenta?.luminance ?? 0 } } as ColorHSL })}
                  />
                  <Slider
                    label="Saturation"
                    value={img.colorHSL?.magenta?.saturation ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, magenta: { ...img.colorHSL?.magenta, saturation: v, hue: img.colorHSL?.magenta?.hue ?? 0, luminance: img.colorHSL?.magenta?.luminance ?? 0 } } as ColorHSL })}
                  />
                  <Slider
                    label="Luminance"
                    value={img.colorHSL?.magenta?.luminance ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    onChange={(v) => onUpdate({ colorHSL: { ...img.colorHSL, magenta: { ...img.colorHSL?.magenta, luminance: v, hue: img.colorHSL?.magenta?.hue ?? 0, saturation: img.colorHSL?.magenta?.saturation ?? 0 } } as ColorHSL })}
                  />
                </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Effects Panel Popup */}
      {activePanel === 'effects' && isImage && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 p-4 w-72">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white">Effects</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onUpdate({ clarity: 0, dehaze: 0, vignette: 0, grain: 0 })}
                  className="text-xs text-[#888] hover:text-white transition-colors cursor-pointer"
                >
                  Reset
                </button>
                <button
                  onClick={() => setActivePanel(null)}
                  className="p-1 text-[#888] hover:text-white transition-colors cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="space-y-3">
              <Slider label="Clarity" value={img.clarity} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => onUpdate({ clarity: v })} />
              <Slider label="Dehaze" value={img.dehaze} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => onUpdate({ dehaze: v })} />
              <Slider label="Vignette" value={img.vignette} min={0} max={1} step={0.01} defaultValue={0} onChange={(v) => onUpdate({ vignette: v })} />
              <Slider label="Grain" value={img.grain} min={0} max={1} step={0.01} defaultValue={0} onChange={(v) => onUpdate({ grain: v })} />
            </div>
          </div>
        </div>
      )}

      {/* Presets Panel Popup */}
      {activePanel === 'presets' && isImage && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 p-4 w-80">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white">Presets</h3>
              <button
                onClick={() => setActivePanel(null)}
                className="p-1 text-[#888] hover:text-white transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xmp"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />

            {/* Drag and drop area */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`mb-4 border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                isDraggingOver
                  ? 'border-[#3ECF8E] bg-[#3ECF8E]/10'
                  : 'border-[#333] bg-[#252525] hover:border-[#3ECF8E]/50'
              }`}
            >
              <svg className="w-10 h-10 mx-auto mb-2 text-[#666]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm text-[#888] mb-1">Drop .xmp files here</p>
              <p className="text-xs text-[#666]">or click to browse</p>
            </div>

            {/* Presets list */}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {presets.length === 0 ? (
                <p className="text-xs text-[#666] text-center py-4">No presets yet</p>
              ) : (
                presets
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((preset) => (
                    <div
                      key={preset.id}
                      className="flex items-center justify-between gap-2 p-3 bg-[#252525] hover:bg-[#333] rounded-lg transition-colors group"
                    >
                      {renamingPresetId === preset.id ? (
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleRenameSubmit();
                            } else if (e.key === 'Escape') {
                              handleRenameCancel();
                            }
                          }}
                          onBlur={handleRenameSubmit}
                          autoFocus
                          className="flex-1 px-2 py-1 text-sm text-white bg-[#1a1a1a] border border-[#3ECF8E] rounded focus:outline-none"
                        />
                      ) : (
                        <button
                          onClick={() => applyPreset(preset)}
                          onDoubleClick={() => handlePresetDoubleClick(preset)}
                          className="flex-1 text-left text-sm text-white cursor-pointer"
                        >
                          {preset.name}
                        </button>
                      )}
                      <button
                        onClick={() => deletePreset(preset.id)}
                        className="p-1 text-[#888] hover:text-[#f87171] transition-colors opacity-0 group-hover:opacity-100 cursor-pointer flex-shrink-0"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Toolbar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
        <div className="bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 backdrop-blur-xl">
          <div className="px-4 py-3">
            <div className="flex items-center gap-2">
              {isImage ? (
                <>
                  {/* Curves */}
                  <button
                    onClick={() => togglePanel('curves')}
                    className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all duration-150 cursor-pointer ${
                      activePanel === 'curves' || isCurvesModified
                        ? 'bg-[#3ECF8E]/20 text-[#3ECF8E]'
                        : 'bg-[#252525] text-[#999] hover:bg-[#333] hover:text-white'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 20 C 8 20, 8 4, 12 4 C 16 4, 16 20, 20 20" />
                    </svg>
                    <span className="text-[10px] font-medium uppercase tracking-wider">Curves</span>
                  </button>

                  {/* Light */}
                  <button
                    onClick={() => togglePanel('light')}
                    className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all duration-150 cursor-pointer ${
                      activePanel === 'light' || isLightModified
                        ? 'bg-[#3ECF8E]/20 text-[#3ECF8E]'
                        : 'bg-[#252525] text-[#999] hover:bg-[#333] hover:text-white'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    <span className="text-[10px] font-medium uppercase tracking-wider">Light</span>
                  </button>

                  {/* Color */}
                  <button
                    onClick={() => togglePanel('color')}
                    className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all duration-150 cursor-pointer ${
                      activePanel === 'color' || isColorModified
                        ? 'bg-[#3ECF8E]/20 text-[#3ECF8E]'
                        : 'bg-[#252525] text-[#999] hover:bg-[#333] hover:text-white'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                    </svg>
                    <span className="text-[10px] font-medium uppercase tracking-wider">Color</span>
                  </button>

                  {/* Effects */}
                  <button
                    onClick={() => togglePanel('effects')}
                    className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all duration-150 cursor-pointer ${
                      activePanel === 'effects' || isEffectsModified
                        ? 'bg-[#3ECF8E]/20 text-[#3ECF8E]'
                        : 'bg-[#252525] text-[#999] hover:bg-[#333] hover:text-white'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                    <span className="text-[10px] font-medium uppercase tracking-wider">Effects</span>
                  </button>

                  {/* Presets */}
                  <button
                    onClick={() => togglePanel('presets')}
                    className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all duration-150 cursor-pointer ${
                      activePanel === 'presets'
                        ? 'bg-[#3ECF8E]/20 text-[#3ECF8E]'
                        : 'bg-[#252525] text-[#999] hover:bg-[#333] hover:text-white'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <span className="text-[10px] font-medium uppercase tracking-wider">Presets</span>
                  </button>

                  {/* Divider */}
                  <div className="w-px h-10 bg-[#333] mx-1" />

                  {/* Reset to Original */}
                  {onResetToOriginal && (
                    <button
                      onClick={onResetToOriginal}
                      className="p-2 rounded-lg bg-[#252525] text-[#999] hover:bg-[#333] hover:text-white transition-colors cursor-pointer"
                      title="Reset to Original"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  )}

                  {/* Save */}
                  {onSave && (
                    <button
                      onClick={onSave}
                      className="p-2 rounded-lg bg-[#3ECF8E]/20 text-[#3ECF8E] hover:bg-[#3ECF8E]/30 transition-colors cursor-pointer"
                      title="Save Edits"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                  )}

                  {/* Delete */}
                  <button
                    onClick={onDelete}
                    className="p-2 rounded-lg bg-[#252525] text-[#f87171] hover:bg-[#3a2020] transition-colors cursor-pointer"
                    title="Delete"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </>
              ) : (
                <>
                  {/* Text Content */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-medium text-[#888] uppercase tracking-wider">Text</label>
                    <input
                      type="text"
                      value={(object as CanvasText).text}
                      onChange={(e) => onUpdate({ text: e.target.value })}
                      className="w-40 px-3 py-1.5 text-sm text-white bg-[#252525] border border-[#333] rounded-lg focus:border-[#3ECF8E] focus:outline-none transition-colors"
                    />
                  </div>

                  {/* Font Size */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-medium text-[#888] uppercase tracking-wider">Size</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="12"
                        max="72"
                        step="1"
                        value={(object as CanvasText).fontSize}
                        onChange={(e) => onUpdate({ fontSize: parseInt(e.target.value) })}
                        onDoubleClick={() => onUpdate({ fontSize: 24 })}
                        className="w-16 h-1 bg-[#333] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#3ECF8E]"
                      />
                      <span className="text-xs text-[#666] w-6 tabular-nums">{(object as CanvasText).fontSize}</span>
                    </div>
                  </div>

                  {/* Color */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-medium text-[#888] uppercase tracking-wider">Color</label>
                    <input
                      type="color"
                      value={(object as CanvasText).fill}
                      onChange={(e) => onUpdate({ fill: e.target.value })}
                      className="w-8 h-8 rounded-lg cursor-pointer border-2 border-[#333] hover:border-[#3ECF8E] transition-colors"
                    />
                  </div>

                  {/* Divider */}
                  <div className="w-px h-10 bg-[#333] mx-1" />

                  {/* Delete */}
                  <button
                    onClick={onDelete}
                    className="p-2 rounded-lg bg-[#252525] text-[#f87171] hover:bg-[#3a2020] transition-colors cursor-pointer"
                    title="Delete"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
