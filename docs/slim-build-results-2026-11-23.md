# Lokaler OpenFlow Build mit verkleinertem Paket

Version `1.5.28-local.1`, erstellt und lokal installiert am 23. November 2026. Grundlage ist GitHub `b334cbb` mit dem Dictation-Sounds-Schalter und dem behobenen JavaScript-Fehler. Die Umsetzung des [Verkleinerungsplans](size-reduction-plan-2026-11-23.md) wurde ausschließlich lokal gebaut und installiert.

## Ergebnis

| Messung | Vorher | Installierter Testbuild | Reduktion |
| --- | ---: | ---: | ---: |
| Programmdateien | 1.127,81 MiB | 410,77 MiB | 63,58 % |
| Vollständiger Installer | 420,07 MiB | 113,12 MiB | 73,07 % |
| Eigener Code und Assets | 675.785 Bytes | 606.410 Bytes | 10,27 % |

MiB = 1.048.576 Bytes. Gemessen wurden logische Dateigrößen; heruntergeladene Modelle und Benutzerdaten sind nicht Teil der Programmgröße. Die [Messwerte in Bytes](slim-build-results-2026-11-23.json) enthalten beide Ausgangsgrößen. Eine RAM- oder Startzeitverbesserung wird daraus nicht abgeleitet.

## Änderungen

- `node-llama-cpp`, seine nativen CPU-/CUDA-/Vulkan-/ARM64-Pakete und exklusive transitive Abhängigkeiten entfernt. Ein sauberes `npm ci` installiert 322 statt zuvor 421 npm-Pakete einschließlich der Entwicklungswerkzeuge. Die einzige direkte Produktionsabhängigkeit ist weiterhin `sherpa-onnx-node`.
- Lokalen Textmodell-Host, Worker, Modell-Downloads, Downloadfenster und ungenutzte Auswahl-/Fortschrittsoberflächen entfernt. OpenAI-Textverbesserung, Vorschläge, Schutzprüfungen, Verlauf und Undo bleiben aktiv.
- 32 bestätigte alte Backend-Aktionen entfernt; 52 bleiben bestehen. Alle 39 noch vorhandenen wörtlichen Renderer-Aufrufe haben einen Backend-Handler. Gemeinsame aktive Routinen für Transkriptvorbereitung, Einfügen, Korrekturen, Dictionary, Snippets und Automationen bleiben erhalten.
- Alte Screenshot-Crop-Hilfsdatei und den nicht abgespielten Stop-Ton entfernt. Start-, Done- und Error-Töne samt neuem Ein/Aus-Schalter bleiben erhalten.
- Ausschließlich Laufzeitdateien und Lizenz aus der Flameshot-Distribution verpackt. Den separaten, von OpenFlow nicht ausgeführten `vc_redist.x64.exe`-Installer sowie Entwicklungsheader und Linkbibliothek ausgeschlossen. Flameshot, Qt, Bildformat-/TLS-/Plattform-Plugins, Grafik-Fallbacks und die mitgelieferten VC-Runtime-DLLs bleiben enthalten.
- Den ASAR-Kopierfehler durch direktes Lesen und Schreiben der vier PowerShell-Helfer behoben. Es gibt keinen temporären `copyFileSync`-Pfad mehr für diese Skripte.

Historische lokale Modellnamen bleiben als kleine Kompatibilitätsliste erhalten, damit vergangene lokale Aufträge weiterhin kostenlos erscheinen. Historische Daten und unklare Verwaltungsadapter für Notes, Dictionary, Corrections, Automationen, History sowie Import/Export wurden entsprechend dem Plan beibehalten. Vorhandene Modell-Dateien in Benutzerdaten werden nicht gelöscht.

## Prüfungen

**85 automatisierte Tests bestanden.** Sie prüfen unter anderem Datenkompatibilität, Regeln und Snippets, Kostenhistorie, lange Cloud-Notizen, Original-/Compact-/Polish-Verarbeitung, Abbruch und Fehler-Fallbacks, Notizverbesserung und Undo sowie Commands. Sieben ausschließlich zu entfernten internen Komponenten gehörende Tests entfielen; drei zusätzliche Kompatibilitätsprüfungen kamen hinzu.

Die Electron-Integration gegen das tatsächliche ASAR bestand für alle fünf Ansichten, alle vier Shortcuts, die drei Textmodelle, Keyprüfung, Notizverbesserung und Vorschläge, Verlauf und Undo, Cloud-Transkriptionsablauf mit Dictionary, alle drei Bubble-Darstellungen und Commands-Verwaltung. Diese Cloud-Aufrufe waren simuliert und verursachten keine API-Anfragen. Der Sound-Schalter wurde zusätzlich auf sofortige Wirkung, Hold/Toggle, Neuladen, Persistenz und Boolean-Validierung geprüft.

Der echte Parakeet-Laufzeitpfad aus dem Paket transkribierte ohne Cloud-Aufruf einen mit Windows-Sprachausgabe erzeugten Testsatz korrekt: „The application is ready for dictation. This is a local speech recognition test.“ Vorhandene Sprachmodelle wurden wiederverwendet.

Flameshot startete aus dem schlanken Paket; die geladenen Qt-, Plattform- und MSVC-140-DLLs wurden im Paketverzeichnis nachgewiesen. Der GUI-Aufruf der installierten Flameshot-Version öffnete die Screenshot-Erfassung. Die Erfassung wurde anschließend beendet. Bildbearbeitung, Export/Upload, mehrere Monitore und ein frisches Windows-System ohne vorinstallierte VC-Runtime wurden in dieser Sitzung nicht vollständig geprüft. Der Ausschluss betrifft einen Installer, den die Anwendung bisher nicht ausführte; die tatsächlich geladenen Runtime-DLLs bleiben mitgeliefert.

Der lokale NSIS-Installer endete mit Exitcode 0. `scripts/verify-package.cjs` bestand auch gegen den Installationsordner: Quelldateien stimmen mit dem Build überein, benötigte native Laufzeiten sind vorhanden und entfernte Pakete fehlen tatsächlich. Der installierte Shortcut-Helfer antwortet über seine echte Steuer-Pipe mit `ok`. Weitere 120 Skriptbereitstellungen aus dem installierten ASAR bestanden bei absichtlich blockiertem temporärem Kopierpfad. Alle gespeicherten Datenbestände waren nach der Installation identisch mit der unmittelbar davor angelegten Sicherung.

Die installierte App wurde geöffnet und der Dictation-Sounds-Schalter in Settings sichtbar geprüft. Der Installer liegt unter `release-local/OpenFlow-Setup-1.5.28-local.1-local.exe`.

## Wiederholbare Paketprüfungen

```powershell
npm test
npm run verify:package
npm run verify:script-copy
```

Die letzten beiden Befehle erwarten den lokal gebauten Ordner `release-local/win-unpacked`. Ein anderer Installationsordner kann an `node scripts/verify-package.cjs` übergeben werden; der ASAR-Pfad lässt sich an `electron scripts/verify-script-copy.cjs` übergeben. Der Skripttest verwendet ein isoliertes Profil unter `.cache`, ohne das normale Profil zu verändern.
