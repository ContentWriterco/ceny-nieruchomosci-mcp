import { test } from "node:test";
import assert from "node:assert/strict";
import { toPuwg92, fromPuwg92 } from "../dist/puwg92.js";
import { parseFeatures } from "../dist/rcn.js";
import { filterTxs } from "../dist/report.js";

test("puwg92: matches GUGiK coordinates (Poznań, Święty Marcin 40) and round-trips", () => {
  const p = fromPuwg92(358862.28, 506563.0);
  assert.ok(Math.abs(p.lat - 52.40675) < 1e-5 && Math.abs(p.lon - 16.92452) < 1e-5, JSON.stringify(p));
  const q = toPuwg92(p.lat, p.lon);
  assert.ok(Math.abs(q.x - 358862.28) < 0.05 && Math.abs(q.y - 506563.0) < 0.05, JSON.stringify(q));
});

const rec = (o) => `<ms:lokale gml:id="lokale.${o.id}">
  <gml:boundedBy><gml:Envelope srsName="urn:ogc:def:crs:EPSG::2180"><gml:lowerCorner>${o.y} ${o.x}</gml:lowerCorner><gml:upperCorner>${o.y} ${o.x}</gml:upperCorner></gml:Envelope></gml:boundedBy>
  <ms:TERYT>3064</ms:TERYT><ms:TRAN_LOKALNY_ID_IIP>deal-${o.id}</ms:TRAN_LOKALNY_ID_IIP>
  <ms:TRAN_RODZAJ_TRANS>${o.trans ?? "wolnyRynek"}</ms:TRAN_RODZAJ_TRANS><ms:TRAN_RODZAJ_RYNKU>${o.market ?? ""}</ms:TRAN_RODZAJ_RYNKU>
  <ms:TRAN_CENA_BRUTTO>${o.price}</ms:TRAN_CENA_BRUTTO>
  <ms:DOK_DATA gml:id="x"><gml:timePosition>${o.date}</gml:timePosition></ms:DOK_DATA>
  <ms:NIER_RODZAJ>nieruchomoscLokalowa</ms:NIER_RODZAJ><ms:NIER_UDZIAL>${o.share ?? "1/1"}</ms:NIER_UDZIAL><ms:NIER_CENA_BRUTTO>${o.price}</ms:NIER_CENA_BRUTTO>
  <ms:LOK_FUNKCJA>${o.use ?? "mieszkalna"}</ms:LOK_FUNKCJA><ms:LOK_LICZBA_IZB>${o.rooms ?? 2}</ms:LOK_LICZBA_IZB><ms:LOK_NR_KOND>1</ms:LOK_NR_KOND>
  <ms:LOK_POW_UZYT>${o.area}</ms:LOK_POW_UZYT><ms:LOK_CENA_BRUTTO>${o.price}</ms:LOK_CENA_BRUTTO>
</ms:lokale>`;

test("rcn: parse WFS features and filter to comparable free-market sales", () => {
  const xml = `<wfs:FeatureCollection numberReturned="6">${[
    rec({ id: 1, x: 358862, y: 506563, price: 500000, area: 50, date: "2026-03-01" }),
    rec({ id: 2, x: 358900, y: 506600, price: 600000, area: 50, date: "2025-11-15", rooms: 3 }),
    rec({ id: 3, x: 358862, y: 506563, price: 30000, area: 50, date: "2026-01-01", trans: "sprzedazZBonifikata" }),
    rec({ id: 4, x: 358862, y: 506563, price: 200000, area: 50, date: "2026-01-01", share: "1/2" }),
    rec({ id: 5, x: 360862, y: 506563, price: 500000, area: 50, date: "2026-01-01" }),
    rec({ id: 6, x: 358862, y: 506563, price: 400000, area: 40, date: "2200-01-10" }),
  ].join("")}</wfs:FeatureCollection>`;
  const txs = parseFeatures(xml, "flat");
  assert.equal(txs.length, 6);
  assert.equal(txs[0].x, 358862);
  assert.equal(txs[0].y, 506563);
  assert.equal(txs[0].date, "2026-03-01");
  assert.equal(txs[1].rooms, 3);
  const center = { label: "x", x: 358862, y: 506563, lat: 0, lon: 0, precision: "address" };
  const rows = filterTxs(txs, { place: "x", kind: "flat", months: 24 }, center, 500, new Date("2026-10-21"));
  // bonifikata, fractional share, outside radius and the future-dated typo are dropped
  assert.deepEqual(rows.map((r) => r.dealId).sort(), ["deal-1", "deal-2"]);
  assert.equal(rows.find((r) => r.dealId === "deal-1").ppm2, 10000);
  assert.equal(filterTxs(txs, { place: "x", kind: "flat", months: 24, rooms: 3 }, center, 500, new Date("2026-10-21")).length, 1);
});
