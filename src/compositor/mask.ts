/**
 * Convert a PSD grayscale mask into a document-sized alpha mask usable with
 * Canvas `destination-in`. PSD masks are not ordinary alpha images: their
 * grayscale channel is the coverage value.
 */
export function createPsdMaskAlphaCanvas(
    bitmap: ImageBitmap,
    width: number,
    height: number,
    left: number,
    top: number,
    defaultColor = 0,
    density = 1,
    feather = 0,
): HTMLCanvasElement | null {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return null;

    const base = Math.max(0, Math.min(255, defaultColor));
    maskCtx.fillStyle = `rgb(${base}, ${base}, ${base})`;
    maskCtx.fillRect(0, 0, width, height);
    if (feather > 0) maskCtx.filter = `blur(${Math.min(feather, 256)}px)`;
    maskCtx.drawImage(bitmap, left, top);
    maskCtx.filter = 'none';

    const image = maskCtx.getImageData(0, 0, width, height);
    for (let i = 0; i < image.data.length; i += 4) {
        image.data[i + 3] = Math.round(image.data[i] * image.data[i + 3] * Math.max(0, Math.min(1, density)) / 255);
        image.data[i] = 255;
        image.data[i + 1] = 255;
        image.data[i + 2] = 255;
    }
    maskCtx.putImageData(image, 0, 0);
    return maskCanvas;
}
