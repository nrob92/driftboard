'use client';

import React, { useRef, useEffect } from 'react';
import { Image as KonvaImage, Group, Rect } from 'react-konva';
import useImage from 'use-image';
import Konva from 'konva';
import type { CanvasImage } from '@/lib/types';
import { usePixiFilters } from '@/lib/hooks/usePixiFilters';

export interface ImageNodeProps {
  image: CanvasImage;
  onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDblClick?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onContextMenu?: (e: Konva.KonvaEventObject<PointerEvent>, imageId: string) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTouchStart?: (e: Konva.KonvaEventObject<TouchEvent>, imageId: string) => void;
  onTouchEnd?: (e: Konva.KonvaEventObject<TouchEvent>, imageId: string) => void;
  onTouchMove?: (e: Konva.KonvaEventObject<TouchEvent>, imageId: string) => void;
  onUpdate: (updates: Partial<CanvasImage>) => void;
  bypassedTabs?: Set<'curves' | 'light' | 'color' | 'effects'>;
  useLowResPreview?: boolean;
  isSelected?: boolean;
  isPreviewingQuality?: boolean;
}

// Image node component - memoized to prevent unnecessary re-renders
// Uses GPU-accelerated PixiJS filters for real-time editing
export const ImageNode = React.memo(function ImageNode({
  image,
  onClick,
  onDblClick,
  onContextMenu,
  onDragEnd,
  onDragMove,
  onTouchStart,
  onTouchEnd,
  onTouchMove,
  onUpdate,
  bypassedTabs,
  isSelected,
}: ImageNodeProps) {
  const [img, imgStatus] = useImage(image.src, 'anonymous');
  const imageRef = useRef<Konva.Image>(null);
  const groupRef = useRef<Konva.Group>(null);
  const prevPosRef = useRef({ x: image.x, y: image.y });
  const isDraggingRef = useRef(false);

  // GPU filter pipeline — replaces the entire CPU filter stack
  // No throttling, no progressive quality, no deferred values needed
  const { filteredCanvas, hasActiveFilters } = usePixiFilters({
    image,
    imgElement: img ?? null,
    bypassedTabs: bypassedTabs ?? new Set(),
    isSelected: isSelected ?? false,
    konvaImageRef: imageRef,
  });

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

  // Cache the Konva node when GPU provides a filtered canvas.
  // Without cache, every Konva redraw (zoom, pan, drag) re-draws from the canvas source.
  // With cache, Konva blits a pre-rendered raster — much faster for 20+ images.
  useEffect(() => {
    const node = imageRef.current;
    if (!node) return;

    node.clearCache();
    node.filters([]);

    if (filteredCanvas) {
      // GPU canvas is at display×2 — cache at pixelRatio 1 gives display-res raster
      node.cache({ pixelRatio: 1 });
    }

    node.getLayer()?.batchDraw();
  }, [filteredCanvas, hasActiveFilters]);

  if (!img || imgStatus === 'loading') {
    return null;
  }

  const borderWidth = image.borderWidth ?? 0;
  const borderColor = image.borderColor ?? '#ffffff';
  const hasBorder = borderWidth > 0;

  // Use GPU-filtered canvas when available, otherwise original image
  const displayImage = filteredCanvas ?? img;

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
      onDblTap={(e) => {
        e.cancelBubble = true;
        // TouchEvent has no button; pass synthetic event so handler doesn't skip mobile double-tap
        onDblClick?.({ ...e, evt: { ...e.evt, button: 0 } } as unknown as Konva.KonvaEventObject<MouseEvent>);
      }}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        onContextMenu?.(e as Konva.KonvaEventObject<PointerEvent>, image.id);
      }}
      onTouchStart={(e) => onTouchStart?.(e, image.id)}
      onTouchEnd={(e) => onTouchEnd?.(e, image.id)}
      onTouchMove={(e) => onTouchMove?.(e, image.id)}
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
        onDragEnd(e);
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
        image={displayImage}
        x={0}
        y={0}
        width={image.width}
        height={image.height}
        perfectDrawEnabled={false}
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
  const prev = prevProps.image;
  const next = nextProps.image;

  if (prev.x !== next.x || prev.y !== next.y) return false;

  if (prev.src !== next.src || prev.width !== next.width || prev.height !== next.height ||
      prev.rotation !== next.rotation || prev.scaleX !== next.scaleX || prev.scaleY !== next.scaleY) {
    return false;
  }

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

  // Complex objects
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

  // Selection state changed
  if (prevProps.isSelected !== nextProps.isSelected) return false;

  return true;
});
