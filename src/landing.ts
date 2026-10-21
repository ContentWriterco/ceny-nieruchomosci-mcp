import { VERSION } from "./version.js";

const REPO = "https://github.com/ContentWriterco/ceny-nieruchomosci-mcp";

export function landingHtml(base: string, stats: boolean): string {
  const mcp = `${base}/mcp`;
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ceny-nieruchomosci-mcp – prawdziwe ceny transakcyjne mieszkań dla AI (serwer MCP)</title>
<meta name="description" content="Darmowy serwer MCP z cenami transakcyjnymi mieszkań, domów i działek z Rejestru Cen Nieruchomości (akty notarialne). Zapytaj Claude albo ChatGPT, za ile naprawdę sprzedawały się mieszkania w okolicy.">
<link rel="canonical" href="${base}/">
<meta property="og:title" content="Za ile naprawdę sprzedają się mieszkania obok? – ceny transakcyjne dla Twojego asystenta AI">
<meta property="og:description" content="Ceny z aktów notarialnych (Rejestr Cen Nieruchomości) w Claude, ChatGPT i każdym kliencie MCP. Bez klucza API.">
<meta property="og:url" content="${base}/"><meta name="twitter:card" content="summary">
<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "ceny-nieruchomosci-mcp",
    applicationCategory: "FinanceApplication",
    operatingSystem: "Any",
    softwareVersion: VERSION,
    description: "MCP server with real transaction prices of Polish real estate from the official price register.",
    url: `${base}/`,
    codeRepository: REPO,
    license: "https://opensource.org/licenses/MIT",
    offers: { "@type": "Offer", price: "0", priceCurrency: "PLN" },
    publisher: { "@type": "Organization", name: "Compabase (Content Writer sp. z o.o.)", url: "https://compabase.com" },
  })}</script>
<style>
:root{--bg:#fff;--fg:#1f2328;--mut:#59636e;--card:#f6f8fa;--bd:#d1d9e0;--acc:#1a7f37}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--card:#151b23;--bd:#3d444d;--acc:#3fb950}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:860px;margin:0 auto;padding:48px 16px 64px}h1{font-size:38px;line-height:1.15;margin:0 0 12px}h1 span{color:var(--acc)}h2{font-size:22px;margin:36px 0 12px}
p.lead{font-size:19px;color:var(--mut);margin:0 0 24px}.ep{display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:12px 14px;font:15px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.ep code{flex:1;min-width:0;overflow-wrap:anywhere}button{font:600 14px inherit;font-family:inherit;padding:6px 12px;border-radius:8px;border:1px solid var(--bd);background:var(--bg);color:var(--fg);cursor:pointer}
pre{background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:14px;overflow:auto;font-size:13.5px;line-height:1.5;white-space:pre-wrap}li{margin:6px 0}a{color:var(--acc)}.small{color:var(--mut);font-size:14px}
</style></head><body><main>
<h1>ceny-<span>nieruchomości</span>-mcp</h1>
<p class="lead">Za ile naprawdę sprzedają się mieszkania obok? Ceny z aktów notarialnych z Rejestru Cen Nieruchomości – nie ceny z ogłoszeń – w Claude, ChatGPT, Cursorze i każdym kliencie MCP. Za darmo, bez klucza API.</p>
<div class="ep"><code id="u">${mcp}</code><button onclick="navigator.clipboard.writeText(document.getElementById('u').textContent);this.textContent='Skopiowano'">Kopiuj adres MCP</button></div>
<h2>Przykład</h2>
<pre>Ty:    Za ile sprzedawały się 3-pokojowe mieszkania koło ul. Garbary 10 w Poznaniu?
Agent: W promieniu 500 m w ostatnich 2 latach: mediana 13 900 zł/m², typowo 760 tys. zł za ok. 55 m²
       (połowa transakcji między 12 300 a 15 800 zł/m²). Trend: 2023 – 11 800, 2024 – 13 100, 2025 – 14 200 zł/m².</pre>
<p class="small">Liczby w przykładzie są ilustracyjne – prawdziwe policzy serwer dla Twojego adresu.</p>
<h2>Jak podłączyć</h2>
<ul>
<li><b>Claude</b>: Ustawienia → Connectors → <i>Add custom connector</i> → wklej adres powyżej.</li>
<li><b>ChatGPT</b>: Settings → Connectors (tryb deweloperski) → dodaj serwer MCP z tym adresem.</li>
<li><b>Claude Code</b>: <code>claude mcp add --transport http ceny ${mcp}</code></li>
<li><b>Lokalnie</b>: <code>npx -y ceny-nieruchomosci-mcp</code></li>
</ul>
<h2>Co potrafi</h2>
<ul>
<li><b>property_prices</b> – mieszkania, domy albo działki w promieniu od adresu: mediana ceny za m², rozrzut, ceny wg liczby pokoi, trend rok do roku i ostatnie transakcje (bez adresów).</li>
<li><b>find_address</b> – sprawdzenie adresu w państwowym rejestrze adresów.</li>
<li><b>data_sources</b> – źródła i zastrzeżenia.</li>
</ul>
<p class="small">Dane: Rejestr Cen Nieruchomości – Główny Urząd Geodezji i Kartografii (bezpłatny od 13.02.2026), adresy GUGiK. Pomijamy dane identyfikujące transakcje. Open source (MIT): <a href="${REPO}">GitHub</a>${stats ? ` · <a href="/stats">statystyki użycia</a> (anonimowe)` : ""} · wersja ${VERSION} · hostowane pro publico bono przez <a href="https://compabase.com">Compabase</a>.</p>
<p class="small" lang="en"><b>English:</b> free MCP server with real transaction prices of Polish flats, houses and plots from notarial deeds (official RCN register). Endpoint: <code>${mcp}</code></p>
</main></body></html>`;
}
