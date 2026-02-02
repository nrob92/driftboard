/**
 * Next.js instrumentation: runs once when the Node server starts.
 * Configures Sharp (libvips) concurrency for better parallel image processing.
 * @see https://sharp.pixelplumbing.com/performance/
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const os = await import('os');
    const sharp = await import('sharp');
    const concurrency = Math.max(1, os.cpus().length);
    sharp.default.concurrency(concurrency);
  }
}
