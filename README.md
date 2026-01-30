# Driftboard

A Figma-inspired photo editing web app built with Next.js, Supabase, and react-konva.

## Features

- 🎨 Infinite canvas with zoom/pan (mouse wheel + touch support)
- 📸 Drag-and-drop image upload with grid snapping
- ✏️ Image editing: crop, rotate, flip, brightness, contrast, saturation, hue, blur
- 🎭 Filters: grayscale, sepia, invert, noise
- 📝 Text overlays with draggable/resizable text
- ↩️ Undo/redo functionality
- 💾 Save to Supabase Storage or download locally

## Getting Started

### Prerequisites

- Node.js 18+ 
- A Supabase account (optional for MVP - app works without it for local saves)

### Installation

1. Clone the repository and install dependencies:

```bash
npm install
```

2. Set up environment variables:

Create a `.env.local` file in the root directory:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

> **Note:** If you don't have Supabase set up, the app will still work but will download saves locally instead of uploading to cloud storage.

3. Set up Supabase Storage (optional):

If you want cloud storage:
- Create a Supabase project at [supabase.com](https://supabase.com)
- Create a storage bucket named `photos`
- Set the bucket to public (or configure RLS policies as needed)
- Add your project URL and anon key to `.env.local`

4. Run the development server:

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

- **Upload images**: Click "Upload" or drag and drop images onto the canvas
- **Zoom**: Use mouse wheel or pinch-to-zoom on touch devices
- **Pan**: Click and drag the canvas background, or use touch gestures
- **Select objects**: Click on an image or text to select it
- **Edit**: Use the right sidebar to adjust properties when an object is selected
- **Add text**: Click "Add Text" button in the top bar
- **Save**: Click "Save" to export the canvas (uploads to Supabase if configured, otherwise downloads locally)

## Tech Stack

- **Next.js 16** - React framework with App Router
- **TypeScript** - Type safety
- **react-konva** - Canvas rendering and manipulation
- **Supabase** - Storage and optional auth
- **@tanstack/react-query** - Data fetching and caching
- **Tailwind CSS** - Styling

## Deploy on Vercel

The easiest way to deploy is using [Vercel](https://vercel.com):

1. Push your code to GitHub
2. Import your repository on Vercel
3. Add your environment variables in Vercel's dashboard
4. Deploy!

## License

MIT
