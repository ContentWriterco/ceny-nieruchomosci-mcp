import { config, UserError } from "./config.js";
import { geocode, type Place } from "./geocode.js";
import { fetchBox, type Kind, type Tx } from "./rcn.js";

export interface Query {
  place: string;
  kind?: Kind;
  radiusM?: number;
  months?: number;
  rooms?: number;
  minArea?: number;
  maxArea?: number;
  market?: "primary" | "secondary" | "any";
  includeNonMarket?: boolean;
  examples?: number;
}

const KIND_PL: Record<Kind, string> = { flat: "mieszkania (lokale mieszkalne)", house: "domy (nieruchomości zabudowane budynkiem mieszkalnym)", plot: "działki niezabudowane" };
const PPM2_RANGE: Record<Kind, [number, number]> = { flat: [1500, 80000], house: [300, 60000], plot: [2, 30000] };

const pct = (sorted: number[], p: number) => {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};
const group = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const zl = (v: number) => (Number.isFinite(v) ? `${group(v)} zł` : "–");
/** RCN zoning codes like "budownictwoMieszkanioweJednorodzinne" -> "budownictwo mieszkaniowe jednorodzinne" */
export const zoningPl = (z: string) =>
  ({ brakMPZPLubWZ: "brak MPZP i WZ", innyNiewymieniony: "przeznaczenie inne", rolnicze: "rolne", lesne: "leśne" })[z] ??
  z.replace(/([a-ząćęłńóśźż])([A-ZĄĆĘŁŃÓŚŹŻ])/g, "$1 $2").toLowerCase();
const k = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2).replace(".", ",")} mln zł` : zl(Math.round(v / 1000) * 1000));

export function filterTxs(txs: Tx[], q: Required<Pick<Query, "kind" | "months">> & Query, center: Place, radius: number, now = new Date()): (Tx & { ppm2: number; dist: number })[] {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - q.months);
  const from = cutoff.toISOString().slice(0, 10);
  // typos in deed dates (e.g. "2200-01-10") – ignore anything in the future
  const until = new Date(now.getTime() + 31 * 86400_000).toISOString().slice(0, 10);
  const [lo, hi] = PPM2_RANGE[q.kind];
  const seen = new Set<string>();
  const out: (Tx & { ppm2: number; dist: number })[] = [];
  for (const t of txs) {
    if (!t.date || t.date < from || t.date > until) continue;
    const dist = Math.hypot(t.x - center.x, t.y - center.y);
    if (dist > radius) continue;
    // houses: usable area is often missing in the register -> keep them, price per m² only when known
    if (!(t.price > 0) || (!(t.area > 0) && q.kind !== "house")) continue;
    if (q.kind === "flat" && t.use !== "mieszkalna") continue;
    if (q.kind === "house" && (t.use !== "mieszkalny" || t.propType !== "nieruchomoscGruntowaZabudowana")) continue;
    if (q.kind === "plot" && t.propType !== "nieruchomoscGruntowaNiezabudowana") continue;
    if (!q.includeNonMarket && t.transType && t.transType !== "wolnyRynek") continue;
    if (t.share && t.share !== "1/1") continue; // fractional shares distort prices
    if (q.rooms !== undefined && (q.rooms >= 5 ? (t.rooms ?? 0) < 5 : t.rooms !== q.rooms)) continue;
    if (q.minArea !== undefined && t.area < q.minArea) continue;
    if (q.maxArea !== undefined && t.area > q.maxArea) continue;
    if (q.market === "primary" && t.market !== "rynekPierwotny") continue;
    if (q.market === "secondary" && t.market !== "rynekWtorny") continue;
    const ppm2 = t.area > 0 ? t.price / t.area : NaN;
    if (Number.isFinite(ppm2) && (ppm2 < lo || ppm2 > hi)) continue;
    if (q.kind === "house" && !Number.isFinite(ppm2) && (t.price < 100_000 || t.price > 30_000_000)) continue;
    // the same unit can appear in several overlapping fetches / versions
    const key = `${t.dealId}|${t.area}|${t.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...t, ppm2, dist });
  }
  return out;
}

function summary(rows: { ppm2: number; price: number; area: number }[]) {
  const p = rows.map((r) => r.ppm2).filter(Number.isFinite).sort((a, b) => a - b);
  const pr = rows.map((r) => r.price).sort((a, b) => a - b);
  const ar = rows.map((r) => r.area).filter((v) => v > 0).sort((a, b) => a - b);
  return { n: rows.length, nPpm2: p.length, med: pct(p, 0.5), p25: pct(p, 0.25), p75: pct(p, 0.75), price: pct(pr, 0.5), area: pct(ar, 0.5) };
}

export async function priceReport(q: Query): Promise<string> {
  const kind: Kind = q.kind ?? "flat";
  const months = Math.max(1, Math.min(120, q.months ?? 24));
  let radius = Math.max(100, Math.min(config.maxRadius, q.radiusM ?? (kind === "flat" ? 500 : 1500)));
  const places = await geocode(q.place);
  const center = places[0];
  let txs = await fetchBox(kind, center.x - radius, center.y - radius, center.x + radius, center.y + radius);
  const qq = { ...q, kind, months };
  let rows = filterTxs(txs, qq, center, radius);
  // a town is given as one point (often not where people live): widen the circle once when nothing is found
  if (!rows.length && center.precision === "town" && q.radiusM === undefined && radius < config.maxRadius) {
    radius = config.maxRadius;
    txs = await fetchBox(kind, center.x - radius, center.y - radius, center.x + radius, center.y + radius);
    rows = filterTxs(txs, qq, center, radius);
  }
  const lines: string[] = [];
  const unit = kind === "plot" ? "m² działki" : "m² pow. użytkowej";
  lines.push(
    `Ceny transakcyjne: ${KIND_PL[kind]} w promieniu ${radius} m od: ${center.label}${center.precision === "town" ? " (środek miejscowości)" : center.precision === "street" ? " (ulica)" : ""}`,
    `Okres: ostatnie ${months} mies.${q.rooms !== undefined ? ` · pokoje: ${q.rooms >= 5 ? "5+" : q.rooms}` : ""}${q.minArea || q.maxArea ? ` · powierzchnia ${q.minArea ?? 0}–${q.maxArea ?? "∞"} m²` : ""}${q.market && q.market !== "any" ? ` · rynek ${q.market === "primary" ? "pierwotny" : "wtórny"}` : ""}`,
    "",
  );
  if (places.length > 1 && center.precision === "town")
    lines.push(`(Jest więcej miejscowości o tej nazwie: ${places.slice(1, 5).map((p) => p.label).join("; ")} – jeśli chodzi o inną, podaj adres z ulicą albo „lat,lon”.)`, "");
  else if (places.length > 1 && center.precision !== "point") lines.push(`(Inne dopasowania adresu: ${places.slice(1, 4).map((p) => p.label).join("; ")})`, "");
  if (!rows.length) {
    lines.push(
      `Brak transakcji spełniających kryteria (w promieniu jest ${txs.length} rekordów RCN dowolnego rodzaju i daty).`,
      "Spróbuj większego promienia (radius_m), dłuższego okresu (months) albo bez filtrów pokoi/powierzchni.",
    );
  } else {
    const s = summary(rows);
    lines.push(`Transakcji: ${s.n}${s.n < 10 ? " (mała próba – traktuj orientacyjnie)" : ""}`);
    if (kind === "house") {
      const land = rows.map((r) => r.landArea ?? NaN).filter((v) => v > 0).sort((a, b) => a - b);
      lines.push(`Mediana ceny domu (z działką): ${k(s.price)} (połowa między ${k(pct(rows.map((r) => r.price).sort((a, b) => a - b), 0.25))} a ${k(pct(rows.map((r) => r.price).sort((a, b) => a - b), 0.75))})`);
      if (land.length) lines.push(`Mediana powierzchni działki: ${group(pct(land, 0.5))} m²`);
      if (s.nPpm2 >= 3) lines.push(`Cena za m² pow. użytkowej (gdy podana w rejestrze, ${s.nPpm2} transakcji): mediana ${zl(s.med)}`);
    } else {
      lines.push(
        `Mediana ceny za ${unit}: ${zl(s.med)} (połowa transakcji między ${zl(s.p25)} a ${zl(s.p75)})`,
        `Mediana ceny transakcji: ${k(s.price)} · mediana powierzchni: ${group(s.area)} m²`,
      );
    }
    if (kind === "flat") {
      const byRooms = new Map<string, typeof rows>();
      for (const r of rows) {
        const key = !r.rooms ? "?" : r.rooms >= 4 ? "4+" : String(r.rooms);
        (byRooms.get(key) ?? byRooms.set(key, []).get(key)!).push(r);
      }
      const order = ["1", "2", "3", "4+", "?"];
      const parts = order.filter((o) => byRooms.get(o)?.length).map((o) => {
        const ss = summary(byRooms.get(o)!);
        return `${o === "?" ? "brak danych" : `${o} pok.`}: ${zl(ss.med)}/m², ${k(ss.price)} (${ss.n})`;
      });
      lines.push(`Wg liczby pokoi: ${parts.join(" · ")}`);
      const prim = rows.filter((r) => r.market === "rynekPierwotny");
      const sec = rows.filter((r) => r.market === "rynekWtorny");
      if (prim.length >= 3 && sec.length >= 3) lines.push(`Rynek pierwotny: ${zl(summary(prim).med)}/m² (${prim.length}) · wtórny: ${zl(summary(sec).med)}/m² (${sec.length})`);
    }
    // trend by year over a longer window
    const trendRows = filterTxs(txs, { ...qq, months: 72 }, center, radius);
    const byYear = new Map<string, typeof rows>();
    for (const r of trendRows) (byYear.get(r.date.slice(0, 4)) ?? byYear.set(r.date.slice(0, 4), []).get(r.date.slice(0, 4))!).push(r);
    const years = [...byYear.keys()].sort();
    if (years.length >= 2)
      lines.push(
        kind === "house"
          ? `Trend (mediana ceny domu wg roku aktu): ${years.map((y) => `${y}: ${k(summary(byYear.get(y)!).price)} (${byYear.get(y)!.length})`).join(" · ")}`
          : `Trend (mediana za m² wg roku aktu): ${years.map((y) => `${y}: ${zl(summary(byYear.get(y)!).med)} (${byYear.get(y)!.length})`).join(" · ")}`,
      );
    const ex = [...rows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, Math.max(0, Math.min(25, q.examples ?? 8)));
    if (ex.length) {
      lines.push("", "Ostatnie transakcje (bez adresów):");
      for (const r of ex) {
        const det = kind === "flat" ? `${r.rooms ? `${r.rooms} pok., ` : ""}${r.floor !== undefined ? `piętro ${r.floor}, ` : ""}` : kind === "plot" && r.zoning ? `${zoningPl(r.zoning)}, ` : "";
        const size = kind === "house" ? `${r.area > 0 ? `${Math.round(r.area)} m² domu, ` : ""}${r.landArea ? `działka ${group(r.landArea)} m²` : ""}`.replace(/, $/, "") : `${Math.round(r.area)} m²`;
        lines.push(`- ${r.date.slice(0, 7)} · ${size || "–"} · ${det}${k(r.price)}${Number.isFinite(r.ppm2) ? ` · ${zl(r.ppm2)}/m²` : ""} · ${Math.round(r.dist)} m od punktu`);
      }
    }
    const newest = rows.reduce((m, r) => (r.date > m ? r.date : m), "");
    lines.push("", `Najnowszy akt w próbie: ${newest}. Rejestr jest uzupełniany z opóźnieniem (zwykle kilka tygodni–miesięcy), więc ostatnie miesiące bywają niepełne.`);
  }
  lines.push(
    "Ceny z aktów notarialnych (transakcje wolnorynkowe, pełna własność), nie ceny ofertowe. Bez transakcji z bonifikatą i udziałów ułamkowych.",
    "Dane: Rejestr Cen Nieruchomości – Główny Urząd Geodezji i Kartografii (geoportal.gov.pl), adresy: GUGiK UUG. Dane przetworzone.",
  );
  return lines.join("\n");
}
