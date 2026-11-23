# OpenFlow verkleinern und bestehende Funktionen erhalten

Stand 23. November 2026. Grundlage ist der frische GitHub-Klon von `LuiInventions/OpenFlow`, Commit `b334cbb`, Version 1.5.27, mit dem neuen Dictation-Sounds-Schalter und dem behobenen ASAR-Skriptkopierfehler. Die uncommitteten Änderungen und älteren Pläne im ursprünglichen Ordner `C:\_Openflow` sind eine andere Entwicklungsbasis; sie werden hier nicht als bereits umgesetzte Produktfunktionen vorausgesetzt.

Der größte Größenhebel ist der mitgelieferte llama.cpp-Stack für lokale Textmodelle. Die aktuelle Anwendung führt ihre Textverbesserung über OpenAI aus. Nach Entfernen dieses Stacks und des ungenutzten VC-Runtime-Installers in der Flameshot-Distribution wären rechnerisch etwa **418 MiB statt 1.128 MiB** Programmdateien übrig: **rund 710 MiB beziehungsweise 63 % weniger**. Flameshot als Screenshot-Werkzeug und Parakeet als Offline-Spracherkennung bleiben erhalten.

Die Verkleinerung ist ein Plan. In diesem Arbeitsschritt wurde ausschließlich der JavaScript-Fehler behoben und lokal installiert; es wurden keine Produktfunktionen oder Abhängigkeiten entfernt.

## Behobener JavaScript Fehler

`electron/main.cjs`, Funktion `scriptCopy`, kopierte Skripte mit `fs.copyFileSync` aus `app.asar`. Die gemeldete Exception nennt eine fehlende temporäre `.tmp.ps1` als Kopierquelle. Dieser ASAR-Kopierpfad benötigt eine von Electron extrahierte temporäre Datei. Welche Komponente die Datei entfernt hat, ist durch den Stacktrace allein nicht feststellbar.

Der Fix verwendet `fs.readFileSync` direkt auf den Archiveintrag, stellt das Zielverzeichnis sicher und schreibt dessen Inhalt mit `fs.writeFileSync` in die Benutzerdaten. Er gilt für `chord.ps1`, `paste.ps1`, `unmute.ps1` und `micrepair.ps1`.

Validierung: 89 bestehende Tests bestanden; 120 Skriptbereitstellungen aus einem echten Build-ASAR sowie weitere 120 aus dem installierten ASAR mit exaktem Inhaltsvergleich bestanden. Dabei war `copyFileSync` für PowerShell-Dateien aus ASAR absichtlich mit einer simulierten ENOENT-Exception blockiert. Der Installer endete mit Exitcode 0. Die installierten Änderungen stimmen bytegenau mit den Quelldateien überein. Nach dem Start läuft der echte Shortcut-Helfer und antwortet über seine Named Pipe auf die unveränderte Shortcut-Konfiguration mit `ok`. Diese Prüfung ersetzt keine vollständige Aufnahmeprüfung unter allen Windows-Konfigurationen.

## Gemessene Größen

MiB entspricht 1.048.576 Bytes. Die folgenden Werte sind logische Dateigrößen der installierten Anwendung, keine NTFS-Belegung und keine RAM-Messung. Heruntergeladene Sprachmodelle, Benutzerdaten, Build-Verzeichnisse und npm-Entwicklungspakete sind darin nicht enthalten.

| Bestandteil | Installiert in MiB | Geplante Behandlung |
| --- | ---: | --- |
| Electron und Installer-Dateien | 317,42 | Erhalten |
| llama.cpp CUDA-Erweiterung | 369,71 | Entfernen, wenn die Funktionsprüfungen bestehen |
| llama.cpp CUDA | 174,21 | Mit dem ungenutzten Textmodell-Stack entfernen |
| llama.cpp Vulkan | 70,53 | Ebenso |
| llama.cpp x64 CPU | 31,39 | Ebenso |
| node-llama-cpp Bibliothek und Quellmaterial | 38,41 | Ebenso |
| llama.cpp ARM64-Reste im x64-Produkt | 1,02 | Ebenso |
| Flameshot einschließlich Qt | 94,87 | Screenshot-Funktion erhalten; nur nachgewiesenen Distributionsballast ausschließen |
| sherpa-onnx x64 und JavaScript-Wrapper | 22,42 | Für Parakeet erhalten |
| App-ASAR mit JavaScript-Abhängigkeiten | 7,39 | Nur bestätigte ungenutzte Zweige und exklusive Abhängigkeiten bereinigen |
| Reflink-Binärdatei | 0,35 | Ausschließlich über llama.cpp eingebunden; beim Bereinigen des Abhängigkeitsbaums prüfen |
| Weitere Ressource, Elevation-Helfer | 0,10 | Für Commands mit Administratorrechten erhalten |
| **Gesamt** | **1.127,81** | |

Der eigene Inhalt in `electron/`, `renderer/` und `src/` umfasst zusammen **675.785 Bytes, also 0,64 MiB**, einschließlich HTML, CSS, Skripten, Bildern und Tönen. Eine Bereinigung des eigenen Codes verbessert Verständlichkeit und Wartung; große Speicherplatzeinsparungen kommen hier überwiegend aus den Abhängigkeiten.

Der aktuelle vollständige Installer ist **420,07 MiB** groß. Seine Dateieinträge weisen dem llama.cpp-Stack rund **282,28 MiB komprimierte Daten** und `vc_redist.x64.exe` weitere **23,61 MiB** zu. Aus diesen tatsächlichen Einträgen ergibt sich für denselben Packmodus eine **Schätzung von etwa 114 MiB** nach den beiden Maßnahmen. Der endgültige schlanke Installer muss neu gebaut und gemessen werden; dies ist noch kein gebauter oder funktionsgeprüfter schlanker Release.

Installer und Installation werden getrennt gemessen: Der Installer enthält fünf ARM64-DLLs mit zusammen 10.415.104 Bytes, die im gemessenen Installationsordner fehlen. Der Grund dafür wurde nicht bestimmt. Die komprimierte Schätzung stammt deshalb direkt aus dem Installer und wird nicht aus dem Verhältnis installierter Bytes hochgerechnet. Verbleibende exklusive JavaScript-Abhängigkeiten und kleine Code-Reste sind in den Einsparungen noch nicht zusätzlich gutgeschrieben.

Die Rohdaten mit Dateigrößen und Aufrufstellen stehen in [footprint-evidence-2026-11-23.json](footprint-evidence-2026-11-23.json).

## Erster Schritt mit dem größten Einsparpotenzial

### Lokalen Textmodell Stack vollständig entkoppeln

Der Nachweis beruht auf der Produktionskette, nicht allein auf einer fehlenden Schaltfläche:

- `src/text-completion.js`: `selection()` liefert ausschließlich OpenAI; `complete()` erstellt ausschließlich einen OpenAI-Chat-Request. Der übergebene `completeLocal`-Callback wird dort nicht benutzt.
- `src/store.js`: Die Settings-Normalisierung setzt `noteImproveProvider` auf `openai`.
- Die bestehenden Tests `legacy local note settings require a key and never run a local model` und `legacy local settings cannot enable local cleanup or bypass the API key` sichern dieses Verhalten ab.
- `renderer/app.js`: `settingsHtml()` erzeugt keine Auswahlkarten für lokale Textmodelle. `noteEngineCard` und `noteModelLine` sind verbliebene Erzeuger ohne produktiven Aufruf. Es existieren noch alte Listener, Dialogzustände und Backend-Endpunkte für die Modellverwaltung; sie werden gemeinsam entkoppelt.

Geplant entfallen:

| Datei oder Bereich | Konkrete Änderung |
| --- | --- |
| `package.json` und `package-lock.json` | `node-llama-cpp` und `@node-llama-cpp/win-x64` entfernen; ausschließlich dazugehörige transitive Pakete über npm bereinigen |
| Build-Konfiguration | llama.cpp-Globs aus `files` und `asarUnpack` entfernen; verbleibende sherpa-Dateien ausdrücklich erhalten |
| `src/llama-host.js`, `src/llama-worker.js` | Entfernen |
| `src/note-models.js`, `renderer/note-model-download.html` | Mit den nicht mehr erreichbaren lokalen Textmodell-Downloads entfernen |
| `electron/main.cjs` | Imports, Host-/Library-Instanzen, Downloadfenster, Download-/Auswahlhelfer, `notes.model.*`-Handler und lokale Modellstatus-Felder entfernen; aktive OpenAI-Keyprüfung erhalten |
| `renderer/app.js` | Lokale Textmodell-Karten, Download-Listener, Provider-Bestätigungsdialoge und Fortschrittszustände entfernen; aktuelle STT- und Textmodellwahl erhalten |
| `src/note-improve.js`, `src/note-sparkle.js` | Ausschließlich lokale Textmodell-Kataloge, Chunking-/Timeout-Zweige und deren Exporte entfernen; gemeinsam benutzte Prompts, Validierung, Vorschläge und Undo erhalten |
| Tests | Tests nur für die abgeschaffte interne Textmodell-Laufzeit anpassen; Schutz gegen lokale Inferenz und die vollständigen aktiven Verbesserungstests beibehalten |

Die vier vollständig entfallenden Textmodell-Quelldateien umfassen zusammen 19.633 Bytes. Die großen **685,26 MiB** Einsparung kommen aus den installierten llama.cpp-Paketen. Weitere Einsparungen durch exklusive JavaScript-Abhängigkeiten werden nach einem sauberen `npm ci` gemessen. `@reflink/reflink-win32-x64-msvc` ist über `ipull → node-llama-cpp` eingebunden; es darf nur mit seinem exklusiven Abhängigkeitszweig entfallen.

**Schutzbedingung:** Parakeet ist ein anderer Modellpfad. `src/parakeet.js`, `sherpa-onnx-node`, `sherpa-onnx-win-x64`, das Parakeet-Installationsfenster und vorhandene ONNX-Gewichte bleiben bestehen. Vorhandene GGUF-Dateien in Benutzerdaten werden nicht automatisch gelöscht. Alte Profilfelder bleiben beim Laden und Speichern erhalten oder werden kompatibel ignoriert.

### Flameshot auf benötigte Distributionsdateien begrenzen

`shot.open → openFlameshot()` in `electron/main.cjs` ruft tatsächlich die mitgelieferte `flameshot.exe` auf. Das Programm mit Qt bildet die aktive Screenshot-Funktion. Ein ersatzloses Entfernen würde diese Funktion zerstören.

Als erste gezielte Maßnahme wird ausschließlich `bin/vc_redist.x64.exe` aus `extraResources` ausgeschlossen: **25.635.768 Bytes beziehungsweise 24,45 MiB**. Weder App noch Installerskript rufen diesen separaten Installer auf; die benötigten MSVC-Laufzeit-DLLs liegen bereits neben Flameshot. Die Freigabe setzt einen Screenshot-Test auf einem sauberen Windows-System ohne separat vorinstallierte VC-Runtime voraus.

`opengl32sw.dll` (19,68 MiB), `dxcompiler.dll` (13,65 MiB), `dxil.dll`, QtNetwork, Plattform-, TLS- und Bildformat-Plugins bleiben zunächst enthalten. Sie können Treiber-Fallbacks, Upload oder Bildexport ermöglichen, auch wenn sie in einem einzelnen Standardlauf nicht geladen werden. Fehlende DLL-Imports allein beweisen bei Qt keine Entbehrlichkeit. Weitere Ausschlüsse erfordern Ladeprotokolle und Funktionsprüfungen für die betroffenen Betriebsarten. Dafür wird noch keine Einsparung eingeplant.

## Kleine Code und Asset Reste

Diese Kandidaten werden nach dem großen Abhängigkeitsumbau einzeln geprüft und bereinigt:

| Kandidat | Befund und Bedingung | Dateigröße |
| --- | --- | ---: |
| `src/shot.js` | Nur die alten Crop-Unit-Tests benutzen das Modul; die App importiert es nicht. Die aktive Flameshot-Anbindung bleibt bestehen. | 1,660 KiB |
| `renderer/sounds/listen-stop.wav` | Kein aktueller Audio-Aufruf; die Bubble benutzt Start, Done und Error. Asset-Generator und Testliste entsprechend anpassen. | 18,131 KiB |
| Verwaiste lokale Textmodell-UI | Erzeuger, Listener, Status und CSS gemeinsam prüfen; keine pauschale Entfernung generischer Karten- oder Switch-Styles. | In den bestehenden App-Dateien enthalten |
| Nicht mehr benötigte Snapshot-Felder | Nur Felder entfernen, die keine aktuelle Ansicht, Hilfsseite oder Hintergrundfunktion liest. Die jeweiligen gespeicherten Daten bleiben erhalten. | Nach der Änderung messen |

Die sechs vollständig benannten Dateien einschließlich der vier Textmodell-Dateien ergeben zusammen **38,96 KiB**. Die Ersparnis kleiner In-place-Codeänderungen wird erst am endgültigen Diff ausgewiesen und nicht mit dem Gewicht der nativen Abhängigkeiten vermischt.

## Alte Endpunkte und Datenpfade sicher unterscheiden

Die Inventur fand **84 Backend-Aktionen** und **45 unterschiedliche wörtliche Renderer-Aufrufe**. **39 Aktionen haben keinen solchen Aufruf**. Das ist eine Prüfliste, keine automatische Löschliste: Der Renderer delegiert auch über `dispatch(action, payload)`, und gemeinsame Backend-Funktionen bleiben unabhängig von einem alten IPC-Namen aktiv.

| Aktionsgruppe ohne wörtlichen Renderer-Aufruf | Geplante Einordnung |
| --- | --- |
| `transform.set`, `speech.transform`, `speech.speak`, `speech.rewrite`, `speech.instruct`, `speech.summarize` | Alte, aktuell nicht angebotene Oberflächenpfade. Handler und ausschließlich daran hängende Provider-/Store-Helfer nach vollständiger Aufrufprüfung entfernen. |
| `speech.translate` | Alten IPC-Handler prüfen; `translateText` und Provider-Übersetzung erhalten, solange gespeicherte Automationen sie verwenden. |
| `clipboard.paste`, `text.prepare`, `overlay.set` | Nicht aufgerufene Hüllen prüfen; aktives Einfügen, Transkriptvorbereitung und Fehleranzeige ausdrücklich erhalten. |
| `commands.validateName` | Alten separaten Handler prüfen; Namensvalidierung beim Erstellen und Speichern von Commands bleibt zwingend bestehen. |
| `notes.model.download` | Teil des verwaisten lokalen Textmodell-Stacks; zusammen mit den übrigen Modell-Endpunkten im ersten Schritt entkoppeln. |
| `notes.sparkle.versions` | Gegen die aktive History-Kette mit `notes.sparkle.history.*` prüfen; Versionsdaten, Verlauf und Undo erhalten. |
| `notes.save`, `notes.versions`, `notes.delete` | Historischen Notes-Speicher von den aktiven `pads.*` und `padVersions` trennen. Keine gespeicherten Notizen oder Versionen verwerfen; alte Daten vor Entfernen eines Adapters gegebenenfalls migrieren. |
| `meetings.save/delete`, `events.save/delete`, `todos.save/delete`, `folders.save/delete` | Alte Workspace-CRUD-Hüllen nach dynamischer Aufrufprüfung entfernen; persistierte Bestände und Import-/Export-Kompatibilität zunächst erhalten. |
| `links.save/delete/open`, `scratchpad.set`, `notifications.read` | Alte Verwaltungsoberflächen prüfen. `notifications.add` ist aktiv und bleibt bestehen. |
| `dictionary.save/delete`, `corrections.add/delete`, `automations.save/delete` | Verwaltungs-IPC und aktive Verarbeitung getrennt betrachten. Regeln werden in `flow.prepareTranscript` beim Diktieren weiterhin angewandt; dieser Pfad und gespeicherte Regeln bleiben erhalten. |
| `history.update/delete`, `file.export/import` | Bis zur Klärung von Daten- und Sicherungskompatibilität zurückstellen; eine fehlende aktuelle Schaltfläche reicht für die Entfernung nicht aus. |

Die vollständigen Aktionsnamen und tatsächlichen Renderer-Aufrufstellen stehen in den Rohdaten. Auch nach dem Entfernen einer alten CRUD-Hülle dürfen `blank()`, `snapshot()`, `replaceAll()` und die Profilnormalisierung ältere Daten nicht stillschweigend löschen.

## Vorgehen zum Nachweis ungenutzten Codes

1. Aktuelle Funktionen in einer Abnahmeliste festhalten und für jede den Weg vom sichtbaren Steuerelement über Renderer, IPC und Backend bis zu Datei, Modell oder Prozess dokumentieren. Auch Kontextmenüs, Hover-Menüs, Tastatur, Tray und Hilfsfenster berücksichtigen.
2. `require`-/Import-Beziehungen, statische und dynamische Dispatch-Aufrufe, Worker-, HTML-, Asset- und Skriptpfade zusammenführen. npm-Abhängigkeiten getrennt betrachten. Ein einzelner Texttreffer oder ein fehlender Treffer entscheidet nicht über eine Entfernung.
3. Mit einem isolierten Profil in einem Testbuild Aufruf- und Ladeereignisse protokollieren, ohne Diktattexte oder API-Schlüssel zu loggen. Die komplette Abnahmeliste ausführen. Nicht beobachtete Fehler-/Fallback-Zweige anschließend gezielt auslösen.
4. Kandidaten nur freigeben, wenn keine aktive Aufrufkette und keine benötigte Datenmigration darauf angewiesen ist. Bei Qt zusätzlich dynamisch geladene Plugins und Fallbacks prüfen.
5. Pro Änderungsgruppe einen überprüfbaren Diff erstellen. Danach aus einem sauberen Abhängigkeitsverzeichnis bauen und das fertige ASAR, entpackte native Dateien und Installer erneut inventarisieren. Die spätere Paketprüfung muss verbotene llama.cpp-Dateien erkennen und die benötigten Parakeet-/Flameshot-Dateien nachweisen.

## Abnahme vor einem schlanken Testrelease

| Bereich | Erforderliche Prüfung |
| --- | --- |
| Start und Windows-Helfer | Mehrfache Kaltstarts, Tray, erneuter Start nach Beenden, Shortcut-Helfer-Neustart, keine Main-Process-Exception; alle vier Skripte im installierten Build bereitstellen |
| Diktieren | Alle vier Shortcuts, Hold und Start/Stop, Parakeet offline und OpenAI, kurze/lange Aufnahme, Stille, Abbruch, Einfügen ins ursprüngliche Textfeld und Notiz-Fallback |
| Sound und Bubble | Sound an/aus samt Neustart, Start/Done/Error, Active/Grayed Out/Hidden, Elemente entfernen, zurückholen und umsortieren, Sprachaufnahme aus Bubble und Notes |
| Notizen und KI | Erstellen, Ändern, Speichern, Kopieren, Löschen, mehrere Fenster, Improve Notes, Vorschläge, Verlauf, Undo; Compact/Polish/Original, Key-Fehler und Offline-Fallback ohne Textverlust |
| Regeln und Daten | Profil mit Dictionary, Snippets, Corrections und Automationen weiterverarbeiten; alte Notes/Versionen unverändert erhalten; Upgrade mit bestehendem Profil und Modellbestand |
| Commands | Anlegen, Bearbeiten, Validierung, Symbole, Bubble-Ausführung, normale Rechte und explizite Administratorausführung |
| Screenshots | Aufruf aus der Bubble, Bereichswahl, Abbruch, alle angebotenen Werkzeuge, Rückgängig, Kopieren, Speichern und angebotene Export-/Upload-Funktionen; mehrere Monitore und unterschiedliche Skalierung; sauberer Windows-Test für VC-Runtime |
| Usage und Settings | Lokale/API-Zeiten, Wörter, Token und historische Kosten unverändert; Textmodellwahl und Einstellungen über Neustarts hinweg |

Die vorhandenen 89 Tests bilden die Ausgangsbasis. Neue Tests sichern benötigte Fähigkeiten ab; Tests, die ausschließlich die zu entfernende interne Textmodell-Laufzeit prüfen, werden entsprechend ersetzt. Jede noch offene Funktionsprüfung blockiert die Entfernung des davon betroffenen Bestandteils.

## Reihenfolge und erwartetes Ergebnis

1. **Abgeschlossen:** ASAR-Skriptfehler beheben, paketiert prüfen und lokal installieren.
2. Funktions- und Datenkompatibilität als Ausgangsbasis sichern.
3. Ungenutzten lokalen Textmodell-Stack samt exklusiven Abhängigkeiten entfernen: rechnerisch **1.127,81 → 442,55 MiB** installierte Dateien, zuzüglich kleinerer später gemessener Code-/Abhängigkeitsersparnisse.
4. Separaten VC-Runtime-Installer nach dem sauberen Screenshot-Test ausschließen: weitere **24,45 MiB**, rechnerisch **418,10 MiB** verbleibend. Flameshot selbst bleibt etwa **70,42 MiB** groß.
5. Bestätigte alte Handler, UI-Zweige und Assets einzeln bereinigen; unklare Datenpfade zurückstellen. Größe, Funktionsabnahme und Diff pro Gruppe dokumentieren.
6. Vollständigen lokalen Installer bauen, Anwendung auf vorhandenem und sauberem Windows-Profil prüfen und die endgültigen Vorher-/Nachher-Größen veröffentlichen. Der aktuelle, aus Archiveinträgen abgeleitete Installer-Zielwert liegt bei etwa **114 MiB**.

Ein Austausch von Electron, ein neuer Screenshot-Editor, das Löschen von Benutzermodellen oder das Entfernen von GPU-/Qt-Fallbacks gehört nicht zu diesem ersten Plan. Weniger mitgelieferte Dateien bedeuten außerdem keine gleich große RAM-Ersparnis; Startzeit und Ruheverbrauch benötigen eigene Vorher-/Nachher-Messungen.
