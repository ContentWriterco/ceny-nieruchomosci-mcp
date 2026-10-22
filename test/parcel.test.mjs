import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { parseParcelText, parseFeatureInfo, cleanRecs, landUseName } from "../dist/parcel.js";
import { parseWkt, area, contains, distance, interiorPoint, rasterize } from "../dist/geom.js";
import { decodeAlpha } from "../dist/png.js";

test("parcel text: obręb + number, with optional gmina", () => {
  assert.deepEqual(parseParcelText("Bnin 100"), { region: "Bnin", nr: "100", commune: undefined });
  assert.deepEqual(parseParcelText("obręb Bnin, działka nr 100/3 gmina Kórnik"), { region: "Bnin", nr: "100/3", commune: "Kórnik" });
  assert.deepEqual(parseParcelText("dz. 12/5 Stara Wieś"), { region: "Stara Wieś", nr: "12/5", commune: undefined });
  assert.equal(parseParcelText("Kórnik"), null);
});

test("feature info: XML rows, header tables and key/value tables", () => {
  const xml = `<GetFeatureInfo_Result><ROWSET><ROW num="1"><FUN_SYMB>B3.ZPp-UK</FUN_SYMB><WWW>../dane/x.html</WWW></ROW></ROWSET></GetFeatureInfo_Result>`;
  assert.deepEqual(cleanRecs(parseFeatureInfo(xml)), [[["FUN_SYMB", "B3.ZPp-UK"]]]);
  const esri = `<html><head><style>table, th { x }</style></head><body><table><tr><th>OBJECTID</th><th>Oznaczenie</th><th>Shape</th></tr><tr><td>9</td><td>MW/U.40</td><td>Polygon</td></tr></table></body></html>`;
  assert.deepEqual(cleanRecs(parseFeatureInfo(esri)), [[["Oznaczenie", "MW/U.40"]]]);
  const kv = `<table><tr><th class='c'>Uchwała</th><td>613/LI/1998</td></tr><tr><th>Treść uchwały</th><td><a href="https://x/005.pdf">https://x/005.pdf</a></td></tr></table>`;
  assert.deepEqual(cleanRecs(parseFeatureInfo(kv)), [[["Uchwała", "613/LI/1998"], ["Treść uchwały", "https://x/005.pdf"]]]);
});

test("land use names", () => {
  assert.equal(landUseName("RIIIa"), "RIIIa – grunty orne (klasa IIIa)");
  assert.equal(landUseName("Bi"), "Bi – inne tereny zabudowane");
  assert.equal(landUseName("XYZ"), "XYZ");
});

test("geometry: area, containment, distance, interior point, raster mask", () => {
  const g = parseWkt("SRID=2180;POLYGON((0 0,10 0,10 10,0 10,0 0))");
  assert.equal(area(g), 100);
  assert.ok(contains(g, 5, 5) && !contains(g, 15, 5));
  assert.equal(distance(g, 13, 5), 3);
  const u = parseWkt("POLYGON((0 0,30 0,30 30,20 30,20 10,10 10,10 30,0 30,0 0))"); // U shape, centroid outside
  const [x, y] = interiorPoint(u);
  assert.ok(contains(u, x, y));
  const mask = rasterize(g, { minX: 0, minY: 0, maxX: 20, maxY: 10 }, 20, 10);
  assert.equal(mask.reduce((a, b) => a + b, 0), 100);
  const mp = parseWkt("MULTIPOLYGON(((0 0,1 0,1 1,0 0)),((5 5,6 5,6 6,5 5)))");
  assert.equal(mp.length, 2);
});

test("png: palette with tRNS -> alpha mask", () => {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(3, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 3;
  const raw = Buffer.from([0, 0, 1, 0, /*row2, filter sub*/ 1, 1, 0, 255]); // row1: 0,1,0 ; row2 (sub filter): 1, 1+0, 1+255 -> 1,1,0
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("PLTE", Buffer.alloc(9)), chunk("tRNS", Buffer.from([0, 255, 255])), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  const m = decodeAlpha(png);
  assert.deepEqual([...m.data], [0, 1, 0, 1, 1, 0]);
});
