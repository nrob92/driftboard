'use client';

import React, { useCallback, useRef, useState, useEffect } from 'react';

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

interface CurvesEditorProps {
  curves: ChannelCurves;
  onChange: (curves: ChannelCurves) => void;
  onClose: () => void;
}

type Channel = 'rgb' | 'red' | 'green' | 'blue';

const channelColors: Record<Channel, string> = {
  rgb: '#ffffff',
  red: '#ff6b6b',
  green: '#51cf66',
  blue: '#74c0fc',
};

const channelBgColors: Record<Channel, string> = {
  rgb: '#333',
  red: '#4a2020',
  green: '#1a3a1a',
  blue: '#1a2a4a',
};

export function CurvesEditor({ curves, onChange, onClose }: CurvesEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeChannel, setActiveChannel] = useState<Channel>('rgb');
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [localCurves, setLocalCurves] = useState<ChannelCurves>(curves);

  const currentPoints = localCurves[activeChannel];
  const curveColor = channelColors[activeChannel];

  // Interpolate curve using monotone cubic spline
  const interpolateCurve = useCallback((pts: CurvePoint[], x: number): number => {
    if (pts.length === 0) return x;
    if (pts.length === 1) return pts[0].y;

    const sorted = [...pts].sort((a, b) => a.x - b.x);

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

    return Math.max(0, Math.min(255, y));
  }, []);

  // Draw the curve
  const drawCurve = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear with channel-specific background
    ctx.fillStyle = channelBgColors[activeChannel];
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = activeChannel === 'rgb' ? '#3a3a3a' : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const pos = (i / 4) * width;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(width, pos);
      ctx.stroke();
    }

    // Diagonal reference line
    ctx.strokeStyle = activeChannel === 'rgb' ? '#444' : 'rgba(255,255,255,0.15)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(width, 0);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw curve
    ctx.strokeStyle = curveColor;
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let x = 0; x <= 255; x++) {
      const y = interpolateCurve(currentPoints, x);
      const canvasX = (x / 255) * width;
      const canvasY = height - (y / 255) * height;

      if (x === 0) {
        ctx.moveTo(canvasX, canvasY);
      } else {
        ctx.lineTo(canvasX, canvasY);
      }
    }
    ctx.stroke();

    // Draw points
    currentPoints.forEach((point, index) => {
      const canvasX = (point.x / 255) * width;
      const canvasY = height - (point.y / 255) * height;

      // Outer ring
      ctx.beginPath();
      ctx.arc(canvasX, canvasY, 7, 0, Math.PI * 2);
      ctx.fillStyle = draggingIndex === index ? curveColor : '#1a1a1a';
      ctx.fill();
      ctx.strokeStyle = curveColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner dot
      ctx.beginPath();
      ctx.arc(canvasX, canvasY, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = curveColor;
      ctx.fill();
    });
  }, [currentPoints, activeChannel, curveColor, draggingIndex, interpolateCurve]);

  useEffect(() => {
    drawCurve();
  }, [drawCurve]);

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 255;
    const y = 255 - ((e.clientY - rect.top) / rect.height) * 255;

    return {
      x: Math.max(0, Math.min(255, x)),
      y: Math.max(0, Math.min(255, y)),
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);

    const pointIndex = currentPoints.findIndex((p) => {
      const dx = p.x - x;
      const dy = p.y - y;
      return Math.sqrt(dx * dx + dy * dy) < 15;
    });

    if (pointIndex !== -1) {
      setDraggingIndex(pointIndex);
    } else {
      const newPoints = [...currentPoints, { x, y }].sort((a, b) => a.x - b.x);
      setLocalCurves(prev => ({ ...prev, [activeChannel]: newPoints }));
      setDraggingIndex(newPoints.findIndex((p) => p.x === x && p.y === y));
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggingIndex === null) return;

    const { x, y } = getCanvasCoords(e);
    const isEndpoint = draggingIndex === 0 || draggingIndex === currentPoints.length - 1;

    setLocalCurves(prev => {
      const newPoints = [...prev[activeChannel]];
      if (isEndpoint) {
        newPoints[draggingIndex] = { ...newPoints[draggingIndex], y };
      } else {
        newPoints[draggingIndex] = { x, y };
      }
      return { ...prev, [activeChannel]: newPoints.sort((a, b) => a.x - b.x) };
    });
  };

  const handleMouseUp = () => {
    if (draggingIndex !== null) {
      onChange(localCurves);
    }
    setDraggingIndex(null);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);

    const pointIndex = currentPoints.findIndex((p, i) => {
      if (i === 0 || i === currentPoints.length - 1) return false;
      const dx = p.x - x;
      const dy = p.y - y;
      return Math.sqrt(dx * dx + dy * dy) < 15;
    });

    if (pointIndex !== -1) {
      const newPoints = currentPoints.filter((_, i) => i !== pointIndex);
      setLocalCurves(prev => ({ ...prev, [activeChannel]: newPoints }));
      onChange({ ...localCurves, [activeChannel]: newPoints });
    }
  };

  const handleReset = () => {
    const defaultPoints = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
    const newCurves = { ...localCurves, [activeChannel]: defaultPoints };
    setLocalCurves(newCurves);
    onChange(newCurves);
  };

  const handleResetAll = () => {
    const defaultPoints = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
    const newCurves = {
      rgb: defaultPoints,
      red: [...defaultPoints],
      green: [...defaultPoints],
      blue: [...defaultPoints],
    };
    setLocalCurves(newCurves);
    onChange(newCurves);
  };

  return (
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
      <div className="bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-white">Curves</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="text-xs text-[#888] hover:text-white transition-colors cursor-pointer"
            >
              Reset
            </button>
            <button
              onClick={handleResetAll}
              className="text-xs text-[#888] hover:text-white transition-colors cursor-pointer"
            >
              Reset All
            </button>
            <button
              onClick={onClose}
              className="p-1 text-[#888] hover:text-white transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Channel Tabs */}
        <div className="flex gap-1 mb-3">
          {(['rgb', 'red', 'green', 'blue'] as Channel[]).map((channel) => (
            <button
              key={channel}
              onClick={() => setActiveChannel(channel)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                activeChannel === channel
                  ? channel === 'rgb'
                    ? 'bg-white/20 text-white'
                    : channel === 'red'
                    ? 'bg-red-500/30 text-red-400'
                    : channel === 'green'
                    ? 'bg-green-500/30 text-green-400'
                    : 'bg-blue-500/30 text-blue-400'
                  : 'bg-[#252525] text-[#666] hover:text-[#999]'
              }`}
            >
              {channel.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Canvas */}
        <canvas
          ref={canvasRef}
          width={220}
          height={220}

          className="rounded-lg cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
        />

        {/* Footer labels */}
        <div className="flex justify-between mt-2 text-[10px] text-[#555]">
          <span>Shadows</span>
          <span>Midtones</span>
          <span>Highlights</span>
        </div>
      </div>
    </div>
  );
}
