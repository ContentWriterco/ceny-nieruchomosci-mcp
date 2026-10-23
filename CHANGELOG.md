# Changelog

## 0.2.2 – 2026-10-23

- Same-name towns: the town whose commune carries its name (e.g. Piła in wielkopolskie, not one of 13 villages) is picked first.

## 0.2.1 – 2026-10-23

- Miejscowości o tej samej nazwie (np. cztery „Zakopane”): wybieramy miasto (gminę miejską / miasto w gminie miejsko-wiejskiej wg ULDK), a pozostałe pokazujemy ze współrzędnymi i podpowiedzią, jak wskazać inną.
- Gdy dla samej nazwy miejscowości nic nie ma w domyślnym promieniu, promień zwiększa się raz do maksimum (1,5 km).

## 0.2.0 – 2026-10-22

- Nowe narzędzie `parcel_report` – prześwietlenie działki: identyfikator i powierzchnia (ULDK, ewidencja gruntów), użytek i grupa rejestrowa, plan miejscowy z krajowej integracji MPZP (z symbolem przeznaczenia także z usług WMS planów gmin), uzbrojenie terenu z KIUT/GESUT (odległość sieci od granic działki), zagrożenie powodziowe (ISOK), formy ochrony przyrody (GDOŚ), ceny działek w okolicy.
- CLI: `ceny-nieruchomosci-mcp parcel "<działka>"`.
- Czytelne nazwy przeznaczenia działek w przykładach transakcji (np. „budownictwo mieszkaniowe jednorodzinne” zamiast kodu RCN).

## 0.1.0 – 2026-10-21

Pierwsza wersja: `property_prices` (mieszkania, domy, działki; mediana za m², rozrzut, pokoje, rynek, trend, ostatnie transakcje), `find_address`, `data_sources`; stdio i Streamable HTTP; anonimowe statystyki; strona główna.
