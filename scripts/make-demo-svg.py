#!/usr/bin/env python3
"""
Generates the animated README demo (docs/demo-pl.svg, docs/demo-en.svg): a user types a question,
the agent calls property_prices and answers with a median, prices by rooms and a yearly trend chart.
Content = a real answer of the public server (Poznań, Garbary 10, flats, 500 m, 24 months; 2026-10-22).
Pure SVG + SMIL, adapts to light/dark mode.
Usage: python3 scripts/make-demo-svg.py
"""
import os
from xml.sax.saxutils import escape

W, CW = 860, 8.45   # width, monospace char width (approx.)
LOOP = 20.0         # seconds
X0 = 28

# yearly medians (zł/m²) from the same answer
TREND = [(2021, 8832), (2022, 9183), (2023, 9510), (2024, 11138), (2025, 12179), (2026, 11405)]

TEXT = {
    "pl": {
        "title": "Claude · ceny-nieruchomosci-mcp",
        "you": "Ty", "agent": "Agent",
        "q": "Za ile sprzedawały się mieszkania koło Garbary 10 w Poznaniu?",
        "tool": 'property_prices(place: "Poznań, Garbary 10", kind: "flat")',
        "done": "228 aktów notarialnych · 500 m · 24 mies.",
        "intro": "Mediana 12 048 zł/m² (połowa transakcji: 10 115–14 782 zł/m²).",
        "rows": [
            ("1 pok.", "13 163 zł/m²  · typowo 387 tys. zł  (73 transakcje)"),
            ("2 pok.", "13 069 zł/m²  · typowo 512 tys. zł  (73)"),
            ("3 pok.", "10 787 zł/m²  · typowo 499 tys. zł  (43)"),
        ],
        "chart": "Mediana zł/m² wg roku aktu",
        "fmt": lambda v: f"{v / 1000:.1f}".replace(".", ",") + " tys.",
        "note": "Rynek pierwotny 12 250 zł/m², wtórny 11 171 zł/m². Ceny z aktów, nie z ogłoszeń.",
        "aria": "Animacja: użytkownik pyta agenta AI, za ile sprzedawały się mieszkania koło ul. Garbary 10 w Poznaniu; agent wywołuje property_prices z ceny-nieruchomosci-mcp i podaje medianę ceny za metr, ceny wg liczby pokoi i wykres trendu z lat 2021–2026.",
    },
    "en": {
        "title": "Claude · ceny-nieruchomosci-mcp",
        "you": "You", "agent": "Agent",
        "q": "What did flats near Garbary 10 in Poznań actually sell for?",
        "tool": 'property_prices(place: "Poznań, Garbary 10", kind: "flat")',
        "done": "228 notarial deeds · 500 m · 24 months",
        "intro": "Median 12,048 zł/m² (middle half of sales: 10,115–14,782 zł/m²).",
        "rows": [
            ("1 room", "13,163 zł/m²  · typically 387k zł  (73 sales)"),
            ("2 rooms", "13,069 zł/m²  · typically 512k zł  (73)"),
            ("3 rooms", "10,787 zł/m²  · typically 499k zł  (43)"),
        ],
        "chart": "Median zł/m² by deed year",
        "fmt": lambda v: f"{v / 1000:.1f}k",
        "note": "New-build 12,250 zł/m², resale 11,171 zł/m². Prices from deeds, not listings.",
        "aria": "Animation: a user asks an AI agent what flats near Garbary 10 in Poznań sold for; the agent calls property_prices from ceny-nieruchomosci-mcp and answers with the median price per m², prices by number of rooms and a 2021–2026 trend chart.",
    },
}

T_TYPE0, T_TYPE1 = 0.6, 3.6
T_TOOL, T_TOOLDONE = 4.1, 5.6
T_ANS0, T_STEP = 6.1, 0.5
T_FADE = 18.6


def kt(t):
    return f"{t / LOOP:.4f}"


def appear(t, fade=0.25):
    return (f'<animate attributeName="opacity" dur="{LOOP}s" repeatCount="indefinite" '
            f'values="0;0;1;1;0;0" keyTimes="0;{kt(t)};{kt(t + fade)};{kt(T_FADE)};{kt(T_FADE + 0.5)};1"/>')


def grow(attr, full, t, base=None, dur=0.6):
    """animate a bar's height (and y) from 0 to full starting at t"""
    if base is None:
        vals = f"0;0;{full};{full};0;0"
    else:
        vals = f"{base};{base};{base - full};{base - full};{base};{base}"
    return (f'<animate attributeName="{attr}" dur="{LOOP}s" repeatCount="indefinite" '
            f'values="{vals}" keyTimes="0;{kt(t)};{kt(t + dur)};{kt(T_FADE)};{kt(T_FADE + 0.5)};1"/>')


def typing(clip_id, n, x):
    widths, times = [0], [0.0]
    for i in range(n + 1):
        widths.append(round(i * CW + 2, 1))
        times.append((T_TYPE0 + (T_TYPE1 - T_TYPE0) * i / n) / LOOP)
    widths += [n * CW + 2, 0]
    times += [(T_FADE + 0.5) / LOOP, 1.0]
    return (f'<clipPath id="{clip_id}"><rect x="{x}" y="0" height="2000" width="0">'
            f'<animate attributeName="width" dur="{LOOP}s" repeatCount="indefinite" calcMode="discrete" '
            f'values="{";".join(str(w) for w in widths)}" keyTimes="{";".join(f"{t:.4f}" for t in times)}"/>'
            f'</rect></clipPath>')


def svg(lang):
    t = TEXT[lang]
    H_HEADER = 44
    y = H_HEADER + 34
    body, defs = [], []

    body.append(f'<text class="label" x="{X0}" y="{y}">{escape(t["you"])}</text>')
    y += 24
    body.append(f'<rect class="bubble" x="{X0 - 10}" y="{y - 19}" width="{len(t["q"]) * CW + 30}" height="30" rx="8"/>')
    defs.append(typing("type", len(t["q"]), X0 + 4))
    body.append(f'<g clip-path="url(#type)"><text class="q" x="{X0 + 4}" y="{y}">{escape(t["q"])}</text></g>')
    y += 46

    body.append(f'<g opacity="0">{appear(T_TOOL)}'
                f'<rect class="tool" x="{X0 - 10}" y="{y - 19}" width="{len(t["tool"]) * CW + 64}" height="30" rx="15"/>'
                f'<text class="toolic" x="{X0 + 4}" y="{y}">⚙</text>'
                f'<text class="toolt" x="{X0 + 26}" y="{y}">{escape(t["tool"])}</text></g>')
    dx = X0 + len(t["tool"]) * CW + 72
    body.append(f'<g opacity="0"><animate attributeName="opacity" dur="{LOOP}s" repeatCount="indefinite" '
                f'values="0;0;1;1;0;0" keyTimes="0;{kt(T_TOOL)};{kt(T_TOOL + 0.1)};{kt(T_TOOLDONE)};{kt(T_TOOLDONE + 0.05)};1"/>'
                + "".join(f'<circle class="dot" cx="{dx + i * 10}" cy="{y - 4}" r="3"><animate attributeName="opacity" values="0.2;1;0.2" dur="0.9s" begin="{i * 0.15}s" repeatCount="indefinite"/></circle>' for i in range(3))
                + "</g>")
    y += 30
    body.append(f'<g opacity="0">{appear(T_TOOLDONE)}<text class="ok" x="{X0 + 4}" y="{y}">✓ {escape(t["done"])}</text></g>')
    y += 44

    ta = T_ANS0
    body.append(f'<g opacity="0">{appear(ta)}<text class="label" x="{X0}" y="{y}">{escape(t["agent"])}</text></g>')
    y += 26
    body.append(f'<g opacity="0">{appear(ta)}<text class="big" x="{X0}" y="{y}">{escape(t["intro"])}</text></g>')
    y += 10
    for tag, line in t["rows"]:
        ta += T_STEP
        y += 32
        pw = 72
        body.append(f'<g opacity="0">{appear(ta)}'
                    f'<rect class="pill" x="{X0}" y="{y - 17}" width="{pw}" height="22" rx="11"/>'
                    f'<text class="pillt" x="{X0 + pw / 2}" y="{y - 1}" text-anchor="middle">{escape(tag)}</text>'
                    f'<text class="a" x="{X0 + pw + 14}" y="{y}">{escape(line)}</text></g>')

    # trend chart
    ta += T_STEP
    y += 44
    body.append(f'<g opacity="0">{appear(ta)}<text class="muted" x="{X0}" y="{y}">{escape(t["chart"])}</text></g>')
    y += 14
    ch, bw, gap = 110, 70, 34
    base = y + ch
    vmax = max(v for _, v in TREND)
    body.append(f'<g opacity="0">{appear(ta)}<line class="axis" x1="{X0}" y1="{base}" x2="{X0 + len(TREND) * (bw + gap)}" y2="{base}"/></g>')
    for i, (yr, v) in enumerate(TREND):
        tb = ta + 0.25 + i * 0.22
        x = X0 + 6 + i * (bw + gap)
        h = round(ch * v / vmax, 1)
        cls = "bar hi" if yr == 2025 else "bar"
        body.append(f'<rect class="{cls}" x="{x}" y="{base}" width="{bw}" height="0" rx="4">'
                    f'{grow("height", h, tb)}{grow("y", h, tb, base=base)}</rect>')
        body.append(f'<g opacity="0">{appear(tb + 0.5)}'
                    f'<text class="val" x="{x + bw / 2}" y="{base - h - 7}" text-anchor="middle">{escape(t["fmt"](v))}</text></g>')
        body.append(f'<g opacity="0">{appear(ta)}<text class="yr" x="{x + bw / 2}" y="{base + 18}" text-anchor="middle">{yr}</text></g>')
    y = base + 18
    ta += 0.25 + len(TREND) * 0.22 + 0.4
    y += 34
    body.append(f'<g opacity="0">{appear(ta)}<text class="note" x="{X0}" y="{y}">{escape(t["note"])}</text></g>')
    H = y + 30

    style = """
  .bg{fill:#ffffff;stroke:#d0d7de}
  .hdr{fill:#f6f8fa}
  .hdrt{fill:#57606a;font:600 13px -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}
  text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'DejaVu Sans Mono','Liberation Mono',monospace;font-size:14px}
  .label{fill:#6e7781;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
  .bubble{fill:#ddf4ff;stroke:#b6e3ff}
  .q{fill:#0b2a4a}
  .tool{fill:#f6f8fa;stroke:#d0d7de}
  .toolic{fill:#8250df}
  .toolt{fill:#24292f;font-size:13px}
  .dot{fill:#8250df}
  .ok{fill:#1a7f37;font-size:13px}
  .big{fill:#24292f;font-weight:700}
  .a{fill:#24292f}
  .pill{fill:#0969da}
  .pillt{fill:#ffffff;font-size:12px;font-weight:700}
  .muted{fill:#57606a;font-size:12px;font-weight:600;letter-spacing:.03em;text-transform:uppercase}
  .axis{stroke:#d0d7de;stroke-width:1.5}
  .bar{fill:#9ecbff}.bar.hi{fill:#0969da}
  .val{fill:#24292f;font-size:12px;font-weight:600}
  .yr{fill:#57606a;font-size:12px}
  .note{fill:#1a7f37;font-size:13px}
  @media (prefers-color-scheme: dark){
    .bg{fill:#0d1117;stroke:#30363d}.hdr{fill:#161b22}.hdrt{fill:#8b949e}
    .label,.muted,.yr{fill:#8b949e}.bubble{fill:#0c2d4a;stroke:#1f6feb}.q{fill:#cae8ff}
    .tool{fill:#161b22;stroke:#30363d}.toolt{fill:#c9d1d9}.toolic,.dot{fill:#bc8cff}
    .ok,.note{fill:#3fb950}.a,.big,.val{fill:#e6edf3}.axis{stroke:#30363d}
    .pill{fill:#1f6feb}.bar{fill:#1c4a7e}.bar.hi{fill:#388bfd}
  }"""
    head = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="{escape(t["aria"])}">'
            f'<title>{escape(t["aria"])}</title><style>{style}</style><defs>{"".join(defs)}</defs>'
            f'<rect class="bg" x="0.5" y="0.5" width="{W - 1}" height="{H - 1}" rx="12"/>'
            f'<path class="hdr" d="M12.5 0.5 H{W - 12.5} A12 12 0 0 1 {W - 0.5} 12.5 V{H_HEADER} H0.5 V12.5 A12 12 0 0 1 12.5 0.5 Z"/>'
            + "".join(f'<circle cx="{22 + i * 18}" cy="22" r="6" fill="{c}"/>' for i, c in enumerate(["#ff5f57", "#febc2e", "#28c840"]))
            + f'<text class="hdrt" x="{W / 2}" y="27" text-anchor="middle">{escape(t["title"])}</text>')
    return head + "".join(body) + "</svg>\n"


here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs")
os.makedirs(here, exist_ok=True)
for lang in TEXT:
    p = os.path.join(here, f"demo-{lang}.svg")
    with open(p, "w", encoding="utf-8") as f:
        f.write(svg(lang))
    print("wrote", os.path.normpath(p))
