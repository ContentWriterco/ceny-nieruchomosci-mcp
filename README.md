<h1 align="center">ceny-nieruchomości-mcp 🏠</h1>

<p align="center">
  <b>Prawdziwe ceny transakcyjne mieszkań, domów i działek w Polsce – dla Twojego asystenta AI.</b><br>
  Serwer <a href="https://modelcontextprotocol.io">MCP</a> z danymi z aktów notarialnych (Rejestr Cen Nieruchomości, GUGiK) – nie z ogłoszeń. Działa w Claude, ChatGPT, Cursorze i każdym kliencie MCP.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ceny-nieruchomosci-mcp"><img alt="npm" src="https://img.shields.io/npm/v/ceny-nieruchomosci-mcp?color=cb3837&label=npm"></a>
  <a href="https://github.com/ContentWriterco/ceny-nieruchomosci-mcp/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ContentWriterco/ceny-nieruchomosci-mcp/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="Licencja MIT" src="https://img.shields.io/badge/licencja-MIT-blue"></a>
  <img alt="Bez klucza API" src="https://img.shields.io/badge/klucz%20API-niepotrzebny-2ea44f">
</p>

```
Ty:     Za ile sprzedawały się mieszkania koło ul. Garbary 10 w Poznaniu?
Agent:  W promieniu 500 m w ostatnich 2 latach było 228 transakcji wolnorynkowych:
        mediana 12 048 zł/m² (połowa między 10 115 a 14 782 zł/m²), typowo 444 tys. zł za 39 m².
        1 pokój: 13 163 zł/m² · 2 pokoje: 13 069 zł/m² · 3 pokoje: 10 787 zł/m² · 4+: 9 629 zł/m².
```
<sub>Prawdziwy wynik z października 2026.</sub>

## Podłącz w 30 sekund

Adres MCP: **`https://ceny.compabase.com/mcp`** (Streamable HTTP, bez logowania).

- **Claude:** Ustawienia → Connectors → *Add custom connector* → wklej adres.
- **ChatGPT:** Settings → Connectors (tryb deweloperski) → dodaj serwer MCP.
- **Claude Code:** `claude mcp add --transport http ceny https://ceny.compabase.com/mcp`
- **Lokalnie (stdio):** `npx -y ceny-nieruchomosci-mcp`, np. w Claude Desktop:

```json
{ "mcpServers": { "ceny": { "command": "npx", "args": ["-y", "ceny-nieruchomosci-mcp"] } } }
```

## Co potrafi

| Narzędzie | Do czego |
|---|---|
| `property_prices` | Mieszkania, domy albo działki niezabudowane w promieniu od adresu, ulicy, miejscowości lub punktu: mediana ceny za m², rozrzut (25–75%), typowa cena i powierzchnia, ceny wg liczby pokoi, rynek pierwotny/wtórny, trend rok do roku i ostatnie transakcje (bez adresów). Filtry: pokoje, powierzchnia, okres, promień. |
| `find_address` | Sprawdza adres w państwowym rejestrze adresów (GUGiK). |
| `data_sources` | Źródła danych i zastrzeżenia. |

**Przykładowe pytania:** „Ile kosztuje m² mieszkania przy Długiej w Krakowie?”, „Za ile sprzedają się domy w Swarzędzu?”, „Ceny działek budowlanych w Kórniku w ostatnich 3 latach”, „Czy 650 tys. za 3 pokoje 55 m² na Wildzie to dobra cena?”.

## Skąd dane i jak liczymy

- **Rejestr Cen Nieruchomości** prowadzony przez starostów, udostępniany bezpłatnie od 13.02.2026 (nowelizacja Prawa geodezyjnego i kartograficznego) przez krajową usługę GUGiK `https://mapy.geoportal.gov.pl/wss/service/rcn`. Adresy: państwowy geokoder GUGiK (UUG).
- Liczymy tylko **transakcje wolnorynkowe pełnej własności** (bez sprzedaży z bonifikatą, przetargów gminnych i udziałów ułamkowych), mieszkania tylko o funkcji mieszkalnej (bez garaży i komórek), z odrzuceniem oczywistych błędów (np. dat z przyszłości).
- **Prywatność:** nie pokazujemy numerów aktów, stron ani adresów lokali (usługa krajowa ich nie publikuje); transakcje podajemy z odległością od wskazanego punktu.
- **Zastrzeżenia:** rejestr jest uzupełniany z opóźnieniem (ostatnie miesiące są niepełne), zasięg zależy od powiatów, a dla domów rejestr często nie podaje powierzchni użytkowej – wtedy podajemy cenę całej nieruchomości i powierzchnię działki.

## Własny serwer

```bash
npx -y ceny-nieruchomosci-mcp --http --port 3000      # MCP: http://localhost:3000/mcp
npx -y ceny-nieruchomosci-mcp prices "Gdańsk, Długa 1" --rooms 2
```

Zmienne: `CENY_MAX_RADIUS_M` (1500), `CENY_CACHE_MB` (300), `CENY_RATE_LIMIT`, `CENY_STATS=1` (anonimowe liczniki pod `/stats`), `CENY_CONTACT`, `CENY_PUBLIC_URL`.

## Licencja

Kod: MIT. Dane: Rejestr Cen Nieruchomości – Główny Urząd Geodezji i Kartografii (dane przetworzone). Projekt niezależny, hostowany pro publico bono przez [Compabase](https://compabase.com). Zobacz też [rozkład-mcp](https://github.com/ContentWriterco/rozklad-mcp) – rozkłady jazdy PKP, PKS i komunikacji miejskiej dla AI.

---

## English

**ceny-nieruchomosci-mcp** gives AI assistants **real transaction prices of Polish real estate** (flats, houses, building plots) from notarial deeds in the official Rejestr Cen Nieruchomości (GUGiK), not asking prices. `property_prices` returns the median price per m², interquartile range, breakdown by rooms, primary/secondary market, a yearly trend and recent sales within a radius of any Polish address, street, town or coordinates. Public endpoint: `https://ceny.compabase.com/mcp` (no key), or run locally with `npx -y ceny-nieruchomosci-mcp`.
