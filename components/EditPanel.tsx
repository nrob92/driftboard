'use client';

import { useCallback, useState } from 'react';
import { CurvesEditor } from './CurvesEditor';

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
  // Color
  temperature: number;
  vibrance: number;
  saturation: number;
  // Effects
  clarity: number;
  dehaze: number;
  vignette: number;
  grain: number;
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

type ActivePanel = 'curves' | 'light' | 'color' | 'effects' | null;

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
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 p-4 w-72">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white">Color</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onUpdate({ temperature: 0, vibrance: 0, saturation: 0 })}
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
