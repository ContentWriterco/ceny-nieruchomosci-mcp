import { config, log } from "./config.js";

/**
 * Rejestr Cen Nieruchomości (RCN) – transactions from notarial deeds, national WFS of GUGiK
 * (https://mapy.geoportal.gov.pl/wss/service/rcn, layers ms:lokale / ms:budynki / ms:dzialki).
 * Only the BBOX filter works server-side, so we fetch a box and filter locally.
 * Addresses are not published in the national service; we never output deed numbers or parties.
 */
export type Kind = "flat" | "house" | "plot";
const LAYER: Record<Kind, string> = { flat: "lokale", house: "budynki", plot: "dzialki" };
const PREFIX: Record<Kind, string> = { flat: "LOK", house: "BUD", plot: "DZI" };

export interface Tx {
  kind: Kind;
  /** transaction date YYYY-MM-DD */
  date: string;
  /** price of this property (flat / building / plot), gross PLN */
  price: number;
  /** usable area m² (flat/house) or plot area m² */
  area: number;
  rooms?: number;
  floor?: number;
  /** "mieszkalna", "garaz", "mieszkalny", "inne"... */
  use: string;
  /** wolnyRynek, sprzedazBezprzetargowa, ... */
  transType: string;
  /** rynekPierwotny / rynekWtorny / "" */
  market: string;
  share: string;
  /** whole-deed price (several properties in one deed => cannot be split reliably) */
  dealPrice: number;
  /** number of deed parcels/units – used to spot bundled deals */
  x: number;
  y: number;
  teryt: string;
  /** MPZP / zoning for plots */
  zoning?: string;
  /** nieruchomoscLokalowa / nieruchomoscGruntowaZabudowana / ...Niezabudowana */
  propType: string;
  /** plot area of the property, m² (houses) */
  landArea?: number;
  dealId: string;
}

function tag(rec: string, name: string): string {
  const i = rec.indexOf(`<ms:${name}`);
  if (i < 0) return "";
  const s = rec.indexOf(">", i) + 1;
  if (rec.startsWith("<gml:timePosition>", s)) {
    const s2 = s + "<gml:timePosition>".length;
    return rec.slice(s2, rec.indexOf("<", s2)).trim();
  }
  return rec.slice(s, rec.indexOf("<", s)).trim();
}

const num = (s: string) => (s === "" ? NaN : Number(s.replace(",", ".")));

export function parseFeatures(xml: string, kind: Kind): Tx[] {
  const layer = LAYER[kind];
  const p = PREFIX[kind];
  const out: Tx[] = [];
  const open = `<ms:${layer} `;
  const close = `</ms:${layer}>`;
  let i = 0;
  for (;;) {
    const a = xml.indexOf(open, i);
    if (a < 0) break;
    const b = xml.indexOf(close, a);
    if (b < 0) break;
    const rec = xml.slice(a, b);
    i = b + close.length;
    // envelope centre in EPSG:2180 (northing easting order)
    const lc = rec.match(/<gml:lowerCorner>([\d.]+) ([\d.]+)<\/gml:lowerCorner>\s*<gml:upperCorner>([\d.]+) ([\d.]+)</);
    if (!lc) continue;
    const y = (+lc[1] + +lc[3]) / 2;
    const x = (+lc[2] + +lc[4]) / 2;
    // houses: the buyer pays for the whole property (land + building) -> NIER price first
    const price =
      kind === "house"
        ? num(tag(rec, "NIER_CENA_BRUTTO")) || num(tag(rec, "BUD_CENA_BRUTTO"))
        : num(tag(rec, `${p}_CENA_BRUTTO`)) || num(tag(rec, "NIER_CENA_BRUTTO"));
    let area = num(tag(rec, kind === "plot" ? "DZI_POW_EWID" : `${p}_POW_UZYT`));
    if (kind === "plot") area *= 10000; // ha -> m²
    out.push({
      kind,
      date: tag(rec, "DOK_DATA").slice(0, 10),
      price,
      area,
      rooms: num(tag(rec, "LOK_LICZBA_IZB")) || undefined,
      floor: Number.isFinite(num(tag(rec, "LOK_NR_KOND"))) ? num(tag(rec, "LOK_NR_KOND")) : undefined,
      use: tag(rec, kind === "flat" ? "LOK_FUNKCJA" : kind === "house" ? "BUD_RODZAJ" : "DZI_SPOSOB_UZYT"),
      transType: tag(rec, "TRAN_RODZAJ_TRANS"),
      market: tag(rec, "TRAN_RODZAJ_RYNKU"),
      share: tag(rec, "NIER_UDZIAL"),
      dealPrice: num(tag(rec, "TRAN_CENA_BRUTTO")),
      x,
      y,
      teryt: tag(rec, "TERYT"),
      zoning: kind === "plot" ? tag(rec, "DZI_PRZEZN_WMPZP") : undefined,
      propType: tag(rec, "NIER_RODZAJ"),
      landArea: num(tag(rec, "NIER_POW_GRUNTU")) * 10000 || undefined,
      dealId: tag(rec, "TRAN_LOKALNY_ID_IIP"),
    });
  }
  return out;
}

interface Entry {
  at: number;
  bytes: number;
  txs: Tx[];
}
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Tx[]>>();
let cacheBytes = 0;

/** Transactions of `kind` within the EPSG:2180 box (easting/northing). Cached on a 100 m grid. */
export async function fetchBox(kind: Kind, xmin: number, ymin: number, xmax: number, ymax: number): Promise<Tx[]> {
  const r = (v: number, up: boolean) => (up ? Math.ceil(v / 100) : Math.floor(v / 100)) * 100;
  [xmin, ymin, xmax, ymax] = [r(xmin, false), r(ymin, false), r(xmax, true), r(ymax, true)];
  const key = `${kind}:${xmin}:${ymin}:${xmax}:${ymax}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < config.cacheTtlSec * 1000) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.txs;
  }
  let p = inflight.get(key);
  if (p) return p;
  p = (async () => {
    const all: Tx[] = [];
    const PAGE = 10000;
    for (let start = 0; start < 50000; start += PAGE) {
      const u = new URL(config.rcnUrl);
      u.searchParams.set("SERVICE", "WFS");
      u.searchParams.set("VERSION", "2.0.0");
      u.searchParams.set("REQUEST", "GetFeature");
      u.searchParams.set("TYPENAMES", `ms:${LAYER[kind]}`);
      u.searchParams.set("COUNT", String(PAGE));
      u.searchParams.set("STARTINDEX", String(start));
      // EPSG:2180 axis order: northing, easting
      u.searchParams.set("BBOX", `${ymin},${xmin},${ymax},${xmax},urn:ogc:def:crs:EPSG::2180`);
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 90_000);
      let xml: string;
      try {
        const res = await fetch(u, { signal: ac.signal, headers: { "user-agent": config.userAgent } });
        if (!res.ok) throw new Error(`RCN service HTTP ${res.status}`);
        xml = await res.text();
      } finally {
        clearTimeout(t);
      }
      if (xml.includes("ExceptionReport")) throw new Error(`RCN service error: ${xml.match(/<ows:ExceptionText>([^<]*)/)?.[1] ?? "unknown"}`);
      const page = parseFeatures(xml, kind);
      all.push(...page);
      const returned = Number(xml.match(/numberReturned="(\d+)"/)?.[1] ?? page.length);
      if (returned < PAGE) break;
    }
    const bytes = all.length * 220;
    cache.set(key, { at: Date.now(), bytes, txs: all });
    cacheBytes += bytes;
    while (cacheBytes > config.cacheMb * 1e6 && cache.size > 1) {
      const [k, v] = cache.entries().next().value!;
      cache.delete(k);
      cacheBytes -= v.bytes;
    }
    log("debug", `RCN ${key}: ${all.length} records`);
    return all;
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}
