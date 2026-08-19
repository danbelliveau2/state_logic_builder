/**
 * imageUtils.js — client-side image prep for JARVIS uploads.
 *
 * downscaleImage(file): downscale a File to max 1568px long edge (Claude's
 * vision sweet spot) and return { name, base64, mediaType, previewUrl }.
 * Used by JarvisDescribeModal and SpecEditorModal drag-drop zones.
 */

export const MAX_IMAGE_EDGE = 1568;

export function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        URL.revokeObjectURL(objUrl);
        resolve({
          name: file.name,
          base64: dataUrl.split(',')[1],
          mediaType: 'image/jpeg',
          previewUrl: dataUrl,
        });
      } catch (e) { URL.revokeObjectURL(objUrl); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error(`Could not read image ${file.name}`)); };
    img.src = objUrl;
  });
}
