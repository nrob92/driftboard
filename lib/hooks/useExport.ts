import { useCallback, useState } from "react";
import type { CanvasImage, PhotoFolder } from "@/lib/types";
import { exportWithCanvasFilters } from "@/lib/filters/clientFilters";
import { getPixiFilterEngine } from "@/lib/filters/pixiFilterEngine";
import {
  SOCIAL_LAYOUT_PAGE_WIDTH,
  SOCIAL_LAYOUT_ASPECT,
  SOCIAL_LAYOUT_MAX_PAGES,
  DEFAULT_SOCIAL_LAYOUT_BG,
  isSocialLayout,
} from "@/lib/folders/folderLayout";

interface UseExportOptions {
  images: CanvasImage[];
  selectedIds: string[];
  folders: PhotoFolder[];
  decodeDNG: (
    buffer: ArrayBuffer,
    forPreview?: boolean,
  ) => Promise<{ dataUrl: string; width: number; height: number }>;
  sessionId?: string;
}

interface UseExportReturn {
  exportProgress: { current: number; total: number } | null;
  setExportProgress: (v: { current: number; total: number } | null) => void;
  exportImageToDownload: (
    image: CanvasImage,
    silent?: boolean,
  ) => Promise<boolean>;
  handleExport: () => void;
  handleExportSelection: (contextMenuSelectedIds: string[]) => void;
  handleExportLayout: (folderId: string) => void;
}

export function useExport({
  images,
  selectedIds,
  folders,
  decodeDNG,
  sessionId,
}: UseExportOptions): UseExportReturn {
  const [exportProgress, setExportProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  // Export a single image with edits (DNG full-res or server). silent = true for multi-export (no per-image alerts).
  const exportImageToDownload = useCallback(
    async (image: CanvasImage, silent = false): Promise<boolean> => {
      const hasCloudPath = image.storagePath || image.originalStoragePath;
      if (!hasCloudPath) return false;

      try {
        const pathIsDng = (p: string | undefined) =>
          p?.toLowerCase().endsWith(".dng") ?? false;
        const isDngSource =
          image.originalStoragePath && pathIsDng(image.originalStoragePath);

        if (isDngSource && image.originalStoragePath) {
          if (!silent)
            alert(
              "Decoding DNG at full resolution... This may take 10-20 seconds.",
            );
          try {
            const signedUrlResponse = await fetch("/api/signed-url", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                bucket: "originals",
                path: image.originalStoragePath,
              }),
            });
            if (!signedUrlResponse.ok) {
              const err = await signedUrlResponse.json();
              console.error("Failed to get signed URL:", err);
              if (!silent)
                alert(
                  "Failed to access original DNG. Falling back to preview quality.",
                );
            } else {
              const { signedUrl } = await signedUrlResponse.json();
              const response = await fetch(signedUrl);
              if (!response.ok)
                throw new Error(`Failed to download DNG: ${response.status}`);
              const dngBlob = await response.blob();
              const arrayBuffer = await dngBlob.arrayBuffer();
              const decoded = await decodeDNG(arrayBuffer, false);
              // Use GPU filter pipeline for fast full-res export (WYSIWYG)
              const blob = await exportImageWithFilters(image, decoded.dataUrl);
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${image.id || "export"}-fullres-${Date.now()}.jpg`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              if (!silent)
                alert(
                  `Exported at full resolution: ${decoded.width}x${decoded.height}px`,
                );
              return true;
            }
          } catch (dngError) {
            console.error("DNG export error:", dngError);
            if (!silent)
              alert(
                `DNG export failed: ${dngError instanceof Error ? dngError.message : "Unknown error"}. Falling back to preview quality.`,
              );
          }
        }

        // Use client-side canvas filters so export matches the UI (WYSIWYG). Get signed URL and run same pipeline as display.
        const pathToFetch = image.storagePath || image.originalStoragePath;
        const bucket = isDngSource
          ? "originals"
          : image.storagePath
            ? sessionId
              ? "collab-photos"
              : "photos"
            : "originals";

        const signedRes = await fetch("/api/signed-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bucket, path: pathToFetch }),
        });
        if (!signedRes.ok) {
          const err = await signedRes.json();
          throw new Error(err.error || "Failed to get image URL");
        }
        const { signedUrl } = await signedRes.json();
        const blob = await exportImageWithFilters(image, signedUrl);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${image.id || "export"}-${Date.now()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;
      } catch (error) {
        console.error("Export error:", error);
        if (!silent)
          alert(
            `Export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        return false;
      }
    },
    [decodeDNG, sessionId],
  ); // Added sessionId dependency

  // Handle export with edits applied (single selected image). Runs in background with progress overlay.
  const handleExport = useCallback(() => {
    const singleId = selectedIds.length === 1 ? selectedIds[0] : null;
    if (!singleId) return;
    const image = images.find((img) => img.id === singleId);
    if (!image || !(image.storagePath || image.originalStoragePath)) {
      alert("Cannot export: Image not saved to cloud");
      return;
    }
    setExportProgress({ current: 1, total: 1 });
    (async () => {
      try {
        await exportImageToDownload(image, false);
      } finally {
        setExportProgress(null);
      }
    })();
  }, [selectedIds, images, exportImageToDownload]);

  // Export multiple selected photos with edits (context menu). Runs in background with "Exporting 1 of N" overlay.
  const handleExportSelection = useCallback(
    (contextMenuSelectedIds: string[]) => {
      const toExport = contextMenuSelectedIds
        .map((id) => images.find((img) => img.id === id))
        .filter(
          (img): img is CanvasImage =>
            !!img &&
            "src" in img &&
            !!(img.storagePath || img.originalStoragePath),
        );
      if (toExport.length === 0) {
        alert("No photos to export. Selected items must be saved to cloud.");
        return;
      }
      const total = toExport.length;
      setExportProgress({ current: 1, total });
      (async () => {
        const delayMs = 400;
        let ok = 0;
        let fail = 0;
        for (let i = 0; i < toExport.length; i++) {
          const success = await exportImageToDownload(toExport[i], true);
          if (success) ok++;
          else fail++;
          if (i < toExport.length - 1) {
            setExportProgress({ current: i + 2, total });
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
        setExportProgress(null);
        if (total > 1 && (ok > 0 || fail > 0)) {
          if (fail === 0) alert(`Exported ${ok} photo${ok === 1 ? "" : "s"}.`);
          else
            alert(
              `Exported ${ok} photo${ok === 1 ? "" : "s"}. ${fail} failed.`,
            );
        }
      })();
    },
    [images, exportImageToDownload],
  );

  // Export a social layout (one image per page)
  const handleExportLayout = useCallback(
    (folderId: string) => {
      const folder = folders.find((f) => f.id === folderId);
      if (!folder || !isSocialLayout(folder)) return;

      const pageCount = Math.max(
        1,
        Math.min(SOCIAL_LAYOUT_MAX_PAGES, folder.pageCount ?? 1),
      );
      const folderImages = folder.imageIds
        .map((id) => images.find((img) => img.id === id))
        .filter((img): img is CanvasImage => !!img);

      setExportProgress({ current: 1, total: pageCount });

      (async () => {
        try {
          for (let page = 0; page < pageCount; page++) {
            setExportProgress({ current: page + 1, total: pageCount });
            await exportSocialLayoutPage(folder, folderImages, page, decodeDNG);
            if (page < pageCount - 1) {
              await new Promise((r) => setTimeout(r, 400));
            }
          }
        } catch (error) {
          console.error("Layout export error:", error);
          alert(
            `Layout export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        } finally {
          setExportProgress(null);
        }
      })();
    },
    [folders, images, decodeDNG],
  );

  return {
    exportProgress,
    setExportProgress,
    exportImageToDownload,
    handleExport,
    handleExportSelection,
    handleExportLayout,
  };
}

/** Add border around a filtered image blob if the image has a border */
async function applyBorderToBlob(
  blob: Blob,
  image: CanvasImage,
): Promise<Blob> {
  const borderWidth = image.borderWidth ?? 0;
  if (borderWidth <= 0) return blob;

  const borderColor = image.borderColor ?? "#ffffff";

  // Load the filtered image
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(new Error("Failed to load filtered image for border"));
      el.src = url;
    });

    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;

    // Scale border relative to image size (borderWidth is in canvas display units,
    // but the exported image may be at full source resolution)
    // The border on canvas is relative to image.width (display size), so scale proportionally
    const scale = imgW / image.width;
    const scaledBorder = Math.round(borderWidth * scale);

    const canvas = document.createElement("canvas");
    canvas.width = imgW + scaledBorder * 2;
    canvas.height = imgH + scaledBorder * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;

    // Fill with border color
    ctx.fillStyle = borderColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw the filtered image centered
    ctx.drawImage(img, scaledBorder, scaledBorder);

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        0.95,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Export image with GPU filters (fallback to CPU if GPU unavailable), then apply border */
async function exportImageWithFilters(
  image: CanvasImage,
  imageUrl: string,
): Promise<Blob> {
  let blob: Blob;
  try {
    // Try GPU pipeline first
    const engine = getPixiFilterEngine();
    const hasFilters = engine.hasActiveFilters(image);

    if (hasFilters) {
      // Load full-res image
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = "anonymous";
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Failed to load image"));
        el.src = imageUrl;
      });

      // Initialize GPU engine at full resolution
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const ok = await engine.init(w, h);

      if (ok) {
        // GPU export (fast!)
        blob = await engine.exportFiltered(image, img);
        return applyBorderToBlob(blob, image);
      }
    }
  } catch (e) {
    console.warn("[useExport] GPU export failed, falling back to CPU:", e);
  }

  // Fallback: CPU pipeline
  blob = await exportWithCanvasFilters(image, imageUrl);
  return applyBorderToBlob(blob, image);
}

/** Get a signed URL for an image's cloud storage path */
async function getSignedUrl(image: CanvasImage): Promise<string> {
  const pathToFetch = image.storagePath || image.originalStoragePath;
  const bucket = image.storagePath ? "photos" : "originals";
  const signedRes = await fetch("/api/signed-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket, path: pathToFetch }),
  });
  if (!signedRes.ok) {
    const err = await signedRes.json();
    throw new Error(err.error || "Failed to get image URL");
  }
  const { signedUrl } = await signedRes.json();
  return signedUrl;
}

/** Export a single page of a social layout as a composite image */
async function exportSocialLayoutPage(
  folder: PhotoFolder,
  folderImages: CanvasImage[],
  pageIndex: number,
  decodeDNG: (
    buffer: ArrayBuffer,
    forPreview?: boolean,
  ) => Promise<{ dataUrl: string; width: number; height: number }>,
): Promise<void> {
  const pageWidth = SOCIAL_LAYOUT_PAGE_WIDTH;
  const pageHeight =
    (pageWidth * SOCIAL_LAYOUT_ASPECT.h) / SOCIAL_LAYOUT_ASPECT.w;
  const bg = folder.backgroundColor ?? DEFAULT_SOCIAL_LAYOUT_BG;

  // Export at high resolution (3x for quality)
  const exportScale = 3;
  const canvasW = Math.round(pageWidth * exportScale);
  const canvasH = Math.round(pageHeight * exportScale);

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not available");

  // Fill background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // The page region in canvas coords:
  // page starts at folder.x + pageIndex * pageWidth, folder.y + 30 (label offset)
  const pageLeft = folder.x + pageIndex * pageWidth;
  const pageTop = folder.y + 30; // 30px label offset

  // Find images that fall within this page's bounds
  for (const image of folderImages) {
    // Image position in canvas space
    const imgLeft = image.x;
    const imgTop = image.y;
    const imgW = image.width * (image.scaleX ?? 1);
    const imgH = image.height * (image.scaleY ?? 1);
    const imgRight = imgLeft + imgW;
    const imgBottom = imgTop + imgH;

    // Check if this image overlaps with this page
    const pageRight = pageLeft + pageWidth;
    const pageBottom = pageTop + pageHeight;
    if (
      imgRight <= pageLeft ||
      imgLeft >= pageRight ||
      imgBottom <= pageTop ||
      imgTop >= pageBottom
    ) {
      continue; // Image not on this page
    }

    // Get filtered image for this photo
    let filteredImg: HTMLImageElement;
    try {
      const hasCloudPath = image.storagePath || image.originalStoragePath;
      if (!hasCloudPath) continue;

      const pathIsDng = (p: string | undefined) =>
        p?.toLowerCase().endsWith(".dng") ?? false;
      const isDngSource =
        image.originalStoragePath && pathIsDng(image.originalStoragePath);

      let imageBlob: Blob;
      if (isDngSource && image.originalStoragePath) {
        try {
          const signedUrl = await getSignedUrl({
            ...image,
            storagePath: undefined,
            originalStoragePath: image.originalStoragePath,
          } as CanvasImage);
          const response = await fetch(signedUrl);
          const dngBlob = await response.blob();
          const arrayBuffer = await dngBlob.arrayBuffer();
          const decoded = await decodeDNG(arrayBuffer, false);
          imageBlob = await exportImageWithFilters(image, decoded.dataUrl);
        } catch {
          // Fallback to preview
          const signedUrl = await getSignedUrl(image);
          imageBlob = await exportImageWithFilters(image, signedUrl);
        }
      } else {
        const signedUrl = await getSignedUrl(image);
        imageBlob = await exportImageWithFilters(image, signedUrl);
      }

      const blobUrl = URL.createObjectURL(imageBlob);
      try {
        filteredImg = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error("Failed to load filtered image"));
          el.src = blobUrl;
        });
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    } catch (e) {
      console.warn(`[exportLayout] Failed to render image ${image.id}:`, e);
      continue;
    }

    // Calculate position relative to this page, then scale to export resolution
    const relX = (imgLeft - pageLeft) * exportScale;
    const relY = (imgTop - pageTop) * exportScale;
    const drawW = imgW * exportScale;
    const drawH = imgH * exportScale;

    // The filtered image blob already includes the border (from applyBorderToBlob),
    // so we need to account for the border in the draw position
    const borderWidth = image.borderWidth ?? 0;
    const hasBorder = borderWidth > 0;

    if (hasBorder) {
      // The blob includes the border, so the total image is larger
      // Offset the draw position by the border width (in export-scaled units)
      const scaledBorder = borderWidth * exportScale;
      ctx.drawImage(
        filteredImg,
        relX - scaledBorder,
        relY - scaledBorder,
        drawW + scaledBorder * 2,
        drawH + scaledBorder * 2,
      );
    } else {
      ctx.drawImage(filteredImg, relX, relY, drawW, drawH);
    }
  }

  // Download the page
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      0.95,
    );
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${folder.name}-page${pageIndex + 1}-${Date.now()}.jpg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
