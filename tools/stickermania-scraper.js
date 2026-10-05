/*
 * Einmal-Scraper für https://www.interspar.at/suche?q=stickermania
 *
 * So geht's:
 *  1. Seite im normalen Browser öffnen (Cloudflare-Prüfung ggf. bestätigen).
 *  2. F12 → Tab "Konsole" öffnen.
 *  3. Dieses ganze Skript einfügen, Enter drücken.
 *     (Chrome verlangt beim ersten Einfügen evtl., dass man "allow pasting" tippt.)
 *  4. Das Skript ruft die Suche mit productLimit=30, 40, 50, ... ab (das ist die
 *     Paginierung der Seite), bis keine neuen Produkte mehr dazukommen.
 *     Weil die Suche nur ca. 100 Treffer liefert, wird danach jede fehlende
 *     Nummer einzeln gesucht ("stickermania 12"). Danach:
 *     - Tabelle in der Konsole + Liste der fehlenden Nummern
 *     - Import-Text für admin.html (Format "Nummer;Name") liegt in der Zwischenablage
 *     - window.stickerJson enthält Nummer, Name, Bild- und Produkt-URL als JSON
 *       → in der Konsole: copy(window.stickerJson)
 *
 * Erkannt wird über das alt-Attribut der Produktbilder, z.B.
 *   alt="Stickermania 34 Fischadler 2026 1 Stk."
 */
(async () => {
  const QUERY = "stickermania";
  // productLimit ist die Paginierung der Seite: 30, 40, 50, ... (wie "Mehr laden")
  const START = 0,
    STEP = 10,
    MAX = 1000;
  // Anzahl Sticker im Album, falls bekannt (sonst null → wird geschätzt)
  const TOTAL = 200;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const ALT_RE =
    /^\s*Stickermania\s+(\d{1,3}[a-z]?)\s+(.+?)(?:\s+20\d\d)?(?:\s+\d+\s*Stk\.?)?\s*$/i;

  // Größtes Bild aus srcset, sonst src
  const imgUrl = (img) => {
    const set = img.getAttribute("srcset") || "";
    const largest = set
      .split(",")
      .map((s) => s.trim().split(/\s+/)[0])
      .filter(Boolean)
      .pop();
    const raw = largest || img.getAttribute("src") || "";
    try {
      return raw && !raw.startsWith("data:")
        ? new URL(raw, location.origin).href
        : "";
    } catch {
      return "";
    }
  };

  const stickers = new Map(); // Nummer -> { number, name, image, url }
  const products = new Set(); // alle Produkt-Links (/p/...), um "nichts Neues mehr" zu erkennen

  const extract = (doc) => {
    for (const img of doc.querySelectorAll("img[alt]")) {
      const link = img.closest('a[href*="/p/"]');
      if (link) products.add(link.getAttribute("href"));
      const m = img.getAttribute("alt").match(ALT_RE);
      if (!m) continue;
      const number = m[1];
      if (stickers.has(number)) continue;
      stickers.set(number, {
        number,
        name: m[2].trim(),
        image: imgUrl(img),
        url: link
          ? new URL(link.getAttribute("href"), location.origin).href
          : "",
      });
    }
  };

  // Trefferzahl, falls die Seite eine anzeigt ("123 Produkte" o.ä.)
  const hitCount = (doc) =>
    (doc.body?.textContent.match(
      /(\d+)\s*(?:Produkte|Artikel|Ergebnisse|Treffer)/i,
    ) || [])[0];

  const load = async (query, limit) => {
    const url = `/suche?q=${encodeURIComponent(query)}&productLimit=${limit}`;
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) {
      console.warn(`HTTP ${res.status} bei ${url}`);
      return null;
    }
    return new DOMParser().parseFromString(await res.text(), "text/html");
  };

  // Runde 1: allgemeine Suche, Seite für Seite
  let stale = 0;
  for (let limit = START; limit <= MAX; limit += STEP) {
    const doc = await load(QUERY, limit);
    if (!doc) break;
    const before = products.size;
    extract(doc);
    const tilesOnPage = new Set(
      [...doc.querySelectorAll('a[href*="/p/"]')].map((a) =>
        a.getAttribute("href"),
      ),
    ).size;
    console.log(
      `productLimit=${limit}: ${tilesOnPage} Produkte auf der Seite, ${stickers.size} Sticker gesamt` +
        (hitCount(doc) ? ` (Seite meldet: ${hitCount(doc)})` : ""),
    );
    // fertig, wenn die Seite weniger als das Limit liefert (alles geladen)
    // oder dreimal hintereinander nichts Neues kommt
    if (tilesOnPage < limit) break;
    stale = products.size === before ? stale + 1 : 0;
    if (stale >= 3) break;
    await sleep(400);
  }

  // Runde 2: Die Suche liefert nicht alle Treffer → fehlende Nummern einzeln suchen.
  // Ohne TOTAL wird über die höchste Nummer hinaus gesucht, bis 10 Nummern
  // hintereinander nicht gefunden werden.
  const highest = () =>
    Math.max(0, ...[...stickers.keys()].map((n) => parseInt(n, 10)));
  let misses = 0;
  for (let n = 1; TOTAL ? n <= TOTAL : n <= highest() || misses < 10; n++) {
    if (stickers.has(String(n))) {
      misses = 0;
      continue;
    }
    const doc = await load(`${QUERY} ${n}`, START);
    if (!doc) break;
    extract(doc);
    const found = stickers.has(String(n));
    misses = found || n <= highest() ? 0 : misses + 1;
    console.log(
      `Nr. ${n}: ${found ? "gefunden – " + stickers.get(String(n)).name : "nicht gefunden"}`,
    );
    await sleep(400);
  }

  // Fallback: angezeigte Seite (falls die Treffer nur per JavaScript kommen)
  if (stickers.size === 0) {
    console.warn(
      "Im abgerufenen HTML nichts gefunden – werte die angezeigte Seite aus.",
    );
    extract(document);
  }

  // Ausgabe
  const result = [...stickers.values()].sort((a, b) =>
    a.number.localeCompare(b.number, "de", { numeric: true }),
  );
  const nums = result
    .map((s) => parseInt(s.number, 10))
    .filter(Number.isFinite);
  const max = TOTAL || Math.max(0, ...nums);
  const missing = [];
  for (let n = 1; n <= max; n++) if (!nums.includes(n)) missing.push(n);

  console.log(`${result.length} Sticker erkannt (höchste Nummer: ${max})`);
  console.table(result);
  if (missing.length)
    console.warn(`Fehlende Nummern (${missing.length}): ${missing.join(", ")}`);

  window.stickerJson = JSON.stringify(result, null, 2);
  const importText = result.map((s) => `${s.number};${s.name}`).join("\n");
  try {
    copy(importText);
    console.log("Import-Text ist in der Zwischenablage (für admin.html).");
  } catch {
    console.log(importText);
  }
  console.log("JSON mit Bild-URLs: copy(window.stickerJson)");
})();
