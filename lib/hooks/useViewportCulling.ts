import { useMemo } from "react";
import type { CanvasImage } from "@/lib/types";

/**
 * Viewport culling: Only render ImageNode components whose bounding boxes
 * intersect the visible viewport + padding. With 500 images on canvas,
 * only ~20-30 are visible at any time. Non-visible images are not mounted
 * (no filter computation, no useImage hook, no DOM).
 *
 * @param images - All images on canvas
 * @param stagePosition - Current stage pan position {x, y}
 * @param stageScale - Current zoom scale
 * @param viewportWidth - Browser viewport width (px)
 * @param viewportHeight - Browser viewport height (px)
 * @param padding - Extra padding around viewport in canvas units (default 200)
 * @returns Set of image IDs that are within the visible viewport
 */
export function useViewportCulling(
  images: CanvasImage[],
  stagePosition: { x: number; y: number },
  stageScale: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 200,
): Set<string> {
  return useMemo(() => {
    // Convert viewport bounds to canvas (world) coordinates
    // Stage position is the offset of the stage origin from the top-left of the screen
    // To get canvas coords: canvasX = (screenX - stagePosition.x) / stageScale
    const worldLeft = -stagePosition.x / stageScale - padding;
    const worldTop = -stagePosition.y / stageScale - padding;
    const worldRight = (viewportWidth - stagePosition.x) / stageScale + padding;
    const worldBottom =
      (viewportHeight - stagePosition.y) / stageScale + padding;

    const visible = new Set<string>();

    for (const img of images) {
      // Image bounding box in canvas coordinates
      const imgRight = img.x + img.width * img.scaleX;
      const imgBottom = img.y + img.height * img.scaleY;

      // AABB intersection test
      if (
        img.x < worldRight &&
        imgRight > worldLeft &&
        img.y < worldBottom &&
        imgBottom > worldTop
      ) {
        visible.add(img.id);
      }
    }

    return visible;
  }, [
    images,
    stagePosition,
    stageScale,
    viewportWidth,
    viewportHeight,
    padding,
  ]);
}
