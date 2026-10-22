/** Planar geometry in EPSG:2180 metres (x = easting, y = northing). */
export type Ring = [number, number][];
export type Poly = Ring[]; // outer ring + holes
export type MultiPoly = Poly[];

export interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** "SRID=2180;POLYGON((x y, ...))" / MULTIPOLYGON -> polygons. */
export function parseWkt(wkt: string): MultiPoly {
  const s = wkt.replace(/^SRID=\d+;/i, "").trim();
  const body = s.replace(/^[A-Z]+\s*/i, "");
  const polys: MultiPoly = [];
  const isMulti = /^MULTIPOLYGON/i.test(s);
  const polyTexts = isMulti ? body.slice(1, -1).split(/\)\)\s*,\s*\(\(/) : [body.slice(1, -1)];
  for (let pt of polyTexts) {
    pt = pt.replace(/^\(+/, "").replace(/\)+$/, "");
    const rings = pt.split(/\)\s*,\s*\(/).map((r) =>
      r
        .replace(/[()]/g, "")
        .split(",")
        .map((p) => p.trim().split(/\s+/).map(Number) as [number, number])
        .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])),
    );
    polys.push(rings.filter((r) => r.length >= 3));
  }
  return polys.filter((p) => p.length);
}

export function extent(mp: MultiPoly): Extent {
  const e = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of mp) for (const [x, y] of p[0]) {
    if (x < e.minX) e.minX = x;
    if (y < e.minY) e.minY = y;
    if (x > e.maxX) e.maxX = x;
    if (y > e.maxY) e.maxY = y;
  }
  return e;
}

function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
}

export function area(mp: MultiPoly): number {
  let a = 0;
  for (const p of mp) {
    a += Math.abs(ringArea(p[0]));
    for (const h of p.slice(1)) a -= Math.abs(ringArea(h));
  }
  return a;
}

function inRing(x: number, y: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function contains(mp: MultiPoly, x: number, y: number): boolean {
  for (const p of mp) if (inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h))) return true;
  return false;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from a point to the polygon (0 inside). */
export function distance(mp: MultiPoly, x: number, y: number): number {
  if (contains(mp, x, y)) return 0;
  let d = Infinity;
  for (const p of mp) for (const r of p) for (let i = 0, j = r.length - 1; i < r.length; j = i++) d = Math.min(d, segDist(x, y, r[j][0], r[j][1], r[i][0], r[i][1]));
  return d;
}

/** A point guaranteed inside the polygon (centroid if inside, else the deepest of a grid sample). */
export function interiorPoint(mp: MultiPoly): [number, number] {
  // area-weighted centroid of the largest polygon's outer ring
  const big = [...mp].sort((a, b) => Math.abs(ringArea(b[0])) - Math.abs(ringArea(a[0])))[0];
  const r = big[0];
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
    cx += (r[j][0] + r[i][0]) * f;
    cy += (r[j][1] + r[i][1]) * f;
    a += f;
  }
  if (a) {
    cx /= 3 * a;
    cy /= 3 * a;
    if (contains(mp, cx, cy)) return [cx, cy];
  }
  const e = extent([big]);
  let best: [number, number] = r[0];
  let bestD = -1;
  const n = 24;
  for (let i = 1; i < n; i++)
    for (let j = 1; j < n; j++) {
      const x = e.minX + ((e.maxX - e.minX) * i) / n;
      const y = e.minY + ((e.maxY - e.minY) * j) / n;
      if (!contains([big], x, y)) continue;
      let d = Infinity;
      for (let k = 0, l = r.length - 1; k < r.length; l = k++) d = Math.min(d, segDist(x, y, r[l][0], r[l][1], r[k][0], r[k][1]));
      if (d > bestD) {
        bestD = d;
        best = [x, y];
      }
    }
  return best;
}

/** Rasterise the polygon on a grid (row 0 = maxY), even-odd rule over all rings. 1 = inside. */
export function rasterize(mp: MultiPoly, box: Extent, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  const rx = (box.maxX - box.minX) / width;
  const ry = (box.maxY - box.minY) / height;
  const rings = mp.flat();
  const xs: number[] = [];
  for (let j = 0; j < height; j++) {
    const y = box.maxY - (j + 0.5) * ry;
    xs.length = 0;
    for (const r of rings)
      for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
        const [x1, y1] = r[k];
        const [x2, y2] = r[i];
        if (y1 > y !== y2 > y) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    xs.sort((a, b) => a - b);
    for (let n = 0; n + 1 < xs.length; n += 2) {
      const i0 = Math.max(0, Math.ceil((xs[n] - box.minX) / rx - 0.5));
      const i1 = Math.min(width - 1, Math.floor((xs[n + 1] - box.minX) / rx - 0.5));
      for (let i = i0; i <= i1; i++) out[j * width + i] = 1;
    }
  }
  return out;
}
