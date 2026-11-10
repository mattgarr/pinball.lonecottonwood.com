// The lights simulator's "garage wall": what the room looks like, not just two rows of LEDs.
// The top run glows along the left wall, the loft beam and the right wall and washes light down the
// wall; the six machines stand in their zones; the curb run glows behind them, just above the floor.
// Pixels come from the same renderer as before (render.js), so what you see is what the strips do.
import { useEffect, useRef } from 'react';
import { LIGHTS, bandOf } from '../lib/lights/config.js';
import { renderRange } from '../lib/lights/render.js';

export const WALL_ASPECT = 3.6; // width ÷ height

const hexA = (rgbw, a) => {
  const [r, g, b, w = 0] = rgbw || [255, 176, 32, 0];
  return `rgba(${Math.min(255, r + w)},${Math.min(255, g + w)},${Math.min(255, b + w)},${a})`;
};

export default function LightsWall({ model, speed = 1, zones, nameOf }) {
  const wrap = useRef(null), canvas = useRef(null);
  const names = useRef(nameOf);
  names.current = nameOf;
  const off = useRef({ top: null, curb: null, wash: null });
  const size = useRef({ w: 0, h: 0, dpr: 1 });

  // Keep the canvas sharp at any size.
  useEffect(() => {
    const el = wrap.current, cv = canvas.current;
    const fit = () => {
      const w = el.clientWidth, h = Math.round(w / WALL_ASPECT), dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w, h, dpr };
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.height = `${h}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const { top, curb } = LIGHTS.runs;
    const topLen = top.stop - top.start, curbLen = curb.stop - curb.start;
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    off.current.top = mk(topLen, 1);
    off.current.curb = mk(curbLen, 1);
    const font = (getComputedStyle(document.documentElement).getPropertyValue('--px') || 'monospace').trim();
    const curbShift = Math.max(0, bandOf(zones).start - top.start);

    const putRow = (c, px) => {
      const g = c.getContext('2d'), img = g.createImageData(px.length, 1);
      px.forEach(([r, gg, b], i) => { img.data.set([r, gg, b, 255], i * 4); });
      g.putImageData(img, 0, 0);
    };
    // A soft wash of light from a strip, stretched across the wall and faded with distance.
    const wash = (ctx, src, x, y, w, h, up, alpha) => {
      const c = off.current.wash || (off.current.wash = mk(1, 1));
      c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(src, 0, 0, src.width, 1, 0, 0, c.width, c.height);
      g.globalCompositeOperation = 'destination-in';
      const grad = g.createLinearGradient(0, up ? c.height : 0, 0, up ? 0 : c.height);
      grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(0.35, 'rgba(0,0,0,0.45)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha;
      ctx.drawImage(c, x, up ? y - h : y, w, h);
      ctx.restore();
    };
    const leds = (ctx, px, x0, u, y, t) => {
      px.forEach(([r, g, b], i) => {
        if (r + g + b < 6) { ctx.fillStyle = '#15151f'; } else ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x0 + i * u, y - t / 2, Math.max(1, u * 0.86), t);
      });
    };

    const draw = () => {
      const cv = canvas.current; if (!cv) return;
      const { w: W, h: H, dpr } = size.current; if (!W) return;
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const now = performance.now();
      const pxTop = renderRange(model.current, top.start, top.stop, now, speed);
      const pxCurb = renderRange(model.current, curb.start, curb.stop, now, speed);
      putRow(off.current.top, pxTop); putRow(off.current.curb, pxCurb);

      const m = W * 0.02, u = (W - 2 * m) / topLen;
      const yTop = H * 0.13, yCurb = H * 0.76, yFloor = H * 0.84, t = Math.max(3, H * 0.022);

      // Wall and floor.
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0b0b14'); bg.addColorStop(0.92, '#07070d'); bg.addColorStop(1, '#040407');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#0e0e16'; ctx.fillRect(0, yFloor, W, H - yFloor);

      // Corners where the side walls meet the beam.
      let acc = 0;
      ctx.font = `${Math.max(8, Math.round(H * 0.035))}px ${font}`;
      ctx.textBaseline = 'top';
      top.sections.forEach((s, i) => {
        const x = m + acc * u;
        if (i > 0) { ctx.strokeStyle = 'rgba(120,120,170,0.25)'; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(x, yTop + t); ctx.lineTo(x, yFloor); ctx.stroke(); ctx.setLineDash([]); }
        ctx.fillStyle = 'rgba(156,156,180,0.55)';
        if (W >= 560) ctx.fillText(s.name, x + 4, H * 0.02); // too cramped on a phone
        acc += s.len;
      });

      // Light spilling down from the top run and up from the curb (behind the machines).
      wash(ctx, off.current.top, m, yTop, W - 2 * m, H * 0.42, false, 0.55);
      const cx0 = m + curbShift * u;
      wash(ctx, off.current.curb, cx0, yCurb, curbLen * u, H * 0.5, true, 0.75);

      // The curb strip itself, then the machines standing in front of it.
      leds(ctx, pxCurb, cx0, u, yCurb, t);
      (zones.top || []).forEach(z => {
        const theme = LIGHTS.machineThemes[z.machineId]?.colors || [];
        const zx0 = m + z.start * u, zw = (z.stop - z.start) * u;
        const cw = zw * 0.74, x = zx0 + (zw - cw) / 2;
        const bbTop = H * 0.27, bbH = H * 0.19, neck = H * 0.035, bodyTop = bbTop + bbH + neck, bodyH = H * 0.17;
        // backbox
        const face = ctx.createLinearGradient(x, bbTop, x + cw, bbTop + bbH);
        face.addColorStop(0, hexA(theme[0], 0.55)); face.addColorStop(1, hexA(theme[1] || theme[0], 0.35));
        ctx.fillStyle = '#0c0c12'; ctx.fillRect(x, bbTop, cw, bbH);
        ctx.fillStyle = face; ctx.fillRect(x + 3, bbTop + 3, cw - 6, bbH - 6);
        ctx.strokeStyle = hexA(theme[0], 0.8); ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.5, bbTop + 0.5, cw - 1, bbH - 1);
        // neck, cabinet and legs
        ctx.fillStyle = '#0a0a10';
        ctx.fillRect(x + cw * 0.38, bbTop + bbH, cw * 0.24, neck);
        ctx.fillRect(x - cw * 0.04, bodyTop, cw * 1.08, bodyH);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.strokeRect(x - cw * 0.04 + 0.5, bodyTop + 0.5, cw * 1.08 - 1, bodyH - 1);
        const legW = Math.max(2, cw * 0.06);
        ctx.fillRect(x, bodyTop + bodyH, legW, yFloor - bodyTop - bodyH);
        ctx.fillRect(x + cw - legW, bodyTop + bodyH, legW, yFloor - bodyTop - bodyH);
        // name under the floor line, in the machine's color; alternate rows so neighbors never overlap
        const name = names.current(z.machineId);
        const label = /dragons/i.test(name) ? 'D&D' : /cactus/i.test(name) ? 'Cactus' : /white/i.test(name) ? 'Whitewater' : name;
        const idx = (zones.top || []).indexOf(z);
        const fs = Math.max(8, Math.round(H * 0.034));
        if (W < 560) return; // on a phone the machine colors say which is which
        ctx.font = `${fs}px ${font}`;
        ctx.fillStyle = hexA(theme[0], 0.95); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(label, x + cw / 2, yFloor + 3 + (idx % 2) * (fs + 3));
        ctx.textAlign = 'left';
      });

      // The top run: a glow line along the wall/beam, then the LEDs.
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6; ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off.current.top, 0, 0, topLen, 1, m, yTop - t * 1.6, W - 2 * m, t * 3.2);
      ctx.drawImage(off.current.curb, 0, 0, curbLen, 1, cx0, yCurb - t * 1.6, curbLen * u, t * 3.2);
      ctx.restore();
      leds(ctx, pxTop, m, u, yTop, t);
    };
    // A plain timer (not requestAnimationFrame) keeps drawing even when the window is in the background.
    const iv = setInterval(draw, 33);
    draw();
    return () => clearInterval(iv);
  }, [model, speed, JSON.stringify(zones)]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="lw" ref={wrap}>
      <canvas ref={canvas} role="img" aria-label="The garage wall: top light run, the six machines, and the curb light behind them" />
    </div>
  );
}
