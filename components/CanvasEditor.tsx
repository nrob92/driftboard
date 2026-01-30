'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Text, Transformer, Rect, Group } from 'react-konva';
import useImage from 'use-image';
import Konva from 'konva';
import { TopBar } from './TopBar';
import { EditPanel } from './EditPanel';
import { snapToGrid, findNearestPhoto } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

const GRID_SIZE = 50;

interface CurvePoint {
  x: number; // 0-255 input
  y: number; // 0-255 output
}

interface ChannelCurves {
  rgb: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
}

const DEFAULT_CURVES: ChannelCurves = {
  rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  red: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
};

interface CanvasImage {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
  storagePath?: string; // Path in Supabase storage (e.g., "user_id/filename.jpg")
  folderId?: string; // ID of the folder this image belongs to
  rotation: number;
  scaleX: number;
  scaleY: number;
  // Light adjustments
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  // Color adjustments
  temperature: number; // warm/cool
  vibrance: number;
  saturation: number;
  // Effects
  clarity: number;
  dehaze: number;
  vignette: number;
  grain: number;
  // Curves
  curves: ChannelCurves;
  // Legacy (keeping for compatibility)
  brightness: number;
  hue: number;
  blur: number;
  filters: string[];
}

// Edit data that gets saved to Supabase
interface PhotoEdits {
  storage_path: string;
  user_id: string;
  folder_id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale_x: number;
  scale_y: number;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number;
  vibrance: number;
  saturation: number;
  clarity: number;
  dehaze: number;
  vignette: number;
  grain: number;
  curves: ChannelCurves;
  brightness: number;
  hue: number;
  blur: number;
  filters: string[];
}

interface CanvasText {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fill: string;
  rotation: number;
}

interface PhotoFolder {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number; // Folder width - controls how many columns fit
  imageIds: string[]; // IDs of images in this folder
  color: string; // Accent color for the folder
}

const FOLDER_COLORS = [
  '#3ECF8E', // Green
  '#74c0fc', // Blue
  '#ff9f43', // Orange
  '#ff6b6b', // Red
  '#a78bfa', // Purple
  '#f472b6', // Pink
  '#fbbf24', // Yellow
  '#34d399', // Teal
];

// Centralized grid configuration - used everywhere for consistency
const GRID_CONFIG = {
  imageMaxSize: 140,  // Max width/height for images in grid
  imageGap: 12,       // Gap between images (same for horizontal and vertical)
  folderPadding: 15,  // Padding inside folder border
  defaultFolderWidth: 500, // Default folder width
  minFolderWidth: 180, // Minimum folder width (at least 1 image + padding)
  folderGap: 40,      // Minimum gap between folders
};
const CELL_SIZE = GRID_CONFIG.imageMaxSize + GRID_CONFIG.imageGap;

// Calculate columns based on folder width
const calculateColsFromWidth = (folderWidth: number): number => {
  const availableWidth = folderWidth - (GRID_CONFIG.folderPadding * 2);
  const cols = Math.floor((availableWidth + GRID_CONFIG.imageGap) / CELL_SIZE);
  return Math.max(1, cols);
};

// Reflow images within a folder based on its width
const reflowImagesInFolder = (
  folderImages: CanvasImage[],
  folderX: number,
  folderY: number,
  folderWidth: number
): CanvasImage[] => {
  const cols = calculateColsFromWidth(folderWidth);
  const { folderPadding, imageMaxSize } = GRID_CONFIG;
  
  // Border starts at folderX, so images start at folderX + folderPadding
  // Border is 30px below label (folderY), add padding for top of content area
  const contentStartX = folderX + folderPadding;
  const contentStartY = folderY + 30 + folderPadding; // 30px for label gap + padding
  
  return folderImages.map((img, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    
    // Center images in their cells
    const imgWidth = Math.min(img.width * img.scaleX, imageMaxSize);
    const imgHeight = Math.min(img.height * img.scaleY, imageMaxSize);
    const cellOffsetX = (imageMaxSize - imgWidth) / 2;
    const cellOffsetY = (imageMaxSize - imgHeight) / 2;
    
    return {
      ...img,
      x: contentStartX + col * CELL_SIZE + cellOffsetX,
      y: contentStartY + row * CELL_SIZE + cellOffsetY,
    };
  });
};

// Calculate folder bounding box (including label)
const getFolderBounds = (folder: PhotoFolder, imageCount: number) => {
  const cols = calculateColsFromWidth(folder.width);
  const rows = Math.ceil(imageCount / cols) || 1;
  const contentHeight = rows * CELL_SIZE + (GRID_CONFIG.folderPadding * 2);
  const height = 30 + Math.max(contentHeight, 100); // 30px for label gap
  
  return {
    x: folder.x,
    y: folder.y,
    width: folder.width,
    height: height,
    right: folder.x + folder.width,
    bottom: folder.y + height,
  };
};

// Check if two rectangles overlap
const rectsOverlap = (
  a: { x: number; y: number; right: number; bottom: number },
  b: { x: number; y: number; right: number; bottom: number },
  gap: number
): boolean => {
  return !(
    a.right + gap <= b.x ||
    b.right + gap <= a.x ||
    a.bottom + gap <= b.y ||
    b.bottom + gap <= a.y
  );
};

// Resolve folder overlaps by pushing folders apart in all directions
const resolveFolderOverlaps = (
  folders: PhotoFolder[],
  images: CanvasImage[],
  changedFolderId?: string
): PhotoFolder[] => {
  if (folders.length < 2) return folders;
  
  const { folderGap } = GRID_CONFIG;
  const updated = [...folders];
  let hasOverlap = true;
  let iterations = 0;
  const maxIterations = 20; // Reduced for smoother performance
  
  while (hasOverlap && iterations < maxIterations) {
    hasOverlap = false;
    iterations++;
    
    for (let i = 0; i < updated.length; i++) {
      const folderA = updated[i];
      const imageCountA = images.filter(img => folderA.imageIds.includes(img.id)).length;
      const boundsA = getFolderBounds(folderA, imageCountA);
      
      for (let j = i + 1; j < updated.length; j++) {
        const folderB = updated[j];
        const imageCountB = images.filter(img => folderB.imageIds.includes(img.id)).length;
        const boundsB = getFolderBounds(folderB, imageCountB);
        
        if (rectsOverlap(boundsA, boundsB, folderGap)) {
          hasOverlap = true;
          
          // Calculate centers
          const centerAX = boundsA.x + boundsA.width / 2;
          const centerAY = boundsA.y + boundsA.height / 2;
          const centerBX = boundsB.x + boundsB.width / 2;
          const centerBY = boundsB.y + boundsB.height / 2;
          
          // Determine which folder to move (prefer moving the one that wasn't changed)
          const moveB = changedFolderId === folderA.id || !changedFolderId;
          const mover = moveB ? folderB : folderA;
          const moverBounds = moveB ? boundsB : boundsA;
          const staticBounds = moveB ? boundsA : boundsB;
          const staticCenterX = moveB ? centerAX : centerBX;
          const staticCenterY = moveB ? centerAY : centerBY;
          const moverCenterX = moveB ? centerBX : centerAX;
          const moverCenterY = moveB ? centerBY : centerAY;
          
          // Calculate push direction based on relative position
          const dx = moverCenterX - staticCenterX;
          const dy = moverCenterY - staticCenterY;
          
          // Calculate the minimum push needed in each direction
          const pushRight = staticBounds.right + folderGap - moverBounds.x;
          const pushLeft = moverBounds.right + folderGap - staticBounds.x;
          const pushDown = staticBounds.bottom + folderGap - moverBounds.y;
          const pushUp = moverBounds.bottom + folderGap - staticBounds.y;
          
          // Choose direction based on where mover is relative to static
          // and which push distance is smallest
          let newX = mover.x;
          let newY = mover.y;
          
          if (Math.abs(dx) > Math.abs(dy)) {
            // More horizontal separation - push left or right
            if (dx > 0) {
              // Mover is to the right, push right
              newX = mover.x + pushRight;
            } else {
              // Mover is to the left, push left
              newX = mover.x - pushLeft;
            }
          } else {
            // More vertical separation - push up or down
            if (dy > 0) {
              // Mover is below, push down
              newY = mover.y + pushDown;
            } else {
              // Mover is above, push up
              newY = mover.y - pushUp;
            }
          }
          
          if (moveB) {
            updated[j] = { ...folderB, x: newX, y: newY };
          } else {
            updated[i] = { ...folderA, x: newX, y: newY };
          }
        }
      }
    }
  }
  
  return updated;
};

export function CanvasEditor() {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [images, setImages] = useState<CanvasImage[]>([]);
  const [texts, setTexts] = useState<CanvasText[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stageScale, setStageScale] = useState(1);
  const [stagePosition, setStagePosition] = useState({ x: 0, y: 0 });
  const [history, setHistory] = useState<{ images: CanvasImage[]; texts: CanvasText[]; folders: PhotoFolder[] }[]>([{ images: [], texts: [], folders: [] }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const lastOverlapCheckRef = useRef<number>(0);
  const folderNameDragRef = useRef<boolean>(false);
  const lastSwappedImageRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const overlapThrottleMs = 32; // ~30fps for smooth updates
  const [lastTouchDistance, setLastTouchDistance] = useState<number | null>(null);
  const [lastTouchCenter, setLastTouchCenter] = useState<{ x: number; y: number } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1920, height: 1080 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showHeader, setShowHeader] = useState(false);
  const [folders, setFolders] = useState<PhotoFolder[]>([]);
  const [showFolderPrompt, setShowFolderPrompt] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [pendingFileCount, setPendingFileCount] = useState(0);
  const pendingFilesRef = useRef<File[]>([]);
  const [editingFolder, setEditingFolder] = useState<PhotoFolder | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [selectedExistingFolderId, setSelectedExistingFolderId] = useState<string | null>(null);
  const [folderNameError, setFolderNameError] = useState('');
  const [dragHoveredFolderId, setDragHoveredFolderId] = useState<string | null>(null);
  const [resizingFolderId, setResizingFolderId] = useState<string | null>(null);
  const [hoveredFolderBorder, setHoveredFolderBorder] = useState<string | null>(null);
  const folderFileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  // Get window dimensions
  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Handle keyboard events for Spacebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(false);
        setIsDragging(false);
      }
    };

    // Also handle when Spacebar is released outside the window
    const handleBlur = () => {
      setIsSpacePressed(false);
      setIsDragging(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // Show header when mouse is near top
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Show header when mouse is within 60px of top
      setShowHeader(e.clientY < 60);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Auto-load user's photos from Supabase on login
  useEffect(() => {
    const loadUserPhotos = async () => {
      if (!user) return;

      try {
        // List files in user's folder
        const { data: files, error } = await supabase.storage
          .from('photos')
          .list(user.id, {
            limit: 50,
            sortBy: { column: 'created_at', order: 'asc' },
          });

        if (error || !files || files.length === 0) return;

        // Filter out hidden files and get URLs
        const validFiles = files.filter((f) => !f.name.startsWith('.'));
        
        // Load each image and add to canvas
        const newImages: CanvasImage[] = [];
        const cols = 3; // Number of columns in grid
        const spacing = 420; // Spacing between images

        for (let i = 0; i < validFiles.length; i++) {
          const file = validFiles[i];
          const { data: urlData } = supabase.storage
            .from('photos')
            .getPublicUrl(`${user.id}/${file.name}`);

          const imageUrl = urlData.publicUrl;

          // Load image to get dimensions
          try {
            const img = new window.Image();
            img.crossOrigin = 'anonymous';
            
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error('Failed to load'));
              img.src = imageUrl;
            });

            const maxWidth = 400;
            const maxHeight = 400;
            let width = img.width;
            let height = img.height;

            if (width > maxWidth || height > maxHeight) {
              const ratio = Math.min(maxWidth / width, maxHeight / height);
              width = width * ratio;
              height = height * ratio;
            }

            // Position in grid
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = 100 + col * spacing;
            const y = 100 + row * spacing;

            const storagePath = `${user.id}/${file.name}`;
            
            newImages.push({
              id: `img-${Date.now()}-${Math.random()}`,
              x,
              y,
              width,
              height,
              src: imageUrl,
              storagePath,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              // Light
              exposure: 0,
              contrast: 0,
              highlights: 0,
              shadows: 0,
              whites: 0,
              blacks: 0,
              // Color
              temperature: 0,
              vibrance: 0,
              saturation: 0,
              // Effects
              clarity: 0,
              dehaze: 0,
              vignette: 0,
              grain: 0,
              // Curves
              curves: { ...DEFAULT_CURVES },
              // Legacy
              brightness: 0,
              hue: 0,
              blur: 0,
              filters: [],
            });
          } catch {
            // Skip failed images
            console.log(`Failed to load image: ${file.name}`);
          }
        }

        // Load saved edits from database
        const { data: savedEdits, error: editsError } = await supabase
          .from('photo_edits')
          .select('*')
          .eq('user_id', user.id);
        
        console.log('Loaded edits from DB:', savedEdits, 'Error:', editsError);

        // Load saved folders from database
        const { data: savedFolders, error: foldersError } = await supabase
          .from('photo_folders')
          .select('*')
          .eq('user_id', user.id);
        
        console.log('Loaded folders from DB:', savedFolders, 'Error:', foldersError);

        // Apply saved edits to images
        if (savedEdits && savedEdits.length > 0) {
          for (const img of newImages) {
            const edit = savedEdits.find((e: PhotoEdits) => e.storage_path === img.storagePath);
            if (edit) {
              img.x = edit.x ?? img.x;
              img.y = edit.y ?? img.y;
              img.width = edit.width ?? img.width;
              img.height = edit.height ?? img.height;
              img.folderId = edit.folder_id ?? undefined;
              img.rotation = edit.rotation ?? 0;
              img.scaleX = edit.scale_x ?? 1;
              img.scaleY = edit.scale_y ?? 1;
              img.exposure = edit.exposure ?? 0;
              img.contrast = edit.contrast ?? 0;
              img.highlights = edit.highlights ?? 0;
              img.shadows = edit.shadows ?? 0;
              img.whites = edit.whites ?? 0;
              img.blacks = edit.blacks ?? 0;
              img.temperature = edit.temperature ?? 0;
              img.vibrance = edit.vibrance ?? 0;
              img.saturation = edit.saturation ?? 0;
              img.clarity = edit.clarity ?? 0;
              img.dehaze = edit.dehaze ?? 0;
              img.vignette = edit.vignette ?? 0;
              img.grain = edit.grain ?? 0;
              img.curves = edit.curves ?? { ...DEFAULT_CURVES };
              img.brightness = edit.brightness ?? 0;
              img.hue = edit.hue ?? 0;
              img.blur = edit.blur ?? 0;
              img.filters = edit.filters ?? [];
            }
          }
        }

        // Reconstruct folders from saved data
        const loadedFolders: PhotoFolder[] = [];
        if (savedFolders && savedFolders.length > 0) {
          console.log('Reconstructing folders...');
          for (const sf of savedFolders) {
            // Find all images that belong to this folder
            const folderImageIds = newImages
              .filter(img => img.folderId === sf.id)
              .map(img => img.id);
            
            console.log(`Folder "${sf.name}" (${sf.id}): found ${folderImageIds.length} images`);
            
            loadedFolders.push({
              id: sf.id,
              name: sf.name,
              x: sf.x,
              y: sf.y,
              width: sf.width ?? GRID_CONFIG.defaultFolderWidth,
              color: sf.color,
              imageIds: folderImageIds,
            });
          }
        }
        
        console.log('Final loaded folders:', loadedFolders);
        console.log('Images with folderIds:', newImages.map(img => ({ id: img.id, folderId: img.folderId })));

        if (newImages.length > 0) {
          setImages(newImages);
          setFolders(loadedFolders);
          // Update history with loaded state
          setHistory([{ images: newImages, texts: [], folders: loadedFolders }]);
          setHistoryIndex(0);
          
          // Center the viewport on the loaded content
          if (loadedFolders.length > 0) {
            // Calculate bounding box of all folders
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            
            for (const folder of loadedFolders) {
              const folderImgCount = newImages.filter(img => folder.imageIds.includes(img.id)).length;
              const bounds = getFolderBounds(folder, folderImgCount);
              minX = Math.min(minX, bounds.x);
              maxX = Math.max(maxX, bounds.right);
              minY = Math.min(minY, bounds.y);
              maxY = Math.max(maxY, bounds.bottom);
            }
            
            // Calculate center of all content
            const contentCenterX = (minX + maxX) / 2;
            const contentCenterY = (minY + maxY) / 2;
            
            // Pan so content is centered in viewport
            const viewportCenterX = window.innerWidth / 2;
            const viewportCenterY = window.innerHeight / 2;
            
            setStagePosition({
              x: viewportCenterX - contentCenterX,
              y: viewportCenterY - contentCenterY,
            });
          }
        }
      } catch (err) {
        console.error('Error loading user photos:', err);
      }
    };

    loadUserPhotos();
  }, [user]);

  // Save state to history
  const saveToHistory = useCallback(() => {
    setHistory((prevHistory) => {
      const newHistory = prevHistory.slice(0, historyIndex + 1);
      newHistory.push({ images: [...images], texts: [...texts], folders: [...folders] });
      setHistoryIndex(newHistory.length - 1);
      return newHistory;
    });
  }, [images, texts, folders, historyIndex]);

  // Resolve folder overlaps and reflow all affected images
  const resolveOverlapsAndReflow = useCallback((
    currentFolders: PhotoFolder[],
    currentImages: CanvasImage[],
    changedFolderId?: string
  ): { folders: PhotoFolder[]; images: CanvasImage[] } => {
    // First resolve overlaps
    const resolvedFolders = resolveFolderOverlaps(currentFolders, currentImages, changedFolderId);
    
    // Then reflow images in folders that moved
    let updatedImages = [...currentImages];
    for (let i = 0; i < resolvedFolders.length; i++) {
      const newFolder = resolvedFolders[i];
      const oldFolder = currentFolders.find(f => f.id === newFolder.id);
      
      // If folder position changed, reflow its images
      if (oldFolder && (oldFolder.x !== newFolder.x || oldFolder.y !== newFolder.y)) {
        const folderImgs = updatedImages.filter(img => newFolder.imageIds.includes(img.id));
        if (folderImgs.length > 0) {
          const reflowed = reflowImagesInFolder(folderImgs, newFolder.x, newFolder.y, newFolder.width);
          updatedImages = updatedImages.map(img => {
            const r = reflowed.find(ri => ri.id === img.id);
            return r || img;
          });
        }
      }
    }
    
    return { folders: resolvedFolders, images: updatedImages };
  }, []);

  // Undo
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prevState = history[historyIndex - 1];
      setImages([...prevState.images]);
      setTexts([...prevState.texts]);
      setFolders([...(prevState.folders || [])]);
      setHistoryIndex(historyIndex - 1);
      setSelectedId(null);
    }
  }, [history, historyIndex]);

  // Redo
  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextState = history[historyIndex + 1];
      setImages([...nextState.images]);
      setTexts([...nextState.texts]);
      setFolders([...(nextState.folders || [])]);
      setHistoryIndex(historyIndex + 1);
      setSelectedId(null);
    }
  }, [history, historyIndex]);

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
      const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
      const validFiles = Array.from(files).filter(f => validTypes.includes(f.type));
      
      console.log('Valid files:', validFiles.length);
      
      if (validFiles.length === 0) {
        alert('Please upload JPEG, PNG, or WebP files only.');
        return;
      }
      
      // Store COPY of files in ref (not the live FileList reference)
      pendingFilesRef.current = validFiles;
      console.log('Stored in ref:', pendingFilesRef.current);
      setPendingFileCount(validFiles.length);
      setNewFolderName('');
      setShowFolderPrompt(true);
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

      // Check for duplicate folder name
      const isDuplicate = folders.some(
        f => f.name.toLowerCase() === folderName.toLowerCase()
      );
      
      if (isDuplicate) {
        setFolderNameError('A folder with this name already exists');
        return;
      }

      console.log('Processing files with folder:', folderName, 'Files:', files.length, files);

      setFolderNameError('');
      setShowFolderPrompt(false);
      setIsUploading(true);

      // Calculate folder position - use simple fixed position for reliability
      // Position at top-left with some padding, accounting for existing folders
      const existingFolderCount = folders.length;
      const folderX = 100;
      const folderY = 100 + existingFolderCount * 500; // Stack folders vertically

      console.log('Folder position:', folderX, folderY);

      // Create the folder
      const folderId = `folder-${Date.now()}`;
      const folderColor = FOLDER_COLORS[existingFolderCount % FOLDER_COLORS.length];
      const newImages: CanvasImage[] = [];

      // Grid layout for images within folder - using centralized config
      const { imageMaxSize } = GRID_CONFIG;
      let imageIndex = 0;

      // files is already an array of validated files
      console.log('Files to process:', files.length);

      for (const file of files) {
        // Files are already validated, no need to check again

        try {
          console.log('Processing file:', file.name);
          
          // Generate unique filename with user folder
          const fileExt = file.name.split('.').pop();
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
          const filePath = user ? `${user.id}/${fileName}` : `anonymous/${fileName}`;

          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          let imageSrc = '';

          if (supabaseUrl && user) {
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
              console.log('Upload successful:', uploadData);
              const { data: urlData } = supabase.storage
                .from('photos')
                .getPublicUrl(filePath);
              imageSrc = urlData.publicUrl;
              console.log('Public URL:', imageSrc);
            }
          } else {
            console.log('Using base64 (no Supabase or not logged in)');
            const reader = new FileReader();
            imageSrc = await new Promise<string>((resolve) => {
              reader.onload = (e) => resolve(e.target?.result as string);
              reader.readAsDataURL(file);
            });
          }

          // Load image to get dimensions
          console.log('Loading image to get dimensions...');
          const img = new window.Image();
          img.crossOrigin = 'anonymous';
          
          await new Promise<void>((resolve, reject) => {
            img.onload = () => {
              console.log('Image loaded:', img.width, 'x', img.height);
              resolve();
            };
            img.onerror = (e) => {
              console.error('Image load error:', e);
              reject(new Error('Failed to load image'));
            };
            img.src = imageSrc;
          });

          let width = img.width;
          let height = img.height;

          if (width > imageMaxSize || height > imageMaxSize) {
            const ratio = Math.min(imageMaxSize / width, imageMaxSize / height);
            width = width * ratio;
            height = height * ratio;
          }

          // Position within folder grid (below the folder label) - using folder width
          const cols = calculateColsFromWidth(GRID_CONFIG.defaultFolderWidth);
          const col = imageIndex % cols;
          const row = Math.floor(imageIndex / cols);
          
          // Center images in their cells for consistent spacing
          // Border starts at folderX, content starts at folderX + padding
          // Border is 30px below label, add padding for content area
          const contentStartX = folderX + GRID_CONFIG.folderPadding;
          const contentStartY = folderY + 30 + GRID_CONFIG.folderPadding;
          const cellOffsetX = (GRID_CONFIG.imageMaxSize - width) / 2;
          const cellOffsetY = (GRID_CONFIG.imageMaxSize - height) / 2;
          const x = contentStartX + col * CELL_SIZE + Math.max(0, cellOffsetX);
          const y = contentStartY + row * CELL_SIZE + Math.max(0, cellOffsetY);

          console.log('Image position:', x, y, 'Size:', width, height);

          const uploadedToSupabase = supabaseUrl && imageSrc.includes('supabase');

          const imageId = `img-${Date.now()}-${Math.random()}`;

          const newImage: CanvasImage = {
            id: imageId,
            x,
            y,
            width,
            height,
            src: imageSrc,
            storagePath: uploadedToSupabase ? filePath : undefined,
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
          };

          newImages.push(newImage);
          imageIndex++;
        } catch (error) {
          console.error('Error processing file:', file.name, error);
        }
      }

      console.log('Processed images:', newImages.length);

      // Create the folder and add images in one update
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
        
        console.log('Creating folder:', newFolder);
        
        // Save folder and photo edits to Supabase
        if (user) {
          // Save the folder
          const { error: folderError } = await supabase
            .from('photo_folders')
            .upsert({
              id: folderId,
              user_id: user.id,
              name: folderName,
              x: Math.round(folderX),
              y: Math.round(folderY),
              width: GRID_CONFIG.defaultFolderWidth,
              color: folderColor,
            });
          
          if (folderError) {
            console.error('Error saving folder:', folderError);
          } else {
            console.log('Folder saved to Supabase');
          }

          // Also save all images with their folder_id
          const imagesToSave = newImages.filter(img => img.storagePath);
          if (imagesToSave.length > 0) {
            const editsToSave = imagesToSave.map(img => ({
              storage_path: img.storagePath!,
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
              temperature: img.temperature,
              vibrance: img.vibrance,
              saturation: img.saturation,
              clarity: img.clarity,
              dehaze: img.dehaze,
              vignette: img.vignette,
              grain: img.grain,
              curves: img.curves,
              brightness: img.brightness,
              hue: img.hue,
              blur: img.blur,
              filters: img.filters,
            }));

            const { error: editsError } = await supabase
              .from('photo_edits')
              .upsert(editsToSave, { onConflict: 'storage_path,user_id' });
            
            if (editsError) {
              console.error('Error saving photo edits:', editsError);
            } else {
              console.log('Photo edits saved with folder_id');
            }
          }
        }
        
        // Update state all at once, then resolve overlaps
        const allImages = [...images, ...newImages];
        const allFolders = [...folders, newFolder];
        
        // Resolve any folder overlaps
        const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
          allFolders,
          allImages,
          folderId
        );
        
        setImages(resolvedImages);
        setFolders(resolvedFolders);
        
        // Small delay before saving to history to ensure state is updated
        setTimeout(() => saveToHistory(), 100);
      } else {
        console.log('No images were processed successfully');
      }
      
      pendingFilesRef.current = [];
      setIsUploading(false);
    },
    [folders, images, saveToHistory, user, resolveOverlapsAndReflow]
  );

  // Add files to an existing folder
  const addFilesToExistingFolder = useCallback(
    async (folderId: string) => {
      const files = pendingFilesRef.current;
      if (!files || files.length === 0) return;

      const targetFolder = folders.find(f => f.id === folderId);
      if (!targetFolder) return;

      setShowFolderPrompt(false);
      setSelectedExistingFolderId(null);
      setIsUploading(true);

      const newImages: CanvasImage[] = [];
      const { imageMaxSize } = GRID_CONFIG;

      // Find how many images already exist in folder to continue grid layout
      let imageIndex = targetFolder.imageIds.length;
      const folderX = targetFolder.x;
      const folderY = targetFolder.y;

      for (const file of files) {
        try {
          const fileExt = file.name.split('.').pop();
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
          const filePath = user ? `${user.id}/${fileName}` : `anonymous/${fileName}`;

          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          let imageSrc = '';

          if (supabaseUrl && user) {
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
              const { data: urlData } = supabase.storage
                .from('photos')
                .getPublicUrl(filePath);
              imageSrc = urlData.publicUrl;
            }
          } else {
            const reader = new FileReader();
            imageSrc = await new Promise<string>((resolve) => {
              reader.onload = (e) => resolve(e.target?.result as string);
              reader.readAsDataURL(file);
            });
          }

          const img = new window.Image();
          img.crossOrigin = 'anonymous';
          
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = imageSrc;
          });

          let width = img.width;
          let height = img.height;

          if (width > imageMaxSize || height > imageMaxSize) {
            const ratio = Math.min(imageMaxSize / width, imageMaxSize / height);
            width = width * ratio;
            height = height * ratio;
          }

          // Dynamic columns based on folder width
          const cols = calculateColsFromWidth(targetFolder.width);
          const col = imageIndex % cols;
          const row = Math.floor(imageIndex / cols);
          
          // Center images in their cells for consistent spacing
          // Border starts at folderX, content starts at folderX + padding
          const contentStartX = folderX + GRID_CONFIG.folderPadding;
          const contentStartY = folderY + 30 + GRID_CONFIG.folderPadding;
          const cellOffsetX = (GRID_CONFIG.imageMaxSize - width) / 2;
          const cellOffsetY = (GRID_CONFIG.imageMaxSize - height) / 2;
          const x = contentStartX + col * CELL_SIZE + Math.max(0, cellOffsetX);
          const y = contentStartY + row * CELL_SIZE + Math.max(0, cellOffsetY);

          const uploadedToSupabase = supabaseUrl && imageSrc.includes('supabase');
          const imageId = `img-${Date.now()}-${Math.random()}`;

          const newImage: CanvasImage = {
            id: imageId,
            x,
            y,
            width,
            height,
            src: imageSrc,
            storagePath: uploadedToSupabase ? filePath : undefined,
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
          };

          newImages.push(newImage);
          imageIndex++;
        } catch (error) {
          console.error('Error processing file:', file.name, error);
        }
      }

      if (newImages.length > 0) {
        // Update folder with new image IDs
        const updatedFolders = folders.map((f) =>
          f.id === folderId
            ? { ...f, imageIds: [...f.imageIds, ...newImages.map(img => img.id)] }
            : f
        );
        
        const allImages = [...images, ...newImages];
        
        // Resolve any folder overlaps (folder got bigger)
        const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
          updatedFolders,
          allImages,
          folderId
        );
        
        setFolders(resolvedFolders);
        setImages(resolvedImages);

        // Save photo edits to Supabase
        if (user) {
          const imagesToSave = newImages.filter(img => img.storagePath);
          if (imagesToSave.length > 0) {
            const editsToSave = imagesToSave.map(img => ({
              storage_path: img.storagePath!,
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
              temperature: img.temperature,
              vibrance: img.vibrance,
              saturation: img.saturation,
              clarity: img.clarity,
              dehaze: img.dehaze,
              vignette: img.vignette,
              grain: img.grain,
              curves: img.curves,
              brightness: img.brightness,
              hue: img.hue,
              blur: img.blur,
              filters: img.filters,
            }));

            await supabase
              .from('photo_edits')
              .upsert(editsToSave, { onConflict: 'storage_path,user_id' });
          }
        }
        
        setTimeout(() => saveToHistory(), 100);
      }
      
      pendingFilesRef.current = [];
      setIsUploading(false);
    },
    [folders, images, saveToHistory, user, resolveOverlapsAndReflow]
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
      const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
      const validFiles = Array.from(e.target.files).filter(f => validTypes.includes(f.type));

      if (validFiles.length === 0) {
        alert('Please upload JPEG, PNG, or WebP files only.');
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

  // Zoom with mouse wheel (only when Ctrl is held)
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      // Only zoom if Ctrl (or Cmd on Mac) is pressed
      if (!e.evt.ctrlKey && !e.evt.metaKey) {
        return;
      }

      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;

      const oldScale = stage.scaleX();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      };

      const scaleBy = 1.1;
      // Scroll up (deltaY < 0) zooms in, scroll down (deltaY > 0) zooms out
      const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
      const clampedScale = Math.max(0.1, Math.min(5, newScale));

      setStageScale(clampedScale);
      setStagePosition({
        x: pointer.x - mousePointTo.x * clampedScale,
        y: pointer.y - mousePointTo.y * clampedScale,
      });
    },
    []
  );

  // Touch handlers for pinch zoom
  const getDistance = (p1: Touch, p2: Touch) => {
    return Math.sqrt(Math.pow(p2.clientX - p1.clientX, 2) + Math.pow(p2.clientY - p1.clientY, 2));
  };

  const getCenter = (p1: Touch, p2: Touch) => {
    return {
      x: (p1.clientX + p2.clientX) / 2,
      y: (p1.clientY + p2.clientY) / 2,
    };
  };

  const handleTouchMove = useCallback(
    (e: Konva.KonvaEventObject<TouchEvent>) => {
      const stage = stageRef.current;
      if (!stage) return;

      const touch1 = e.evt.touches[0];
      const touch2 = e.evt.touches[1];

      if (touch1 && touch2) {
        // Pinch zoom
        e.evt.preventDefault();
        const distance = getDistance(touch1, touch2);
        const center = getCenter(touch1, touch2);

        if (lastTouchDistance !== null && lastTouchCenter !== null) {
          const scaleChange = distance / lastTouchDistance;
          const newScale = Math.max(0.1, Math.min(5, stageScale * scaleChange));

          const stageBox = stage.container().getBoundingClientRect();
          const pointTo = {
            x: (center.x - stageBox.left - stage.x()) / stageScale,
            y: (center.y - stageBox.top - stage.y()) / stageScale,
          };

          setStageScale(newScale);
          setStagePosition({
            x: center.x - stageBox.left - pointTo.x * newScale,
            y: center.y - stageBox.top - pointTo.y * newScale,
          });
        }

        setLastTouchDistance(distance);
        setLastTouchCenter(center);
      } else if (touch1 && !isDragging) {
        // Single touch pan
        const stageBox = stage.container().getBoundingClientRect();
        const newPos = {
          x: touch1.clientX - stageBox.left - (lastTouchCenter?.x || touch1.clientX - stageBox.left - stage.x()),
          y: touch1.clientY - stageBox.top - (lastTouchCenter?.y || touch1.clientY - stageBox.top - stage.y()),
        };
        setStagePosition(newPos);
      }
    },
    [stageScale, lastTouchDistance, lastTouchCenter, isDragging]
  );

  const handleTouchEnd = useCallback(() => {
    setLastTouchDistance(null);
    setLastTouchCenter(null);
    setIsDragging(false);
  }, []);

  // Handle stage drag
  const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const clickedOnEmpty = e.target === e.target.getStage();
    if (clickedOnEmpty) {
      setSelectedId(null);
    }
  }, []);

  // Update transformer when selection changes
  useEffect(() => {
    if (!transformerRef.current) return;

    const transformer = transformerRef.current;
    const stage = transformer.getStage();
    if (!stage) return;

    const selectedNode = stage.findOne(`.${selectedId}`);
    if (selectedNode) {
      transformer.nodes([selectedNode]);
      transformer.getLayer()?.batchDraw();
    } else {
      transformer.nodes([]);
    }
  }, [selectedId]);

  // Handle object selection
  const handleObjectClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    const id = e.target.id();
    setSelectedId(id);
  }, []);

  // Handle object drag end with smart snapping (only if near another photo)
  // Handle real-time grid snapping and shuffling during drag
  const handleImageDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      const currentX = node.x();
      const currentY = node.y();
      const currentImg = images.find((i) => i.id === node.id());
      if (!currentImg) return;

      const currentCenterX = currentX + currentImg.width / 2;
      const currentCenterY = currentY + currentImg.height / 2;

      // Detect which folder is being hovered
      let targetFolderId: string | undefined = currentImg.folderId;
      let targetFolder: PhotoFolder | undefined = folders.find(f => f.id === currentImg.folderId);
      
      for (const folder of folders) {
        const folderImages = images.filter(i => folder.imageIds.includes(i.id) && i.id !== currentImg.id);
        const cols = calculateColsFromWidth(folder.width);
        const rows = Math.ceil(folderImages.length / cols) || 1;
        const contentHeight = rows * CELL_SIZE + (GRID_CONFIG.folderPadding * 2);
        
        const boundLeft = folder.x;
        const boundRight = folder.x + folder.width;
        const boundTop = folder.y + 30;
        const boundBottom = folder.y + 30 + Math.max(contentHeight, 100);
        
        if (currentCenterX >= boundLeft && currentCenterX <= boundRight &&
            currentCenterY >= boundTop && currentCenterY <= boundBottom) {
          targetFolderId = folder.id;
          targetFolder = folder;
          break;
        }
      }

      // If image is in a folder, calculate grid position and shuffle in real-time
      if (targetFolderId && targetFolder) {
        const cols = calculateColsFromWidth(targetFolder.width);
        const { folderPadding, imageMaxSize } = GRID_CONFIG;
        const contentStartX = targetFolder.x + folderPadding;
        const contentStartY = targetFolder.y + 30 + folderPadding;
        
        // Calculate which cell the drag position corresponds to
        const relativeX = currentX - contentStartX;
        const relativeY = currentY - contentStartY;
        const targetCol = Math.max(0, Math.floor(relativeX / CELL_SIZE));
        const targetRow = Math.max(0, Math.floor(relativeY / CELL_SIZE));
        const clampedCol = Math.min(targetCol, cols - 1);
        
        // Calculate the center of the target cell
        const targetCellCenterX = contentStartX + clampedCol * CELL_SIZE + imageMaxSize / 2;
        const targetCellCenterY = contentStartY + targetRow * CELL_SIZE + imageMaxSize / 2;
        
        // Snap threshold - only snap when within 40px of cell center
        const snapThreshold = 40;
        const distanceToCellCenter = Math.sqrt(
          Math.pow(currentX + currentImg.width / 2 - targetCellCenterX, 2) +
          Math.pow(currentY + currentImg.height / 2 - targetCellCenterY, 2)
        );
        
        // Update folder hover state
        setDragHoveredFolderId(targetFolderId || null);
        
        // Only snap if close enough to cell center
        if (distanceToCellCenter > snapThreshold) {
          // Too far from cell center - allow free dragging
          return;
        }
        
        const targetCellIndex = targetRow * cols + clampedCol;
        
        // Get other images in folder
        const otherFolderImages = images.filter(img => 
          targetFolder!.imageIds.includes(img.id) && img.id !== currentImg.id
        );
        
        // Calculate current cell positions for other images
        const imageCellMap = new Map<string, number>();
        otherFolderImages.forEach((img) => {
          const imgRelativeX = img.x - contentStartX;
          const imgRelativeY = img.y - contentStartY;
          const imgCol = Math.floor(imgRelativeX / CELL_SIZE);
          const imgRow = Math.floor(imgRelativeY / CELL_SIZE);
          const cellIndex = imgRow * cols + imgCol;
          imageCellMap.set(img.id, cellIndex);
        });
        
        // Calculate current image's cell
        const currentImgRelativeX = currentImg.x - contentStartX;
        const currentImgRelativeY = currentImg.y - contentStartY;
        const currentImgCol = Math.floor(currentImgRelativeX / CELL_SIZE);
        const currentImgRow = Math.floor(currentImgRelativeY / CELL_SIZE);
        const currentImgCell = currentImgRow * cols + currentImgCol;
        
        // Check if target cell is occupied
        const occupiedBy = Array.from(imageCellMap.entries()).find(([, cellIndex]) => cellIndex === targetCellIndex);
        
        let swapX: number | undefined;
        let swapY: number | undefined;
        let swapImgId: string | undefined;
        let finalCol = clampedCol;
        let finalRow = targetRow;
        
        if (occupiedBy) {
          const [occupiedImgId] = occupiedBy;
          
          // Swap if current image has a valid cell position
          if (currentImgCell >= 0 && currentImgCell < cols * 1000 && 
              currentImg.folderId === targetFolderId) {
            const occupiedImg = otherFolderImages.find(img => img.id === occupiedImgId);
            if (occupiedImg) {
              const swapCol = currentImgCell % cols;
              const swapRow = Math.floor(currentImgCell / cols);
              const swapImgWidth = Math.min(occupiedImg.width * occupiedImg.scaleX, imageMaxSize);
              const swapImgHeight = Math.min(occupiedImg.height * occupiedImg.scaleY, imageMaxSize);
              const swapOffsetX = (imageMaxSize - swapImgWidth) / 2;
              const swapOffsetY = (imageMaxSize - swapImgHeight) / 2;
              
              swapX = contentStartX + swapCol * CELL_SIZE + swapOffsetX;
              swapY = contentStartY + swapRow * CELL_SIZE + swapOffsetY;
              swapImgId = occupiedImgId;
            }
          } else {
            // Find nearest empty cell
            const occupiedCells = new Set(Array.from(imageCellMap.values()));
            const maxRows = Math.max(10, Math.ceil((otherFolderImages.length + 1) / cols));
            
            for (let radius = 0; radius < maxRows * cols; radius++) {
              let foundEmpty = false;
              for (let dr = -radius; dr <= radius && !foundEmpty; dr++) {
                for (let dc = -radius; dc <= radius && !foundEmpty; dc++) {
                  if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
                  
                  const checkRow = targetRow + dr;
                  const checkCol = clampedCol + dc;
                  
                  if (checkRow >= 0 && checkCol >= 0 && checkCol < cols) {
                    const checkCellIndex = checkRow * cols + checkCol;
                    if (!occupiedCells.has(checkCellIndex)) {
                      finalRow = checkRow;
                      finalCol = checkCol;
                      foundEmpty = true;
                    }
                  }
                }
              }
              if (foundEmpty) break;
            }
          }
        }
        
        // Calculate final position for dragged image
        const imgWidth = Math.min(currentImg.width * currentImg.scaleX, imageMaxSize);
        const imgHeight = Math.min(currentImg.height * currentImg.scaleY, imageMaxSize);
        const cellOffsetX = (imageMaxSize - imgWidth) / 2;
        const cellOffsetY = (imageMaxSize - imgHeight) / 2;
        
        const finalX = contentStartX + finalCol * CELL_SIZE + cellOffsetX;
        const finalY = contentStartY + finalRow * CELL_SIZE + cellOffsetY;
        
        // Update positions in real-time
        setImages((prev) =>
          prev.map((img) => {
            if (img.id === currentImg.id) {
              return { ...img, x: finalX, y: finalY };
            }
            if (swapImgId && img.id === swapImgId && swapX !== undefined && swapY !== undefined) {
              return { ...img, x: swapX, y: swapY };
            }
            return img;
          })
        );
        
        // Update swapped image node position instantly
        if (swapImgId && swapX !== undefined && swapY !== undefined) {
          const swapNode = node.getStage()?.findOne(`#${swapImgId}`);
          if (swapNode) {
            swapNode.setAttrs({ x: swapX, y: swapY });
            // Track swapped image for saving later
            lastSwappedImageRef.current = { id: swapImgId, x: swapX, y: swapY };
          }
        }
        // Don't clear lastSwappedImageRef here - when hovering over the target cell after a swap,
        // the target appears "empty" (other image moved out) so we'd clear it and lose the swap
        // info. We only clear it in handleObjectDragEnd after saving.
        
        // Update dragged image position using setAttrs
        node.setAttrs({ x: finalX, y: finalY });
      }
      
      // Update folder hover state for visual feedback
      setDragHoveredFolderId(targetFolderId || null);
    },
    [images, folders]
  );

  const handleObjectDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, type: 'image' | 'text') => {
      const node = e.target;
      const currentX = node.x();
      const currentY = node.y();
      
      let newX = currentX;
      let newY = currentY;

      // Only snap if it's an image
      if (type === 'image') {
        const currentImg = images.find((img) => img.id === node.id());
        if (currentImg) {
          // Get the current position (already updated by handleImageDragMove if in folder)
          newX = currentX;
          newY = currentY;
          
          // Calculate current center position
          const currentCenterX = currentX + currentImg.width / 2;
          const currentCenterY = currentY + currentImg.height / 2;

          // Check if image was dropped into a folder (or is already in one)
          let targetFolderId: string | undefined = currentImg.folderId;
          let targetFolder: PhotoFolder | undefined = folders.find(f => f.id === currentImg.folderId);
          
          // Check if dropped into a different folder
          for (const folder of folders) {
            const folderImages = images.filter(img => folder.imageIds.includes(img.id) && img.id !== currentImg.id);
            const cols = calculateColsFromWidth(folder.width);
            const rows = Math.ceil(folderImages.length / cols) || 1;
            const contentHeight = rows * CELL_SIZE + (GRID_CONFIG.folderPadding * 2);
            
            const boundLeft = folder.x;
            const boundRight = folder.x + folder.width;
            const boundTop = folder.y + 30;
            const boundBottom = folder.y + 30 + Math.max(contentHeight, 100);
            
            if (currentCenterX >= boundLeft && currentCenterX <= boundRight &&
                currentCenterY >= boundTop && currentCenterY <= boundBottom) {
              targetFolderId = folder.id;
              targetFolder = folder;
              break;
            }
          }

          // If image is outside folders, use snapping logic
          if (!targetFolderId) {
            const nearest = findNearestPhoto(currentCenterX, currentCenterY, images, node.id(), 100);
            if (nearest) {
              newX = nearest.x - currentImg.width / 2;
              newY = nearest.y - currentImg.height / 2;
              newX = snapToGrid(newX, GRID_SIZE);
              newY = snapToGrid(newY, GRID_SIZE);
            }
          }

          // Update image's folder assignment
          const oldFolderId = currentImg.folderId;
          
          if (targetFolderId !== oldFolderId) {
            // If dropped outside all folders AND image was in a folder, create a new "Untitled" folder
            if (!targetFolderId && oldFolderId) {
              // Generate unique "Untitled" name
              const existingUntitledNames = folders
                .filter(f => f.name.toLowerCase().startsWith('untitled'))
                .map(f => f.name.toLowerCase());
              
              let untitledName = 'Untitled';
              if (existingUntitledNames.includes('untitled')) {
                let counter = 2;
                while (existingUntitledNames.includes(`untitled-${counter}`)) {
                  counter++;
                }
                untitledName = `Untitled-${counter}`;
              }

              // Create new folder at the image's position
              const newFolderId = `folder-${Date.now()}`;
              const colorIndex = folders.length % FOLDER_COLORS.length;
              
              // New folder position - use drop position for folder label
              const newFolderX = newX;
              const newFolderY = newY - 50; // Position label above where image was dropped
              const newFolderWidth = GRID_CONFIG.defaultFolderWidth;
              
              // Calculate proper centered position for image inside the new folder
              const contentStartX = newFolderX + GRID_CONFIG.folderPadding;
              const contentStartY = newFolderY + 30 + GRID_CONFIG.folderPadding;
              const imgWidth = currentImg.width * currentImg.scaleX;
              const imgHeight = currentImg.height * currentImg.scaleY;
              const cellOffsetX = Math.max(0, (GRID_CONFIG.imageMaxSize - imgWidth) / 2);
              const cellOffsetY = Math.max(0, (GRID_CONFIG.imageMaxSize - imgHeight) / 2);
              const centeredX = contentStartX + cellOffsetX;
              const centeredY = contentStartY + cellOffsetY;
              
              // Combined state update: remove from old folder AND add new folder
              setFolders((prev) => {
                const updated = prev.map((f) =>
                  f.id === oldFolderId
                    ? { ...f, imageIds: f.imageIds.filter((id) => id !== currentImg.id) }
                    : f
                );
                return [...updated, {
                  id: newFolderId,
                  name: untitledName,
                  x: newFolderX,
                  y: newFolderY,
                  width: newFolderWidth,
                  imageIds: [currentImg.id],
                  color: FOLDER_COLORS[colorIndex],
                }];
              });

              // Update image's folderId and position (centered in folder)
              setImages((prev) =>
                prev.map((img) =>
                  img.id === currentImg.id
                    ? { ...img, x: centeredX, y: centeredY, folderId: newFolderId }
                    : img
                )
              );
              
              // Update the node position visually
              node.position({ x: centeredX, y: centeredY });

              // Save new folder to Supabase
              if (user) {
                supabase.from('photo_folders').insert({
                  id: newFolderId,
                  user_id: user.id,
                  name: untitledName,
                  x: Math.round(newFolderX),
                  y: Math.round(newFolderY),
                  width: Math.round(newFolderWidth),
                  color: FOLDER_COLORS[colorIndex],
                }).then(({ error }) => {
                  if (error) console.error('Failed to save new folder:', error);
                });

                // Update photo_edits with new folder_id and centered position
                if (currentImg.storagePath) {
                  supabase.from('photo_edits')
                    .update({ folder_id: newFolderId, x: Math.round(centeredX), y: Math.round(centeredY) })
                    .eq('storage_path', currentImg.storagePath)
                    .eq('user_id', user.id)
                    .then(({ error }) => {
                      if (error) console.error('Failed to update photo folder:', error);
                    });
                }
              }
              
              return; // Exit early since we already updated images
            }
            
            // Moving between existing folders or into a folder
            if (targetFolderId) {
              // Find target folder and calculate grid position
              const targetFolder = folders.find(f => f.id === targetFolderId);
              let gridX = newX;
              let gridY = newY;
              
              if (targetFolder) {
                // Count existing images in target folder (excluding current image if it was already in this folder)
                const existingCount = targetFolder.imageIds.filter(id => id !== currentImg.id).length;
                
                // Dynamic columns based on folder width
                const cols = calculateColsFromWidth(targetFolder.width);
                const col = existingCount % cols;
                const row = Math.floor(existingCount / cols);
                
                // Center image in cell for consistent spacing
                // Border starts at folder.x, content starts at folder.x + padding
                const contentStartX = targetFolder.x + GRID_CONFIG.folderPadding;
                const contentStartY = targetFolder.y + 30 + GRID_CONFIG.folderPadding;
                const imgWidth = currentImg.width * currentImg.scaleX;
                const imgHeight = currentImg.height * currentImg.scaleY;
                const cellOffsetX = Math.max(0, (GRID_CONFIG.imageMaxSize - imgWidth) / 2);
                const cellOffsetY = Math.max(0, (GRID_CONFIG.imageMaxSize - imgHeight) / 2);
                
                gridX = contentStartX + col * CELL_SIZE + cellOffsetX;
                gridY = contentStartY + row * CELL_SIZE + cellOffsetY;
              }

              // Update folders
              const updatedFolders = folders.map((f) => {
                if (f.id === oldFolderId) {
                  return { ...f, imageIds: f.imageIds.filter((id) => id !== currentImg.id) };
                }
                if (f.id === targetFolderId) {
                  return { ...f, imageIds: [...f.imageIds, currentImg.id] };
                }
                return f;
              });

              // Update images
              const updatedImages = images.map((img) =>
                img.id === currentImg.id
                  ? { ...img, x: gridX, y: gridY, folderId: targetFolderId }
                  : img
              );

              // Resolve any folder overlaps (target folder may have grown)
              const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
                updatedFolders,
                updatedImages,
                targetFolderId
              );
              
              setFolders(resolvedFolders);
              setImages(resolvedImages);

              // Update the node position visually
              const finalImg = resolvedImages.find(img => img.id === currentImg.id);
              if (finalImg) {
                node.position({ x: finalImg.x, y: finalImg.y });
              }

              // Persist folder changes and image positions to Supabase
              if (user) {
                // Save moved folders
                for (const f of resolvedFolders) {
                  const oldF = folders.find(of => of.id === f.id);
                  if (oldF && (oldF.x !== f.x || oldF.y !== f.y)) {
                    supabase.from('photo_folders')
                      .update({ x: Math.round(f.x), y: Math.round(f.y) })
                      .eq('id', f.id)
                      .eq('user_id', user.id)
                      .then(({ error }) => {
                        if (error) console.error('Failed to update folder:', error);
                      });
                  }
                }
                
                // Save the dragged image
                if (currentImg.storagePath && finalImg) {
                  supabase.from('photo_edits')
                    .update({ folder_id: targetFolderId, x: Math.round(finalImg.x), y: Math.round(finalImg.y) })
                    .eq('storage_path', currentImg.storagePath)
                    .eq('user_id', user.id)
                    .then(({ error }) => {
                      if (error) console.error('Failed to update photo folder:', error);
                    });
                }
                
                // Save swapped image if there was a swap (when moving within same folder before folder change)
                if (lastSwappedImageRef.current) {
                  const swappedImg = resolvedImages.find(img => img.id === lastSwappedImageRef.current!.id);
                  if (swappedImg?.storagePath) {
                    supabase.from('photo_edits')
                      .update({ 
                        x: Math.round(swappedImg.x), 
                        y: Math.round(swappedImg.y),
                        folder_id: swappedImg.folderId || null
                      })
                      .eq('storage_path', swappedImg.storagePath)
                      .eq('user_id', user.id)
                      .then(({ error }) => {
                        if (error) console.error('Failed to update swapped photo position:', error);
                      });
                  }
                  // Clear swap tracking
                  lastSwappedImageRef.current = null;
                }
              }

              return; // Exit early since we already updated images
            }
          }

          // If image is in a folder (same folder move), positions are already updated in real-time
          // Just save to Supabase and ensure folder assignment is correct
          if (targetFolderId && targetFolderId === oldFolderId) {
            // Use node position directly - it was updated synchronously by handleImageDragMove
            const finalX = node.x();
            const finalY = node.y();
            
            // Update folder assignment if needed (should already be set)
            setImages((prev) =>
              prev.map((img) =>
                img.id === currentImg.id
                  ? { ...img, folderId: targetFolderId, x: finalX, y: finalY }
                  : img
              )
            );

            // Save to Supabase if user is logged in
            if (user) {
              // Save dragged image using state position
              if (currentImg.storagePath) {
                supabase.from('photo_edits')
                  .update({ x: Math.round(finalX), y: Math.round(finalY), folder_id: targetFolderId })
                  .eq('storage_path', currentImg.storagePath)
                  .eq('user_id', user.id)
                  .then(({ error }) => {
                    if (error) console.error('Failed to update photo position:', error);
                  });
              }
              
              // Save swapped image if there was a swap - use the position from ref (calculated during drag)
              if (lastSwappedImageRef.current) {
                const swappedRef = lastSwappedImageRef.current;
                const swappedImg = images.find(img => img.id === swappedRef.id);
                if (swappedImg?.storagePath) {
                  const swappedX = swappedRef.x;
                  const swappedY = swappedRef.y;
                  
                  // Use swappedRef (captured) - the ref may be cleared before the callback runs
                  setImages((prev) =>
                    prev.map((img) =>
                      img.id === swappedRef.id
                        ? { ...img, x: swappedX, y: swappedY }
                        : img
                    )
                  );
                  
                  supabase.from('photo_edits')
                    .update({ 
                      x: Math.round(swappedX), 
                      y: Math.round(swappedY) 
                    })
                    .eq('storage_path', swappedImg.storagePath)
                    .eq('user_id', user.id)
                    .then(({ error }) => {
                      if (error) console.error('Failed to update swapped photo position:', error);
                    });
                }
                // Clear swap tracking
                lastSwappedImageRef.current = null;
              }
            }

            // Update node position to match state (in case there's any drift)
            node.position({ x: finalX, y: finalY });
            return; // Exit early since we already updated images
          }
        }
      }

      node.position({ x: newX, y: newY });

      if (type === 'image') {
        setImages((prev) =>
          prev.map((img) => (img.id === node.id() ? { ...img, x: newX, y: newY } : img))
        );
      } else {
        setTexts((prev) =>
          prev.map((txt) => (txt.id === node.id() ? { ...txt, x: newX, y: newY } : txt))
        );
      }
    },
    [images, folders, user, resolveOverlapsAndReflow]
  );

  // Save edits to Supabase database
  const handleSave = useCallback(async () => {
    if (!user) {
      alert('Please sign in to save your edits');
      return;
    }

    try {
      // Only save images that have a storagePath (uploaded to Supabase)
      const imagesToSave = images.filter(img => img.storagePath);
      
      if (imagesToSave.length === 0) {
        alert('No photos to save. Upload some photos first!');
        return;
      }

      // Prepare edit data for each image
      const editsToSave = imagesToSave.map(img => ({
        storage_path: img.storagePath!,
        user_id: user.id,
        folder_id: img.folderId || null,
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
        temperature: img.temperature,
        vibrance: img.vibrance,
        saturation: img.saturation,
        clarity: img.clarity,
        dehaze: img.dehaze,
        vignette: img.vignette,
        grain: img.grain,
        curves: img.curves,
        brightness: img.brightness,
        hue: img.hue,
        blur: img.blur,
        filters: img.filters,
      }));

      // Upsert edits (insert or update)
      const { error } = await supabase
        .from('photo_edits')
        .upsert(editsToSave, { 
          onConflict: 'storage_path,user_id',
        });

      if (error) {
        console.error('Save error:', error);
        alert(`Failed to save edits: ${error.message}`);
        return;
      }

      alert('Edits saved successfully! Your original photos are preserved.');
    } catch (error) {
      console.error('Save error:', error);
      alert('Failed to save edits');
    }
  }, [user, images]);

  // Handle folder click to edit
  const handleFolderDoubleClick = useCallback((folder: PhotoFolder) => {
    // Only edit if we didn't just drag the folder name
    if (!folderNameDragRef.current) {
      setEditingFolder(folder);
      setEditingFolderName(folder.name);
    }
  }, []);

  // Rename folder
  const handleRenameFolder = useCallback(async () => {
    if (!editingFolder || !editingFolderName.trim()) return;

    const newName = editingFolderName.trim();
    
    // Check for duplicate name
    const isDuplicate = folders.some(
      f => f.id !== editingFolder.id && f.name.toLowerCase() === newName.toLowerCase()
    );
    
    if (isDuplicate) {
      setFolderNameError('A folder with this name already exists');
      return;
    }
    
    setFolderNameError('');
    
    // Update local state
    setFolders((prev) =>
      prev.map((f) => f.id === editingFolder.id ? { ...f, name: newName } : f)
    );

    // Update in Supabase if user is logged in
    if (user) {
      try {
        await supabase
          .from('photo_folders')
          .update({ name: newName })
          .eq('id', editingFolder.id)
          .eq('user_id', user.id);
      } catch (error) {
        console.error('Failed to update folder name:', error);
      }
    }

    setEditingFolder(null);
    setEditingFolderName('');
    setFolderNameError('');
    saveToHistory();
  }, [editingFolder, editingFolderName, folders, user, saveToHistory]);

  // Delete folder (and optionally its images)
  const handleDeleteFolder = useCallback(async (deleteImages: boolean) => {
    if (!editingFolder) return;

    const folderImageIds = editingFolder.imageIds;

    if (deleteImages) {
      // Delete images from Supabase storage
      if (user) {
        for (const imgId of folderImageIds) {
          const img = images.find(i => i.id === imgId);
          if (img?.storagePath) {
            try {
              await supabase.storage.from('photos').remove([img.storagePath]);
              await supabase.from('photo_edits').delete()
                .eq('storage_path', img.storagePath)
                .eq('user_id', user.id);
            } catch (error) {
              console.error('Failed to delete image:', error);
            }
          }
        }
      }

      // Remove images from canvas
      setImages((prev) => prev.filter(img => !folderImageIds.includes(img.id)));
    } else {
      // Just remove folder association from images
      setImages((prev) =>
        prev.map((img) =>
          folderImageIds.includes(img.id) ? { ...img, folderId: undefined } : img
        )
      );
    }

    // Delete folder from Supabase
    if (user) {
      try {
        await supabase
          .from('photo_folders')
          .delete()
          .eq('id', editingFolder.id)
          .eq('user_id', user.id);
      } catch (error) {
        console.error('Failed to delete folder:', error);
      }
    }

    // Remove folder from state
    setFolders((prev) => prev.filter(f => f.id !== editingFolder.id));
    setEditingFolder(null);
    setEditingFolderName('');
    setFolderNameError('');
    saveToHistory();
  }, [editingFolder, images, user, saveToHistory]);

  // Add empty folder at viewport center
  const handleAddEmptyFolder = useCallback(async () => {
    // Calculate center of viewport in stage coordinates
    const centerX = (dimensions.width / 2 - stagePosition.x) / stageScale;
    const centerY = (dimensions.height / 2 - stagePosition.y) / stageScale;

    const folderId = `folder-${Date.now()}`;
    const colorIndex = folders.length % FOLDER_COLORS.length;
    
    const newFolder: PhotoFolder = {
      id: folderId,
      name: 'New Folder',
      x: centerX,
      y: centerY,
      width: GRID_CONFIG.defaultFolderWidth,
      imageIds: [],
      color: FOLDER_COLORS[colorIndex],
    };

    setFolders((prev) => [...prev, newFolder]);

    // Save to Supabase
    if (user) {
      try {
        await supabase.from('photo_folders').insert({
          id: folderId,
          user_id: user.id,
          name: 'New Folder',
          x: Math.round(centerX),
          y: Math.round(centerY),
          width: GRID_CONFIG.defaultFolderWidth,
          color: FOLDER_COLORS[colorIndex],
        });
      } catch (error) {
        console.error('Failed to save folder:', error);
      }
    }

    // Open edit modal so user can rename
    setEditingFolder(newFolder);
    setEditingFolderName('New Folder');
    saveToHistory();
  }, [dimensions, stagePosition, stageScale, folders.length, user, saveToHistory]);

  // Recenter all folders horizontally in the middle of the canvas
  const handleRecenterFolders = useCallback(async () => {
    if (folders.length === 0) return;
    
    const { folderGap } = GRID_CONFIG;
    
    // Calculate total width needed for all folders
    let totalWidth = 0;
    const folderWidths: number[] = [];
    
    for (const folder of folders) {
      folderWidths.push(folder.width);
      totalWidth += folder.width;
    }
    
    // Add gaps between folders
    totalWidth += (folders.length - 1) * folderGap;
    
    // Calculate center of viewport in stage coordinates
    const viewportCenterX = (dimensions.width / 2 - stagePosition.x) / stageScale;
    const viewportCenterY = (dimensions.height / 2 - stagePosition.y) / stageScale;
    
    // Calculate starting X position (left edge of first folder)
    let currentX = viewportCenterX - totalWidth / 2;
    
    // Sort folders by current x position to preserve user's left-to-right arrangement
    const sortedFolders = [...folders].sort((a, b) => a.x - b.x);
    
    // Position all folders horizontally
    const recenteredFolders: PhotoFolder[] = [];
    let recenteredImages = [...images];
    
    for (let i = 0; i < sortedFolders.length; i++) {
      const folder = sortedFolders[i];
      const newFolder = {
        ...folder,
        x: currentX,
        y: viewportCenterY - 100, // Slightly above center
      };
      recenteredFolders.push(newFolder);

      // Translate images with their folder (preserve layout and order, don't reflow)
      const deltaX = newFolder.x - folder.x;
      const deltaY = newFolder.y - folder.y;
      const folderImgIds = new Set(folder.imageIds);
      recenteredImages = recenteredImages.map((img) => {
        if (folderImgIds.has(img.id)) {
          return { ...img, x: img.x + deltaX, y: img.y + deltaY };
        }
        return img;
      });
      
      currentX += folder.width + folderGap;
    }
    
    setFolders(recenteredFolders);
    setImages(recenteredImages);
    saveToHistory();
    
    // Persist to Supabase
    if (user) {
      for (const f of recenteredFolders) {
        supabase.from('photo_folders')
          .update({ x: Math.round(f.x), y: Math.round(f.y) })
          .eq('id', f.id)
          .eq('user_id', user.id)
          .then(({ error }) => {
            if (error) console.error('Failed to update folder position:', error);
          });
      }
      
      const folderImages = recenteredImages.filter(img => img.storagePath && img.folderId);
      for (const img of folderImages) {
        supabase.from('photo_edits')
          .update({ x: Math.round(img.x), y: Math.round(img.y) })
          .eq('storage_path', img.storagePath!)
          .eq('user_id', user.id)
          .then(({ error }) => {
            if (error) console.error('Failed to update image position:', error);
          });
      }
    }
  }, [folders, images, dimensions, stagePosition, stageScale, user, saveToHistory]);

  // Add text at double-click position
  const handleStageDoubleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    // Don't add text if clicking on an object
    const clickedOnEmpty = e.target === e.target.getStage();
    if (!clickedOnEmpty) return;

    const stage = stageRef.current;
    if (!stage) return;

    // Get pointer position in stage coordinates
    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;

    // Convert screen coordinates to stage coordinates
    const x = (pointerPos.x - stagePosition.x) / stageScale;
    const y = (pointerPos.y - stagePosition.y) / stageScale;

    const newText: CanvasText = {
      id: `text-${Date.now()}-${Math.random()}`,
      x,
      y,
      text: 'Click to edit',
      fontSize: 24,
      fill: '#ffffff',
      rotation: 0,
    };

    setTexts((prev) => {
      const updated = [...prev, newText];
      saveToHistory();
      return updated;
    });
    setSelectedId(newText.id);
  }, [stagePosition, stageScale, saveToHistory]);

  // Get selected object
  const selectedObject = selectedId
    ? [...images, ...texts].find((obj) => obj.id === selectedId)
    : null;

  return (
    <div className="relative h-full w-full bg-[#0d0d0d]">
      <TopBar
        onUpload={handleFileUpload}
        onAddFolder={handleAddEmptyFolder}
        onRecenter={handleRecenterFolders}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        visible={showHeader}
      />

      {/* Upload loading indicator */}
      {isUploading && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-[#171717] border border-[#2a2a2a] rounded-xl px-4 py-3 shadow-2xl shadow-black/50">
          <div className="w-5 h-5 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
          <span className="text-white text-sm font-medium">Uploading...</span>
        </div>
      )}

      {/* Folder Name Prompt Modal */}
      {showFolderPrompt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-96">
            <h2 className="text-lg font-semibold text-white mb-1">Add {pendingFileCount} photo{pendingFileCount > 1 ? 's' : ''}</h2>
            <p className="text-sm text-[#888] mb-4">
              Choose an existing folder or create a new one
            </p>
            
            {/* Existing Folders */}
            {folders.length > 0 && (
              <div className="mb-4">
                <label className="block text-xs uppercase tracking-wide text-[#666] mb-2">Existing Folders</label>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => {
                        setSelectedExistingFolderId(folder.id);
                        setNewFolderName('');
                        setFolderNameError('');
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left cursor-pointer ${
                        selectedExistingFolderId === folder.id
                          ? 'bg-[#3ECF8E]/20 border border-[#3ECF8E]'
                          : 'bg-[#252525] border border-[#333] hover:border-[#444]'
                      }`}
                    >
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: folder.color }}
                      />
                      <span className="text-sm text-white truncate">{folder.name}</span>
                      <span className="text-xs text-[#666] ml-auto">{folder.imageIds.length} photos</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Divider */}
            {folders.length > 0 && (
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-[#333]" />
                <span className="text-xs text-[#666]">OR</span>
                <div className="flex-1 h-px bg-[#333]" />
              </div>
            )}

            {/* New Folder Name */}
            <label className="block text-xs uppercase tracking-wide text-[#666] mb-2">Create New Folder</label>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => {
                setNewFolderName(e.target.value);
                setSelectedExistingFolderId(null);
                setFolderNameError('');
              }}
              placeholder="e.g., Beach Trip 2024"
              className={`w-full px-4 py-3 text-white bg-[#252525] border rounded-xl focus:outline-none transition-colors mb-1 ${
                folderNameError ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20'
              }`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newFolderName.trim()) {
                  processFilesWithFolder(newFolderName.trim());
                }
              }}
            />
            {folderNameError && (
              <p className="text-xs text-red-400 mb-3">{folderNameError}</p>
            )}
            {!folderNameError && <div className="mb-4" />}
            
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowFolderPrompt(false);
                  setNewFolderName('');
                  setSelectedExistingFolderId(null);
                  setFolderNameError('');
                  pendingFilesRef.current = [];
                }}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-[#999] bg-[#252525] hover:bg-[#333] rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              {selectedExistingFolderId ? (
                <button
                  onClick={() => addFilesToExistingFolder(selectedExistingFolderId)}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] rounded-xl transition-colors cursor-pointer"
                >
                  Add to Folder
                </button>
              ) : (
                <button
                  onClick={() => {
                    if (newFolderName.trim()) {
                      processFilesWithFolder(newFolderName.trim());
                    }
                  }}
                  disabled={!newFolderName.trim()}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] disabled:bg-[#333] disabled:text-[#666] disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer"
                >
                  Create Folder
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Folder Edit Modal */}
      {editingFolder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-96">
            <h2 className="text-lg font-semibold text-white mb-4">Edit Folder</h2>
            
            {/* Rename Section */}
            <div className="mb-4">
              <label className="block text-sm text-[#888] mb-2">Folder Name</label>
              <input
                type="text"
                value={editingFolderName}
                onChange={(e) => {
                  setEditingFolderName(e.target.value);
                  setFolderNameError('');
                }}
                placeholder="Folder name"
                className={`w-full px-4 py-3 text-white bg-[#252525] border rounded-xl focus:outline-none transition-colors ${
                  folderNameError ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20'
                }`}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && editingFolderName.trim()) {
                    handleRenameFolder();
                  }
                }}
              />
              {folderNameError && (
                <p className="text-xs text-red-400 mt-1">{folderNameError}</p>
              )}
            </div>

            {/* Info */}
            <p className="text-sm text-[#666] mb-4">
              {editingFolder.imageIds.length} photo{editingFolder.imageIds.length !== 1 ? 's' : ''} in this folder
            </p>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setEditingFolder(null);
                    setEditingFolderName('');
                    setFolderNameError('');
                  }}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-[#999] bg-[#252525] hover:bg-[#333] rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRenameFolder}
                  disabled={!editingFolderName.trim() || editingFolderName === editingFolder.name}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] disabled:bg-[#333] disabled:text-[#666] disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer"
                >
                  Save Name
                </button>
              </div>

              {/* Delete Section */}
              <div className="pt-3 border-t border-[#333]">
                <p className="text-xs text-[#666] mb-3">Delete this folder</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleDeleteFolder(false)}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-orange-400 bg-orange-400/10 hover:bg-orange-400/20 rounded-xl transition-colors cursor-pointer"
                  >
                    Ungroup Only
                  </button>
                  <button
                    onClick={() => handleDeleteFolder(true)}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-red-400 bg-red-400/10 hover:bg-red-400/20 rounded-xl transition-colors cursor-pointer"
                  >
                    Delete All Photos
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        className={`h-full w-full ${isSpacePressed ? 'cursor-grab' : ''} ${isDragging && isSpacePressed ? 'cursor-grabbing' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {/* Hidden file input for folder plus button */}
        <input
          ref={folderFileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleFolderFileSelect}
          className="hidden"
        />
        <Stage
          ref={stageRef}
          width={dimensions.width}
          height={dimensions.height}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePosition.x}
          y={stagePosition.y}
          pixelRatio={Math.max(window.devicePixelRatio || 2, 2)}
          onWheel={handleWheel}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleStageMouseDown}
          onDblClick={handleStageDoubleClick}
          draggable={isSpacePressed}
          onDragStart={() => {
            if (isSpacePressed) {
              setIsDragging(true);
            }
          }}
          onDragMove={(e) => {
            if (isSpacePressed) {
              // Update stage position during drag so plus buttons move in real-time
              setStagePosition({ x: e.target.x(), y: e.target.y() });
            }
          }}
          onDragEnd={(e) => {
            if (isSpacePressed) {
              setStagePosition({ x: e.target.x(), y: e.target.y() });
              setIsDragging(false);
            }
          }}
        >
          <Layer>
            {/* Folder Borders and Labels */}
            {folders.map((folder) => {
              // Calculate folder dimensions
              const folderImages = images.filter(img => folder.imageIds.includes(img.id));
              const { folderPadding } = GRID_CONFIG;
              
              // Get current folder from state to ensure we have latest width
              const currentFolder = folders.find(f => f.id === folder.id) || folder;
              
              // Border starts at folder.x aligned with the label
              const borderX = currentFolder.x;
              const borderY = currentFolder.y + 30; // Start below the label
              const borderWidth = currentFolder.width;
              
              // Calculate height based on actual content
              const cols = calculateColsFromWidth(currentFolder.width);
              const rows = Math.ceil(folderImages.length / cols) || 1;
              const contentHeight = rows * CELL_SIZE + (folderPadding * 2); // Padding top and bottom
              const borderHeight = Math.max(contentHeight, 100); // Minimum height
              
              const isHovered = hoveredFolderBorder === currentFolder.id;
              const isResizing = resizingFolderId === currentFolder.id;

              return (
                <Group key={folder.id}>
                  {/* Folder Label - Above the border */}
                  <Text
                    x={currentFolder.x}
                    y={currentFolder.y}
                    text={currentFolder.name}
                    fontSize={16}
                    fontStyle="600"
                    fill={currentFolder.color}
                    draggable
                    onMouseEnter={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container) container.style.cursor = 'pointer';
                    }}
                    onMouseLeave={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container && !isDragging) container.style.cursor = 'default';
                    }}
                    onClick={() => handleFolderDoubleClick(currentFolder)}
                    onTap={() => handleFolderDoubleClick(currentFolder)}
                    onDragStart={() => {
                      // Track that we're dragging the folder name to prevent click from firing
                      folderNameDragRef.current = true;
                    }}
                    onDragMove={(e) => {
                      const newX = e.target.x();
                      const newY = e.target.y();
                      const now = Date.now();
                      
                      // Always update dragged folder position for smooth movement
                      const updatedFolders = folders.map((f) => 
                        f.id === currentFolder.id ? { ...f, x: newX, y: newY } : f
                      );
                      
                      // Always reflow images for the dragged folder
                      const folderImgs = images.filter(img => currentFolder.imageIds.includes(img.id));
                      let updatedImages = [...images];
                      if (folderImgs.length > 0) {
                        const reflowedImages = reflowImagesInFolder(folderImgs, newX, newY, currentFolder.width);
                        updatedImages = images.map((img) => {
                          const reflowed = reflowedImages.find(r => r.id === img.id);
                          return reflowed ? reflowed : img;
                        });
                      }
                      
                      // Throttle overlap resolution for smooth performance
                      if (now - lastOverlapCheckRef.current >= overlapThrottleMs) {
                        lastOverlapCheckRef.current = now;
                        const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
                          updatedFolders,
                          updatedImages,
                          currentFolder.id
                        );
                        setFolders(resolvedFolders);
                        setImages(resolvedImages);
                      } else {
                        // Just update the dragged folder without overlap check
                        setFolders(updatedFolders);
                        setImages(updatedImages);
                      }
                    }}
                    onDragEnd={async () => {
                      // Reset drag flag after a short delay to prevent click from firing
                      setTimeout(() => {
                        folderNameDragRef.current = false;
                      }, 100);
                      
                      // Final overlap resolution to ensure clean state
                      const { folders: finalFolders, images: finalImages } = resolveOverlapsAndReflow(
                        folders,
                        images,
                        currentFolder.id
                      );
                      setFolders(finalFolders);
                      setImages(finalImages);
                      saveToHistory();
                      
                      // Persist folder and image positions to Supabase
                      if (user) {
                        // Save all folder positions (some may have been pushed)
                        for (const f of finalFolders) {
                          supabase.from('photo_folders')
                            .update({ x: Math.round(f.x), y: Math.round(f.y) })
                            .eq('id', f.id)
                            .eq('user_id', user.id)
                            .then(({ error }) => {
                              if (error) console.error('Failed to update folder position:', error);
                            });
                        }
                        
                        // Save all images positions
                        const allFolderImages = finalImages.filter((img: CanvasImage) => img.storagePath && img.folderId);
                        for (const img of allFolderImages) {
                          supabase.from('photo_edits')
                            .update({ x: Math.round(img.x), y: Math.round(img.y) })
                            .eq('storage_path', img.storagePath!)
                            .eq('user_id', user.id)
                            .then(({ error }) => {
                              if (error) console.error('Failed to update image position:', error);
                            });
                        }
                      }
                    }}
                  />
                  
                  
                  {/* Folder Border - Below the label */}
                  <Rect
                    x={borderX}
                    y={borderY}
                    width={borderWidth}
                    height={Math.max(borderHeight, 80)}
                    stroke={currentFolder.color}
                    strokeWidth={dragHoveredFolderId === currentFolder.id || isHovered ? 3 : 1}
                    cornerRadius={12}
                    dash={dragHoveredFolderId === currentFolder.id || isHovered ? undefined : [8, 4]}
                    opacity={dragHoveredFolderId === currentFolder.id || isHovered ? 0.9 : 0.4}
                    shadowColor={currentFolder.color}
                    shadowBlur={dragHoveredFolderId === currentFolder.id || isHovered ? 20 : 0}
                    shadowOpacity={dragHoveredFolderId === currentFolder.id || isHovered ? 0.6 : 0}
                    onMouseEnter={() => setHoveredFolderBorder(currentFolder.id)}
                    onMouseLeave={() => {
                      if (!resizingFolderId) setHoveredFolderBorder(null);
                    }}
                  />
                  
                  {/* Resize Handle - Right edge */}
                  <Rect
                    x={borderX + borderWidth - 8}
                    y={borderY + borderHeight / 2 - 20}
                    width={16}
                    height={40}
                    fill={isHovered || isResizing ? currentFolder.color : 'transparent'}
                    opacity={isHovered || isResizing ? 0.6 : 0}
                    cornerRadius={4}
                    draggable
                    dragBoundFunc={(pos) => {
                      // Only allow horizontal dragging
                      const minWidth = GRID_CONFIG.minFolderWidth;
                      const newWidth = pos.x - borderX + 8;
                      const clampedWidth = Math.max(minWidth, newWidth);
                      return {
                        x: borderX + clampedWidth - 8,
                        y: borderY + borderHeight / 2 - 20
                      };
                    }}
                    onMouseEnter={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container) container.style.cursor = 'ew-resize';
                      setHoveredFolderBorder(currentFolder.id);
                    }}
                    onMouseLeave={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container && !resizingFolderId) container.style.cursor = 'default';
                      if (!resizingFolderId) setHoveredFolderBorder(null);
                    }}
                    onDragStart={() => {
                      setResizingFolderId(currentFolder.id);
                    }}
                    onDragMove={(e) => {
                      const newWidth = e.target.x() - borderX + 8;
                      const clampedWidth = Math.max(GRID_CONFIG.minFolderWidth, newWidth);
                      const now = Date.now();
                      
                      // Recalculate border height based on new width
                      const newCols = calculateColsFromWidth(clampedWidth);
                      const newRows = Math.ceil(folderImages.length / newCols) || 1;
                      const newContentHeight = newRows * CELL_SIZE + (folderPadding * 2);
                      const newBorderHeight = Math.max(newContentHeight, 100);
                      
                      // Update folder width
                      const updatedFolders = folders.map((f) => 
                        f.id === currentFolder.id ? { ...f, width: clampedWidth } : f
                      );
                      
                      // Update the handle position to stay aligned with the border (center vertically)
                      const handleX = borderX + clampedWidth - 8;
                      const handleY = borderY + newBorderHeight / 2 - 20;
                      e.target.x(handleX);
                      e.target.y(handleY);
                      
                      // Reflow images within the folder
                      const folderImgs = images.filter(img => currentFolder.imageIds.includes(img.id));
                      let updatedImages = [...images];
                      if (folderImgs.length > 0) {
                        const reflowedImages = reflowImagesInFolder(folderImgs, currentFolder.x, currentFolder.y, clampedWidth);
                        updatedImages = images.map((img) => {
                          const reflowed = reflowedImages.find(r => r.id === img.id);
                          return reflowed ? reflowed : img;
                        });
                      }
                      
                      // Throttle overlap resolution for smooth performance
                      if (now - lastOverlapCheckRef.current >= overlapThrottleMs) {
                        lastOverlapCheckRef.current = now;
                        const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
                          updatedFolders,
                          updatedImages,
                          currentFolder.id
                        );
                        setFolders(resolvedFolders);
                        setImages(resolvedImages);
                      } else {
                        // Just update the resized folder without overlap check
                        setFolders(updatedFolders);
                        setImages(updatedImages);
                      }
                    }}
                    onDragEnd={async (e) => {
                      const container = e.target.getStage()?.container();
                      if (container) container.style.cursor = 'default';
                      setResizingFolderId(null);
                      setHoveredFolderBorder(null);
                      
                      // Final overlap resolution to ensure clean state
                      const { folders: finalFolders, images: finalImages } = resolveOverlapsAndReflow(
                        folders,
                        images,
                        currentFolder.id
                      );
                      setFolders(finalFolders);
                      setImages(finalImages);
                      saveToHistory();
                      
                      // Persist folder positions/widths and image positions to Supabase
                      if (user) {
                        // Save all folder positions (some may have been pushed)
                        for (const f of finalFolders) {
                          supabase.from('photo_folders')
                            .update({ x: Math.round(f.x), y: Math.round(f.y), width: Math.round(f.width) })
                            .eq('id', f.id)
                            .eq('user_id', user.id)
                            .then(({ error }) => {
                              if (error) console.error('Failed to update folder:', error);
                            });
                        }
                        
                        // Save all images positions
                        const allFolderImages = finalImages.filter((img: CanvasImage) => img.storagePath && img.folderId);
                        for (const img of allFolderImages) {
                          supabase.from('photo_edits')
                            .update({ x: Math.round(img.x), y: Math.round(img.y) })
                            .eq('storage_path', img.storagePath!)
                            .eq('user_id', user.id)
                            .then(({ error }) => {
                              if (error) console.error('Failed to update image position:', error);
                            });
                        }
                      }
                    }}
                  />
                </Group>
              );
            })}

            {images.map((img) => (
              <ImageNode
                key={img.id}
                image={img}
                isSelected={selectedId === img.id}
                onClick={handleObjectClick}
                onDragEnd={(e) => {
                  setDragHoveredFolderId(null);
                  handleObjectDragEnd(e, 'image');
                }}
                onDragMove={handleImageDragMove}
                onUpdate={(updates) => {
                  setImages((prev) =>
                    prev.map((i) => (i.id === img.id ? { ...i, ...updates } : i))
                  );
                }}
              />
            ))}
            {texts.map((txt) => (
              <TextNode
                key={txt.id}
                text={txt}
                isSelected={selectedId === txt.id}
                onClick={handleObjectClick}
                onDragEnd={(e) => handleObjectDragEnd(e, 'text')}
                onUpdate={(updates) => {
                  setTexts((prev) =>
                    prev.map((t) => (t.id === txt.id ? { ...t, ...updates } : t))
                  );
                }}
              />
            ))}

            <Transformer
              ref={transformerRef}
              boundBoxFunc={(oldBox, newBox) => {
                // Limit resize
                if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) {
                  return oldBox;
                }
                return newBox;
              }}
            />
          </Layer>
        </Stage>
        
        {/* Plus buttons for each folder - positioned to the right of folder name */}
        {folders.map((folder) => {
          // Get the current folder from state to ensure we have the latest position
          const currentFolder = folders.find(f => f.id === folder.id) || folder;
          
          // Position to the right of folder name
          // Folder name is at folder.x, folder.y with fontSize 16, fontStyle "600"
          // Text baseline is at folder.y, so center vertically is at folder.y + 8 (half of fontSize 16)
          // We need to estimate the width of the folder name text
          const folderNameWidth = currentFolder.name.length * 9.5; // Estimate for bold text at fontSize 16
          const plusButtonX = currentFolder.x + folderNameWidth + 12; // 12px gap after folder name
          const plusButtonY = currentFolder.y + 8; // Center vertically with folder name (fontSize 16 / 2 = 8)
          
          // Convert stage coordinates to screen coordinates
          const screenX = plusButtonX * stageScale + stagePosition.x;
          const screenY = plusButtonY * stageScale + stagePosition.y;
          
          return (
            <button
              key={`plus-${currentFolder.id}-${currentFolder.x}-${currentFolder.y}-${stageScale}`}
              onClick={() => handleAddPhotosToFolder(currentFolder.id)}
              className="absolute pointer-events-auto cursor-pointer bg-transparent p-0 m-0 rounded-full flex items-center justify-center z-10 border border-dashed border-[#3ECF8E]"
              style={{
                left: `${screenX}px`,
                top: `${screenY}px`,
                width: `${28 * stageScale}px`,
                height: `${28 * stageScale}px`,
                transform: 'translate(-50%, -50%)',
                borderWidth: `${1 * stageScale}px`,
              }}
            >
              <span 
                className="text-[#3ECF8E] font-bold leading-none flex items-center justify-center w-full h-full"
                style={{
                  fontSize: `${18 * stageScale}px`,
                }}
              >
                +
              </span>
            </button>
          );
        })}
      </div>

      {selectedObject && (
        <EditPanel
          object={selectedObject}
          onUpdate={(updates) => {
            if ('src' in selectedObject) {
              setImages((prev) =>
                prev.map((img) => (img.id === selectedId ? { ...img, ...updates } : img))
              );
            } else {
              setTexts((prev) =>
                prev.map((txt) => (txt.id === selectedId ? { ...txt, ...updates } : txt))
              );
            }
          }}
          onDelete={async () => {
            if ('src' in selectedObject) {
              const imageToDelete = selectedObject as CanvasImage;
              
              // Try to delete from Supabase Storage
              try {
                // Extract the path from the Supabase URL
                // URL format: https://[project].supabase.co/storage/v1/object/public/photos/[user_id]/[filename]
                const url = new URL(imageToDelete.src);
                const pathMatch = url.pathname.match(/\/storage\/v1\/object\/public\/photos\/(.+)/);
                
                if (pathMatch && pathMatch[1]) {
                  const filePath = decodeURIComponent(pathMatch[1]);
                  const { error } = await supabase.storage
                    .from('photos')
                    .remove([filePath]);
                  
                  if (error) {
                    console.error('Failed to delete from Supabase:', error);
                  } else {
                    console.log('Deleted from Supabase:', filePath);
                  }
                }
              } catch (err) {
                console.error('Error deleting from Supabase:', err);
              }
              
              setImages((prev) => prev.filter((img) => img.id !== selectedId));
            } else {
              setTexts((prev) => prev.filter((txt) => txt.id !== selectedId));
            }
            setSelectedId(null);
            saveToHistory();
          }}
          onResetToOriginal={'src' in selectedObject ? () => {
            // Reset all edits to default values
            setImages((prev) =>
              prev.map((img) => img.id === selectedId ? {
                ...img,
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
              } : img)
            );
            saveToHistory();
          } : undefined}
          onSave={'src' in selectedObject ? handleSave : undefined}
        />
      )}

    </div>
  );
}

// Custom brightness filter that multiplies instead of adds (prevents black screens)
const createBrightnessFilter = (brightness: number) => {
  return function(imageData: ImageData) {
    const data = imageData.data;
    const factor = 1 + brightness;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, Math.max(0, data[i] * factor));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] * factor));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] * factor));
    }
  };
};

// Exposure filter - like brightness but uses power curve for more natural look
const createExposureFilter = (exposure: number) => {
  return function(imageData: ImageData) {
    const data = imageData.data;
    // Exposure uses 2^exposure as multiplier (like stops in photography)
    const factor = Math.pow(2, exposure);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, Math.max(0, data[i] * factor));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] * factor));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] * factor));
    }
  };
};

// Tonal filter for highlights, shadows, whites, blacks
const createTonalFilter = (highlights: number, shadows: number, whites: number, blacks: number) => {
  return function(imageData: ImageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let val = data[i + c] / 255;
        
        // Blacks (affects darkest tones)
        if (val < 0.25) {
          val += blacks * 0.5 * (0.25 - val);
        }
        
        // Shadows (affects dark-mid tones)
        if (val < 0.5) {
          const shadowMask = Math.sin(val * Math.PI);
          val += shadows * 0.3 * shadowMask * (0.5 - val);
        }
        
        // Highlights (affects light-mid tones)
        if (val > 0.5) {
          const highlightMask = Math.sin((val - 0.5) * Math.PI);
          val += highlights * 0.3 * highlightMask * (val - 0.5);
        }
        
        // Whites (affects brightest tones)
        if (val > 0.75) {
          val += whites * 0.5 * (val - 0.75);
        }
        
        data[i + c] = Math.min(255, Math.max(0, val * 255));
      }
    }
  };
};

// Temperature filter - warm/cool white balance
const createTemperatureFilter = (temperature: number) => {
  return function(imageData: ImageData) {
    const data = imageData.data;
    // Positive = warmer (more red/yellow), Negative = cooler (more blue)
    const tempFactor = temperature * 30; // Scale to reasonable RGB shift
    for (let i = 0; i < data.length; i += 4) {
      // Warm: boost red, reduce blue
      // Cool: boost blue, reduce red
      data[i] = Math.min(255, Math.max(0, data[i] + tempFactor));       // R
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] - tempFactor)); // B
    }
  };
};

// Vibrance filter - smart saturation that protects skin tones
const createVibranceFilter = (vibrance: number) => {
  return function(imageData: ImageData) {
    const data = imageData.data;
    const amt = vibrance * 1.5;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      
      // Less saturation boost for already saturated colors
      const factor = 1 + amt * (1 - sat);
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      
      data[i] = Math.min(255, Math.max(0, gray + (r - gray) * factor));
      data[i + 1] = Math.min(255, Math.max(0, gray + (g - gray) * factor));
      data[i + 2] = Math.min(255, Math.max(0, gray + (b - gray) * factor));
    }
  };
};

// Clarity filter - midtone contrast enhancement
const createClarityFilter = (clarity: number) => {
  return function(imageData: ImageData) {
    const data = imageData.data;
    const factor = 1 + clarity * 0.5;
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const val = data[i + c] / 255;
        // Apply S-curve centered on midtones
        const midtone = 0.5;
        const diff = val - midtone;
        const newVal = midtone + diff * factor;
        data[i + c] = Math.min(255, Math.max(0, newVal * 255));
      }
    }
  };
};

// Dehaze filter - remove atmospheric haze
const createDehazeFilter = (dehaze: number) => {
  return function(imageData: ImageData) {
    const data = imageData.data;
    // Increase contrast and saturation in a haze-aware way
    const contrastBoost = 1 + dehaze * 0.5;
    const satBoost = 1 + dehaze * 0.3;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      
      // Contrast
      let nr = 128 + (r - 128) * contrastBoost;
      let ng = 128 + (g - 128) * contrastBoost;
      let nb = 128 + (b - 128) * contrastBoost;
      
      // Saturation
      const ngray = 0.299 * nr + 0.587 * ng + 0.114 * nb;
      nr = ngray + (nr - ngray) * satBoost;
      ng = ngray + (ng - ngray) * satBoost;
      nb = ngray + (nb - ngray) * satBoost;
      
      data[i] = Math.min(255, Math.max(0, nr));
      data[i + 1] = Math.min(255, Math.max(0, ng));
      data[i + 2] = Math.min(255, Math.max(0, nb));
    }
  };
};

// Vignette filter - darken edges
const createVignetteFilter = (vignette: number) => {
  return function(imageData: ImageData) {
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    const cx = w / 2;
    const cy = h / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);
    
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
        
        // Smooth falloff
        const falloff = Math.pow(dist, 2) * vignette;
        const factor = Math.max(0, 1 - falloff);
        
        data[i] *= factor;
        data[i + 1] *= factor;
        data[i + 2] *= factor;
      }
    }
  };
};

// Grain filter - add film-like noise
const createGrainFilter = (grain: number) => {
  return function(imageData: ImageData) {
    const data = imageData.data;
    const intensity = grain * 50;
    
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * intensity;
      data[i] = Math.min(255, Math.max(0, data[i] + noise));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
    }
  };
};

// Build a lookup table from curve points
const buildLUT = (points: CurvePoint[]): Uint8Array => {
  const lut = new Uint8Array(256);
  const sorted = [...points].sort((a, b) => a.x - b.x);

  // Interpolation function using Catmull-Rom spline
  const interpolate = (x: number): number => {
    if (sorted.length === 0) return x;
    if (sorted.length === 1) return sorted[0].y;
    if (x <= sorted[0].x) return sorted[0].y;
    if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;

    let i = 0;
    while (i < sorted.length - 1 && sorted[i + 1].x < x) i++;

    const p0 = sorted[Math.max(0, i - 1)];
    const p1 = sorted[i];
    const p2 = sorted[Math.min(sorted.length - 1, i + 1)];
    const p3 = sorted[Math.min(sorted.length - 1, i + 2)];

    const t = (x - p1.x) / (p2.x - p1.x || 1);
    const t2 = t * t;
    const t3 = t2 * t;

    const y = 0.5 * (
      (2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    );

    return Math.max(0, Math.min(255, Math.round(y)));
  };

  // Build lookup table
  for (let i = 0; i < 256; i++) {
    lut[i] = interpolate(i);
  }

  return lut;
};

// Custom curves filter using lookup tables for RGB + individual channels
const createCurvesFilter = (curves: ChannelCurves) => {
  // Pre-compute lookup tables for each channel
  const rgbLUT = buildLUT(curves.rgb);
  const redLUT = buildLUT(curves.red);
  const greenLUT = buildLUT(curves.green);
  const blueLUT = buildLUT(curves.blue);

  return function(imageData: ImageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      // Apply RGB curve first, then individual channel curves
      data[i] = redLUT[rgbLUT[data[i]]];         // R
      data[i + 1] = greenLUT[rgbLUT[data[i + 1]]]; // G
      data[i + 2] = blueLUT[rgbLUT[data[i + 2]]]; // B
    }
  };
};

// Image node component
function ImageNode({
  image,
  onClick,
  onDragEnd,
  onDragMove,
  onUpdate,
}: {
  image: CanvasImage;
  isSelected: boolean;
  onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onUpdate: (updates: Partial<CanvasImage>) => void;
}) {
  const [img, imgStatus] = useImage(image.src, 'anonymous');
  const imageRef = useRef<Konva.Image>(null);

  // Check if any channel curves are modified
  const isCurveChannelModified = (points: CurvePoint[]) => {
    if (!points || points.length === 0) return false;
    if (points.length > 2) return true;
    return points.some((p, i) => {
      if (i === 0) return p.x !== 0 || p.y !== 0;
      if (i === points.length - 1) return p.x !== 255 || p.y !== 255;
      return true;
    });
  };

  const isCurvesModified = image.curves && (
    isCurveChannelModified(image.curves.rgb) ||
    isCurveChannelModified(image.curves.red) ||
    isCurveChannelModified(image.curves.green) ||
    isCurveChannelModified(image.curves.blue)
  );

  // Check if any filters are active
  const hasActiveFilters = 
    // Light
    image.exposure !== 0 ||
    image.contrast !== 0 ||
    image.highlights !== 0 ||
    image.shadows !== 0 ||
    image.whites !== 0 ||
    image.blacks !== 0 ||
    // Color
    image.temperature !== 0 ||
    image.vibrance !== 0 ||
    image.saturation !== 0 ||
    // Effects
    image.clarity !== 0 ||
    image.dehaze !== 0 ||
    image.vignette !== 0 ||
    image.grain !== 0 ||
    // Legacy
    image.brightness !== 0 ||
    image.hue !== 0 ||
    image.blur > 0 ||
    image.filters.length > 0 ||
    // Curves
    isCurvesModified;

  useEffect(() => {
    if (!imageRef.current || !img) return;
    
    const node = imageRef.current;

    // If no filters are active, clear everything and don't cache
    if (!hasActiveFilters) {
      node.clearCache();
      node.filters([]);
      return;
    }

    // Build filter list - using array of filter functions
    const filterList: ((imageData: ImageData) => void)[] = [];

    // Apply curves filter first (if modified)
    if (isCurvesModified && image.curves) {
      filterList.push(createCurvesFilter(image.curves));
    }

    // Light adjustments
    if (image.exposure !== 0) {
      filterList.push(createExposureFilter(image.exposure));
    }
    if (image.highlights !== 0 || image.shadows !== 0 || image.whites !== 0 || image.blacks !== 0) {
      filterList.push(createTonalFilter(image.highlights, image.shadows, image.whites, image.blacks));
    }

    // Color adjustments
    if (image.temperature !== 0) {
      filterList.push(createTemperatureFilter(image.temperature));
    }
    if (image.vibrance !== 0) {
      filterList.push(createVibranceFilter(image.vibrance));
    }

    // Effects
    if (image.clarity !== 0) {
      filterList.push(createClarityFilter(image.clarity));
    }
    if (image.dehaze !== 0) {
      filterList.push(createDehazeFilter(image.dehaze));
    }
    if (image.vignette !== 0) {
      filterList.push(createVignetteFilter(image.vignette));
    }
    if (image.grain !== 0) {
      filterList.push(createGrainFilter(image.grain));
    }

    // Legacy filters
    if (image.brightness !== 0) {
      filterList.push(createBrightnessFilter(image.brightness));
    }
    if (image.contrast !== 0) {
      filterList.push(Konva.Filters.Contrast as unknown as (imageData: ImageData) => void);
    }
    if (image.saturation !== 0 || image.hue !== 0) {
      filterList.push(Konva.Filters.HSV as unknown as (imageData: ImageData) => void);
    }
    if (image.blur > 0) {
      filterList.push(Konva.Filters.Blur as unknown as (imageData: ImageData) => void);
    }
    if (image.filters.includes('grayscale')) {
      filterList.push(Konva.Filters.Grayscale as unknown as (imageData: ImageData) => void);
    }
    if (image.filters.includes('sepia')) {
      filterList.push(Konva.Filters.Sepia as unknown as (imageData: ImageData) => void);
    }
    if (image.filters.includes('invert')) {
      filterList.push(Konva.Filters.Invert as unknown as (imageData: ImageData) => void);
    }
    if (image.filters.includes('noise')) {
      filterList.push(Konva.Filters.Noise as unknown as (imageData: ImageData) => void);
    }

    // Apply Konva filter values
    node.contrast(image.contrast);
    node.saturation(image.saturation);
    node.hue(image.hue);
    node.blurRadius(image.blur);
    node.noise(image.filters.includes('noise') ? 0.2 : 0);

    // Calculate optimal pixelRatio for high quality rendering
    // Use the ratio of original image size to display size to maintain full resolution quality
    const naturalWidth = img.naturalWidth || img.width;
    const naturalHeight = img.naturalHeight || img.height;
    const displayWidth = image.width * Math.abs(image.scaleX || 1);
    const displayHeight = image.height * Math.abs(image.scaleY || 1);
    
    // Calculate scale factor from original to display
    // This tells us how much the image was downscaled for display
    const widthRatio = displayWidth > 0 ? naturalWidth / displayWidth : 1;
    const heightRatio = displayHeight > 0 ? naturalHeight / displayHeight : 1;
    const scaleRatio = Math.min(widthRatio, heightRatio);
    
    // Use a high pixelRatio to maintain quality:
    // - At least 4x for general quality
    // - Match or exceed the downscale ratio to preserve original detail
    // - Cap at 10x to balance quality and performance
    const basePixelRatio = window.devicePixelRatio || 2;
    const qualityPixelRatio = Math.min(
      Math.max(scaleRatio * 0.8, 4), // Use 80% of scale ratio, minimum 4x
      10 // Cap at 10x for performance
    );

    // Apply filters and cache with high pixel ratio for quality
    node.filters(filterList);
    node.cache({
      pixelRatio: qualityPixelRatio,
      imageSmoothingEnabled: true,
    });
  }, [img, hasActiveFilters, isCurvesModified, image]);

  // Don't render until image is loaded
  if (!img || imgStatus === 'loading') {
    return null;
  }

  return (
    <KonvaImage
      ref={imageRef}
      id={image.id}
      image={img}
      x={image.x}
      y={image.y}
      width={image.width}
      height={image.height}
      rotation={image.rotation}
      scaleX={image.scaleX}
      scaleY={image.scaleY}
      draggable
      onClick={onClick}
      onMouseEnter={(e) => {
        const container = e.target.getStage()?.container();
        if (container) container.style.cursor = 'pointer';
      }}
      onMouseLeave={(e) => {
        const container = e.target.getStage()?.container();
        if (container) container.style.cursor = 'default';
      }}
      onDragEnd={onDragEnd}
      onDragMove={onDragMove}
      onTransformEnd={() => {
        const node = imageRef.current;
        if (!node) return;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        const rotation = node.rotation();
        onUpdate({ scaleX, scaleY, rotation });
      }}
    />
  );
}

// Text node component
function TextNode({
  text,
  onClick,
  onDragEnd,
  onUpdate,
}: {
  text: CanvasText;
  isSelected: boolean;
  onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onUpdate: (updates: Partial<CanvasText>) => void;
}) {
  const textRef = useRef<Konva.Text>(null);

  useEffect(() => {
    if (textRef.current) {
      const node = textRef.current;
      node.x(text.x);
      node.y(text.y);
      node.text(text.text);
      node.fontSize(text.fontSize);
      node.fill(text.fill);
      node.rotation(text.rotation);
    }
  }, [text.x, text.y, text.text, text.fontSize, text.fill, text.rotation]);

  return (
    <Text
      ref={textRef}
      id={text.id}
      x={text.x}
      y={text.y}
      text={text.text}
      fontSize={text.fontSize}
      fill={text.fill}
      rotation={text.rotation}
      draggable
      onClick={onClick}
      onDragEnd={onDragEnd}
      onTransformEnd={() => {
        const node = textRef.current;
        if (!node) return;
        const rotation = node.rotation();
        onUpdate({ rotation, x: node.x(), y: node.y() });
      }}
    />
  );
}
