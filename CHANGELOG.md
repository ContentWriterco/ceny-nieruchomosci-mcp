# Changelog

## 0.2.0 – 2026-10-22

- Nowe narzędzie `parcel_report` – prześwietlenie działki: identyfikator i powierzchnia (ULDK, ewidencja gruntów), użytek i grupa rejestrowa, plan miejscowy z krajowej integracji MPZP (z symbolem przeznaczenia także z usług WMS planów gmin), uzbrojenie terenu z KIUT/GESUT (odległość sieci od granic działki), zagrożenie powodziowe (ISOK), formy ochrony przyrody (GDOŚ), ceny działek w okolicy.
- CLI: `ceny-nieruchomosci-mcp parcel "<działka>"`.
- Czytelne nazwy przeznaczenia działek w przykładach transakcji (np. „budownictwo mieszkaniowe jednorodzinne” zamiast kodu RCN).

## 0.1.0 – 2026-10-21

Pierwsza wersja: `property_prices` (mieszkania, domy, działki; mediana za m², rozrzut, pokoje, rynek, trend, ostatnie transakcje), `find_address`, `data_sources`; stdio i Streamable HTTP; anonimowe statystyki; strona główna.
