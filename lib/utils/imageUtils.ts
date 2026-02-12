// DNG support - runtime script loading to avoid bundler issues
export const isDNG = (name: string) => name.toLowerCase().endsWith('.dng');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let LibRawClass: any = null;
let librawLoading: Promise<void> | null = null;

export async function loadLibRaw(): Promise<void> {
  if (LibRawClass) return;
  if (librawLoading) return librawLoading;

  librawLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = `
      import LibRaw from '/libraw/index.js';
      window.__LibRaw = LibRaw;
      window.dispatchEvent(new Event('libraw-loaded'));
    `;

    const handler = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      LibRawClass = (window as any).__LibRaw;
      window.removeEventListener('libraw-loaded', handler);
      resolve();
    };

    window.addEventListener('libraw-loaded', handler);
    document.head.appendChild(script);

    // Timeout after 10 seconds
    setTimeout(() => reject(new Error('LibRaw load timeout')), 10000);
  });

  return librawLoading;
}

// Thumbnail max dimension for egress reduction (load small thumbs in grid, full-res on export)
export const THUMB_MAX_DIM = 1200;

/** Create a thumbnail blob from a file or blob (max 800px) for low-egress grid display */
export async function createThumbnailBlob(file: File | Blob, maxDim = THUMB_MAX_DIM): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w <= maxDim && h <= maxDim) {
        file.arrayBuffer().then((buf) => resolve(new Blob([buf], { type: 'image/jpeg' }))).catch(reject);
        return;
      }
      const scale = maxDim / Math.max(w, h);
      const tw = Math.round(w * scale);
      const th = Math.round(h * scale);
      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, tw, th);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.95);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image load failed'));
    };
    img.src = url;
  });
}

/**
 * Resize image for editing (Lightroom-style smart preview)
 * For 24MP+ images, resize to max 1500px for BLAZING FAST editing
 * Returns data URL of resized image or original if small enough
 */
export async function resizeImageForEditing(imageSrc: string, maxDim = 1500): Promise<{ src: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;

      // If already small enough, return original
      if (w <= maxDim && h <= maxDim) {
        resolve({ src: imageSrc, width: w, height: h });
        return;
      }

      // Resize to max 2000px for speed (smaller than Lightroom's 2540px)
      const scale = maxDim / Math.max(w, h);
      const newW = Math.round(w * scale);
      const newH = Math.round(h * scale);

      const canvas = document.createElement('canvas');
      canvas.width = newW;
      canvas.height = newH;
      const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, newW, newH);

      const resizedSrc = canvas.toDataURL('image/jpeg', 0.92);
      console.log(`Resized image from ${w}x${h} to ${newW}x${newH} for editing`);
      resolve({ src: resizedSrc, width: newW, height: newH });
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = imageSrc;
  });
}

/** Get thumb storage path from full path: user_id/filename.jpg -> user_id/thumbs/filename.jpg */
export function getThumbStoragePath(fullPath: string): string {
  const lastSlash = fullPath.lastIndexOf('/');
  if (lastSlash < 0) return `thumbs/${fullPath}`;
  return fullPath.slice(0, lastSlash + 1) + 'thumbs/' + fullPath.slice(lastSlash + 1);
}

// Preview max dimension for DNG files (best preview: no downscale; use large cap so we keep full res)
const DNG_PREVIEW_MAX_SIZE = 99999;

// Decode DNG using runtime-loaded LibRaw (bypasses bundler)
export const decodeDNG = async (buffer: ArrayBuffer, forPreview = true): Promise<{ dataUrl: string; width: number; height: number }> => {
  await loadLibRaw();

  const raw = new LibRawClass();
  await raw.open(new Uint8Array(buffer), {
    useCameraWb: true,
    outputColor: 1,
    outputBps: 8,
    userQual: 3,
    halfSize: false,
    noAutoBright: false,
  });

  const imageData = await raw.imageData();
  const { data, width, height } = imageData;

  // Convert RGB to RGBA
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = data[i * 3];
    rgba[i * 4 + 1] = data[i * 3 + 1];
    rgba[i * 4 + 2] = data[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }

  let canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);

  let finalWidth = width;
  let finalHeight = height;

  if (forPreview && (width > DNG_PREVIEW_MAX_SIZE || height > DNG_PREVIEW_MAX_SIZE)) {
    const scale = Math.min(DNG_PREVIEW_MAX_SIZE / width, DNG_PREVIEW_MAX_SIZE / height);
    finalWidth = Math.round(width * scale);
    finalHeight = Math.round(height * scale);

    const resizedCanvas = document.createElement('canvas');
    resizedCanvas.width = finalWidth;
    resizedCanvas.height = finalHeight;
    const resizedCtx = resizedCanvas.getContext('2d', { willReadFrequently: true })!;
    resizedCtx.imageSmoothingEnabled = true;
    resizedCtx.imageSmoothingQuality = 'high';
    resizedCtx.drawImage(canvas, 0, 0, finalWidth, finalHeight);
    canvas = resizedCanvas;
  }

  return { dataUrl: canvas.toDataURL('image/jpeg', 0.98), width: finalWidth, height: finalHeight };
};

export const decodeDNGFromUrl = async (url: string): Promise<{ dataUrl: string; width: number; height: number }> => {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return decodeDNG(buffer);
};
