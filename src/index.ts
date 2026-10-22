#!/usr/bin/env node
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { priceReport } from "./report.js";
import { parcelReport } from "./parcel.js";
import { usage } from "./usage.js";
import { landingHtml } from "./landing.js";
import { UserError, log } from "./config.js";
import { VERSION } from "./version.js";

const HELP = `ceny-nieruchomosci-mcp ${VERSION} - real transaction prices of Polish real estate (Rejestr Cen Nieruchomości) for AI agents (MCP)

Usage:
  ceny-nieruchomosci-mcp                 MCP server on stdio (Claude, Cursor, VS Code, ...)
  ceny-nieruchomosci-mcp --http [--port 3000] [--host 127.0.0.1]   Streamable HTTP at /mcp
  ceny-nieruchomosci-mcp prices "<place>" [--kind flat|house|plot] [--radius 500] [--months 24] [--rooms N]
  ceny-nieruchomosci-mcp parcel "<parcel id | obręb nr | address | lat,lon>" [--commune Kórnik] [--no-prices]

Environment:
  CENY_MAX_RADIUS_M    max search radius (default 1500)
  CENY_CACHE_MB        memory for cached RCN responses (default 300)
  CENY_RATE_LIMIT      HTTP: requests per minute per IP (default off)
  CENY_TRUST_PROXY=1   HTTP: client IP from X-Forwarded-For
  CENY_STATS=1         HTTP: anonymous daily usage counters at /stats
  CENY_CONTACT         HTTP: operator e-mail for /.well-known/security.txt
  CENY_PUBLIC_URL      HTTP: public origin for the landing page
`;

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--") && !["http", "help", "version", "no-prices"].includes(key)) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new Error("request too large");
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const RATE = Number(process.env.CENY_RATE_LIMIT ?? 0);
const TRUST_PROXY = process.env.CENY_TRUST_PROXY === "1";
const hits = new Map<string, { n: number; reset: number }>();
function clientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const xf = req.headers["x-forwarded-for"];
    const v = Array.isArray(xf) ? xf[0] : xf;
    if (v) return v.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "?";
}
function rateLimited(req: IncomingMessage): boolean {
  if (!RATE) return false;
  const ip = clientIp(req);
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || now > h.reset) {
    h = { n: 0, reset: now + 60_000 };
    hits.set(ip, h);
    if (hits.size > 50_000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }
  return ++h.n > RATE;
}

async function startHttp(port: number, host: string) {
  const httpServer = createHttpServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type, accept, mcp-protocol-version, mcp-session-id, authorization");
    res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/") {
        if (String(req.headers.accept ?? "").includes("text/html")) {
          const proto = TRUST_PROXY ? String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0] : "http";
          const base = (process.env.CENY_PUBLIC_URL ?? `${proto}://${req.headers.host ?? "localhost"}`).replace(/\/$/, "");
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "max-age=600" });
          res.end(landingHtml(base, usage.enabled));
        } else {
          res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
          res.end(`ceny-nieruchomosci-mcp ${VERSION} - Polish real-estate transaction prices for AI agents (MCP).\nMCP endpoint: POST /mcp\nhttps://github.com/ContentWriterco/ceny-nieruchomosci-mcp\n`);
        }
        return;
      }
      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, version: VERSION }));
        return;
      }
      if (url.pathname === "/.well-known/security.txt" && process.env.CENY_CONTACT) {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end(`Contact: mailto:${process.env.CENY_CONTACT}\nExpires: ${new Date(Date.now() + 180 * 86400_000).toISOString()}\nPreferred-Languages: pl, en\n`);
        return;
      }
      if (url.pathname === "/stats" && usage.enabled) {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "max-age=300" });
        res.end(JSON.stringify(await usage.summary(), null, 1));
        return;
      }
      if (url.pathname !== "/mcp") {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("MCP endpoint is /mcp\n");
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST" });
        res.end();
        return;
      }
      if (rateLimited(req)) {
        void usage.request(clientIp(req), undefined, true);
        res.writeHead(429, { "content-type": "application/json", "retry-after": "60" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: `Rate limit: ${RATE} requests/minute.` }, id: null }));
        return;
      }
      const body = await readBody(req);
      if (usage.enabled) {
        const msgs = (Array.isArray(body) ? body : [body]) as { method?: string; params?: { clientInfo?: { name?: string } } }[];
        const init = msgs.find((m) => m?.method === "initialize");
        void usage.request(clientIp(req), init ? (init.params?.clientInfo?.name ?? "unknown") : undefined);
      }
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      log("error", (e as Error).message);
      if (!res.headersSent) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: (e as Error).message }, id: null }));
      }
    }
  });
  usage.start();
  httpServer.listen(port, host, () => log("info", `HTTP MCP endpoint: http://${host}:${port}/mcp`));
}

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const opt = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);
  if (flags.help) return void process.stdout.write(HELP);
  if (flags.version) return void process.stdout.write(VERSION + "\n");
  try {
    if (pos[0] === "prices") {
      if (!pos[1]) throw new UserError('usage: ceny-nieruchomosci-mcp prices "<place>"');
      process.stdout.write(
        (await priceReport({
          place: pos[1],
          kind: (opt("kind") as "flat" | "house" | "plot") ?? "flat",
          radiusM: opt("radius") ? Number(opt("radius")) : undefined,
          months: opt("months") ? Number(opt("months")) : undefined,
          rooms: opt("rooms") ? Number(opt("rooms")) : undefined,
        })) + "\n",
      );
      return;
    }
    if (pos[0] === "parcel") {
      if (!pos[1]) throw new UserError('usage: ceny-nieruchomosci-mcp parcel "<parcel id | obręb nr | address | lat,lon>"');
      process.stdout.write((await parcelReport({ query: pos[1], commune: opt("commune"), prices: !flags["no-prices"] })) + "\n");
      return;
    }
    if (flags.http) {
      await startHttp(Number(opt("port") ?? process.env.PORT ?? 3000), opt("host") ?? process.env.HOST ?? "127.0.0.1");
      return;
    }
    const server = createServer();
    await server.connect(new StdioServerTransport());
    log("info", `ceny-nieruchomosci-mcp ${VERSION} on stdio`);
  } catch (e) {
    process.stderr.write(`${e instanceof UserError ? "" : "Error: "}${(e as Error).message}\n`);
    process.exitCode = 1;
  }
}
void main();
