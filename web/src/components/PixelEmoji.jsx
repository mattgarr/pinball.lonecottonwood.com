// Turns any emoji into a chunky 8-bit sprite: draw it on a tiny grid, snap colors and alpha to a few
// levels, add a dark outline, then show it scaled up with hard pixel edges. Cached per emoji/grid.
const cache = new Map();
const LEVELS = 5; // color steps per channel (NES-ish posterize)

function sprite(emoji, grid) {
  const key = `${emoji}|${grid}`;
  if (cache.has(key)) return cache.get(key);
  let url = '';
  try {
    const c = document.createElement('canvas');
    c.width = c.height = grid;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = `${Math.round(grid * 0.92)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    x.fillText(emoji, grid / 2, grid / 2 + grid * 0.06);
    const img = x.getImageData(0, 0, grid, grid);
    const d = img.data;
    const solid = new Uint8Array(grid * grid);
    const q = v => Math.round((v / 255) * (LEVELS - 1)) * (255 / (LEVELS - 1));
    for (let i = 0; i < grid * grid; i++) {
      const a = d[i * 4 + 3];
      if (a > 96) {
        solid[i] = 1;
        // un-premultiply edge pixels, then posterize
        const k = 255 / a;
        d[i * 4] = q(Math.min(255, d[i * 4] * (a < 255 ? k : 1)));
        d[i * 4 + 1] = q(Math.min(255, d[i * 4 + 1] * (a < 255 ? k : 1)));
        d[i * 4 + 2] = q(Math.min(255, d[i * 4 + 2] * (a < 255 ? k : 1)));
        d[i * 4 + 3] = 255;
      } else {
        d[i * 4 + 3] = 0;
      }
    }
    // 1px dark outline around the sprite, like classic game characters
    for (let y = 0; y < grid; y++) for (let xx = 0; xx < grid; xx++) {
      const i = y * grid + xx;
      if (solid[i]) continue;
      const n = (yy, xa) => yy >= 0 && yy < grid && xa >= 0 && xa < grid && solid[yy * grid + xa];
      if (n(y - 1, xx) || n(y + 1, xx) || n(y, xx - 1) || n(y, xx + 1)) {
        d[i * 4] = 15; d[i * 4 + 1] = 15; d[i * 4 + 2] = 27; d[i * 4 + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    url = c.toDataURL('image/png');
  } catch { url = ''; }
  cache.set(key, url);
  return url;
}

export default function PixelEmoji({ e, size = 24, grid = 16, className = '', title }) {
  if (!e) return null;
  const url = typeof document !== 'undefined' ? sprite(e, grid) : '';
  if (!url) return <span className={className} style={{ fontSize: size * 0.85, lineHeight: 1 }}>{e}</span>;
  return (
    <img
      className={`px-emoji ${className}`}
      src={url}
      width={size}
      height={size}
      alt={title || e}
      draggable={false}
      style={{ imageRendering: 'pixelated', width: size, height: size, display: 'inline-block', verticalAlign: 'middle' }}
    />
  );
}
