export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

export function findNearestPhoto(
  x: number,
  y: number,
  photos: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  currentId: string,
  snapDistance: number = 100
): { x: number; y: number } | null {
  let nearest: { x: number; y: number; distance: number } | null = null;

  for (const photo of photos) {
    if (photo.id === currentId) continue;

    // Calculate center of the photo
    const photoCenterX = photo.x + photo.width / 2;
    const photoCenterY = photo.y + photo.height / 2;

    // Calculate distance from current position to photo center
    const dx = x - photoCenterX;
    const dy = y - photoCenterY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Check if within snap distance
    if (distance <= snapDistance) {
      if (!nearest || distance < nearest.distance) {
        nearest = {
          x: photoCenterX,
          y: photoCenterY,
          distance,
        };
      }
    }
  }

  // If found a nearby photo, snap to align with it
  if (nearest) {
    return {
      x: snapToGrid(nearest.x, 50),
      y: snapToGrid(nearest.y, 50),
    };
  }

  return null;
}
