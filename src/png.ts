import { inflateSync } from "node:zlib";

/** Minimal PNG decoder (8-bit grey/RGB/palette/grey+alpha/RGBA, palette also 1/2/4-bit, no interlace) -> alpha mask. */
export interface Mask {
  width: number;
  height: number;
  /** 1 = visible (non-transparent) pixel */
  data: Uint8Array;
}

export function decodeAlpha(buf: Buffer): Mask {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  const idat: Buffer[] = [];
  let trns: Buffer | null = null;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      ctype = body[9];
      interlace = body[12];
    } else if (type === "tRNS") trns = Buffer.from(body);
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!width || !height) throw new Error("PNG without IHDR");
  if (interlace) throw new Error("interlaced PNG not supported");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype as 0 | 2 | 3 | 4 | 6];
  if (!channels) throw new Error(`PNG colour type ${ctype} not supported`);
  if (depth !== 8 && !(ctype === 3 && [1, 2, 4].includes(depth))) throw new Error(`PNG bit depth ${depth} not supported`);
  const bitsPP = channels * depth;
  const bpp = Math.max(1, bitsPP >> 3);
  const stride = Math.ceil((width * bitsPP) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(width * height);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const off = y * (stride + 1);
    const f = raw[off];
    for (let i = 0; i < stride; i++) {
      const x = raw[off + 1 + i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v: number;
      switch (f) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`bad PNG filter ${f}`);
      }
      cur[i] = v & 255;
    }
    const row = y * width;
    for (let px = 0; px < width; px++) {
      let alpha = 255;
      if (ctype === 6) alpha = cur[px * 4 + 3];
      else if (ctype === 4) alpha = cur[px * 2 + 1];
      else if (ctype === 3) {
        const idx = depth === 8 ? cur[px] : (cur[(px * depth) >> 3] >> (8 - depth - ((px * depth) & 7))) & ((1 << depth) - 1);
        alpha = trns && idx < trns.length ? trns[idx] : 255;
      } else if (trns) {
        // single transparent colour
        if (ctype === 0) alpha = cur[px] === trns.readUInt16BE(0) ? 0 : 255;
        else alpha = cur[px * 3] === trns.readUInt16BE(0) && cur[px * 3 + 1] === trns.readUInt16BE(2) && cur[px * 3 + 2] === trns.readUInt16BE(4) ? 0 : 255;
      }
      out[row + px] = alpha > 16 ? 1 : 0;
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, data: out };
}
