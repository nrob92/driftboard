import { useCallback, useState } from 'react';
import type { CanvasImage } from '@/lib/types';
import { exportWithCanvasFilters } from '@/lib/filters/clientFilters';

interface UseExportOptions {
  images: CanvasImage[];
  selectedIds: string[];
  decodeDNG: (buffer: ArrayBuffer, forPreview?: boolean) => Promise<{ dataUrl: string; width: number; height: number }>;
}

interface UseExportReturn {
  exportProgress: { current: number; total: number } | null;
  setExportProgress: (v: { current: number; total: number } | null) => void;
  exportImageToDownload: (image: CanvasImage, silent?: boolean) => Promise<boolean>;
  handleExport: () => void;
  handleExportSelection: (contextMenuSelectedIds: string[]) => void;
}

export function useExport({ images, selectedIds, decodeDNG }: UseExportOptions): UseExportReturn {
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(null);

  // Export a single image with edits (DNG full-res or server). silent = true for multi-export (no per-image alerts).
  const exportImageToDownload = useCallback(async (image: CanvasImage, silent = false): Promise<boolean> => {
    const hasCloudPath = image.storagePath || image.originalStoragePath;
    if (!hasCloudPath) return false;

    try {
      const pathIsDng = (p: string | undefined) => p?.toLowerCase().endsWith('.dng') ?? false;
      const isDngSource = image.originalStoragePath && pathIsDng(image.originalStoragePath);

      if (isDngSource && image.originalStoragePath) {
        if (!silent) alert('Decoding DNG at full resolution... This may take 10-20 seconds.');
        try {
          const signedUrlResponse = await fetch('/api/signed-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bucket: 'originals', path: image.originalStoragePath }),
          });
          if (!signedUrlResponse.ok) {
            const err = await signedUrlResponse.json();
            console.error('Failed to get signed URL:', err);
            if (!silent) alert('Failed to access original DNG. Falling back to preview quality.');
          } else {
            const { signedUrl } = await signedUrlResponse.json();
            const response = await fetch(signedUrl);
            if (!response.ok) throw new Error(`Failed to download DNG: ${response.status}`);
            const dngBlob = await response.blob();
            const arrayBuffer = await dngBlob.arrayBuffer();
            const decoded = await decodeDNG(arrayBuffer, false);
            // Use same canvas filter pipeline as UI so DNG export matches what you see (WYSIWYG)
            const blob = await exportWithCanvasFilters(image, decoded.dataUrl);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${image.id || 'export'}-fullres-${Date.now()}.jpg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (!silent) alert(`Exported at full resolution: ${decoded.width}x${decoded.height}px`);
            return true;
          }
        } catch (dngError) {
          console.error('DNG export error:', dngError);
          if (!silent) alert(`DNG export failed: ${dngError instanceof Error ? dngError.message : 'Unknown error'}. Falling back to preview quality.`);
        }
      }

      // Use client-side canvas filters so export matches the UI (WYSIWYG). Get signed URL and run same pipeline as display.
      const pathToFetch = image.storagePath || image.originalStoragePath;
      const bucket = image.storagePath ? 'photos' : 'originals';
      const signedRes = await fetch('/api/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket, path: pathToFetch }),
      });
      if (!signedRes.ok) {
        const err = await signedRes.json();
        throw new Error(err.error || 'Failed to get image URL');
      }
      const { signedUrl } = await signedRes.json();
      const blob = await exportWithCanvasFilters(image, signedUrl);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${image.id || 'export'}-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (error) {
      console.error('Export error:', error);
      if (!silent) alert(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }, [decodeDNG]);

  // Handle export with edits applied (single selected image). Runs in background with progress overlay.
  const handleExport = useCallback(() => {
    const singleId = selectedIds.length === 1 ? selectedIds[0] : null;
    if (!singleId) return;
    const image = images.find(img => img.id === singleId);
    if (!image || !(image.storagePath || image.originalStoragePath)) {
      alert('Cannot export: Image not saved to cloud');
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
  const handleExportSelection = useCallback((contextMenuSelectedIds: string[]) => {
    const toExport = contextMenuSelectedIds
      .map((id) => images.find((img) => img.id === id))
      .filter((img): img is CanvasImage => !!img && 'src' in img && !!(img.storagePath || img.originalStoragePath));
    if (toExport.length === 0) {
      alert('No photos to export. Selected items must be saved to cloud.');
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
        if (fail === 0) alert(`Exported ${ok} photo${ok === 1 ? '' : 's'}.`);
        else alert(`Exported ${ok} photo${ok === 1 ? '' : 's'}. ${fail} failed.`);
      }
    })();
  }, [images, exportImageToDownload]);

  return { exportProgress, setExportProgress, exportImageToDownload, handleExport, handleExportSelection };
}
