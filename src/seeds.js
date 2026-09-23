/**
 * Starting shapes. Each returns { points, closed }.
 *
 * Polygons are seeded with only their corners — subdivision fills in the rest,
 * which is also what makes the node count verifiable by hand (a square seeded
 * with 4 nodes goes 4 -> 8 -> 16 -> 32 as each pass halves every edge).
 */

import { distance } from './growth.js';

function ring(count, radius, wobble = false) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const r = wobble ? radius * (1 + Math.sin(t * 3) * 0.22 + Math.sin(t * 5 + 1.3) * 0.13) : radius;
    points.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
  }
  return points;
}

function star(points, outer, inner) {
  const out = [];
  for (let i = 0; i < points * 2; i++) {
    const t = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    out.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
  }
  return out;
}

export const SEEDS = {
  circle: () => ({ points: ring(48, 9), closed: true }),
  square: () => ({ points: ring(4, 9), closed: true }),
  triangle: () => ({ points: ring(3, 10), closed: true }),
  star: () => ({ points: star(5, 12, 5), closed: true }),
  blob: () => ({ points: ring(40, 9, true), closed: true }),
  line: () => ({ points: [{ x: -14, y: 0 }, { x: 14, y: 0 }], closed: false }),
  arc: () => {
    const points = [];
    for (let i = 0; i <= 16; i++) {
      const t = -Math.PI * 0.75 + (i / 16) * Math.PI * 1.5;
      points.push({ x: 12 * Math.cos(t), y: 12 * Math.sin(t) });
    }
    return { points, closed: false };
  },
};

/**
 * Turn a freehand stroke into a seed: resample to even spacing so subdivision
 * starts from a clean curve, then decide whether it was meant to be closed by
 * comparing the end-to-start gap against the drawing's own size.
 */
export function fromStroke(raw, spacing) {
  if (raw.length < 3) return null;

  const points = [raw[0]];
  let run = 0;
  for (let i = 1; i < raw.length; i++) {
    run += distance(raw[i], raw[i - 1]);
    if (run >= spacing) {
      points.push(raw[i]);
      run = 0;
    }
  }
  if (points.length < 3) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY);
  const closed = distance(points[0], points[points.length - 1]) < diagonal * 0.18;

  return { points, closed };
}
