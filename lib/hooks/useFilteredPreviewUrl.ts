/**
 * Hook that renders the image through the PixiJS filter pipeline and returns
 * a data URL for display. Used by the mobile fullscreen EditPanel to show
 * live edits in the preview (which otherwise would only show the raw source).
 */

"use client";

import { useEffect, useState, useMemo } from "react";
import useImage from "use-image";
import type { CanvasImage } from "@/lib/types";
import { getPixiFilterEngine } from "@/lib/filters/pixiFilterEngine";

const MAX_PREVIEW_PX = 1024; // Cap preview size for performance on mobile

export function useFilteredPreviewUrl(
  image: CanvasImage | null,
  bypassedTabs: Set<string>,
  enabled: boolean,
): string | null {
  const [imgElement, imgStatus] = useImage(image?.src ?? "", "anonymous");
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  const filterSignature = useMemo(() => {
    if (!image) return "";
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
      bypass: Array.from(bypassedTabs).sort().join(","),
    });
  }, [image, bypassedTabs]);

  useEffect(() => {
    // When disabled or no image, the return value will be null
    // We don't need to clear dataUrl - just let the effect run when conditions are met
    if (!enabled || !image || !imgElement || imgStatus !== "loaded") {
      return;
    }

    const w = imgElement.naturalWidth || image.width;
    const h = imgElement.naturalHeight || image.height;
    const maxDim = Math.max(w, h);
    let renderW = w;
    let renderH = h;
    if (maxDim > MAX_PREVIEW_PX) {
      const scale = MAX_PREVIEW_PX / maxDim;
      renderW = Math.round(w * scale);
      renderH = Math.round(h * scale);
    }

    let cancelled = false;
    const engine = getPixiFilterEngine();
    engine
      .renderImage(imgElement, image, bypassedTabs, renderW, renderH)
      .then((canvas) => {
        if (cancelled) return;
        // This setState is in an async callback, which is allowed
        if (canvas) {
          setDataUrl(canvas.toDataURL("image/jpeg", 0.92));
        }
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn("[useFilteredPreviewUrl] Render failed:", e);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, image, imgElement, imgStatus, filterSignature, bypassedTabs]);

  // Derive the return value based on inputs and state
  // When disabled or no image, always return null
  if (!enabled || !image) {
    return null;
  }

  // Return the data URL if we have it
  if (dataUrl) {
    return dataUrl;
  }

  // Still loading or rendering - show original as fallback
  return image.src;
}
