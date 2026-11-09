// A 16x16 pixel-art chrome pinball, NES palette. Returns an SVG string (crisp at any size).
const G = 16;
export function pinballSvg() {
  const rects = [];
  const c = 7.5, r = 7.4;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    const dx = (x - c) / r, dy = (y - c) / r;
    const d = Math.hypot(dx, dy);
    if (d > 1) continue;
    let col;
    if (d > 0.86) col = '#000000'; // outline
    else {
      const nz = Math.sqrt(Math.max(0, 1 - d * d));
      const light = -0.55 * dx - 0.65 * dy + 0.5 * nz; // lit from top-left
      if ((x === 4 || x === 5) && (y === 4 || y === 5)) col = '#fcfcfc'; // glint
      else if (dy > 0.45 && dx > -0.35 && dx < 0.45 && d > 0.6) col = '#3cbcfc'; // playfield reflection
      else if (light > 0.9) col = '#fcfcfc';
      else if (light > 0.55) col = '#bcbcbc';
      else if (light > 0.1) col = '#7c7c7c';
      else col = '#3c3c5c';
    }
    rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${col}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G} ${G}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}
export const pinballDataUrl = () => `data:image/svg+xml;utf8,${encodeURIComponent(pinballSvg())}`;
