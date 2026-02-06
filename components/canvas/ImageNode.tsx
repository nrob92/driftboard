'use client';

import React, { useRef, useEffect, useMemo, useDeferredValue } from 'react';
import { Image as KonvaImage, Group, Rect } from 'react-konva';
import useImage from 'use-image';
import Konva from 'konva';
import type { CurvePoint, CanvasImage } from '@/lib/types';
import {
  createBrightnessFilter, createExposureFilter, createTonalFilter,
  createTemperatureFilter, createVibranceFilter, createClarityFilter,
  createDehazeFilter, createVignetteFilter, createGrainFilter,
  createCurvesFilter, createHSLColorFilter, createSplitToningFilter,
  createShadowTintFilter, createColorGradingFilter, createColorCalibrationFilter,
} from '@/lib/filters/clientFilters';

export interface ImageNodeProps {
  image: CanvasImage;
  onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDblClick?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onContextMenu?: (e: Konva.KonvaEventObject<PointerEvent>, imageId: string) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onUpdate: (updates: Partial<CanvasImage>) => void;
  bypassedTabs?: Set<'curves' | 'light' | 'color' | 'effects'>;
  useLowResPreview?: boolean;
  isSelected?: boolean;
  isPreviewingQuality?: boolean;
}

// Image node component - memoized to prevent unnecessary re-renders
// Uses fast Konva filters with pre-computed LUTs for real-time editing
export const ImageNode = React.memo(function ImageNode({
  image,
  onClick,
  onDblClick,
  onContextMenu,
  onDragEnd,
  onDragMove,
  onUpdate,
  bypassedTabs,
  useLowResPreview,
  isSelected,
  isPreviewingQuality,
}: ImageNodeProps) {
  const [img, imgStatus] = useImage(image.src, 'anonymous');
  const imageRef = useRef<Konva.Image>(null);
  const groupRef = useRef<Konva.Group>(null);
  const prevPosRef = useRef({ x: image.x, y: image.y });
  const isDraggingRef = useRef(false);
  const cacheTimeoutRef = useRef<number | undefined>(undefined);
  const wasLowResRef = useRef(false);
  const idleCallbackRef = useRef<number | undefined>(undefined);
  const pendingFullQualityRef = useRef<{
    pixelRatio: number;
    filterList: ((imageData: ImageData) => void)[];
    contrast: number;
    saturation: number;
    hue: number;
    blurRadius: number;
  } | null>(null);
  const lastFilterApplyRef = useRef<number>(0);
  const applyParamsRef = useRef<{
    cacheOpts: { pixelRatio: number; width?: number; height?: number };
    filterList: ((imageData: ImageData) => void)[];
    contrastVal: number;
    saturationVal: number;
    hueVal: number;
    blurRadiusVal: number;
    useLowResPreview: boolean;
    justReleased: boolean;
    fullPixelRatio: number;
    isLargeImage: boolean;
    sourceMaxDim: number;
    displayW: number;
    displayH: number;
    sourceScale: number;
    isPreviewingQuality: boolean;
  } | null>(null);
  // Throttle filter application during drag for smooth performance
  // Prioritize CPU headroom over preview smoothness
  const APPLY_THROTTLE_MS = 100; // 10 FPS target - maximum CPU headroom for smooth editing

  // Debounce filter updates after bulk changes (e.g., preset application)
  // Prevents "thundering herd" when many filters change simultaneously
  const bulkUpdateDebounceRef = useRef<number | undefined>(undefined);

  // Defer image during slider drag so we run the expensive filter effect less often (React 18)
  const deferredImage = useDeferredValue(image);
  const imageForEffect = useLowResPreview ? deferredImage : image;

  // Create a stable filter signature to reduce useEffect dependencies
  // This prevents the filter effect from running when unrelated props change
  const filterSignature = useMemo(() => {
    const img = imageForEffect;
    return JSON.stringify({
      // Light
      exp: img.exposure, con: img.contrast, hi: img.highlights, sh: img.shadows,
      wh: img.whites, bl: img.blacks, br: img.brightness, cl: img.clarity,
      // Color
      temp: img.temperature, vib: img.vibrance, sat: img.saturation, hue: img.hue,
      // Effects
      dh: img.dehaze, vig: img.vignette, gr: img.grain, blur: img.blur,
      // Complex
      curv: img.curves, hsl: img.colorHSL, st: img.splitToning,
      cg: img.colorGrading, cc: img.colorCalibration, stint: img.shadowTint,
      filt: img.filters,
      // Display
      w: img.width, h: img.height, sx: img.scaleX, sy: img.scaleY,
      // Bypass
      bypass: Array.from(bypassedTabs || []).sort().join(','),
      lowRes: useLowResPreview
    });
  }, [imageForEffect, bypassedTabs, useLowResPreview]);

  // Sync position when x/y change from state (e.g. after drop) – no animation, drop into place
  useEffect(() => {
    const group = groupRef.current;
    if (!group || isDraggingRef.current) return;

    const newX = image.x;
    const newY = image.y;
    const prevX = prevPosRef.current.x;
    const prevY = prevPosRef.current.y;

    if (Math.abs(newX - prevX) > 0.5 || Math.abs(newY - prevY) > 0.5) {
      group.position({ x: newX, y: newY });
      prevPosRef.current = { x: newX, y: newY };
    }
  }, [image.x, image.y]);

  // Check if curves are modified (uses latest image for hasActiveFilters early exit)
  const isCurvesModified = useMemo(() => {
    if (!image.curves) return false;
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
      isChannelModified(image.curves.rgb) ||
      isChannelModified(image.curves.red) ||
      isChannelModified(image.curves.green) ||
      isChannelModified(image.curves.blue)
    );
  }, [image.curves]);

  // Same for deferred image so filter list stays consistent with imageForEffect
  const isCurvesModifiedForEffect = useMemo(() => {
    if (!imageForEffect.curves) return false;
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
      isChannelModified(imageForEffect.curves.rgb) ||
      isChannelModified(imageForEffect.curves.red) ||
      isChannelModified(imageForEffect.curves.green) ||
      isChannelModified(imageForEffect.curves.blue)
    );
  }, [imageForEffect.curves]);

  // Check if any filters are active (memoized for performance)
  const hasActiveFilters = useMemo(() =>
    image.exposure !== 0 || image.contrast !== 0 || image.highlights !== 0 ||
    image.shadows !== 0 || image.whites !== 0 || image.blacks !== 0 ||
    image.temperature !== 0 || image.vibrance !== 0 || image.saturation !== 0 ||
    image.clarity !== 0 || image.dehaze !== 0 || image.vignette !== 0 ||
    image.grain !== 0 || image.brightness !== 0 || image.hue !== 0 ||
    image.blur > 0 || image.filters.length > 0 || isCurvesModified ||
    image.colorHSL !== undefined || image.splitToning !== undefined ||
    image.colorGrading !== undefined || image.colorCalibration !== undefined ||
    (image.shadowTint !== undefined && image.shadowTint !== 0)
  , [image, isCurvesModified]);

  // PERFORMANCE: Create all filters in ONE useMemo to avoid thundering herd during preset application
  // Instead of 15 separate useMemos that all fire when preset is applied, batch them together
  const filterPack = useMemo(() => {
    const pack = {
      curves: (!useLowResPreview && isCurvesModifiedForEffect && imageForEffect.curves)
        ? createCurvesFilter(imageForEffect.curves) : null,
      exposure: imageForEffect.exposure !== 0 ? createExposureFilter(imageForEffect.exposure) : null,
      tonal: (imageForEffect.highlights !== 0 || imageForEffect.shadows !== 0 || imageForEffect.whites !== 0 || imageForEffect.blacks !== 0)
        ? createTonalFilter(imageForEffect.highlights, imageForEffect.shadows, imageForEffect.whites, imageForEffect.blacks) : null,
      clarity: (!useLowResPreview && imageForEffect.clarity !== 0) ? createClarityFilter(imageForEffect.clarity) : null,
      brightness: imageForEffect.brightness !== 0 ? createBrightnessFilter(imageForEffect.brightness) : null,
      temperature: imageForEffect.temperature !== 0 ? createTemperatureFilter(imageForEffect.temperature) : null,
      vibrance: imageForEffect.vibrance !== 0 ? createVibranceFilter(imageForEffect.vibrance) : null,
      hslColor: null as ((imageData: ImageData) => void) | null,
      splitToning: (!useLowResPreview && imageForEffect.splitToning) ? createSplitToningFilter(imageForEffect.splitToning) : null,
      shadowTint: (!useLowResPreview && imageForEffect.shadowTint && imageForEffect.shadowTint !== 0)
        ? createShadowTintFilter(imageForEffect.shadowTint) : null,
      colorGrading: (!useLowResPreview && imageForEffect.colorGrading) ? createColorGradingFilter(imageForEffect.colorGrading) : null,
      colorCalibration: (!useLowResPreview && imageForEffect.colorCalibration) ? createColorCalibrationFilter(imageForEffect.colorCalibration) : null,
      dehaze: (!useLowResPreview && imageForEffect.dehaze !== 0) ? createDehazeFilter(imageForEffect.dehaze) : null,
      vignette: (!useLowResPreview && imageForEffect.vignette !== 0) ? createVignetteFilter(imageForEffect.vignette) : null,
      grain: (!useLowResPreview && imageForEffect.grain !== 0) ? createGrainFilter(imageForEffect.grain) : null,
    };

    // HSL color filter (special case - needs condition check)
    if (!useLowResPreview && imageForEffect.colorHSL) {
      const hasHSL = Object.values(imageForEffect.colorHSL).some(
        (adj) => adj && ((adj.hue ?? 0) !== 0 || (adj.saturation ?? 0) !== 0 || (adj.luminance ?? 0) !== 0)
      );
      pack.hslColor = hasHSL ? createHSLColorFilter(imageForEffect.colorHSL) : null;
    }

    return pack;
  }, [filterSignature]); // Single dependency on filter signature!

  // Destructure for easier access (these are now stable references)
  const { curves: curvesFilter, exposure: exposureFilter, tonal: tonalFilter,
    clarity: clarityFilter, brightness: brightnessFilter, temperature: temperatureFilter,
    vibrance: vibranceFilter, hslColor: hslColorFilter, splitToning: splitToningFilter,
    shadowTint: shadowTintFilter, colorGrading: colorGradingFilter,
    colorCalibration: colorCalibrationFilter, dehaze: dehazeFilter,
    vignette: vignetteFilter, grain: grainFilter } = filterPack;

  // Apply Konva filters
  useEffect(() => {
    if (!imageRef.current || !img) return;
    const node = imageRef.current;

    if (!hasActiveFilters) {
      if (cacheTimeoutRef.current) {
        cancelAnimationFrame(cacheTimeoutRef.current);
        cacheTimeoutRef.current = undefined;
      }
      node.clearCache();
      node.filters([]);
      node.getLayer()?.batchDraw();
      return;
    }

    // SMART OPTIMIZATION: Skip non-selected images ONLY during drag
    // - During drag: Only process selected image (smooth editing)
    // - After release: Process all images (edits stay visible)
    if (isSelected === false && useLowResPreview && hasActiveFilters) {
      // Skip processing non-selected images during active drag for maximum speed
      return;
    }

    // Build filter list using memoized filters (much faster!)
    const filterList: ((imageData: ImageData) => void)[] = [];
    const bypassCurves = bypassedTabs?.has('curves');
    const bypassLight = bypassedTabs?.has('light');
    const bypassColor = bypassedTabs?.has('color');
    const bypassEffects = bypassedTabs?.has('effects');

    // Use memoized filters - only recreated when their specific params change
    if (!bypassCurves && curvesFilter) filterList.push(curvesFilter);

    // Light adjustments
    if (!bypassLight) {
      if (exposureFilter) filterList.push(exposureFilter);
      if (tonalFilter) filterList.push(tonalFilter);
      if (clarityFilter) filterList.push(clarityFilter);
      if (brightnessFilter) filterList.push(brightnessFilter);
      if (imageForEffect.contrast !== 0) {
        filterList.push(Konva.Filters.Contrast as unknown as (imageData: ImageData) => void);
      }
    }

    // Color adjustments
    if (!bypassColor) {
      if (temperatureFilter) filterList.push(temperatureFilter);
      if (imageForEffect.saturation !== 0 || imageForEffect.hue !== 0) {
        filterList.push(Konva.Filters.HSV as unknown as (imageData: ImageData) => void);
      }
      if (vibranceFilter) filterList.push(vibranceFilter);
      // Heavy color filters (memoized)
      if (hslColorFilter) filterList.push(hslColorFilter);
      if (splitToningFilter) filterList.push(splitToningFilter);
      if (shadowTintFilter) filterList.push(shadowTintFilter);
      if (colorGradingFilter) filterList.push(colorGradingFilter);
      if (colorCalibrationFilter) filterList.push(colorCalibrationFilter);
    }

    // Effects (memoized)
    if (!bypassEffects) {
      if (dehazeFilter) filterList.push(dehazeFilter);
      if (vignetteFilter) filterList.push(vignetteFilter);
      if (grainFilter) filterList.push(grainFilter);
      if (imageForEffect.blur > 0) {
        filterList.push(Konva.Filters.Blur as unknown as (imageData: ImageData) => void);
      }
    }

    // Legacy filters (always apply)
    if (imageForEffect.filters.includes('grayscale')) {
      filterList.push(Konva.Filters.Grayscale as unknown as (imageData: ImageData) => void);
    }
    if (imageForEffect.filters.includes('sepia')) {
      filterList.push(Konva.Filters.Sepia as unknown as (imageData: ImageData) => void);
    }
    if (imageForEffect.filters.includes('invert')) {
      filterList.push(Konva.Filters.Invert as unknown as (imageData: ImageData) => void);
    }

    // Use full quality except during slider drag (low-res for responsive feedback)
    const displayW = imageForEffect.width || img.width;
    const displayH = imageForEffect.height || img.height;
    const scaleX = img.width / displayW;
    const scaleY = img.height / displayH;
    const sourceScale = Math.max(scaleX, scaleY, 1);
    const fullPixelRatio = Math.min(sourceScale * window.devicePixelRatio, 8);
    const justReleased = useLowResPreview === false && wasLowResRef.current;
    wasLowResRef.current = useLowResPreview === true;

    // NUCLEAR SPEED STRATEGY with QUALITY PREVIEW TOGGLE:
    // - Images 1500px max (Instagram-sized)
    // - pixelRatio 1 normally (blazing fast)
    // - pixelRatio 8-10 when holding preview button (MAXIMUM quality)
    // - Only process selected image during drag
    const sourceMaxDim = Math.max(img.width, img.height);
    const isLargeImage = sourceMaxDim > 1000;

    let cacheOpts: { pixelRatio: number };

    if (isPreviewingQuality) {
      // PREVIEW QUALITY MODE: User holding preview button - MAXIMUM quality
      // Use uncapped sourceScale for absolute best quality (processing at or above source resolution)
      const maxQualityRatio = Math.min(sourceScale * window.devicePixelRatio, 10);
      cacheOpts = { pixelRatio: maxQualityRatio };
    } else {
      // NORMAL MODE: pixelRatio 1 for maximum speed
      cacheOpts = { pixelRatio: 1 };
    }

    // Clear any pending cache update and any pending idle full-quality pass
    if (cacheTimeoutRef.current) {
      cancelAnimationFrame(cacheTimeoutRef.current);
    }
    if (idleCallbackRef.current !== undefined) {
      cancelIdleCallback(idleCallbackRef.current);
      idleCallbackRef.current = undefined;
    }

    const contrastVal = bypassLight ? 0 : imageForEffect.contrast * 25;
    const saturationVal = bypassColor ? 0 : imageForEffect.saturation * 2;
    const hueVal = bypassColor ? 0 : imageForEffect.hue * 180;
    const blurRadiusVal = bypassEffects ? 0 : imageForEffect.blur * 20;

    applyParamsRef.current = {
      cacheOpts,
      filterList,
      contrastVal,
      saturationVal,
      hueVal,
      blurRadiusVal,
      useLowResPreview: useLowResPreview === true,
      justReleased,
      fullPixelRatio,
      isLargeImage,
      sourceMaxDim,
      displayW,
      displayH,
      sourceScale,
      isPreviewingQuality: isPreviewingQuality === true,
    };

    const runApply = () => {
      const node = imageRef.current;
      const p = applyParamsRef.current;
      if (!node || !p) return;
      const now = Date.now();

      // Throttle during drag
      if (p.useLowResPreview && now - lastFilterApplyRef.current < APPLY_THROTTLE_MS) {
        cacheTimeoutRef.current = requestAnimationFrame(runApply);
        return;
      }
      if (p.useLowResPreview) lastFilterApplyRef.current = now;

      // Konva REQUIRES cache for filters to work!
      // But we can still optimize by using lower pixelRatio during drag
      node.clearCache();
      node.cache(p.cacheOpts); // MUST cache for filters to apply

      // Apply filters
      node.filters(p.filterList);
      node.contrast(p.contrastVal);
      node.saturation(p.saturationVal);
      node.hue(p.hueVal);
      node.blurRadius(p.blurRadiusVal);
      node.getLayer()?.batchDraw();

      // PROGRESSIVE QUALITY: After 150ms idle, upgrade to high quality
      // Skip if user is holding preview button (they're already seeing max quality)
      if (!p.useLowResPreview && !p.isPreviewingQuality) {
        // Wait 150ms of idle time before upgrading
        if (idleCallbackRef.current !== undefined) {
          cancelIdleCallback(idleCallbackRef.current);
        }
        idleCallbackRef.current = requestIdleCallback(() => {
          if (!imageRef.current) return;
          // Upgrade to high quality (pixelRatio 6)
          // Good balance between quality and performance for 1500px source
          imageRef.current.clearCache();
          imageRef.current.cache({ pixelRatio: 6 });
          imageRef.current.filters(p.filterList);
          imageRef.current.contrast(p.contrastVal);
          imageRef.current.saturation(p.saturationVal);
          imageRef.current.hue(p.hueVal);
          imageRef.current.blurRadius(p.blurRadiusVal);
          imageRef.current.getLayer()?.batchDraw();
          idleCallbackRef.current = undefined;
        }, { timeout: 150 });
      }
    };

    cacheTimeoutRef.current = requestAnimationFrame(runApply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    img, hasActiveFilters, filterSignature, filterPack, isSelected, isPreviewingQuality
    // filterPack contains all memoized filters - only recreates when filterSignature changes!
    // isSelected determines whether to skip filter processing for non-selected images
    // isPreviewingQuality triggers high-quality render when user holds preview button
  ]);

  // Cleanup RAF and idle callback on unmount
  useEffect(() => {
    return () => {
      if (cacheTimeoutRef.current) {
        cancelAnimationFrame(cacheTimeoutRef.current);
      }
      if (idleCallbackRef.current !== undefined) {
        cancelIdleCallback(idleCallbackRef.current);
      }
    };
  }, []);

  if (!img || imgStatus === 'loading') {
    return null;
  }

  const borderWidth = image.borderWidth ?? 0;
  const borderColor = image.borderColor ?? '#ffffff';
  const hasBorder = borderWidth > 0;

  return (
    <Group
      ref={groupRef}
      id={image.id}
      x={image.x}
      y={image.y}
      rotation={image.rotation}
      scaleX={image.scaleX}
      scaleY={image.scaleY}
      draggable
      onClick={onClick}
      onDblClick={(e) => {
        e.cancelBubble = true;
        onDblClick?.(e);
      }}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        onContextMenu?.(e as Konva.KonvaEventObject<PointerEvent>, image.id);
      }}
      onMouseEnter={(e) => {
        const container = e.target.getStage()?.container();
        if (container) container.style.cursor = 'pointer';
      }}
      onMouseLeave={(e) => {
        const container = e.target.getStage()?.container();
        if (container) container.style.cursor = 'default';
      }}
      onDragStart={(e) => {
        isDraggingRef.current = true;
        e.target.moveToTop();
      }}
      onDragEnd={(e) => {
        isDraggingRef.current = false;
        // Don't call onUpdate here - let handleObjectDragEnd calculate snapped position first
        // The snapped position will be set by handleObjectDragEnd which calls setImages
        onDragEnd(e);
        // Update prevPosRef after drag end handler has potentially snapped the position
        const group = e.target as Konva.Group;
        prevPosRef.current = { x: group.x(), y: group.y() };
      }}
      onDragMove={(e) => {
        const group = e.target as Konva.Group;
        const newX = group.x();
        const newY = group.y();
        prevPosRef.current = { x: newX, y: newY };
        onDragMove?.(e);
      }}
    >
      {hasBorder && (
        <Rect
          x={-borderWidth}
          y={-borderWidth}
          width={image.width + borderWidth * 2}
          height={image.height + borderWidth * 2}
          fill={borderColor}
          listening={false}
        />
      )}
      <KonvaImage
        ref={imageRef}
        id={image.id}
        image={img}
        x={0}
        y={0}
        width={image.width}
        height={image.height}
        perfectDrawEnabled={!useLowResPreview}
        onTransformEnd={() => {
          const node = imageRef.current;
          if (!node) return;
          const group = node.getParent();
          if (group) {
            onUpdate({
              scaleX: group.scaleX(),
              scaleY: group.scaleY(),
              rotation: group.rotation(),
            });
          }
        }}
      />
    </Group>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if relevant props changed
  // This prevents unnecessary re-renders when image object reference changes
  // but actual filter values haven't changed

  const prev = prevProps.image;
  const next = nextProps.image;

  // Position changes should always trigger re-render (handled by ref, but check anyway)
  if (prev.x !== next.x || prev.y !== next.y) return false;

  // Source or dimensions changed
  if (prev.src !== next.src || prev.width !== next.width || prev.height !== next.height ||
      prev.rotation !== next.rotation || prev.scaleX !== next.scaleX || prev.scaleY !== next.scaleY) {
    return false;
  }

  // Border changes
  if (prev.borderWidth !== next.borderWidth || prev.borderColor !== next.borderColor) return false;

  // Light adjustments
  if (prev.exposure !== next.exposure || prev.contrast !== next.contrast ||
      prev.highlights !== next.highlights || prev.shadows !== next.shadows ||
      prev.whites !== next.whites || prev.blacks !== next.blacks ||
      prev.brightness !== next.brightness || prev.clarity !== next.clarity) {
    return false;
  }

  // Color adjustments
  if (prev.temperature !== next.temperature || prev.vibrance !== next.vibrance ||
      prev.saturation !== next.saturation || prev.hue !== next.hue) {
    return false;
  }

  // Effects
  if (prev.dehaze !== next.dehaze || prev.vignette !== next.vignette ||
      prev.grain !== next.grain || prev.blur !== next.blur) {
    return false;
  }

  // Complex objects - check by reference (deep comparison too expensive)
  if (prev.curves !== next.curves || prev.colorHSL !== next.colorHSL ||
      prev.splitToning !== next.splitToning || prev.colorGrading !== next.colorGrading ||
      prev.colorCalibration !== next.colorCalibration || prev.shadowTint !== next.shadowTint) {
    return false;
  }

  // Filters array
  if (prev.filters.length !== next.filters.length || !prev.filters.every((f, i) => f === next.filters[i])) {
    return false;
  }

  // Bypass tabs
  if (prevProps.bypassedTabs !== nextProps.bypassedTabs) {
    const prevBypass = prevProps.bypassedTabs || new Set();
    const nextBypass = nextProps.bypassedTabs || new Set();
    if (prevBypass.size !== nextBypass.size) return false;
    for (const tab of prevBypass) {
      if (!nextBypass.has(tab)) return false;
    }
  }

  // Low res preview changed
  if (prevProps.useLowResPreview !== nextProps.useLowResPreview) return false;

  // Selection state changed (important for skipping filter processing on non-selected images)
  if (prevProps.isSelected !== nextProps.isSelected) return false;

  // Preview quality mode changed (user pressed/released preview button)
  if (prevProps.isPreviewingQuality !== nextProps.isPreviewingQuality) return false;

  // All checks passed - no need to re-render
  return true;
});
