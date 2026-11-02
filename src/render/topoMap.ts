import type { Terrain } from '../world/terrain';
import { LAKE, PADS, PEAKS, ROUTES, LIFT, BOWL, WORLD_HALF, elevation } from '../world/places';

/**
 * The valley as a patrol map: shaded relief, 20 m contours with every fifth one heavy, roads,
 * tracks and the piste, the lake, the avalanche path hatched. Drawn once onto a canvas and used
 * on the mission table in the lodge, the mission board and the map screen.
 */
export function drawTopo(t: Terrain, size = 640): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const px = (i: number) => -WORLD_HALF + ((i + 0.5) / size) * WORLD_HALF * 2;
  const H = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) H[j * size + i] = t.height(px(i), px(j));
  const step = 20;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const h = H[j * size + i];
      const hr = H[j * size + Math.min(size - 1, i + 1)];
      const hd = H[Math.min(size - 1, j + 1) * size + i];
      // hillshade from the north-west
      const dx = (hr - h) / ((WORLD_HALF * 2) / size);
      const dz = (hd - h) / ((WORLD_HALF * 2) / size);
      const shade = Math.max(0, Math.min(1, 0.72 - dx * 0.55 - dz * 0.45));
      // paper: warm cream low, cooler high
      const k = Math.min(1, Math.max(0, (h - 80) / 700));
      let r = 236 - k * 18;
      let gg = 232 - k * 10;
      let b = 220 + k * 6;
      r *= 0.78 + shade * 0.28;
      gg *= 0.8 + shade * 0.26;
      b *= 0.84 + shade * 0.2;
      // contour lines
      const a = Math.floor(h / step);
      const edge = a !== Math.floor(hr / step) || a !== Math.floor(hd / step);
      if (edge) {
        const major = a % 5 === 0 || Math.floor(hr / step) % 5 === 0;
        const w = major ? 0.55 : 0.78;
        r *= w;
        gg *= w * 0.98;
        b *= w * 0.92;
      }
      const o = (j * size + i) * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const S = (v: number) => ((v + WORLD_HALF) / (WORLD_HALF * 2)) * size;
  const k = size / 640;
  // the avalanche path, hatched in red
  g.save();
  g.beginPath();
  g.ellipse(S(BOWL.cx), S((BOWL.zTop + BOWL.zBottom) / 2), (BOWL.halfWidth * 0.8 * size) / 2000, ((BOWL.zBottom - BOWL.zTop) * 0.5 * size) / 2000, 0, 0, Math.PI * 2);
  g.clip();
  g.strokeStyle = 'rgba(200,60,40,0.35)';
  g.lineWidth = 1.2 * k;
  for (let d = -size; d < size; d += 6 * k) {
    g.beginPath();
    g.moveTo(d, 0);
    g.lineTo(d + size, size);
    g.stroke();
  }
  g.restore();
  // lake
  g.fillStyle = '#a9c9d8';
  g.beginPath();
  g.arc(S(LAKE.x), S(LAKE.z), (LAKE.r * size) / 2000, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#6f97ab';
  g.lineWidth = 1.2 * k;
  g.stroke();
  // routes
  for (const r of ROUTES) {
    g.beginPath();
    r.pts.forEach(([x, z], i) => (i ? g.lineTo(S(x), S(z)) : g.moveTo(S(x), S(z))));
    if (r.kind === 'road') {
      g.strokeStyle = '#3a2f28';
      g.lineWidth = 3.2 * k;
      g.setLineDash([]);
      g.stroke();
      g.strokeStyle = '#e9b44c';
      g.lineWidth = 1.6 * k;
      g.stroke();
    } else if (r.kind === 'track') {
      g.strokeStyle = '#4a3b30';
      g.lineWidth = 1.4 * k;
      g.setLineDash([5 * k, 3 * k]);
      g.stroke();
    } else {
      g.strokeStyle = 'rgba(40,110,190,0.75)';
      g.lineWidth = 3 * k;
      g.setLineDash([]);
      g.stroke();
    }
  }
  g.setLineDash([]);
  // the lift
  g.strokeStyle = '#2b2b2b';
  g.lineWidth = 1.2 * k;
  g.beginPath();
  g.moveTo(S(LIFT.from[0]), S(LIFT.from[1]));
  g.lineTo(S(LIFT.to[0]), S(LIFT.to[1]));
  g.stroke();
  for (let i = 0; i <= 8; i++) {
    const x = S(LIFT.from[0] + ((LIFT.to[0] - LIFT.from[0]) * i) / 8);
    const z = S(LIFT.from[1] + ((LIFT.to[1] - LIFT.from[1]) * i) / 8);
    g.fillStyle = '#2b2b2b';
    g.fillRect(x - 1.5 * k, z - 1.5 * k, 3 * k, 3 * k);
  }
  // peaks
  g.font = `600 ${11 * k}px "Archivo", sans-serif`;
  g.textAlign = 'center';
  for (const p of PEAKS) {
    const h = elevation(t.height(p.x, p.z));
    g.fillStyle = '#3d3329';
    g.beginPath();
    g.moveTo(S(p.x), S(p.z) - 5 * k);
    g.lineTo(S(p.x) + 4.5 * k, S(p.z) + 3 * k);
    g.lineTo(S(p.x) - 4.5 * k, S(p.z) + 3 * k);
    g.fill();
    g.fillText(p.name, S(p.x), S(p.z) + 15 * k);
    g.font = `500 ${9 * k}px "IBM Plex Mono", monospace`;
    g.fillText(`${h} m`, S(p.x), S(p.z) + 26 * k);
    g.font = `600 ${11 * k}px "Archivo", sans-serif`;
  }
  // places
  for (const p of PADS) {
    if (p.id === 'ridge') continue;
    g.fillStyle = p.id === 'hq' ? '#d8382a' : '#2a2520';
    g.beginPath();
    g.arc(S(p.x), S(p.z), (p.id === 'hq' ? 5 : 3.5) * k, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a2520';
    g.font = `${p.id === 'hq' || p.id === 'village' ? 700 : 600} ${(p.id === 'village' ? 13 : 10.5) * k}px "Archivo", sans-serif`;
    g.fillText(p.name, S(p.x), S(p.z) - 9 * k);
  }
  g.font = `italic 600 ${10.5 * k}px "Archivo", sans-serif`;
  g.fillStyle = '#4c7488';
  g.fillText(LAKE.name, S(LAKE.x), S(LAKE.z) + 3 * k);
  g.fillStyle = '#a83a28';
  g.fillText('Kessel Bowl', S(BOWL.cx), S(-320));
  // grid ticks every 250 m
  g.strokeStyle = 'rgba(60,50,40,0.18)';
  g.lineWidth = 1;
  for (let v = -750; v <= 750; v += 250) {
    g.beginPath();
    g.moveTo(S(v), 0);
    g.lineTo(S(v), size);
    g.moveTo(0, S(v));
    g.lineTo(size, S(v));
    g.stroke();
  }
  return c;
}

/** World (x, z) to a 0..1 map position. */
export const mapUV = (x: number, z: number) => ({ u: (x + WORLD_HALF) / (WORLD_HALF * 2), v: (z + WORLD_HALF) / (WORLD_HALF * 2) });
