/**
 * image.js — client-side image helpers.
 *
 * fileToDataUrl downsizes an image to a max dimension and returns a compact
 * data URL. Used for course thumbnails / avatars so we never depend on a
 * cross-origin presigned upload (which can fail with "Failed to fetch").
 */

export function fileToDataUrl(file, { maxDim = 800, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(reader.result); // fall back to raw data URL
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          // PNG keeps transparency; everything else → JPEG for size.
          const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          resolve(canvas.toDataURL(mime, quality));
        } catch {
          resolve(reader.result);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
