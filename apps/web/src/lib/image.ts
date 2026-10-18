// Shrinking a roster photo before upload (docs/design.md § Roster extraction): the long edge at
// most 2000 px, encoded as JPEG at quality 0.9. A phone photo of 4000×3000 is several MB; the
// server takes up to 5 MB, and Claude reads a 2000 px roster as well as a larger one.

/** The longest edge, in pixels, of an uploaded roster photo. */
export const MAX_EDGE = 2000;

const JPEG_QUALITY = 0.9;

/** width×height scaled down so its long edge is at most maxEdge, keeping the aspect ratio. */
export function scaledSize(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void };

// createImageBitmap applies the photo's EXIF orientation; an <img> is the fallback for browsers
// without it. Either way the browser decodes HEIC from an iPhone where it can.
async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Draws the photo on a canvas no larger than MAX_EDGE on its long edge and returns it as JPEG. */
export async function downscaleImage(file: Blob): Promise<Blob> {
  const image = await decode(file);
  try {
    const { width, height } = scaledSize(image.width, image.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.drawImage(image.source, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("could not encode image"))), "image/jpeg", JPEG_QUALITY),
    );
  } finally {
    image.close();
  }
}
