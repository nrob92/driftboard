import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import exifr from 'exifr';
import { supabase } from '@/lib/supabase';
import type { CanvasImage, PhotoFolder } from '@/lib/types';
import { DEFAULT_CURVES } from '@/lib/types';
import { useCanvasStore, selectImages, selectFolders } from '@/lib/stores/canvasStore';
import { useUIStore } from '@/lib/stores/uiStore';
import {
  FOLDER_COLORS, GRID_CONFIG, CELL_SIZE, CELL_HEIGHT,
  LAYOUT_IMPORT_MAX_WIDTH, LAYOUT_IMPORT_MAX_HEIGHT,
  SOCIAL_LAYOUT_PAGE_WIDTH,
  isSocialLayout, getSocialLayoutDimensions,
  calculateColsFromWidth, getFolderBorderHeight, calculateMinimumFolderSize,
  reflowImagesInFolder,
} from '@/lib/folders/folderLayout';
import {
  isDNG, decodeDNG, createThumbnailBlob, getThumbStoragePath, resizeImageForEditing,
} from '@/lib/utils/imageUtils';

interface UseUploadOptions {
  user: User | null;
  saveToHistory: () => void;
  resolveOverlapsAndReflow: (
    currentFolders: PhotoFolder[],
    currentImages: CanvasImage[],
    changedFolderId?: string,
    addedImageId?: string,
  ) => { folders: PhotoFolder[]; images: CanvasImage[] };
}

export function useUpload({ user, saveToHistory, resolveOverlapsAndReflow }: UseUploadOptions) {
  const queryClient = useQueryClient();
  const pendingFilesRef = useRef<File[]>([]);
  const folderFileInputRef = useRef<HTMLInputElement>(null);
  const skipNextPhotosLoadRef = useRef(false);

  // When label-photo API returns labels, update the image in state so filter search works without refresh
  const updateImageLabels = useCallback((storagePath: string, labels: string[]) => {
    useCanvasStore.getState().setImages((prev) =>
      prev.map((img) =>
        img.storagePath === storagePath || img.originalStoragePath === storagePath
          ? { ...img, labels }
          : img
      )
    );
  }, []);

  // Handle file upload - uploads to Supabase Storage
  // Show folder name prompt when uploading
  const handleFileUpload = useCallback(
    (files: FileList | null) => {
      console.log('handleFileUpload called with files:', files, 'length:', files?.length);

      if (!files || files.length === 0) {
        console.log('No files provided');
        return;
      }

      // Validate and COPY files into an array (FileList becomes empty when input is reset)
      const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/x-adobe-dng'];
      const validFiles = Array.from(files).filter(f => validTypes.includes(f.type) || f.name.toLowerCase().endsWith('.dng'));

      console.log('Valid files:', validFiles.length);

      if (validFiles.length === 0) {
        alert('Please upload JPEG, PNG, WebP, or DNG files only.');
        return;
      }

      // Store COPY of files in ref (not the live FileList reference)
      pendingFilesRef.current = validFiles;
      console.log('Stored in ref:', pendingFilesRef.current);
      const uiActions = useUIStore.getState();
      uiActions.setPendingFileCount(validFiles.length);
      uiActions.setNewFolderName('');
      uiActions.setShowFolderPrompt(true);
    },
    []
  );

  // Process files after folder name is entered
  const processFilesWithFolder = useCallback(
    async (folderName: string) => {
      const files = pendingFilesRef.current;
      if (!files || files.length === 0) {
        console.log('No pending files in ref');
        return;
      }

      const folders = useCanvasStore.getState().folders;
      const images = useCanvasStore.getState().images;
      const setImages = useCanvasStore.getState().setImages;
      const setFolders = useCanvasStore.getState().setFolders;
      const uiActions = useUIStore.getState();

      // Check for duplicate folder name
      const isDuplicate = folders.some(
        f => f.name.toLowerCase() === folderName.toLowerCase()
      );

      if (isDuplicate) {
        uiActions.setFolderNameError('A folder with this name already exists');
        return;
      }

      console.log('Processing files with folder:', folderName, 'Files:', files.length, files);

      uiActions.setFolderNameError('');
      uiActions.setShowFolderPrompt(false);
      uiActions.setIsUploading(true);

      // Calculate folder position - use simple fixed position for reliability
      // Position at top-left with some padding, accounting for existing folders
      const existingFolderCount = folders.length;
      const folderX = 100;
      const folderY = 100 + existingFolderCount * 500; // Stack folders vertically

      console.log('Folder position:', folderX, folderY);

      // Create the folder (we'll add images to state as each is ready so the UI updates progressively)
      const folderId = `folder-${Date.now()}`;
      const folderColor = FOLDER_COLORS[existingFolderCount % FOLDER_COLORS.length];
      const newImages: CanvasImage[] = [];
      let accumulatedImages: CanvasImage[] = [...images];

      // Grid layout for images within folder - using centralized config
      let imageIndex = 0;

      // files is already an array of validated files
      console.log('Files to process:', files.length);

      for (const file of files) {
        // Files are already validated, no need to check again

        try {
          console.log('Processing file:', file.name);

          // Extract EXIF metadata (client-side) for filter search
          let takenAt: string | undefined;
          let cameraMake: string | undefined;
          let cameraModel: string | undefined;
          try {
            const exif = await exifr.parse(file, { pick: ['DateTimeOriginal', 'Make', 'Model'] });
            if (exif?.DateTimeOriginal) {
              const d = exif.DateTimeOriginal;
              takenAt = d instanceof Date ? d.toISOString() : String(d);
            }
            if (exif?.Make) cameraMake = String(exif.Make).trim();
            if (exif?.Model) cameraModel = String(exif.Model).trim();
          } catch {
            // ignore EXIF errors
          }

          // Generate unique filename with user folder
          const fileExt = file.name.split('.').pop();
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
          const filePath = user ? `${user.id}/${fileName}` : `anonymous/${fileName}`;

          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          let imageSrc = '';
          let photosUploadSucceeded = false;

          // Skip direct upload for DNG files - they go through the API which creates JPG previews
          if (!isDNG(file.name) && supabaseUrl && user) {
            console.log('Uploading to Supabase:', filePath);
            const { data: uploadData, error: uploadError } = await supabase.storage
              .from('photos')
              .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false,
              });

            if (uploadError) {
              console.error('Upload error:', uploadError.message);
              // Fallback to base64
              const reader = new FileReader();
              imageSrc = await new Promise<string>((resolve) => {
                reader.onload = (e) => resolve(e.target?.result as string);
                reader.readAsDataURL(file);
              });
            } else {
              photosUploadSucceeded = true;
              console.log('Upload successful:', uploadData);
              const { data: urlData } = supabase.storage
                .from('photos')
                .getPublicUrl(filePath);
              imageSrc = urlData.publicUrl;
              console.log('Public URL:', imageSrc);
              // Upload thumbnail in background (reduces egress when loading grid)
              createThumbnailBlob(file).then((thumbBlob) => {
                const thumbPath = getThumbStoragePath(filePath);
                supabase.storage.from('photos').upload(thumbPath, thumbBlob, {
                  contentType: 'image/jpeg',
                  cacheControl: '86400',
                  upsert: true,
                }).then(({ error }) => {
                  if (error) console.warn('Thumb upload failed:', error);
                });
              }).catch(() => {});
            }
          } else if (!isDNG(file.name)) {
            console.log('Using base64 (no Supabase or not logged in)');
            const reader = new FileReader();
            imageSrc = await new Promise<string>((resolve) => {
              reader.onload = (e) => resolve(e.target?.result as string);
              reader.readAsDataURL(file);
            });
          }

          // Load image to get dimensions
          console.log('Loading image to get dimensions...');
          let width: number;
          let height: number;
          let dngBuffer: ArrayBuffer | undefined;

          // DNG/RAW support variables
          let originalStoragePath: string | undefined;
          let previewStoragePath: string | undefined;
          let isRaw = false;
          let originalWidth: number | undefined;
          let originalHeight: number | undefined;

          // Check if file is DNG - use server-side processing for better performance
          if (isDNG(file.name) && user) {
            console.log('Processing DNG file via server:', file.name);
            isRaw = true;

            try {
              // Upload to server API for processing
              const formData = new FormData();
              formData.append('file', file);
              formData.append('userId', user.id);

              const response = await fetch('/api/upload-dng', {
                method: 'POST',
                body: formData,
              });

              if (response.ok) {
                const result = await response.json();
                originalStoragePath = result.originalPath;
                previewStoragePath = result.previewPath ?? undefined;
                originalWidth = result.originalWidth;
                originalHeight = result.originalHeight;
                if (result.previewUrl) {
                  imageSrc = result.previewUrl;
                  width = result.width;
                  height = result.height;
                  console.log('DNG processed via server:', width, 'x', height, 'original:', originalWidth, 'x', originalHeight);
                } else {
                  // Original saved to originals; no server preview — decode client-side and upload preview
                  console.log('DNG saved to originals, decoding preview client-side');
                  const buffer = await file.arrayBuffer();
                  dngBuffer = buffer;
                  const decoded = await decodeDNG(buffer, true);
                  imageSrc = decoded.dataUrl;
                  width = decoded.width;
                  height = decoded.height;

                  // Upload client-decoded preview to photos bucket (background, don't block display)
                  const previewFileName = `${Date.now()}-${Math.random().toString(36).substring(7)}-preview.jpg`;
                  const previewFilePath = `${user.id}/${previewFileName}`;
                  previewStoragePath = previewFilePath; // Set optimistically for immediate use
                  fetch(decoded.dataUrl).then(r => r.blob()).then(previewBlob => {
                    supabase.storage.from('photos').upload(previewFilePath, previewBlob, {
                      contentType: 'image/jpeg',
                      cacheControl: '3600',
                    }).then(({ error }) => {
                      if (error) {
                        console.error('Failed to upload preview:', error);
                        previewStoragePath = undefined; // Clear if upload failed
                      } else {
                        console.log('Uploaded client-decoded preview:', previewFilePath);
                      }
                    });
                  });
                }
              } else {
                // Fallback to client-side decoding
                console.warn('Server DNG processing failed, falling back to client-side');
                const buffer = await file.arrayBuffer();
                dngBuffer = buffer;
                const decoded = await decodeDNG(buffer, true);
                imageSrc = decoded.dataUrl;
                width = decoded.width;
                height = decoded.height;

                // Upload client-decoded preview to photos bucket (background, don't block display)
                const previewFileName = `${Date.now()}-${Math.random().toString(36).substring(7)}-preview.jpg`;
                const previewFilePath = `${user.id}/${previewFileName}`;
                previewStoragePath = previewFilePath; // Set optimistically for immediate use
                fetch(decoded.dataUrl).then(r => r.blob()).then(previewBlob => {
                  supabase.storage.from('photos').upload(previewFilePath, previewBlob, {
                    contentType: 'image/jpeg',
                    cacheControl: '3600',
                  }).then(({ error }) => {
                    if (error) {
                      console.error('Failed to upload preview:', error);
                      previewStoragePath = undefined; // Clear if upload failed
                    } else {
                      console.log('Uploaded client-decoded preview:', previewFilePath);
                    }
                  });
                });
              }
            } catch (apiError) {
              // Fallback to client-side decoding
              console.warn('Server DNG API error, falling back to client-side:', apiError);
              const buffer = await file.arrayBuffer();
              dngBuffer = buffer;
              const decoded = await decodeDNG(buffer, true);
              imageSrc = decoded.dataUrl;
              width = decoded.width;
              height = decoded.height;

              // Upload client-decoded preview to photos bucket (background, don't block display)
              const previewFileName = `${Date.now()}-${Math.random().toString(36).substring(7)}-preview.jpg`;
              const previewFilePath = `${user.id}/${previewFileName}`;
              previewStoragePath = previewFilePath; // Set optimistically for immediate use
              fetch(decoded.dataUrl).then(r => r.blob()).then(previewBlob => {
                supabase.storage.from('photos').upload(previewFilePath, previewBlob, {
                  contentType: 'image/jpeg',
                  cacheControl: '3600',
                }).then(({ error }) => {
                  if (error) {
                    console.error('Failed to upload preview:', error);
                    previewStoragePath = undefined; // Clear if upload failed
                  } else {
                    console.log('Uploaded client-decoded preview:', previewFilePath);
                  }
                });
              });
            }
          } else if (isDNG(file.name)) {
            // Client-side fallback for DNG when not logged in
            console.log('Decoding DNG file (client-side preview):', file.name);
            const buffer = await file.arrayBuffer();
            dngBuffer = buffer;
            const decoded = await decodeDNG(buffer, true);
            imageSrc = decoded.dataUrl;
            width = decoded.width;
            height = decoded.height;
            console.log('DNG preview decoded:', width, 'x', height);
          } else {
            // Regular image - resize for editing if needed (Lightroom-style smart preview)
            console.log('Loading and potentially resizing image for editing...');
            const resized = await resizeImageForEditing(imageSrc, 1500);
            imageSrc = resized.src; // Use resized version for editing
            width = resized.width;
            height = resized.height;
            console.log('Image ready for editing:', width, 'x', height);
          }

          // UNIVERSAL RESIZE: Ensure ALL images (including DNG previews) are resized for editing
          // This catches any images that went through DNG decoding or server preview paths
          if (width > 1500 || height > 1500) {
            console.log('Resizing large image/DNG preview for editing:', width, 'x', height);
            const resized = await resizeImageForEditing(imageSrc, 1500);
            imageSrc = resized.src;
            width = resized.width;
            height = resized.height;
            console.log('Resized to:', width, 'x', height);
          }

          // Keep original source for quality; only scale display size to fit layout bounds
          const layoutScale = Math.min(
            LAYOUT_IMPORT_MAX_WIDTH / width,
            LAYOUT_IMPORT_MAX_HEIGHT / height,
            1
          );
          width = Math.round(width * layoutScale);
          height = Math.round(height * layoutScale);

          // Position within folder grid (below the folder label) - using folder width
          const cols = calculateColsFromWidth(GRID_CONFIG.defaultFolderWidth);
          const col = imageIndex % cols;
          const row = Math.floor(imageIndex / cols);

          // Center images horizontally in their cells, top-aligned vertically
          const contentStartX = folderX + GRID_CONFIG.folderPadding;
          const contentStartY = folderY + 30 + GRID_CONFIG.folderPadding;
          // Compute display width for centering (image will be scaled to uniform row height)
          const fitScale = Math.min(GRID_CONFIG.imageMaxSize / width, GRID_CONFIG.imageMaxHeight / height, 1);
          const displayW = width * fitScale;
          const cellOffsetX = (GRID_CONFIG.imageMaxSize - displayW) / 2;
          const x = contentStartX + col * CELL_SIZE + Math.max(0, cellOffsetX);
          const y = contentStartY + row * CELL_HEIGHT;

          console.log('Image position:', x, y, 'Size:', width, height);

          // Use actual photos upload success so DNG with client-side preview still gets photos path (load matches by listing photos)
          const imageId = `img-${Date.now()}-${Math.random()}`;

          const newImage: CanvasImage = {
            id: imageId,
            x,
            y,
            width,
            height,
            src: imageSrc,
            storagePath: previewStoragePath || (photosUploadSucceeded ? filePath : undefined),
            folderId: folderId, // Link to folder
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            exposure: 0,
            contrast: 0,
            highlights: 0,
            shadows: 0,
            whites: 0,
            blacks: 0,
            temperature: 0,
            vibrance: 0,
            saturation: 0,
            clarity: 0,
            dehaze: 0,
            vignette: 0,
            grain: 0,
            curves: { ...DEFAULT_CURVES },
            brightness: 0,
            hue: 0,
            blur: 0,
            filters: [],
            // DNG/RAW support
            originalStoragePath,
            isRaw,
            originalWidth,
            originalHeight,
            originalDngBuffer: dngBuffer, // Legacy: client-side fallback
            takenAt,
            cameraMake,
            cameraModel,
          };

          newImages.push(newImage);
          accumulatedImages = [...accumulatedImages, newImage];
          imageIndex++;

          // Show this image in the UI immediately (progressive display)
          const folderWithImages: PhotoFolder = {
            id: folderId,
            name: folderName,
            x: folderX,
            y: folderY,
            width: GRID_CONFIG.defaultFolderWidth,
            imageIds: newImages.map(img => img.id),
            color: folderColor,
            height: 30 + getFolderBorderHeight(
              { id: folderId, name: folderName, x: folderX, y: folderY, width: GRID_CONFIG.defaultFolderWidth, imageIds: newImages.map(img => img.id), color: folderColor },
              newImages.length
            ),
          };
          setImages(accumulatedImages);
          setFolders((prev) => {
            const without = prev.filter((f) => f.id !== folderId);
            return [...without, folderWithImages];
          });
        } catch (error) {
          console.error('Error processing file:', file.name, error);
        }
      }

      console.log('Processed images:', newImages.length);

      // Final overlap resolution and save (folder already in state with all images)
      if (newImages.length > 0) {
        const newFolder: PhotoFolder = {
          id: folderId,
          name: folderName,
          x: folderX,
          y: folderY,
          width: GRID_CONFIG.defaultFolderWidth,
          imageIds: newImages.map(img => img.id),
          color: folderColor,
        };

        const allImages = [...images, ...newImages];
        const allFolders = [...folders.filter((f) => f.id !== folderId), newFolder];
        const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
          allFolders,
          allImages,
          folderId
        );

        setImages(resolvedImages);
        setFolders(resolvedFolders);

        // Save folder and photo_edits to Supabase after reflow (so x,y match what's on canvas)
        if (user) {
          const resolvedFolder = resolvedFolders.find(f => f.id === folderId);
          if (resolvedFolder) {
            const { error: folderError } = await supabase
              .from('photo_folders')
              .upsert({
                id: folderId,
                user_id: user.id,
                name: folderName,
                x: Math.round(resolvedFolder.x),
                y: Math.round(resolvedFolder.y),
                width: Math.round(resolvedFolder.width ?? GRID_CONFIG.defaultFolderWidth),
                height: resolvedFolder.height != null ? Math.round(resolvedFolder.height) : undefined,
                color: folderColor,
              });
            if (folderError) console.error('Error saving folder:', folderError);
          }

          const imagesToSave = resolvedImages.filter(
            img => (img.storagePath || img.originalStoragePath) && newImages.some(n => n.id === img.id)
          );
          if (imagesToSave.length > 0) {
            const editsToSave = imagesToSave.map(img => ({
              storage_path: img.storagePath || img.originalStoragePath!,
              user_id: user.id,
              folder_id: folderId,
              x: Math.round(img.x),
              y: Math.round(img.y),
              width: Math.round(img.width),
              height: Math.round(img.height),
              rotation: img.rotation,
              scale_x: img.scaleX,
              scale_y: img.scaleY,
              exposure: img.exposure,
              contrast: img.contrast,
              highlights: img.highlights,
              shadows: img.shadows,
              whites: img.whites,
              blacks: img.blacks,
              texture: img.texture ?? 0,
              temperature: img.temperature,
              vibrance: img.vibrance,
              saturation: img.saturation,
              shadow_tint: img.shadowTint ?? 0,
              color_hsl: img.colorHSL ?? null,
              split_toning: img.splitToning ?? null,
              color_grading: img.colorGrading ?? null,
              color_calibration: img.colorCalibration ?? null,
              clarity: img.clarity,
              dehaze: img.dehaze,
              vignette: img.vignette,
              grain: img.grain,
              grain_size: img.grainSize ?? 0,
              grain_roughness: img.grainRoughness ?? 0,
              curves: img.curves,
              brightness: img.brightness,
              hue: img.hue,
              blur: img.blur,
              filters: img.filters,
              original_storage_path: img.originalStoragePath ?? null,
              is_raw: img.isRaw ?? false,
              original_width: img.originalWidth ?? null,
              original_height: img.originalHeight ?? null,
              taken_at: img.takenAt ?? null,
              camera_make: img.cameraMake ?? null,
              camera_model: img.cameraModel ?? null,
              // Border
              border_width: img.borderWidth ?? null,
              border_color: img.borderColor ?? null,
            }));
            const { error: editsError } = await supabase
              .from('photo_edits')
              .upsert(editsToSave, { onConflict: 'storage_path,user_id' });
            if (editsError) console.error('Error saving photo edits:', editsError);
          }
        }

        if (user) {
          skipNextPhotosLoadRef.current = true;
          queryClient.invalidateQueries({ queryKey: ['user-photos', user.id] });
        }
        setTimeout(() => saveToHistory(), 100);
      } else {
        console.log('No images were processed successfully');
      }

      pendingFilesRef.current = [];
      uiActions.setIsUploading(false);
    },
    [user, saveToHistory, resolveOverlapsAndReflow, queryClient, updateImageLabels]
  );

  // Add files to an existing folder
  const addFilesToExistingFolder = useCallback(
    async (folderId: string) => {
      const files = pendingFilesRef.current;
      if (!files || files.length === 0) return;

      const folders = useCanvasStore.getState().folders;
      const images = useCanvasStore.getState().images;
      const setImages = useCanvasStore.getState().setImages;
      const setFolders = useCanvasStore.getState().setFolders;
      const uiActions = useUIStore.getState();

      const targetFolder = folders.find(f => f.id === folderId);
      if (!targetFolder) return;

      uiActions.setShowFolderPrompt(false);
      uiActions.setSelectedExistingFolderId(null);
      uiActions.setIsUploading(true);

      const newImages: CanvasImage[] = [];

      // Find how many images already exist in folder to continue grid layout
      let imageIndex = targetFolder.imageIds.length;
      const folderX = targetFolder.x;
      const folderY = targetFolder.y;

      for (const file of files) {
        try {
          // Extract EXIF metadata (client-side) for filter search — same as new-folder flow
          let takenAt: string | undefined;
          let cameraMake: string | undefined;
          let cameraModel: string | undefined;
          try {
            const exif = await exifr.parse(file, { pick: ['DateTimeOriginal', 'Make', 'Model'] });
            if (exif?.DateTimeOriginal) {
              const d = exif.DateTimeOriginal;
              takenAt = d instanceof Date ? d.toISOString() : String(d);
            }
            if (exif?.Make) cameraMake = String(exif.Make).trim();
            if (exif?.Model) cameraModel = String(exif.Model).trim();
          } catch {
            // ignore EXIF errors
          }

          const fileExt = file.name.split('.').pop();
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
          const filePath = user ? `${user.id}/${fileName}` : `anonymous/${fileName}`;

          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          let imageSrc = '';
          let photosUploadSucceeded = false;
          let storagePath: string | undefined;
          let originalStoragePath: string | undefined;
          let isRaw = false;
          let originalWidth: number | undefined;
          let originalHeight: number | undefined;
          let dngBuffer: ArrayBuffer | undefined;

          // DNG: use upload-dng API so raw goes to originals, preview to photos (never put raw DNG in photos)
          if (isDNG(file.name) && user) {
            try {
              const formData = new FormData();
              formData.append('file', file);
              formData.append('userId', user.id);
              const response = await fetch('/api/upload-dng', {
                method: 'POST',
                body: formData,
              });
              if (response.ok) {
                const result = await response.json();
                originalStoragePath = result.originalPath;
                storagePath = result.previewPath ?? undefined;
                originalWidth = result.originalWidth;
                originalHeight = result.originalHeight;
                isRaw = true;
                if (result.previewUrl) {
                  imageSrc = result.previewUrl;
                  photosUploadSucceeded = !!result.previewPath;
                } else {
                  const buffer = await file.arrayBuffer();
                  dngBuffer = buffer;
                  const decoded = await decodeDNG(buffer, true);
                  imageSrc = decoded.dataUrl;
                  const previewFileName = `${Date.now()}-${Math.random().toString(36).substring(7)}-preview.jpg`;
                  const previewFilePath = `${user.id}/${previewFileName}`;
                  storagePath = previewFilePath; // Set optimistically for immediate use
                  fetch(decoded.dataUrl).then(r => r.blob()).then(previewBlob => {
                    supabase.storage.from('photos').upload(previewFilePath, previewBlob, {
                      contentType: 'image/jpeg',
                      cacheControl: '3600',
                    }).then(({ error }) => {
                      if (!error) {
                        storagePath = previewFilePath;
                        photosUploadSucceeded = true;
                      }
                    });
                  });
                }
              }
            } catch {
              // Fallback: decode client-side, upload preview only; original stays only in memory (no originals bucket)
              const buffer = await file.arrayBuffer();
              dngBuffer = buffer;
              const decoded = await decodeDNG(buffer, true);
              imageSrc = decoded.dataUrl;
              const previewFileName = `${Date.now()}-${Math.random().toString(36).substring(7)}-preview.jpg`;
              const previewFilePath = `${user.id}/${previewFileName}`;
              storagePath = previewFilePath; // Set optimistically for immediate use
              photosUploadSucceeded = true;
              fetch(decoded.dataUrl).then(r => r.blob()).then(previewBlob => {
                supabase.storage.from('photos').upload(previewFilePath, previewBlob, {
                  contentType: 'image/jpeg',
                  cacheControl: '3600',
                }).then(({ error }) => {
                  if (error) {
                    console.error('Failed to upload preview:', error);
                    storagePath = undefined; // Clear if upload failed
                    photosUploadSucceeded = false;
                  } else {
                    console.log('Uploaded client-decoded preview:', previewFilePath);
                  }
                });
              });
              isRaw = true;
            }
          } else if (supabaseUrl && user && !isDNG(file.name)) {
            const { error: uploadError } = await supabase.storage
              .from('photos')
              .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false,
              });

            if (uploadError) {
              const reader = new FileReader();
              imageSrc = await new Promise<string>((resolve) => {
                reader.onload = (e) => resolve(e.target?.result as string);
                reader.readAsDataURL(file);
              });
            } else {
              photosUploadSucceeded = true;
              storagePath = filePath;
              const { data: urlData } = supabase.storage
                .from('photos')
                .getPublicUrl(filePath);
              imageSrc = urlData.publicUrl;
              createThumbnailBlob(file).then((thumbBlob) => {
                const thumbPath = getThumbStoragePath(filePath);
                supabase.storage.from('photos').upload(thumbPath, thumbBlob, {
                  contentType: 'image/jpeg',
                  cacheControl: '86400',
                  upsert: true,
                }).then(({ error }) => { if (error) console.warn('Thumb upload failed:', error); });
              }).catch(() => {});
            }
          } else {
            const reader = new FileReader();
            imageSrc = await new Promise<string>((resolve) => {
              reader.onload = (e) => resolve(e.target?.result as string);
              reader.readAsDataURL(file);
            });
          }

          let width: number;
          let height: number;

          if (isDNG(file.name)) {
            const dims = await new Promise<{ w: number; h: number }>((resolve) => {
              const img = new window.Image();
              img.onload = () => resolve({ w: img.width, h: img.height });
              img.onerror = () => resolve({ w: 0, h: 0 });
              img.src = imageSrc;
            });
            width = dims.w;
            height = dims.h;
          } else {
            const img = new window.Image();
            img.crossOrigin = 'anonymous';

            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error('Failed to load image'));
              img.src = imageSrc;
            });
            width = img.width;
            height = img.height;
          }

          // Keep original source for quality; only scale display size to fit layout bounds
          const layoutScale = Math.min(
            LAYOUT_IMPORT_MAX_WIDTH / width,
            LAYOUT_IMPORT_MAX_HEIGHT / height,
            1
          );
          width = Math.round(width * layoutScale);
          height = Math.round(height * layoutScale);

          let x: number;
          let y: number;
          if (isSocialLayout(targetFolder)) {
            const contentTop = folderY + 30;
            const { pageHeight } = getSocialLayoutDimensions();
            const centerY = contentTop + pageHeight / 2;
            const firstPageCenterX = folderX + SOCIAL_LAYOUT_PAGE_WIDTH / 2;
            const offsetIndex = imageIndex - targetFolder.imageIds.length;
            x = firstPageCenterX - width / 2;
            y = centerY - height / 2 + offsetIndex * 24;
          } else {
            const cols = calculateColsFromWidth(targetFolder.width);
            const col = imageIndex % cols;
            const row = Math.floor(imageIndex / cols);
            const contentStartX = folderX + GRID_CONFIG.folderPadding;
            const contentStartY = folderY + 30 + GRID_CONFIG.folderPadding;
            const fitScale = Math.min(GRID_CONFIG.imageMaxSize / width, GRID_CONFIG.imageMaxHeight / height, 1);
            const displayW = width * fitScale;
            const cellOffsetX = (GRID_CONFIG.imageMaxSize - displayW) / 2;
            x = contentStartX + col * CELL_SIZE + Math.max(0, cellOffsetX);
            y = contentStartY + row * CELL_HEIGHT;
          }

          const imageId = `img-${Date.now()}-${Math.random()}`;

          const newImage: CanvasImage = {
            id: imageId,
            x,
            y,
            width,
            height,
            src: imageSrc,
            storagePath: storagePath ?? (photosUploadSucceeded ? filePath : undefined),
            folderId: folderId,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            exposure: 0,
            contrast: 0,
            highlights: 0,
            shadows: 0,
            whites: 0,
            blacks: 0,
            temperature: 0,
            vibrance: 0,
            saturation: 0,
            clarity: 0,
            dehaze: 0,
            vignette: 0,
            grain: 0,
            curves: { ...DEFAULT_CURVES },
            brightness: 0,
            hue: 0,
            blur: 0,
            filters: [],
            originalStoragePath: originalStoragePath ?? undefined,
            isRaw: isRaw || undefined,
            originalWidth,
            originalHeight,
            originalDngBuffer: dngBuffer,
            takenAt: takenAt ?? undefined,
            cameraMake: cameraMake ?? undefined,
            cameraModel: cameraModel ?? undefined,
          };

          newImages.push(newImage);
          imageIndex++;
        } catch (error) {
          console.error('Error processing file:', file.name, error);
        }
      }

      if (newImages.length > 0) {
        const totalImageCount = targetFolder.imageIds.length + newImages.length;
        const minSize = calculateMinimumFolderSize(totalImageCount, targetFolder.width);
        const currentHeight = targetFolder.height ?? getFolderBorderHeight(targetFolder, targetFolder.imageIds.length);
        const needsResize = !isSocialLayout(targetFolder) &&
          (minSize.width > targetFolder.width || minSize.height > currentHeight);

        const updatedFolders = folders.map((f) => {
          if (f.id !== folderId) return f;
          if (isSocialLayout(f)) {
            return { ...f, imageIds: [...f.imageIds, ...newImages.map(img => img.id)] };
          }
          return {
            ...f,
            imageIds: [...f.imageIds, ...newImages.map(img => img.id)],
            width: needsResize ? Math.max(f.width, minSize.width) : f.width,
            height: needsResize ? Math.max(currentHeight, minSize.height) : f.height,
          };
        });

        const allImages = [...images, ...newImages];

        // If folder was resized, reflow all images in the folder
        let finalImages = allImages;
        if (needsResize) {
          const updatedFolder = updatedFolders.find(f => f.id === folderId)!;
          const allFolderImages = allImages.filter(img => updatedFolder.imageIds.includes(img.id));
          const reflowedImages = isSocialLayout(updatedFolder)
            ? allFolderImages
            : reflowImagesInFolder(
              allFolderImages,
              updatedFolder.x,
              updatedFolder.y,
              updatedFolder.width
            );
          finalImages = allImages.map(img => {
            const reflowed = reflowedImages.find(r => r.id === img.id);
            return reflowed ? reflowed : img;
          });
        }

        // Resolve any folder overlaps (folder got bigger)
        const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
          updatedFolders,
          finalImages,
          folderId
        );

        setFolders(resolvedFolders);
        setImages(resolvedImages);

        // Save photo edits and folder dimensions to Supabase (includes ALL editable fields)
        if (user) {
          // Save new images (canonical key: photos path or originals path)
          const imagesToSave = newImages.filter(img => img.storagePath || img.originalStoragePath);
          if (imagesToSave.length > 0) {
            const editsToSave = imagesToSave.map(img => ({
              storage_path: img.storagePath || img.originalStoragePath!,
              user_id: user.id,
              folder_id: folderId,
              x: Math.round(img.x),
              y: Math.round(img.y),
              width: Math.round(img.width),
              height: Math.round(img.height),
              rotation: img.rotation,
              scale_x: img.scaleX,
              scale_y: img.scaleY,
              // Light
              exposure: img.exposure,
              contrast: img.contrast,
              highlights: img.highlights,
              shadows: img.shadows,
              whites: img.whites,
              blacks: img.blacks,
              texture: img.texture ?? 0,
              // Color
              temperature: img.temperature,
              vibrance: img.vibrance,
              saturation: img.saturation,
              shadow_tint: img.shadowTint ?? 0,
              color_hsl: img.colorHSL ?? null,
              split_toning: img.splitToning ?? null,
              color_grading: img.colorGrading ?? null,
              color_calibration: img.colorCalibration ?? null,
              // Effects
              clarity: img.clarity,
              dehaze: img.dehaze,
              vignette: img.vignette,
              grain: img.grain,
              grain_size: img.grainSize ?? 0,
              grain_roughness: img.grainRoughness ?? 0,
              // Curves
              curves: img.curves,
              // Legacy
              brightness: img.brightness,
              hue: img.hue,
              blur: img.blur,
              filters: img.filters,
              // DNG/RAW support
              original_storage_path: img.originalStoragePath ?? null,
              is_raw: img.isRaw ?? false,
              original_width: img.originalWidth ?? null,
              original_height: img.originalHeight ?? null,
              // Filter search: metadata + AI labels
              taken_at: img.takenAt ?? null,
              camera_make: img.cameraMake ?? null,
              camera_model: img.cameraModel ?? null,
              // Border
              border_width: img.borderWidth ?? null,
              border_color: img.borderColor ?? null,
            }));

            const { error: editsError } = await supabase
              .from('photo_edits')
              .upsert(editsToSave, { onConflict: 'storage_path,user_id' });
            if (editsError) console.error('Error saving photo edits:', editsError);
          }

          // Update folder dimensions if they changed
          if (needsResize) {
            const updatedFolder = resolvedFolders.find(f => f.id === folderId);
            if (updatedFolder) {
              await supabase
                .from('photo_folders')
                .update({
                  width: Math.round(updatedFolder.width),
                  ...(updatedFolder.height != null && { height: Math.round(updatedFolder.height) }),
                })
                .eq('id', folderId)
                .eq('user_id', user.id);
            }
          }

          // Update positions of existing images if folder was reflowed (canonical key)
          if (needsResize) {
            const existingFolderImages = resolvedImages.filter(
              img => img.folderId === folderId && (img.storagePath || img.originalStoragePath) && !newImages.find(n => n.id === img.id)
            );
            for (const img of existingFolderImages) {
              const canonicalPath = img.storagePath || img.originalStoragePath!;
              await supabase
                .from('photo_edits')
                .update({ x: Math.round(img.x), y: Math.round(img.y) })
                .eq('storage_path', canonicalPath)
                .eq('user_id', user.id);
            }
          }
        }

        if (user) {
          skipNextPhotosLoadRef.current = true;
          queryClient.invalidateQueries({ queryKey: ['user-photos', user.id] });
        }
        setTimeout(() => saveToHistory(), 100);
      }

      pendingFilesRef.current = [];
      uiActions.setIsUploading(false);
    },
    [user, saveToHistory, resolveOverlapsAndReflow, queryClient, updateImageLabels]
  );

  // Handle adding photos to a specific folder via plus button
  const handleAddPhotosToFolder = useCallback((folderId: string) => {
    console.log('handleAddPhotosToFolder called with folderId:', folderId);
    if (folderFileInputRef.current) {
      folderFileInputRef.current.setAttribute('data-folder-id', folderId);
      folderFileInputRef.current.click();
      console.log('File input clicked');
    } else {
      console.error('folderFileInputRef.current is null');
    }
  }, []);

  // Handle file selection for folder plus button
  const handleFolderFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const folderId = e.target.getAttribute('data-folder-id');
      if (!folderId || !e.target.files || e.target.files.length === 0) {
        if (folderFileInputRef.current) {
          folderFileInputRef.current.value = '';
        }
        return;
      }

      // Validate files
      const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/x-adobe-dng'];
      const validFiles = Array.from(e.target.files).filter(f => validTypes.includes(f.type) || f.name.toLowerCase().endsWith('.dng'));

      if (validFiles.length === 0) {
        alert('Please upload JPEG, PNG, WebP, or DNG files only.');
        if (folderFileInputRef.current) {
          folderFileInputRef.current.value = '';
        }
        return;
      }

      // Store files in ref and call addFilesToExistingFolder
      pendingFilesRef.current = validFiles;
      await addFilesToExistingFolder(folderId);

      // Reset input
      if (folderFileInputRef.current) {
        folderFileInputRef.current.value = '';
      }
    },
    [addFilesToExistingFolder]
  );

  // Handle drag and drop
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      handleFileUpload(files);
    },
    [handleFileUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return {
    handleFileUpload,
    processFilesWithFolder,
    addFilesToExistingFolder,
    handleAddPhotosToFolder,
    handleFolderFileSelect,
    handleDrop,
    handleDragOver,
    updateImageLabels,
    pendingFilesRef,
    folderFileInputRef,
    skipNextPhotosLoadRef,
  };
}
