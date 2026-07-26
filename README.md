# Schuldenkompass

Eine kleine, private Web-App zur Verwaltung von Einkommen, Fixkosten und Schulden —
mit einem durchdachten Tilgungsplan, der dir sagt, wie viel du monatlich zahlen
solltest und wann du schuldenfrei bist.

Kein Framework, kein Build-Schritt, keine Abhängigkeiten von außen. Reines HTML/CSS/JS,
läuft direkt im Browser und als installierte App auf dem iPhone-Homescreen (PWA).
Alle Daten bleiben **ausschließlich lokal auf deinem Gerät** — es gibt keinen Server,
kein Tracking, keinen Sync. Das ist bei Finanzdaten bewusst so gewählt.

## Funktionen

- **Einkommen**: mehrere Quellen, fix oder variabel (z. B. schwankende Verkaufserlöse).
  Bei variablem Einkommen trägst du jeden Monat den tatsächlichen Betrag ein — die App
  rechnet automatisch mit dem Schnitt der letzten drei Monate statt einer groben Schätzung.
- **Fixkosten**: kategorisiert (Wohnen, Versicherung, Abos, Mobilität, Sonstiges).
- **Schulden**: beliebig viele — Kreditkarte, Ratenkredit, Dispo, Sonstiges — jeweils mit
  Restschuld, Zinssatz p. a. und Mindestrate.
- **Tilgungsplan** mit drei wählbaren Strategien (siehe unten), live editierbarem
  Monatsbudget, Strategievergleich, Reihenfolge der Tilgung mit Datum und einer Funktion,
  um tatsächlich geleistete Zahlungen pro Monat einzutragen.
- **Cockpit**: Fortschritts-Kompass (wie viel % deiner Schulden schon getilgt sind),
  Restschuld-Prognose als Grafik, Warnung, falls das Budget nicht mal die Mindestraten deckt.
- **Backup**: Export/Import als JSON-Datei — wichtig, siehe Hinweis unten.
- Dunkles und helles Theme, komplett offline nutzbar nach der Installation.

## Der Tilgungsalgorithmus

Jeden Monat wird zuerst der Zins auf jede Restschuld aufgeschlagen, dann werden die
Mindestraten bezahlt. Was vom Budget übrig bleibt ("Extra-Betrag"), fließt nach einer
Priorität in eine einzelne Schuld — sobald die getilgt ist, rollt der frei werdende
Betrag im selben Monat automatisch weiter zur nächsten Priorität (Schneeball-Effekt).
Drei Strategien bestimmen die Priorität:

- **Avalanche**: höchster Zinssatz zuerst → mathematisch optimal, spart über die
  Laufzeit am meisten Zinsen.
- **Schneeball**: kleinste Restschuld zuerst → schnellere Erfolgserlebnisse, kostet
  über die Laufzeit meist etwas mehr Zinsen.
- **Hybrid**: gewichtete Mischung aus beidem, per Regler einstellbar.

Die App simuliert alle drei Strategien parallel und zeigt dir den Vergleich (Dauer,
Gesamtzinsen), damit du eine informierte Wahl triffst statt blind einer Faustregel
zu folgen.

## Lokal testen

Kein `npm install`, kein Build-Schritt. Die App ist bewusst eine einzige `app.js`
ohne ES-Module — du kannst `index.html` direkt per Doppelklick im Browser öffnen.

Für den vollen Test inkl. Offline-Funktion (Service Worker) brauchst du einen
lokalen Server, da Service Worker nur über `http(s)` laufen:

```bash
cd schuldenkompass
python3 -m http.server 8000
# dann im Browser: http://localhost:8000
```

Alternativ, falls Node installiert ist: `npx serve .`

## Auf GitHub veröffentlichen

Nur noch **3 Dateien, keine Unterordner**: `index.html`, `manifest.webmanifest`,
`service-worker.js`. Das ist bewusst so — beim Hochladen über die GitHub-Website
(besonders vom Handy aus) gehen Unterordner wie `css/` oder `js/` beim Drag & Drop
schnell verloren, und dann lädt die Seite lautlos nicht (genau das ist beim letzten
Versuch passiert: CSS und JS haben gefehlt, darum blieb der Bildschirm leer).
Mit nur drei losen Dateien auf einer Ebene kann das nicht mehr passieren.

**Hochladen (am Handy, ohne Terminal):**
1. Im Repo auf **"Add file" → "Upload files"** tippen.
2. Alle drei Dateien einzeln auswählen (nicht als Ordner) und hochladen.
3. Falls du bereits eine alte Version hochgeladen hast: die alten `css/`- und
   `js/`-Ordner im Repo vorher löschen (jeweils in den Ordner rein, "..." → Delete),
   damit nichts Verwaistes liegen bleibt.
4. Unten "Commit changes".

**Mit Git am Rechner:**
```bash
cd schuldenkompass
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/DEIN-NUTZERNAME/schuldenkompass.git
git push -u origin main
```

Dann auf GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: `main`,
Ordner `/ (root)` → Save.** Nach ein bis zwei Minuten ist die App unter
`https://DEIN-NUTZERNAME.github.io/schuldenkompass/` erreichbar.

## Zum iPhone-Homescreen hinzufügen

1. Die GitHub-Pages-URL in **Safari** öffnen (muss Safari sein, nicht Chrome — nur
   Safari kann auf iOS Web-Apps zum Homescreen hinzufügen).
2. Teilen-Symbol (Quadrat mit Pfeil) antippen.
3. **"Zum Home-Bildschirm"** wählen.
4. Ab jetzt startet die App wie eine native App, im Vollbild, auch offline.

## Wichtiger Hinweis zu iOS und deinen Daten

Alle Daten liegen im lokalen Speicher des Geräts (`localStorage`), nicht in der Cloud.
Das schützt deine Finanzdaten, hat aber zwei Konsequenzen:

- **Kein Sync** zwischen mehreren Geräten. Nutzt du die App auf iPhone und iPad, sind
  das zwei getrennte Datenstände.
- iOS kann den Speicher von länger nicht genutzten Web-Apps unter Umständen automatisch
  leeren. Exportiere deshalb **regelmäßig ein Backup** über
  Einstellungen → "Backup exportieren" — besonders vor größeren Änderungen oder einem
  Gerätewechsel.

## Projektstruktur

```
schuldenkompass/
├── index.html                 Alles in einer Datei: HTML + <style> (CSS) +
│                                 <script> (die komplette App-Logik) + Icons
│                                 als eingebettete Bilddaten. Innerhalb klar
│                                 mit Kommentar-Trennern gegliedert:
│                                 Formatierung → Tilgungs-Engine → Storage →
│                                 Store → UI-Helfer → Views → App-Einstieg
├── manifest.webmanifest       PWA-Manifest (Icons ebenfalls eingebettet)
└── service-worker.js          Offline-Cache
```

Keine Unterordner mehr — nichts, was beim Hochladen verloren gehen kann.

## Lizenz

MIT — mach damit, was du willst.
