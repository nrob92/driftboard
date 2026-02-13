/**
 * React hook that manages the GPU filter pipeline via PixiJS.
 * Returns a filtered canvas for Konva to display, or null to use the original image.
 *
 * Flow:
 * 1. Initializes PixiFilterEngine on mount (async, lazy)
 * 2. When filter params change, updates uniforms and renders via GPU
 * 3. Returns a cloned canvas at SOURCE resolution (not display size)
 * 4. Konva downscales it for display (preserving quality)
 * 5. Falls back to null (CPU pipeline) if GPU init fails
 */

"use client";

import { useRef, useEffect, useState, useMemo } from "react";
import Konva from "konva";
import type { CanvasImage } from "@/lib/types";
import {
  getPixiFilterEngine,
  PixiFilterEngine,
} from "@/lib/filters/pixiFilterEngine";

interface UsePixiFiltersOptions {
  image: CanvasImage;
  imgElement: HTMLImageElement | null;
  bypassedTabs: Set<string>;
  isSelected: boolean;
  konvaImageRef: React.RefObject<Konva.Image | null>;
}

interface UsePixiFiltersResult {
  /** The filtered canvas to pass to Konva's <Image> component, or null to use original */
  filteredCanvas: HTMLCanvasElement | null;
  /** Whether the GPU engine is ready */
  gpuReady: boolean;
  /** Whether any filters are active */
  hasActiveFilters: boolean;
}

export function usePixiFilters({
  image,
  imgElement,
  bypassedTabs,
  konvaImageRef,
}: UsePixiFiltersOptions): UsePixiFiltersResult {
  const engineRef = useRef<PixiFilterEngine | null>(null);
  const [gpuReady, setGpuReady] = useState(false);
  const [filteredCanvas, setFilteredCanvas] =
    useState<HTMLCanvasElement | null>(null);
  const renderIdRef = useRef(0); // Monotonic counter to discard stale renders

  // Refs so the render effect can read latest values without re-triggering on x/y changes
  const imageRef = useRef(image);
  imageRef.current = image;
  const bypassRef = useRef(bypassedTabs);
  bypassRef.current = bypassedTabs;
  const konvaRef = useRef(konvaImageRef);
  konvaRef.current = konvaImageRef;

  // Build a stable filter signature to detect when we need to re-render.
  // Uses INDIVIDUAL properties as deps (not the whole image object) so that
  // position-only changes (x/y during drag) don't trigger JSON.stringify.
  // With immer, unchanged properties keep the same reference.
  const filterSignature = useMemo(() => {
    return JSON.stringify({
      exp: image.exposure,
      con: image.contrast,
      hi: image.highlights,
      sh: image.shadows,
      wh: image.whites,
      bl: image.blacks,
      br: image.brightness,
      cl: image.clarity,
      temp: image.temperature,
      vib: image.vibrance,
      sat: image.saturation,
      hue: image.hue,
      dh: image.dehaze,
      vig: image.vignette,
      gr: image.grain,
      blur: image.blur,
      curv: image.curves,
      hsl: image.colorHSL,
      st: image.splitToning,
      cg: image.colorGrading,
      cc: image.colorCalibration,
      stint: image.shadowTint,
      filt: image.filters,
      w: image.width,
      h: image.height,
      bypass: Array.from(bypassedTabs).sort().join(","),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    image.exposure,
    image.contrast,
    image.highlights,
    image.shadows,
    image.whites,
    image.blacks,
    image.brightness,
    image.clarity,
    image.temperature,
    image.vibrance,
    image.saturation,
    image.hue,
    image.dehaze,
    image.vignette,
    image.grain,
    image.blur,
    image.curves,
    image.colorHSL,
    image.splitToning,
    image.colorGrading,
    image.colorCalibration,
    image.shadowTint,
    image.filters,
    image.width,
    image.height,
    bypassedTabs,
  ]);

  // Check if any filters are active — same individual-property deps pattern
  const hasActiveFilters = useMemo(() => {
    const engine = engineRef.current;
    if (engine) return engine.hasActiveFilters(image);
    return (
      image.exposure !== 0 ||
      image.contrast !== 0 ||
      image.highlights !== 0 ||
      image.shadows !== 0 ||
      image.whites !== 0 ||
      image.blacks !== 0 ||
      image.temperature !== 0 ||
      image.vibrance !== 0 ||
      image.saturation !== 0 ||
      image.clarity !== 0 ||
      image.dehaze !== 0 ||
      image.vignette !== 0 ||
      image.grain !== 0 ||
      image.brightness !== 0 ||
      image.hue !== 0 ||
      image.blur > 0 ||
      (image.filters?.length ?? 0) > 0 ||
      image.colorHSL !== undefined ||
      image.splitToning !== undefined ||
      image.colorGrading !== undefined ||
      image.colorCalibration !== undefined ||
      (image.shadowTint !== undefined && image.shadowTint !== 0) ||
      (image.curves &&
        JSON.stringify(image.curves) !==
          JSON.stringify({
            rgb: [
              { x: 0, y: 0 },
              { x: 255, y: 255 },
            ],
            red: [
              { x: 0, y: 0 },
              { x: 255, y: 255 },
            ],
            green: [
              { x: 0, y: 0 },
              { x: 255, y: 255 },
            ],
            blue: [
              { x: 0, y: 0 },
              { x: 255, y: 255 },
            ],
          }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    image.exposure,
    image.contrast,
    image.highlights,
    image.shadows,
    image.whites,
    image.blacks,
    image.brightness,
    image.clarity,
    image.temperature,
    image.vibrance,
    image.saturation,
    image.hue,
    image.dehaze,
    image.vignette,
    image.grain,
    image.blur,
    image.curves,
    image.colorHSL,
    image.splitToning,
    image.colorGrading,
    image.colorCalibration,
    image.shadowTint,
    image.filters,
    image.blur,
  ]);

  // Render filtered image when FILTER PARAMS change (not position/drag)
  // Uses engine.renderImage() which is mutex-protected to prevent race conditions
  // Reads image/bypassedTabs from refs to avoid re-triggering on x/y changes
  //
  // Render at full SOURCE resolution (naturalWidth × naturalHeight) so filtered quality
  // matches the unfiltered image. No cap — we never upscale and never degrade.
  useEffect(() => {
    if (!imgElement) return;

    if (!hasActiveFilters) {
      setFilteredCanvas(null);
      return;
    }

    // Increment render ID so stale async results are discarded
    const thisRenderId = ++renderIdRef.current;

    const engine = getPixiFilterEngine();
    engineRef.current = engine;

    // Read from refs — these always have the latest value without being deps
    const currentImage = imageRef.current;
    const currentBypass = bypassRef.current;

    const renderW = imgElement.naturalWidth || currentImage.width;
    const renderH = imgElement.naturalHeight || currentImage.height;

    engine
      .renderImage(imgElement, currentImage, currentBypass, renderW, renderH)
      .then((clonedCanvas) => {
        // Discard if a newer render was started while we waited for the lock
        if (renderIdRef.current !== thisRenderId) return;

        if (!gpuReady) setGpuReady(true);

        if (clonedCanvas) {
          setFilteredCanvas(clonedCanvas);
          // Force Konva to repaint
          requestAnimationFrame(() => {
            konvaRef.current.current?.getLayer()?.batchDraw();
          });
        }
      })
      .catch((e) => {
        console.warn("[usePixiFilters] GPU render failed:", e);
      });
    // Only re-run when filter params actually change (filterSignature),
    // image source changes (imgElement), or filter active state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSignature, imgElement, hasActiveFilters]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Don't destroy the singleton - other images might use it
      // Just clear local refs
      engineRef.current = null;
    };
  }, []);

  return {
    filteredCanvas: hasActiveFilters ? filteredCanvas : null,
    gpuReady,
    hasActiveFilters,
  };
}
