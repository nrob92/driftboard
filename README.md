# Driftboard

A web-based Lightroom-style photo editor with an infinite canvas workspace. Built with Next.js, Supabase, and react-konva.

## Features

### Canvas Workspace
- 🎨 Infinite canvas with zoom/pan (mouse wheel + touch support)
- 📁 Organize photos in draggable folders (Figma-style layout)
- 🔄 Grid snapping for precise organization
- ↩️ Undo/redo functionality
- 🔐 Google OAuth authentication

### Photo Support
- 📸 Upload JPEG, PNG, WebP images
- 🎞️ **DNG/RAW file support** with automatic preview generation
- ☁️ Cloud storage via Supabase (public preview bucket + private originals bucket)
- 💾 Non-destructive editing workflow

### Professional Photo Editing (Lightroom-style)

**Tonal Adjustments:**
- Exposure, Contrast
- Highlights, Shadows
- Whites, Blacks

**Color Adjustments:**
- Temperature, Tint
- Vibrance, Saturation
- Shadow Tint

**Effects:**
- Clarity, Dehaze
- Vignette, Grain

**Advanced:**
- RGB Curves (Master + per-channel Red/Green/Blue)
- HSL per-color adjustments (Hue, Saturation, Luminance for 8 colors)
- Split Toning (separate color grading for shadows/highlights)
- Color Grading (shadows, midtones, highlights)
- Color Calibration (RGB primary adjustments)

### Presets
- 💾 Save custom editing presets
- 📋 Apply presets to any photo
- 📥 Import Lightroom XMP presets

### Export
- 📤 Server-side processing for full-resolution exports
- 🎯 Applies all edits to original DNG/RAW files
- 🖼️ High-quality JPEG output

## Tech Stack

- **Next.js 16** - React framework with App Router
- **TypeScript** - Type safety
- **react-konva** - Canvas rendering and manipulation
- **Konva.js** - Image filters and transformations
- **Supabase** - Authentication and cloud storage
- **Sharp** - Server-side image processing
- **exifr** - EXIF/DNG metadata extraction
- **libraw-wasm** - Client-side RAW/DNG decoding
- **Tailwind CSS** - Styling

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase account

### Installation

1. Clone and install:

```bash
npm install
```

2. Set up environment variables:

Create a `.env.local` file:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

3. Set up Supabase:

**Storage Buckets:**
- Create a `photos` bucket (public) for preview images
- Create an `originals` bucket (private) for DNG/RAW originals

**Database:**
Run the migrations in `supabase/migrations/`:
- `20250130_create_photo_edits_table.sql`
- `20250130_create_photo_folders_table.sql`
- `20250201_add_missing_photo_edit_columns.sql`
- `20250202_add_dng_support.sql`
- `20250202_storage_originals_policies.sql`

**Authentication:**
- Enable Google OAuth provider in Supabase dashboard
- Add your site URL to allowed redirect URLs

4. Run the development server:

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000)

## Usage

1. **Sign in** with Google
2. **Upload photos** - Click Upload or drag and drop (supports JPEG, PNG, WebP, DNG)
3. **Organize** - Drag photos into folders on the infinite canvas
4. **Edit** - Select a photo and use the right panel for professional editing controls
5. **Save presets** - Save your favorite editing settings
6. **Export** - Click Export for full-resolution processed images

## Project Structure

```
driftboard/
├── app/
│   ├── api/
│   │   ├── upload-dng/    # DNG upload & preview extraction
│   │   ├── export/        # Server-side image processing
│   │   └── delete-photo/  # Photo deletion
│   ├── login/            # Authentication page
│   └── page.tsx          # Main canvas editor
├── components/
│   ├── CanvasEditor.tsx  # Main infinite canvas component
│   ├── EditPanel.tsx     # Photo editing controls
│   ├── CurvesEditor.tsx  # RGB curves editor
│   └── TopBar.tsx        # Navigation and actions
├── lib/
│   ├── auth.tsx          # Auth context provider
│   ├── supabase.ts       # Supabase client
│   ├── serverFilters.ts  # Server-side image filters
│   ├── dngDecoder.ts     # Client-side DNG decoding
│   └── utils.ts          # Helper functions
└── supabase/
    └── migrations/       # Database migrations
```

## Deploy on Vercel

1. Push to GitHub
2. Import repository on [Vercel](https://vercel.com)
3. Add environment variables
4. Deploy

## License

MIT
