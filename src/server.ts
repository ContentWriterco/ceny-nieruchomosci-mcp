import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UserError, log } from "./config.js";
import { priceReport } from "./report.js";
import { geocode } from "./geocode.js";
import { parcelReport } from "./parcel.js";
import { VERSION } from "./version.js";
import { usage, classify } from "./usage.js";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run(tool: string, fn: () => Promise<string>): Promise<Text> {
  const t0 = performance.now();
  let res: Text;
  let userErr = false;
  try {
    res = { content: [{ type: "text", text: await fn() }] };
  } catch (e) {
    userErr = e instanceof UserError;
    const msg = userErr ? (e as Error).message : `Internal error: ${(e as Error).message}`;
    if (!userErr) log("error", (e as Error).stack);
    res = { content: [{ type: "text", text: msg }], isError: true };
  }
  if (usage.enabled) {
    const text = res.content[0].text;
    const outcome = /^Could not find/.test(text) ? "not_found" : /^Brak transakcji/m.test(text) ? "no_result" : classify(text, !!res.isError, userErr);
    void usage.tool(tool, outcome, performance.now() - t0);
  }
  return res;
}

export const INSTRUCTIONS = `Real transaction prices of Polish real estate from notarial deeds (Rejestr Cen Nieruchomości, GUGiK) – not asking prices.
Use property_prices with an address ("Poznań, Garbary 10"), a street ("Kraków, Długa"), a town or "lat,lon". It returns the median price per m², the spread, price by number of rooms, a yearly trend and recent transactions (no addresses) within a radius.
Explain to the user that these are deed prices from the official register (free-market sales, full ownership), that the newest months are incomplete because the register is filled with a delay, and that small samples (<10) are only indicative. Use parcel_report for one plot ("Bnin 100", a parcel id like 306401_1.0051.AR_14.39/6, an address or "lat,lon"): parcel id and area, land use class, local zoning plan (MPZP) with the zoning symbol when published, nearby utility networks (water, sewer, gas, power, heat, telecom), flood hazard, nature protection and plot prices around. If several parcels match, ask the user which one (or pass commune).
Remind the user that the parcel report is a summary of public registers, not a legal zoning extract (wypis i wyrys) and not a design map.
Answer in the user's language.`;

const kind = z.enum(["flat", "house", "plot"]).optional().describe("flat = mieszkanie (default), house = dom, plot = działka niezabudowana");

export function createServer(): McpServer {
  const server = new McpServer({ name: "ceny-nieruchomosci-mcp", version: VERSION }, { instructions: INSTRUCTIONS });
  const ro = { readOnlyHint: true, openWorldHint: true } as const;

  server.registerTool(
    "property_prices",
    {
      title: "Real-estate transaction prices (Poland)",
      description:
        "Actual sale prices of flats, houses or building plots near a place in Poland, from notarial deeds (official Rejestr Cen Nieruchomości). " +
        "Returns median price per m², interquartile range, typical total price and area, breakdown by rooms, yearly trend and recent transactions. " +
        "place: address \"Poznań, Garbary 10\", street \"Kraków, Długa\", town \"Swarzędz\" or \"lat,lon\".",
      inputSchema: {
        place: z.string().describe("Address, street, town or 'lat,lon' in Poland"),
        kind,
        radius_m: z.number().int().min(100).max(1500).optional().describe("Search radius in metres (default 500 for flats, 1500 for houses/plots)"),
        months: z.number().int().min(1).max(120).optional().describe("Look back this many months (default 24)"),
        rooms: z.number().int().min(1).max(5).optional().describe("Only flats with this many rooms (5 = 5+)"),
        min_area: z.number().optional().describe("Minimum area m²"),
        max_area: z.number().optional().describe("Maximum area m²"),
        market: z.enum(["any", "primary", "secondary"]).optional().describe("primary = od dewelopera, secondary = rynek wtórny (when recorded)"),
        examples: z.number().int().min(0).max(25).optional().describe("How many recent transactions to list (default 8)"),
      },
      annotations: ro,
    },
    async (a) =>
      run("property_prices", () =>
        priceReport({
          place: a.place,
          kind: a.kind,
          radiusM: a.radius_m,
          months: a.months,
          rooms: a.rooms,
          minArea: a.min_area,
          maxArea: a.max_area,
          market: a.market,
          examples: a.examples,
        }),
      ),
  );

  server.registerTool(
    "parcel_report",
    {
      title: "Parcel check (Poland): zoning, utilities, flood, protection, prices",
      description:
        "Everything public about one land parcel (działka) in Poland: parcel id, area and land-use class from the land register (EGiB), local zoning plan (MPZP) and zoning symbol, " +
        "utility networks on or near the plot (water, sewer, gas, power, heat, telecom – GESUT), flood hazard (ISOK maps), nature protection areas (GDOŚ) and plot prices nearby (RCN). " +
        "query: parcel id \"302109_4.0001.100\", \"obręb number\" like \"Bnin 100\" or \"obręb Bnin działka 100 gmina Kórnik\", an address \"Kórnik, Poznańska 1\" (the parcel under the address point) or \"lat,lon\".",
      inputSchema: {
        query: z.string().describe("Parcel id, 'obręb number', address or 'lat,lon'"),
        commune: z.string().optional().describe("Gmina / powiat name to pick the right parcel when 'obręb number' matches several"),
        prices: z.boolean().optional().describe("Include plot prices nearby (default true)"),
      },
      annotations: ro,
    },
    async (a) => run("parcel_report", () => parcelReport({ query: a.query, commune: a.commune, prices: a.prices })),
  );

  server.registerTool(
    "find_address",
    {
      title: "Find an address (Poland)",
      description: "Resolve a Polish address, street or town to coordinates using the official address register (GUGiK). Useful to check which place property_prices will use.",
      inputSchema: { query: z.string().describe("e.g. 'Gdańsk, Długa 5'") },
      annotations: ro,
    },
    async (a) =>
      run("find_address", async () => {
        const ps = await geocode(a.query);
        return ps
          .slice(0, 10)
          .map((p) => `- ${p.label} · ${p.lat.toFixed(5)},${p.lon.toFixed(5)} · ${p.precision}${p.teryt ? ` · TERYT ${p.teryt}` : ""}`)
          .join("\n");
      }),
  );

  server.registerTool(
    "data_sources",
    { title: "Data sources", description: "Where the data comes from, licence and caveats.", inputSchema: {}, annotations: ro },
    async () =>
      run("data_sources", async () =>
        [
          "Rejestr Cen Nieruchomości (RCN) – Główny Urząd Geodezji i Kartografii, krajowa usługa WFS https://mapy.geoportal.gov.pl/wss/service/rcn (dane z powiatów; bezpłatne od 13.02.2026, art. 40 ustawy Prawo geodezyjne i kartograficzne).",
          "Adresy: GUGiK UUG (państwowy rejestr granic i adresów).",
          "Działki (parcel_report): ULDK i Krajowa Integracja Ewidencji Gruntów, Krajowa Integracja Miejscowych Planów Zagospodarowania Przestrzennego, Krajowa Integracja Uzbrojenia Terenu (GESUT) – GUGiK; mapy zagrożenia powodziowego – PGW Wody Polskie (ISOK); formy ochrony przyrody – GDOŚ.",
          "Pomijamy dane identyfikujące (numery aktów, strony transakcji, numery lokali); usługa krajowa nie publikuje adresów lokali.",
          "Zasięg zależy od powiatów (większość publikuje; część z opóźnieniem lub niekompletnie). Najnowsze miesiące są zwykle niepełne.",
          `ceny-nieruchomosci-mcp ${VERSION} · https://github.com/ContentWriterco/ceny-nieruchomosci-mcp`,
        ].join("\n"),
      ),
  );
  return server;
}
