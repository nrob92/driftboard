/**
 * Shared Lookup Table (LUT) utilities for image filters.
 * Used by both client-side (Konva) and server-side (Sharp) filter pipelines.
 */

import type { CurvePoint } from "@/lib/types";

/**
 * Build a 256-entry lookup table from curve control points.
 * Uses Catmull-Rom spline interpolation for smooth curves.
 *
 * @param points - Array of curve control points (x: input, y: output)
 * @returns Uint8Array with 256 entries mapping input values to output values
 */
export function buildLUT(points: CurvePoint[]): Uint8Array {
  const lut = new Uint8Array(256);

  // Fast path for identity curve (no modification)
  if (points.length === 2) {
    const sorted = [...points].sort((a, b) => a.x - b.x);
    if (
      sorted[0].x === 0 &&
      sorted[0].y === 0 &&
      sorted[1].x === 255 &&
      sorted[1].y === 255
    ) {
      for (let i = 0; i < 256; i++) lut[i] = i;
      return lut;
    }
  }

  const sorted = [...points].sort((a, b) => a.x - b.x);

  // Catmull-Rom spline interpolation
  const interpolate = (x: number): number => {
    if (sorted.length === 0) return x;
    if (sorted.length === 1) return sorted[0].y;
    if (x <= sorted[0].x) return sorted[0].y;
    if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;

    // Find the segment
    let i = 0;
    while (i < sorted.length - 1 && sorted[i + 1].x < x) i++;

    // Get the four control points for Catmull-Rom
    const p0 = sorted[Math.max(0, i - 1)];
    const p1 = sorted[i];
    const p2 = sorted[Math.min(sorted.length - 1, i + 1)];
    const p3 = sorted[Math.min(sorted.length - 1, i + 2)];

    // Compute interpolation parameter
    const t = (x - p1.x) / (p2.x - p1.x || 1);
    const t2 = t * t;
    const t3 = t2 * t;

    // Catmull-Rom spline formula
    const y =
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

    return Math.max(0, Math.min(255, Math.round(y)));
  };

  for (let i = 0; i < 256; i++) {
    lut[i] = interpolate(i);
  }

  return lut;
}

/**
 * Check if curves have been modified from default.
 * Used to skip curve processing when no changes were made.
 */
export function isCurvesModified(
  curves:
    | {
        rgb: CurvePoint[];
        red: CurvePoint[];
        green: CurvePoint[];
        blue: CurvePoint[];
      }
    | undefined,
): boolean {
  if (!curves) return false;

  const checkChannel = (points: CurvePoint[]) => {
    if (!points || points.length === 0) return false;
    if (points.length > 2) return true;
    return points.some((p, i) =>
      i === 0
        ? p.x !== 0 || p.y !== 0
        : i === points.length - 1
          ? p.x !== 255 || p.y !== 255
          : true,
    );
  };

  return (
    checkChannel(curves.rgb) ||
    checkChannel(curves.red) ||
    checkChannel(curves.green) ||
    checkChannel(curves.blue)
  );
}
