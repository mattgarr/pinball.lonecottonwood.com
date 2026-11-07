// Load a picked image file, center-crop to a square, downscale, and return a compact
// JPEG data URL — small enough to store inline and send over the LAN (~15-30KB).
export async function fileToAvatarDataUrl(file, size = 256) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const s = Math.min(img.width, img.height);
  const sx = (img.width - s) / 2;
  const sy = (img.height - s) / 2;
  ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.82);
}
