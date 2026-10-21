export const config = {
  rcnUrl: process.env.CENY_RCN_URL ?? "https://mapy.geoportal.gov.pl/wss/service/rcn",
  uugUrl: process.env.CENY_UUG_URL ?? "https://services.gugik.gov.pl/uug/",
  maxRadius: Number(process.env.CENY_MAX_RADIUS_M ?? 1500),
  cacheMb: Number(process.env.CENY_CACHE_MB ?? 300),
  cacheTtlSec: Number(process.env.CENY_CACHE_TTL ?? 6 * 3600),
  log: process.env.CENY_LOG ?? "info",
  userAgent: "ceny-nieruchomosci-mcp (+https://github.com/ContentWriterco/ceny-nieruchomosci-mcp)",
};

export function log(level: "debug" | "info" | "warn" | "error", ...args: unknown[]) {
  const order = { debug: 0, info: 1, warn: 2, error: 3 } as const;
  if (order[level] < (order[config.log as keyof typeof order] ?? 1)) return;
  console.error(`[ceny-mcp] ${level}:`, ...args);
}

export class UserError extends Error {}
