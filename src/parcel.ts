import { config, log, UserError } from "./config.js";
import { geocode } from "./geocode.js";
import { fromPuwg92, toPuwg92 } from "./puwg92.js";
import { area, distance, extent, interiorPoint, parseWkt, rasterize, type Extent, type MultiPoly } from "./geom.js";
import { decodeAlpha } from "./png.js";
import { priceReport } from "./report.js";

const ULDK = process.env.CENY_ULDK_URL ?? "https://uldk.gugik.gov.pl/";
const KIEG = process.env.CENY_KIEG_URL ?? "https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow";
const KIMPZP = process.env.CENY_MPZP_URL ?? "https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaMiejscowychPlanowZagospodarowaniaPrzestrzennego";
const KIUT = process.env.CENY_KIUT_URL ?? "https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaUzbrojeniaTerenu";
const ISOK = process.env.CENY_ISOK_URL ?? "https://wody.isok.gov.pl/wss/INSPIRE/INSPIRE_NZ_HY_MZPMRP_WMS";
const GDOS = process.env.CENY_GDOS_URL ?? "https://sdi.gdos.gov.pl/wfs";

export interface Parcel {
  id: string;
  voivodeship: string;
  county: string;
  commune: string;
  region: string;
  number: string;
  geom: MultiPoly;
}

async function fetchBuf(url: string, ms = 25_000): Promise<Buffer> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: "follow", headers: { "user-agent": config.userAgent } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`timeout (${new URL(url).host})`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}
const fetchText = async (url: string, ms?: number) => (await fetchBuf(url, ms)).toString("utf8");

function qs(base: string, params: Record<string, string | number>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

// ---------------------------------------------------------------- ULDK (parcel lookup)

const ULDK_FIELDS = "id,voivodeship,county,commune,region,parcel,geom_wkt";

async function uldk(params: Record<string, string>): Promise<Parcel[]> {
  const text = await fetchText(qs(ULDK, { ...params, result: ULDK_FIELDS, srid: "2180" }), 20_000);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length || lines[0].startsWith("-1")) return [];
  return lines
    .filter((l) => l.includes("|"))
    .map((l) => {
      const [id, voivodeship, county, commune, region, number, wkt] = l.split("|");
      return { id, voivodeship, county, commune, region, number, geom: parseWkt(wkt ?? "") };
    })
    .filter((p) => p.id && p.geom.length);
}

const ID_RE = /^\d{6}_\d\.\d{4}(\.[\w./-]+)?$/;

/** Turn "obręb Bnin działka 100 gmina Kórnik" / "Bnin 100" into { region: "Bnin", nr: "100", commune: "Kórnik" }. */
export function parseParcelText(q: string): { region: string; nr: string; commune?: string } | null {
  let s = q.replace(/\s+/g, " ").trim();
  let commune: string | undefined;
  const gm = s.match(/\b(?:gm\.|gmina|gminie)\s+([\p{L}\- ]+?)(?=$|,| obręb| dz| działka| nr)/iu);
  if (gm) {
    commune = gm[1].trim();
    s = s.replace(gm[0], " ");
  }
  s = s
    .replace(/(^|[\s,;])(obręb(?:ie)?|obr|działka|działki|dz|numer|nr|ewid|ewidencyjna|ewidencyjny)\.?(?=[\s,;]|$)/giu, " ")
    .replace(/[,;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let region: string, nr: string;
  const tail = s.match(/^(.*\p{L}.*?)\s+(\d+(?:\/\d+)?)$/u);
  const head = s.match(/^(\d+(?:\/\d+)?)\s+(.*\p{L}.*)$/u);
  if (tail) [region, nr] = [tail[1], tail[2]];
  else if (head) [region, nr] = [head[2], head[1]];
  else return null;
  region = region.trim();
  return { region, nr, commune };
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\(.*?\)|powiat|gmina/g, "").trim();

export async function findParcel(query: string, commune?: string): Promise<{ parcels: Parcel[]; via: string }> {
  const q = query.trim();
  if (ID_RE.test(q)) return { parcels: await uldk({ request: "GetParcelById", id: q }), via: "identyfikator" };
  const coord = q.match(/^(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)$/);
  if (coord) {
    const { x, y } = toPuwg92(+coord[1], +coord[2]);
    return { parcels: await uldk({ request: "GetParcelByXY", xy: `${x},${y},2180` }), via: "współrzędne" };
  }
  const byText = async () => {
    const p = parseParcelText(q);
    if (!p) return null;
    let res = await uldk({ request: "GetParcelByIdOrNr", id: `${p.region} ${p.nr}` });
    const want = commune ?? p.commune;
    if (want && res.length > 1) {
      const w = norm(want);
      const f = res.filter((r) => norm(r.commune).includes(w) || norm(r.county).includes(w) || norm(r.voivodeship).includes(w));
      if (f.length) res = f;
    }
    return res.length ? { parcels: res, via: "obręb i numer" } : null;
  };
  const byAddress = async () => {
    try {
      const places = await geocode(q);
      const pl = places[0];
      const res = await uldk({ request: "GetParcelByXY", xy: `${pl.x},${pl.y},2180` });
      return res.length ? { parcels: res, via: `adres (${pl.label})` } : null;
    } catch (e) {
      if (e instanceof UserError) return null;
      throw e;
    }
  };
  const first = q.includes(",") ? [byAddress, byText] : [byText, byAddress];
  for (const f of first) {
    const r = await f();
    if (r) return r;
  }
  throw new UserError(
    `Nie znaleziono działki dla "${query}". Podaj identyfikator (np. 306401_1.0051.AR_14.39/6), "obręb numer" (np. "Bnin 100", opcjonalnie z gminą), adres ("Kórnik, Poznańska 1") albo "lat,lon".`,
  );
}

// ---------------------------------------------------------------- feature-info parsing

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m),
    )
    .replace(/\s+/g, " ")
    .trim();

export type Rec = [string, string][];

const stripHead = (s: string) => s.replace(/<(head|style|script)\b[\s\S]*?<\/\1>/gi, " ");

/** WMS GetFeatureInfo (XML rows, HTML header tables or HTML key/value tables) -> records. */
export function parseFeatureInfo(raw: string): Rec[] {
  const body = stripHead(raw);
  const recs: Rec[] = [];
  if (/<ROW\b/i.test(body)) {
    for (const row of body.match(/<ROW\b[\s\S]*?<\/ROW>/gi) ?? []) {
      const r: Rec = [];
      for (const m of row.matchAll(/<([\w:.-]+)>([^<]*)<\/\1>/g)) r.push([m[1], decode(m[2])]);
      recs.push(r);
    }
    return recs;
  }
  for (const table of body.match(/<table\b[\s\S]*?<\/table>/gi) ?? []) {
    const rows = (table.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []).map((tr) =>
      [...tr.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((c) => ({ th: c[1].toLowerCase() === "th", v: decode(c[2]) })),
    );
    if (!rows.length) continue;
    if (rows[0].length > 2 && rows[0].every((c) => c.th)) {
      const head = rows[0].map((c) => c.v);
      for (const row of rows.slice(1)) recs.push(row.map((c, i) => [head[i] ?? `col${i}`, c.v] as [string, string]));
    } else {
      const r: Rec = [];
      for (const row of rows) if (row.length === 2) r.push([row[0].v, row[1].v]);
      if (r.length) recs.push(r);
    }
  }
  return recs;
}

const DROP_KEY =
  /^(objectid|fid|id|id_pg|gdb_id|gid|shape.*|gml_id|identifier.*|identyfikator|przestrzennazw|lokalnyid|wersjaid|begin_lifespan|end_lifespan|referencja|legenda|data zasilenia|usługa przeglądania|poziomhierarchii.*|typplanu_href|status_href|ifcid|id_namespace|.*codespace)$/i;

export function cleanRecs(recs: Rec[], max = 4): Rec[] {
  const seen = new Set<string>();
  const out: Rec[] = [];
  for (const r of recs) {
    const c = r.filter(([k, v]) => {
      if (DROP_KEY.test(k.trim())) return false;
      if (/_href$/i.test(k) && !/(uchwal|rysunek|dokument_href)/i.test(k)) return false;
      return v && !/^(null|polygon|multipolygon|\[\]|-)$/i.test(v) && !v.startsWith("../");
    });
    const key = JSON.stringify(c);
    if (!c.length || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------- EGiB (land register)

const GROUP: Record<string, string> = {
  "1": "Skarb Państwa",
  "2": "Skarb Państwa – użytkowanie wieczyste",
  "3": "państwowe osoby prawne",
  "4": "gmina",
  "5": "gmina – użytkowanie wieczyste",
  "6": "komunalne osoby prawne",
  "7": "osoby fizyczne",
  "8": "spółdzielnie",
  "9": "kościoły i związki wyznaniowe",
  "10": "wspólnoty gruntowe",
  "11": "powiat",
  "12": "powiat – użytkowanie wieczyste",
  "13": "województwo",
  "14": "województwo – użytkowanie wieczyste",
  "15": "spółki handlowe i inne podmioty",
  "16": "podmioty ewidencyjne niewymienione w innych grupach",
};

const LAND_USE: Record<string, string> = {
  R: "grunty orne",
  S: "sady",
  Ł: "łąki trwałe",
  Ps: "pastwiska trwałe",
  Br: "grunty rolne zabudowane",
  Wsr: "grunty pod stawami",
  W: "grunty pod rowami",
  Lzr: "grunty zadrzewione i zakrzewione na użytkach rolnych",
  N: "nieużytki",
  Ls: "lasy",
  Lz: "grunty zadrzewione i zakrzewione",
  B: "tereny mieszkaniowe",
  Ba: "tereny przemysłowe",
  Bi: "inne tereny zabudowane",
  Bp: "zurbanizowane tereny niezabudowane",
  Bz: "tereny rekreacyjno-wypoczynkowe",
  K: "użytki kopalne",
  dr: "drogi",
  Tk: "tereny kolejowe",
  Ti: "inne tereny komunikacyjne",
  Tp: "grunty przeznaczone pod budowę dróg lub linii kolejowych",
  Wm: "grunty pod morskimi wodami wewnętrznymi",
  Wp: "grunty pod wodami powierzchniowymi płynącymi",
  Ws: "grunty pod wodami powierzchniowymi stojącymi",
  Tr: "tereny różne",
};

export function landUseName(code: string): string {
  const m = code.trim().match(/^([A-ZŁŚŻa-złśż]+?)(?:-|\s)?([IV]+[ab]?|VI[z]?)?$/);
  if (!m) return code;
  const name = LAND_USE[m[1]] ?? LAND_USE[m[1].replace(/-.*/, "")];
  return name ? `${code} – ${name}${m[2] ? ` (klasa ${m[2]})` : ""}` : code;
}

async function egib(x: number, y: number): Promise<Rec> {
  const b = `${y - 25},${x - 25},${y + 25},${x + 25}`;
  const body = await fetchText(
    qs(KIEG, { SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetFeatureInfo", LAYERS: "dzialki,uzytki,kontury", QUERY_LAYERS: "dzialki,uzytki,kontury", STYLES: "", CRS: "EPSG:2180", BBOX: b, WIDTH: 101, HEIGHT: 101, I: 50, J: 50, INFO_FORMAT: "text/html", FEATURE_COUNT: 5 }),
  );
  const recs = parseFeatureInfo(body);
  return recs.flat();
}

// ---------------------------------------------------------------- MPZP (local zoning plans)

async function mpzp(lat: number, lon: number, layer: string): Promise<{ recs: Rec[]; note?: string; services: string[] }> {
  const d = 0.0004;
  const body = await fetchText(
    qs(KIMPZP, { SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetFeatureInfo", LAYERS: layer, QUERY_LAYERS: layer, SRS: "EPSG:4326", BBOX: `${lon - d},${lat - d},${lon + d},${lat + d}`, WIDTH: 101, HEIGHT: 101, X: 50, Y: 50, INFO_FORMAT: "text/html", FEATURE_COUNT: 5 }),
    30_000,
  );
  const all = parseFeatureInfo(body);
  const services = [
    ...new Set(
      all
        .flat()
        .filter(([k, v]) => /usługa przeglądania/i.test(k) && /^https?:\/\//.test(v))
        .map(([, v]) => v.split("?")[0]),
    ),
  ].slice(0, 4);
  const recs = cleanRecs(all, 3);
  if (recs.length) return { recs, services };
  const t = decode(stripHead(body)).replace(/FeatureInfoCollection - layer name: '[^']*'/g, "").trim();
  if (/brak serwisu/i.test(t)) return { recs: [], note: "noservice", services };
  if (/brak wyniku/i.test(t) || !t) return { recs: [], note: "none", services };
  if (/exception|error/i.test(t)) return { recs: [], note: "error", services };
  return { recs: t.length < 600 ? [[["info", t]]] : [], note: "none", services };
}

/** Zoning of one plan from its own WMS (gmina services listed in the national register, e.g. igeomap "str" layer). */
async function planZoning(service: string, lat: number, lon: number): Promise<Rec[]> {
  const d = 0.0003;
  const body = await fetchText(
    qs(service, { SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetFeatureInfo", LAYERS: "str", QUERY_LAYERS: "str", STYLES: "", CRS: "EPSG:4326", BBOX: `${lat - d},${lon - d},${lat + d},${lon + d}`, WIDTH: 101, HEIGHT: 101, I: 50, J: 50, INFO_FORMAT: "application/vnd.ogc.gml", FEATURE_COUNT: 3 }),
    15_000,
  );
  const out: Rec[] = [];
  for (const f of body.match(/<(\w+)_feature>[\s\S]*?<\/\1_feature>/g) ?? []) {
    const r: Rec = [];
    for (const m of f.matchAll(/<(opis|etykieta|symbol|przeznaczenie|nazwa|oznaczenie)>([^<]*)<\/\1>/gi)) if (m[2].trim()) r.push([m[1], decode(m[2])]);
    if (r.length) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------- raster checks (utilities, flood)

interface RasterHit {
  /** metres from the parcel boundary to the nearest drawn pixel (0 = on the parcel), Infinity = none in the window */
  dist: number;
  /** share of parcel pixels covered */
  share: number;
  /** a covered pixel inside the parcel (EPSG:2180) */
  inside?: [number, number];
  clipped: boolean;
}

function window(e: Extent, buffer: number, maxSide: number, center: [number, number]): { box: Extent; clipped: boolean } {
  let box = { minX: e.minX - buffer, minY: e.minY - buffer, maxX: e.maxX + buffer, maxY: e.maxY + buffer };
  let clipped = false;
  if (box.maxX - box.minX > maxSide || box.maxY - box.minY > maxSide) {
    clipped = true;
    const h = maxSide / 2;
    box = { minX: center[0] - h, minY: center[1] - h, maxX: center[0] + h, maxY: center[1] + h };
  }
  return { box, clipped };
}

async function rasterCheck(base: string, layers: string, geom: MultiPoly, box: Extent, res: number, clipped: boolean): Promise<RasterHit> {
  const W = Math.max(8, Math.round((box.maxX - box.minX) / res));
  const H = Math.max(8, Math.round((box.maxY - box.minY) / res));
  const buf = await fetchBuf(
    qs(base, { SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetMap", LAYERS: layers, STYLES: "", CRS: "EPSG:2180", BBOX: `${box.minY},${box.minX},${box.maxY},${box.maxX}`, WIDTH: W, HEIGHT: H, FORMAT: "image/png", TRANSPARENT: "TRUE" }),
    40_000,
  );
  if (buf.subarray(0, 4).toString("hex") !== "89504e47") throw new Error(`no image (${buf.subarray(0, 120).toString("utf8").replace(/\s+/g, " ")})`);
  const m = decodeAlpha(buf);
  const rx = (box.maxX - box.minX) / m.width;
  const ry = (box.maxY - box.minY) / m.height;
  const mask = rasterize(geom, box, m.width, m.height);
  let dist = Infinity;
  let inParcel = 0, covered = 0;
  let inside: [number, number] | undefined;
  // nearest outside pixel: check candidates in order of a cheap lower bound (distance to the parcel extent)
  const e = extent(geom);
  const outside: [number, number, number][] = [];
  for (let j = 0; j < m.height; j++) {
    const y = box.maxY - (j + 0.5) * ry;
    for (let i = 0; i < m.width; i++) {
      const k = j * m.width + i;
      const vis = m.data[k] === 1;
      if (mask[k]) {
        inParcel++;
        if (vis) {
          covered++;
          dist = 0;
          inside ??= [box.minX + (i + 0.5) * rx, y];
        }
      } else if (vis && dist > 0) {
        const x = box.minX + (i + 0.5) * rx;
        const lb = Math.hypot(Math.max(0, e.minX - x, x - e.maxX), Math.max(0, e.minY - y, y - e.maxY));
        outside.push([lb, x, y]);
      }
    }
  }
  if (dist > 0 && outside.length) {
    outside.sort((a, b) => a[0] - b[0]);
    for (const [lb, x, y] of outside) {
      if (lb >= dist) break;
      const d = distance(geom, x, y);
      if (d < dist) dist = d;
    }
  }
  return { dist, share: inParcel ? covered / inParcel : 0, inside, clipped };
}

const NETWORKS: [string, string][] = [
  ["przewod_wodociagowy", "wodociąg"],
  ["przewod_kanalizacyjny", "kanalizacja"],
  ["przewod_gazowy", "gaz"],
  ["przewod_elektroenergetyczny", "energetyka"],
  ["przewod_cieplowniczy", "ciepłownictwo"],
  ["przewod_telekomunikacyjny", "telekomunikacja"],
];

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------- report

const ha = (m2: number) => `${(m2 / 10000).toFixed(4).replace(".", ",")} ha`;
const m = (v: number) => `${Math.round(v)} m`;
const fmtGroup = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export interface ParcelQuery {
  query: string;
  commune?: string;
  prices?: boolean;
}

export async function parcelReport(q: ParcelQuery): Promise<string> {
  const { parcels, via } = await findParcel(q.query, q.commune);
  if (!parcels.length) throw new UserError(`Nie znaleziono działki dla "${q.query}".`);
  if (parcels.length > 1) {
    return [
      `Kilka działek (${parcels.length}) pasuje do "${q.query}" – wybierz jedną (podaj identyfikator albo gminę w polu commune):`,
      ...parcels.slice(0, 15).map((p) => `- ${p.id} · obręb ${p.region} · gm. ${p.commune} · ${p.county} · ${p.voivodeship}`),
    ].join("\n");
  }
  const p = parcels[0];
  const e = extent(p.geom);
  const [cx, cy] = interiorPoint(p.geom);
  const { lat, lon } = fromPuwg92(cx, cy);
  const geomArea = area(p.geom);
  const BUF = 60;
  const util = window(e, BUF, 500, [cx, cy]);
  const flood = window(e, 100, 1500, [cx, cy]);

  const safe = async <T>(name: string, f: () => Promise<T>): Promise<T | Error> => {
    try {
      return await f();
    } catch (err) {
      log("warn", `${name}: ${(err as Error).message}`);
      return err as Error;
    }
  };

  const [eg, zone, plan, nets, fl, prot, prices] = await Promise.all([
    safe("egib", () => egib(cx, cy)),
    safe("mpzp-zone", () => mpzp(lat, lon, "wektor-str")),
    safe("mpzp-plan", () => mpzp(lat, lon, "plany_granice")),
    safe("kiut", () => pool(NETWORKS, 3, async ([layer, label]) => ({ label, hit: await safe(layer, () => rasterCheck(KIUT, layer, p.geom, util.box, 0.25, util.clipped)) }))),
    safe("isok", async () => {
      const hit = await rasterCheck(ISOK, "NZ.Fluvial,NZ.SeaWater", p.geom, flood.box, Math.max(1, (flood.box.maxX - flood.box.minX) / 1200), flood.clipped);
      let scen: string[] = [];
      const pt = hit.inside;
      if (pt) {
        const b = `${pt[1] - 20},${pt[0] - 20},${pt[1] + 20},${pt[0] + 20}`;
        const j = JSON.parse(
          await fetchText(qs(ISOK, { SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetFeatureInfo", LAYERS: "NZ.Fluvial,NZ.SeaWater", QUERY_LAYERS: "NZ.Fluvial,NZ.SeaWater", STYLES: "", CRS: "EPSG:2180", BBOX: b, WIDTH: 41, HEIGHT: 41, I: 20, J: 20, INFO_FORMAT: "application/json", FEATURE_COUNT: 10 }), 40_000),
        ) as { features?: { properties?: Record<string, string> }[] };
        scen = [...new Set((j.features ?? []).map((f) => `${f.properties?.hazardcategory === "fluvial" ? "powódź rzeczna" : (f.properties?.hazardcategory ?? "")} – ${f.properties?.loo_qualitativelikelihood ?? "?"}`))];
      }
      return { hit, scen };
    }),
    safe("gdos", async () => {
      const types: [string, string][] = [
        ["GDOS:ParkiNarodowe", "park narodowy"],
        ["GDOS:Rezerwaty", "rezerwat przyrody"],
        ["GDOS:ParkiKrajobrazowe", "park krajobrazowy"],
        ["GDOS:ObszaryChronionegoKrajobrazu", "obszar chronionego krajobrazu"],
        ["GDOS:SpecjalneObszaryOchrony", "Natura 2000 – obszar siedliskowy (SOO)"],
        ["GDOS:ObszarySpecjalnejOchrony", "Natura 2000 – obszar ptasi (OSO)"],
        ["GDOS:ZespolyPrzyrodniczoKrajobrazowe", "zespół przyrodniczo-krajobrazowy"],
        ["GDOS:UzytkiEkologiczne", "użytek ekologiczny"],
      ];
      const xml = await fetchText(
        qs(GDOS, { service: "WFS", version: "1.1.0", request: "GetFeature", typeName: types.map((t) => t[0]).join(","), propertyName: "nazwa", bbox: `${e.minX},${e.minY},${e.maxX},${e.maxY},EPSG:2180` }),
        30_000,
      );
      const out: string[] = [];
      for (const mm of xml.matchAll(/<(GDOS:\w+) gml:id="[^"]*">[\s\S]*?<GDOS:nazwa>([^<]*)<\/GDOS:nazwa>/g)) {
        const label = types.find((t) => t[0] === mm[1])?.[1] ?? mm[1];
        const s = `${label}: ${decode(mm[2]).replace(/\s+/g, " ")}`;
        if (!out.includes(s)) out.push(s);
      }
      return out;
    }),
    q.prices === false ? Promise.resolve(null) : safe("prices", () => priceReport({ place: `${lat.toFixed(6)},${lon.toFixed(6)}`, kind: "plot", radiusM: 1500, months: 36, examples: 3 })),
  ]);

  // zoning from the plans' own services when the national layer has no zones
  let planZones: Rec[] = [];
  if (!(plan instanceof Error) && plan.services.length && (zone instanceof Error || !zone.recs.length)) {
    const res = await Promise.all(plan.services.map((u) => planZoning(u, lat, lon).catch(() => [] as Rec[])));
    planZones = cleanRecs(res.flat(), 3);
  }

  const L: string[] = [];
  L.push(`Działka ${p.number} · obręb ${p.region} · gm. ${p.commune} · ${p.county} · woj. ${p.voivodeship}`);
  L.push(`Identyfikator: ${p.id} (znaleziono po: ${via})`);
  L.push(`Punkt w działce: ${lat.toFixed(6)}, ${lon.toFixed(6)} · Geoportal: https://mapy.geoportal.gov.pl/mobile/?identifyParcel=${encodeURIComponent(p.id)}`);

  // EGiB
  if (eg instanceof Error) L.push(`Powierzchnia z geometrii: ok. ${fmtGroup(geomArea)} m² (ewidencja gruntów niedostępna: ${eg.message})`);
  else {
    const get = (re: RegExp) => eg.find(([k]) => re.test(k))?.[1];
    const pole = get(/^pole/i);
    const grp = get(/grupa rejestrowa/i);
    const uses = [...new Set(eg.filter(([k, v]) => /oznaczenie (użytku|konturu)/i.test(k) && v).map(([, v]) => v))];
    L.push(
      `Powierzchnia: ${pole ? `${pole.replace(".", ",")} ha w ewidencji gruntów` : `ok. ${ha(geomArea)} (z geometrii)`}${pole ? ` (z geometrii ok. ${fmtGroup(geomArea)} m²)` : ""}`,
    );
    if (uses.length) L.push(`Użytek gruntowy (w punkcie środkowym): ${uses.map(landUseName).join("; ")}`);
    if (grp) L.push(`Grupa rejestrowa właściciela: ${/^\d+$/.test(grp) && GROUP[grp] ? `${grp} – ${GROUP[grp]}` : grp.replace(/\s+-\s+/, " – ")}`);
  }

  // MPZP
  L.push("", "Plan miejscowy (MPZP) – w punkcie środkowym działki:");
  const recLines = (recs: Rec[]) => recs.map((r) => "  - " + r.slice(0, 12).map(([k, v]) => `${k}: ${v.length > 220 ? v.slice(0, 217) + "…" : v}`).join(" | "));
  if (zone instanceof Error && plan instanceof Error) L.push(`  usługa niedostępna (${zone.message})`);
  else {
    const z = zone instanceof Error ? null : zone;
    const pl = plan instanceof Error ? null : plan;
    if (z?.recs.length) L.push("  Przeznaczenie terenu:", ...recLines(z.recs));
    else if (planZones.length) L.push("  Przeznaczenie terenu (z usługi planu gminy):", ...recLines(planZones.map((r) => r.map(([k, v]) => [k === "etykieta" ? "symbol" : k === "opis" ? "przeznaczenie" : k, v] as [string, string]))));
    if (pl?.recs.length && JSON.stringify(pl.recs) !== JSON.stringify(z?.recs)) L.push("  Plan:", ...recLines(pl.recs));
    if (!z?.recs.length && !pl?.recs.length) {
      if (z?.note === "noservice" || pl?.note === "noservice") L.push("  Gmina nie udostępnia planów w krajowej integracji MPZP – sprawdź w urzędzie gminy lub na jej geoportalu.");
      else L.push("  Brak planu miejscowego w krajowej integracji dla tego miejsca. Zwykle oznacza to brak MPZP (budowa na podstawie decyzji o warunkach zabudowy) – potwierdź w urzędzie gminy.");
    } else if (pl?.recs.length && !z?.recs.length && !planZones.length) L.push("  (Symbol przeznaczenia nie jest dostępny w usłudze – plan rastrowy albo gmina nie publikuje stref; sprawdź rysunek i treść uchwały.)");
  }

  // utilities
  L.push("", `Uzbrojenie terenu (sieci z powiatowych baz GESUT, w promieniu ${BUF} m od granic${util.clipped ? "; duża działka – sprawdzono 500 m wokół środka" : ""}):`);
  if (nets instanceof Error) L.push(`  usługa niedostępna (${nets.message})`);
  else if (nets.every((n) => n.hit instanceof Error))
    L.push(`  - brak danych: serwer powiatu nie odpowiada (${(nets[0].hit as Error).message}). Część powiatów udostępnia sieci tylko przez własny serwer, który bywa niedostępny.`);
  else
    for (const { label, hit } of nets) {
      if (hit instanceof Error) L.push(`  - ${label}: brak danych (${hit.message})`);
      else if (hit.dist === 0) L.push(`  - ${label}: przebiega przez działkę`);
      else if (hit.dist <= 2) L.push(`  - ${label}: tuż przy granicy działki (do 2 m)`);
      else if (Number.isFinite(hit.dist)) L.push(`  - ${label}: ok. ${m(hit.dist)} od granicy działki`);
      else L.push(`  - ${label}: nie widać w promieniu ${BUF} m`);
    }

  // flood
  L.push("", "Ryzyka:");
  if (fl instanceof Error) L.push(`  - Powódź (mapy zagrożenia powodziowego ISOK): usługa niedostępna (${fl.message})`);
  else if (fl.hit.share > 0)
    L.push(`  - Powódź: ok. ${Math.max(1, Math.round(fl.hit.share * 100))}% działki w obszarze zagrożenia powodziowego${fl.scen.length ? ` (${fl.scen.join("; ")})` : ""}`);
  else if (Number.isFinite(fl.hit.dist)) L.push(`  - Powódź: działka poza obszarami zagrożenia, ale obszar zagrożenia jest ok. ${m(fl.hit.dist)} od granicy`);
  else L.push(`  - Powódź: poza obszarami zagrożenia powodziowego (mapy ISOK, w tym scenariusz raz na 500 lat; w promieniu 100 m brak)`);
  if (prot instanceof Error) L.push(`  - Ochrona przyrody (GDOŚ): usługa niedostępna (${prot.message})`);
  else if (prot.length) L.push(`  - Ochrona przyrody (GDOŚ) – działka w zasięgu lub na skraju: ${prot.join("; ")}`);
  else L.push("  - Ochrona przyrody (GDOŚ): poza parkami, rezerwatami, Naturą 2000 i obszarami chronionego krajobrazu");

  if (prices && !(prices instanceof Error)) {
    const keep = prices.split("\n").filter((l) => l && !/^(Dane:|Ceny z aktów|Najnowszy akt)/.test(l));
    L.push("", "Ceny działek niezabudowanych w okolicy (RCN, 1,5 km, 36 mies.):", ...keep.slice(1).map((l) => "  " + l));
  }

  L.push(
    "",
    "Uwaga: to zestawienie z publicznych rejestrów, nie wypis z MPZP ani mapa do celów projektowych. Przed zakupem: wypis i wyrys z planu (lub decyzja WZ), księga wieczysta, warunki przyłączenia u gestorów sieci.",
    "Dane: ULDK, KIEG (ewidencja gruntów), Krajowa Integracja MPZP, KIUT/GESUT – GUGiK; mapy zagrożenia powodziowego – PGW Wody Polskie (ISOK); formy ochrony przyrody – GDOŚ; ceny – RCN (GUGiK). Dane przetworzone.",
  );
  return L.join("\n");
}
