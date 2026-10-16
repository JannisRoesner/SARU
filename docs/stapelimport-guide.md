# Stapelimport in Lehrwerke – Leitfaden für Importpakete

Dieser Leitfaden beschreibt, wie ein Importpaket (ZIP oder Ordner) aufgebaut sein muss, damit der
**Stapel-Upload** (`/import/stapel`) daraus ohne Nacharbeit ein sauber gegliedertes Lehrwerk macht:
richtige Materialarten, Schülerfassung + Musterlösung als verknüpfte Paare, Fassungen als Varianten,
Lernzirkel mit Stationen und Versuche mit ihrer Gefährdungsbeurteilung.

Er richtet sich vor allem an KI-Agenten, die Pakete automatisch zusammenstellen. Jede Regel hier
entspricht dem tatsächlichen Verhalten des Codes (Stand Adapter-Version `2`). Die maßgeblichen
Stellen sind:

| Thema | Datei |
| --- | --- |
| Entpacken, Formate, Limits | `server/services/bulk-upload/zip.ts`, `shared/utils/ai-material-formats.ts` |
| Bündelung, Rollen, Ordnerrollen, Lernzirkel, Fassungen | `server/services/bulk-upload/pairing.ts` |
| Materialart aus Dateiname/Pfad | `shared/utils/material-type-guess.ts` |
| Anlegen, Verknüpfen, Lehrwerk | `server/services/bulk-upload/bulk-upload.service.ts` |
| Gruppen in der Lehrwerk-Ansicht | `shared/utils/lehrwerk.ts` |

> **Wichtig:** Die KI schlägt beim Stapel nur Titel, Beschreibung, Schlagwörter, Lernziele,
> Inhaltszusammenfassung und ggf. Fach/Schulform vor. **Materialart, Bündelung, Rollen und
> Verknüpfungen entstehen ausschließlich aus Ordnernamen und Dateinamen.** Wer die Namen richtig
> wählt, bekommt ein korrektes Ergebnis – mit oder ohne KI.

---

## 1. Ablauf in Kürze

1. **Upload** – lose Dateien, ein Ordner oder ein/mehrere ZIP-Archive. ZIPs werden entpackt; der
   Pfad im Archiv wird zum `relativePath` jeder Datei.
2. **Analyse (Hintergrund)** – Textextraktion (Textebene, bei Scans Vision/OCR), Dublettenprüfung
   per SHA-256 gegen vorhandene Dateien, **Bündelung** der Dateien zu *Clustern*, Erkennung von
   Lernzirkeln und Versuch↔GFB-Verknüpfungen, danach KI-Metadaten je Cluster.
3. **Vorschau** – die Lehrkraft prüft Titel, Art, Dateirollen, Verknüpfungen und Lernzirkel.
4. **Übernahme** – aus jedem Cluster entstehen ein Material (plus ggf. eine Musterlösung) und die
   Verknüpfungen. Alles ist über „Rückgängig“ wieder entfernbar.

Ein Cluster wird zu **einem Material**. Die Kunst des Paketbaus besteht darin, dass die richtigen
Dateien im selben Cluster landen – und die falschen nicht.

---

## 2. Harte Grenzen

| Regel | Wert / Verhalten |
| --- | --- |
| Erlaubte Dateiformate | `pdf`, `doc`, `docx`, `ppt`, `pptx`, `xls`, `xlsx`, `odt`, `odp`, `ods`, `txt`, `md`, `csv` |
| Container | `.zip` (nur auf oberster Ebene – **ZIPs im ZIP werden übersprungen**) |
| Wird stillschweigend übersprungen | alle anderen Formate, **insbesondere Bilder (`png`, `jpg` …), Videos, `.h5p`, `.mbz`, Links (`.url`)**, leere Dateien, `__MACOSX/`, `.DS_Store`, `Thumbs.db`, Pfade mit `..` |
| Max. Dateien pro Stapel | 10.000 (nach dem Entpacken, nur unterstützte Dokumente gezählt) |
| Max. Paketgröße | `NUXT_MAX_IMPORT_BYTES` (Standard 512 MiB, Summe aller entpackten Dokumente; bei ZIPs schon vor dem Entpacken aus dem ZIP-Verzeichnis geprüft) |
| Max. Einzeldatei | `NUXT_MAX_UPLOAD_BYTES` (Standard 256 MiB) |
| Dateinamen | Steuerzeichen und `< > : " \| ? *` werden entfernt, Länge auf 180 Zeichen gekürzt |

Konsequenzen für den Paketbau:

- **Abbildungen als PDF** ablegen (z. B. eine PDF je Abbildungsseite). Einzelbilder kommen nicht an.
- **Weblinks, Videos, H5P und Moodle-Kurse** gehören nicht in den Stapel – sie werden danach am
  Material bzw. über die eigenen Importwege angelegt.
- Keine verschachtelten ZIPs; alles in **ein** Archiv mit echter Ordnerstruktur packen.

---

## 3. Wie Dateien zu Clustern gebündelt werden

Der Bündelungsschlüssel ist:

```
<Name des unmittelbaren Elternordners> :: <Dateistamm>
```

beides „gefaltet“: klein geschrieben, `ß → ss`, Umlaute/Akzente entfernt (`ö → o`, **nicht** `oe`).

Der **Dateistamm** ist der Dateiname ohne Endung, außerdem

- ohne **Lösungs-Endung** (siehe 3.2), damit `AB 3.docx` und `AB 3 - Lösung.pdf` zusammenfallen,
- bei **Fassungen** nur der Teil vor ` - Fassung …` (siehe 3.3).

### ⚠ Nur der unmittelbare Elternordner zählt

`Kapitel 1/Kopiervorlagen/AB 1.docx` und `Kapitel 2/Kopiervorlagen/AB 1.pdf` haben denselben
Schlüssel `kopiervorlagen::ab 1` und werden zu **einem** Cluster verschmolzen.
**Regel:** Dateistämme müssen innerhalb gleichnamiger Blattordner eindeutig sein – am einfachsten,
indem man die Kapitelnummer in den Dateinamen schreibt (`K1 AB 01 Zellaufbau.docx`) oder die
Blattordner eindeutig benennt (`Kapitel 1 Kopiervorlagen`).

### 3.1 Cluster-Arten

| Art | Wann | Ergebnis |
| --- | --- | --- |
| `einzeln` | genau eine Datei im Schlüssel | ein Material |
| `paar` | genau zwei Dateien und eine der Paar-Bedingungen (unten) | Material + Musterlösung, verknüpft |
| `varianten` | ≥ 2 Dateien, **alle** mit ` - Fassung <Bezeichnung>` und paarweise verschiedenen Bezeichnungen | ein Material mit mehreren Varianten |
| `unklar` | alles andere mit ≥ 2 Dateien | ein Material: erste Datei = Hauptdatei, alle weiteren = Anhänge; Warnung in der Vorschau |

**Paar-Bedingungen** (eine reicht, immer genau 2 Dateien):

1. **Benanntes Lösungspaar:** genau eine der beiden Dateien hat eine Lösungs-Endung – egal welches
   Format (`Klausur 02.doc` + `Klausur 02 - Lösung.doc`). *Bevorzugte Variante.*
2. **Office + PDF:** eine Office-Datei (`doc/docx/odt/ppt/pptx/odp/xls/xlsx/ods`) und eine PDF mit
   gleichem Stamm → Office = Schülerfassung, **PDF = Lösung**.
3. **Zwei verschiedene Endungen in einem Ordner mit Rolle `kopiervorlagen` oder `klausuren`** →
   alphabetisch erste Endung = Schülerfassung, die andere = Lösung.

> **⚠ Häufigster Fehler:** `Arbeitsblatt.docx` + `Arbeitsblatt.pdf` (PDF-Export desselben Blatts)
> wird als Schülerfassung + **Lösung** erkannt. Wenn die PDF nur ein Export ist: **nur eine der
> beiden Dateien ins Paket legen** (bevorzugt die bearbeitbare Office-Datei, sonst die PDF).

### 3.2 Lösungen benennen

Eine Datei gilt als Lösung, wenn ihr gefalteter Stamm **am Ende** auf folgendes Muster passt (davor
beliebig viele Leerzeichen, `.`, `_`, `-`):

```
loesung | losung | loesungen | losungen | musterloesung | musterlosung | lsg
```

| ✅ wird erkannt | ❌ wird nicht erkannt |
| --- | --- |
| `AB 07 Zellatmung - Lösung.pdf` | `Lösung AB 07 Zellatmung.pdf` (Lösung vorne) |
| `AB07_Zellatmung_Loesung.docx` | `AB 07 Zellatmung (Lösung).pdf` (Klammer am Ende) |
| `Klausur 3 Musterlösung.pdf` | `AB 07 Zellatmung - Erwartungshorizont.pdf` |
| `mel_740449_lsg.doc` | `Lösung.pdf` (kein Stamm übrig) |
| `AB 07 Lösungen.pdf` | |

Die Lösung muss **im selben Ordner** liegen und **denselben Stamm** haben wie die Aufgabe.

Zusätzlich gilt für die **Materialart** (Abschnitt 4): Steht `losung`/`loesung`/`-lsg`/`_lsg`
*irgendwo* im Dateinamen, wird eine Einzeldatei als `musterloesung` eingestuft. Deshalb
**Wörter wie „Auflösung“, „Lösungsstrategien“, „Erlösung“ in Dateinamen vermeiden**, wenn die Datei
keine Lösung ist.

### 3.3 Fassungen (Varianten eines Materials)

Mehrere Fassungen desselben Blatts (z. B. Druckfassung und differenzierte Fassung) werden zu
**einem** Material mit mehreren Varianten, wenn sie exakt so heißen:

```
<Titel> - Fassung <Bezeichnung>.<ext>
<Titel> - Fassung <Bezeichnung> (<Code>).<ext>
```

- Der Bindestrich braucht Leerzeichen auf beiden Seiten (`-`, `–` oder `—`).
- Alle Dateien müssen im **selben Ordner** liegen und **denselben `<Titel>`** haben.
- Die Bezeichnungen müssen **verschieden** sein (`Fassung A` + `Fassung A (2)` → kein Variantenbündel).
- **Alle** Dateien des Schlüssels müssen das Fassungsmuster tragen – eine einzige Datei ohne
  ` - Fassung …` macht daraus ein `unklar`-Bündel.
- Die Fassung mit der alphabetisch ersten Bezeichnung wird Hauptvariante; jede Variante heißt wie
  ihre Bezeichnung (`Handbuch`, `Assistent`, `Grundlegend` …). Der `(<Code>)` dient nur der
  Unterscheidung und wird nicht übernommen.

```
Kapitel 01 Arbeitsblätter/
  Hunde und Katzen im Vergleich - Fassung Basis (S040-01).pdf
  Hunde und Katzen im Vergleich - Fassung Erweitert (S040-02).pdf
  Hunde und Katzen im Vergleich - Fassung Leichte Sprache (S040-03).pdf
```

→ ein Material „Hunde und Katzen im Vergleich“ mit drei Varianten (Hauptvariante: „Basis“).

**Lösungen zu Fassungen** heißen `<Titel> - Lösung - Fassung <Bezeichnung>` und liegen im
**selben Ordner** wie die Fassungen:

```
Arbeitsblätter/
  Wald - Fassung Basis.pdf
  Wald - Fassung Erweitert.pdf
  Wald - Lösung - Fassung Basis.pdf
  Wald - Lösung - Fassung Erweitert.pdf
```

Die Lösungsdateien bilden ein eigenes Bündel (mit mehreren Lösungsdateien wieder ein
Variantenbündel, mit einer ein Einzelmaterial). Es wird automatisch per `musterloesung` mit dem
Fassungsmaterial verknüpft. Auch eine einzelne Lösung (`Wald - Lösung - Fassung Basis.pdf`)
wird verknüpft.

- **Nicht** `Wald - Lösung.pdf` neben die Fassungen legen: Diese Datei fällt in denselben
  Schlüssel wie die Fassungen und macht daraus ein `unklar`-Bündel.
- **Fassungen samt Lösungen nicht in einen Ordner mit „Kopiervorlage“ oder „Klausur“ im Namen
  legen.** Dort setzt die Ordnerrolle das Lösungsbündel auf `arbeitsblatt` bzw. `klausur`.
  Verknüpft wird es trotzdem, nur die Art ist falsch (Abschnitt 5.1). In einem neutralen Ordner
  wie `Arbeitsblätter/` wird es `musterloesung`, und das Fassungsmaterial bekommt die
  Standard-Materialart des Stapels.

### 3.4 Anhänge (eine Hauptdatei + Beiwerk)

Es gibt keine eigene Namenskonvention für Anhänge. Ein `unklar`-Bündel (≥ 3 Dateien gleichen Stamms,
oder 2 Dateien ohne Paar-Bedingung, z. B. `docx` + `txt` außerhalb von Kopiervorlagen/Klausuren)
ergibt ein Material, dessen *erste* Datei Hauptdatei ist – welche das ist, hängt von der Reihenfolge
im Paket ab. Für saubere Pakete gilt daher: **Anhänge vermeiden** und jede Datei als eigenes
Material anlegen lassen, oder die Rollen in der Vorschau festlegen (Abschnitt 9).

---

## 4. Ordnerrollen

Jede Datei bekommt eine Ordnerrolle. Geprüft wird der **gesamte Pfad inklusive Dateiname**
(gefaltet), in dieser Reihenfolge – der erste Treffer gewinnt:

| # | Ordnerrolle | Auslöser im Pfad | Standard-Materialart |
| --- | --- | --- | --- |
| 1 | `kopiervorlagen` | `kopiervorlage` | `arbeitsblatt` |
| 2 | `klausuren` | `klausur` oder `_ka_` | `klausur` |
| 3 | `abbildungen` | `abbildung`, `abbsb`, `abbsvb` | `bild` |
| 4 | `gefaehrdungsbeurteilung` | `_gfb_`, `gefaehrdung`, `gefahrdung` (also auch „Gefährdung…“) | `gefaehrdungsbeurteilung` |
| 5 | `versuche` | Ordner-/Wortsegment `versuch` bzw. `versuche`, oder Dateiname beginnt mit `versuch_` | `zusatzmaterial` |
| 6 | `lernzirkel` | Ordnername nach Abschnitt 7 | `arbeitsblatt` |
| 7 | `sonstiges` | alles andere | aus dem Dateinamen bzw. Standard-Materialart des Stapels |

Folgen:

- Weil auch der Dateiname mitzählt, hat `Kopiervorlagen/Klausur 1.docx` die Rolle
  `kopiervorlagen`. Zur Materialart siehe aber Abschnitt 5 – dort gewinnt `klausur` trotzdem.
- `GFB_Katalase.pdf` ohne passenden Ordner wird **nicht** als GFB erkannt (`_gfb_` braucht
  Unterstriche auf beiden Seiten). Gefährdungsbeurteilungen daher immer in einen Ordner
  `Gefährdungsbeurteilungen/` legen.
- Ordnernamen sind das stärkste und robusteste Steuerinstrument. **Empfohlene Ordnernamen:**
  `Kopiervorlagen`, `Klausuren`, `Abbildungen`, `Gefährdungsbeurteilungen`, `Versuche`,
  `Lernzirkel <Thema>`.

---

## 5. Materialarten

### 5.1 Wie die Materialart bestimmt wird

Für jedes Cluster wird `guessMaterialType` auf den vollständigen Pfad jeder Datei angewendet
(bei benannten Lösungspaaren nur auf die Aufgabendatei). Danach:

1. Liefert eine Datei `gefaehrdungsbeurteilung`, `klausur`, `bild` oder `praesentation`, gewinnt diese Art.
2. Sonst: Liefert eine Datei `arbeitsblatt` und ist die Ordnerrolle nicht `klausuren` → `arbeitsblatt`.
3. Sonst entscheidet die Ordnerrolle (Tabelle in Abschnitt 4).
4. Bei Ordnerrolle `sonstiges`: die Art aus dem Dateinamen der ersten Datei, sonst die
   **Standard-Materialart des Stapels** (`defaultMaterialType`, Voreinstellung `arbeitsblatt`).

`guessMaterialType` prüft in dieser Reihenfolge (gefaltet; *Pfad* = ganzer Pfad, *Name* = nur Dateiname):

| Reihenfolge | Treffer | Materialart |
| --- | --- | --- |
| 1 | Pfad enthält `serviceband`, `lehrerband`, `lehrerhandbuch`, `lehrerhandreichung`, `handreichung`, `begleitband`, `kommentarband` | `serviceband` |
| 2 | Pfad enthält `loesungsheft`, `loesungsbuch`, `loesungen zum` / `loesungen_zum` / `loesungen-zum` (**mit `oe`!**) | `loesungsbuch` |
| 3 | Name enthält `losung`, `loesung`, `-lsg`, `_lsg` | `musterloesung` |
| 4 | Pfad enthält `_gfb_`, `gefaehrdung`, `gefahrdung` | `gefaehrdungsbeurteilung` |
| 5 | Name enthält `klausur`, `klassenarbeit`, `_ka_` – oder Ordnerpfad enthält `klausur` | `klausur` |
| 6 | Pfad enthält `abbsb`, `abbsvb`, `abbildung` | `bild` |
| 7 | Name beginnt mit `versuch_` oder Ordner `versuch`/`versuche` | `zusatzmaterial` |
| 8 | Name enthält `lernkontrolle`, `test`, `quiz` | `lernkontrolle` |
| 9 | Name enthält `steckbrief`, `vorlage`, `_ab_`, `kopiervorlage`, `arbeitsblatt` oder beginnt mit `ab-`/`ab_`/`ab ` – oder Ordnerpfad enthält `kopiervorlage` | `arbeitsblatt` |
| 10 | Endung `pptx`/`ppt`/`odp` oder Name enthält `praesentation`/`prasentation`/`folien` | `praesentation` |
| 11 | Pfad enthält `lehrwerk`, `schulbuch`, `schuelerbuch`/`schulerbuch` | `lehrwerk` |
| 12 | Name enthält `elternbrief`, `brief`, `einverstaendnis`/`einverstandnis` | `sonstiges` |
| 13 | – | Standard-Materialart des Stapels |

### 5.2 Fallen bei der Materialart

- **⚠ Wurzelordner nicht „Lehrwerk …“ oder „Schulbuch …“ nennen.** Jede Datei ohne stärkeren
  Treffer bekäme sonst die Art `lehrwerk` – ein Lehrwerk im Lehrwerk. Den Wurzelordner neutral
  benennen (`Natura 7 Paket`, `Biologie 7`).
- **Handreichung im Pfad** macht alles darunter zum Serviceband, sofern keine Ordnerrolle greift.
  Einen Ordner `Lehrerhandreichung/` nur für den Serviceband selbst verwenden.
- **Lösungsheft mit Umlaut:** `Lösungsheft.pdf` wird zu `losungsheft` gefaltet, passt nicht auf
  `loesungsheft` und wird daher `musterloesung` statt `loesungsbuch`. Für ein Lösungsbuch
  **`Loesungsheft`/`Loesungsbuch` mit „oe“** schreiben (beides landet in der Lehrwerk-Gruppe
  „Lösungen“, die Art ist aber nur so korrekt).
- **Einzelne Lösungsdateien in Ordnern mit Rolle `kopiervorlagen`/`klausuren`** (ohne
  zugehörige Aufgabe im selben Ordner) werden `arbeitsblatt` bzw. `klausur`, nicht
  `musterloesung` – die Ordnerrolle schlägt den Dateinamen.
- **`test` im Dateinamen** (auch „Testat“, „Kontest“) → `lernkontrolle`; **`brief`** → `sonstiges`;
  **`vorlage`** → `arbeitsblatt`; **`folien`** → `praesentation`.
- Arten, die **nie** automatisch vergeben werden: `lehrbuchseite`, `aufgabe`, `differenzierung`,
  `unterrichtsentwurf`, `notiz`, `loesung`, `video`, `link`, `h5p`, `moodle_kurs`. Für
  Lehrbuchseiten einen **eigenen Stapel** mit Standard-Materialart „Lehrbuchseite“ fahren (greift
  bei Ordnerrolle `sonstiges` und neutralen Dateinamen) oder die Art in der Vorschau setzen.

### 5.3 Wie man welche Art erzeugt

| Gewünschte Art | So ablegen |
| --- | --- |
| `arbeitsblatt` | `Kopiervorlagen/K1 AB 01 Zellaufbau.docx` |
| `musterloesung` (verknüpft) | `Kopiervorlagen/K1 AB 01 Zellaufbau - Lösung.pdf` neben der Aufgabe |
| `klausur` | `Klausuren/Klausur 01 Zellbiologie.docx` (+ `… - Lösung.docx`) |
| `lernkontrolle` | `Tests/K1 Lernkontrolle Zelle.pdf` |
| `bild` | `Abbildungen/K1 Abbildung Zellorganellen.pdf` |
| `gefaehrdungsbeurteilung` | `Gefährdungsbeurteilungen/Katalase Wasserstoffperoxid.pdf` |
| `zusatzmaterial` (Versuch) | `Versuche/Katalase Wasserstoffperoxid.pdf` |
| `praesentation` | `Präsentationen/K1 Zellorganellen.pptx` |
| `serviceband` | `Serviceband/Natura 7 Serviceband.pdf` |
| `loesungsbuch` | `Loesungsheft/Natura 7 Loesungsheft.pdf` |
| `lernzirkel` (Über-Material) | entsteht automatisch aus einem Lernzirkel-Ordner (Abschnitt 7) |
| `lehrwerk` | **nicht als Datei** – das Lehrwerk wird beim Stapel gewählt oder angelegt (Abschnitt 6) |

---

## 6. Lehrwerk-Zuordnung

Das Lehrwerk wird **nicht** aus dem Paket gelesen, sondern beim Start des Stapels festgelegt
(Feld „Lehrwerk“ bzw. `mapping`):

| Feld | Bedeutung |
| --- | --- |
| `createLehrwerk: true` + `lehrwerkTitle` | neues Lehrwerk (Art `lehrwerk`) mit Fach, Jahrgängen, Schulform des Stapels anlegen |
| `createLehrwerk: true` + `lehrwerkId` | in ein bestehendes Lehrwerk importieren |
| `createLehrwerk: false` | keine Lehrwerk-Zuordnung, nur lose Materialien |

> Die Oberfläche wählt beim Aktivieren automatisch das **erste vorhandene Lehrwerk** vor, solange
> weder Lehrwerk noch Titel gesetzt sind. Vor dem Start prüfen.

Fach (`subjectId`/`subjectName`), Jahrgangsstufen (`gradeLevels`) und Schulform (`schoolForm`)
gelten für **alle** Materialien des Stapels. Ein Paket sollte daher genau **ein Fach und einen
Jahrgangsbereich** umfassen. (Ohne gesetztes Fach übernimmt jedes Material die KI-Fachvorschläge.)

### Was am Lehrwerk hängt

Alle Zuordnungen sind Verknüpfungen vom Typ `gehoert_zu` (Kind → Eltern):

```
Lehrwerk
├── gehoert_zu ← Arbeitsblatt ── musterloesung → Musterlösung
├── gehoert_zu ← Klausur ─────── musterloesung → Musterlösung
├── gehoert_zu ← Versuch ─────── gehoert_zu    → Gefährdungsbeurteilung
├── gehoert_zu ← Gefährdungsbeurteilung
├── gehoert_zu ← Serviceband (mit Varianten)
└── gehoert_zu ← Lernzirkel
                  ├── gehoert_zu ← Station 1 ── musterloesung → Lösung Station 1
                  ├── gehoert_zu ← Station 2
                  └── gehoert_zu ← Handreichung (zusatzmaterial)
```

- Am Lehrwerk hängt das **Hauptmaterial** jedes Clusters. Die **Musterlösung** hängt an ihrem
  Material, nicht direkt am Lehrwerk (in der Ansicht und im Lehrwerk-ZIP erscheint sie trotzdem).
- **Stationen eines Lernzirkels** hängen nur am Lernzirkel, der Lernzirkel am Lehrwerk.
- Ein Cluster, das nur aus einer Lösung besteht, wird selbst zum Hauptmaterial (`musterloesung`)
  und hängt direkt am Lehrwerk.
- **Dubletten** (gleiche Prüfsumme wie eine schon vorhandene Datei) werden standardmäßig
  übersprungen (`linkDuplicates: true`) – und dabei **nicht** mit dem Lehrwerk verknüpft. Bei
  einem erneuten Import in ein bestehendes Lehrwerk nur neue Dateien beilegen.

### Gruppen in der Lehrwerk-Ansicht

Die Lehrwerk-Seite sortiert die zugeordneten Materialien nach Art (und teils Titel) in feste Gruppen:

| Gruppe | Materialarten | zusätzlich per Titel |
| --- | --- | --- |
| Serviceband | `serviceband` | Serviceband, Lehrerband, Lehrerhandbuch, Lehrerhandreichung, Begleitband, Kommentarband |
| Lösungen | `loesungsbuch`, `musterloesung`, `loesung` | Lösungsheft, Lösungsbuch, Musterlösung |
| Versuche | `zusatzmaterial` | „Versuch“/„Versuche“ |
| Lehrbuchseiten | `lehrbuchseite` | |
| Lernzirkel & Stationenarbeit | `lernzirkel` | Lernzirkel, Stationenarbeit, Stationenlernen |
| Kopiervorlagen & Aufgaben | `arbeitsblatt`, `aufgabe`, `differenzierung` | |
| Leistungsnachweise | `klausur`, `lernkontrolle` | |
| Sicherheit | `gefaehrdungsbeurteilung`, `unterrichtsentwurf` | |
| Abbildungen & Medien | `bild`, `video`, `praesentation`, `h5p` | |
| Digitale Kurse | `moodle_kurs` | |
| Weiteres | alles Übrige | |

Jedes `zusatzmaterial` direkt am Lehrwerk landet unter „Versuche“. Sonstiges Zusatzmaterial daher
nicht direkt am Lehrwerk ablegen, sondern z. B. im Lernzirkel (dort wird es automatisch zu
Zubehör).

---

## 7. Lernzirkel (Stationenarbeit)

Aus einer Stationenarbeit entsteht ein **Über-Material** vom Typ `lernzirkel`; die Stationen hängen
daran, der Lernzirkel hängt am Lehrwerk.

### 7.1 Erkennung

Ein Cluster gehört zu einem Lernzirkel, wenn

- **(a)** ein Ordner in seinem Pfad einem dieser Muster entspricht (der tiefste Treffer zählt):
  `Lernzirkel`, `Lernstation…`, `Stationen` / `Stationenarbeit` / `Stationenlernen` /
  `Stationenlauf` / `Stationenbetrieb` (als eigenes Wort), `Lernwerkstatt`, `Zirkeltraining`;
- **oder (b)** in einem Ordner **mindestens drei** Cluster ein Stationsblatt enthalten – Dateiname
  mit `Station <1–2 Ziffern>` oder `Station <Buchstabe>`, auch `Pflichtstation 2`, `Wahlstation B`,
  `Zusatzstation 4`, `Ergänzungsstation 1`.

Ein Lernzirkel braucht **mindestens zwei** Cluster (bei der Übernahme mindestens zwei ausgewählte),
sonst werden die Blätter normal dem Lehrwerk zugeordnet.

### 7.2 Titel

- Variante (a): Ordnername, führende Nummerierung (`03 `, `3_`) entfernt, `_` → Leerzeichen.
  Ein reiner Gattungsname (`Lernzirkel`, `Stationenarbeit`, `Lernstationen`) bekommt den
  Elternordner angehängt: `Katze/Stationenarbeit/` → „Stationenarbeit Katze“.
- Variante (b): „Lernzirkel <Ordnername>“.
- Der Titel ist in der Vorschau änderbar; dort lässt sich der Lernzirkel auch abschalten.

**Empfehlung:** Ordner explizit `Lernzirkel <Thema>` nennen – das ist eindeutig und liefert direkt
den richtigen Titel.

### 7.3 Inhalt eines Lernzirkel-Ordners

- **Stationsblätter** wie gewohnt benennen; Lösungspaare funktionieren auch hier
  (`Station 1 Ernährung.docx` + `Station 1 Ernährung - Lösung.pdf` → Station mit verknüpfter Lösung).
- **Lehrkraft-Zubehör** wird automatisch zu `zusatzmaterial`, wenn der Stamm `Handreichung`,
  `Hinweise für die Lehrkraft`, `Materialliste`, `Kontrollliste` oder `Aufbauplan` enthält – oder
  wenn das Blatt sonst als Serviceband/Lösungsbuch/Lehrwerk erkannt würde.
- Ein Laufzettel o. Ä. wird eine weitere Station (Art `arbeitsblatt`).

```
Lernzirkel Katze/
  00 Laufzettel Lernzirkel Katze.pdf
  Station 1 Körperbau.docx
  Station 1 Körperbau - Lösung.pdf
  Station 2 Sinnesorgane.docx
  Station 2 Sinnesorgane - Lösung.pdf
  Station 3 Ernährung.pdf
  Hinweise für die Lehrkraft.pdf
```

→ Lernzirkel „Lernzirkel Katze“ mit fünf Bündeln (Laufzettel, drei Stationen, zwei Lösungen
verknüpft, Hinweise als Zusatzmaterial).

---

## 8. Automatische Verknüpfungen

Der Stapel erzeugt nur diese Verknüpfungen:

| Verknüpfung | Typ | Richtung | Entsteht durch |
| --- | --- | --- | --- |
| Material → Lösung | `musterloesung` | Aufgabe → Musterlösung | `paar`-Cluster |
| Material → Lehrwerk | `gehoert_zu` | Material → Lehrwerk | Lehrwerk-Zuordnung |
| Station → Lernzirkel | `gehoert_zu` | Station → Lernzirkel | Lernzirkel-Erkennung |
| Lernzirkel → Lehrwerk | `gehoert_zu` | Lernzirkel → Lehrwerk | Lernzirkel + Lehrwerk |
| Versuch → GFB | `gehoert_zu` | Versuch → Gefährdungsbeurteilung | Themenabgleich (unten) |
| Fassungsmaterial → Lösung | `musterloesung` | Fassungsmaterial → Lösungsbündel | `<Titel> - Lösung - Fassung …` im selben Ordner (Abschnitt 3.3) |
| Fassungen | – (Varianten) | – | `varianten`-Cluster |

Die übrigen Beziehungstypen (`zusatzmaterial`, `differenzierung`, `nachfolger`, `quelle`, `loesung`)
und Weblinks legt der Stapel **nicht** an; sie werden nach dem Import manuell gesetzt.

### Versuch ↔ Gefährdungsbeurteilung

Für jedes Cluster mit Ordnerrolle `versuche` wird die passendste Gefährdungsbeurteilung gesucht:

- Aus beiden Dateistämmen werden **Themenwörter** gebildet: Wortteile ab 4 Zeichen, ohne reine
  Zahlen und ohne Füllwörter (`versuch`, `gfb`, `abb`, `anhang`, `kap`, `kopiervorlage`, `klausur`,
  `arbeitsblatt`, `abbildung`, `loesung`, `musterloesung`, Fachkürzel `bio/che/phy/mat` u. a.).
- Jedes gemeinsame Themenwort zählt 10 Punkte, jede gemeinsame 2–3-stellige Seitenzahl
  (durch `_` abgegrenzt, z. B. `_081_`) 2 Punkte. Ab 10 Punkten wird verknüpft (bestes Ergebnis).

**Konvention:** Versuch und GFB tragen dasselbe markante Stichwort im Dateinamen.

```
Versuche/Katalase Wasserstoffperoxid.pdf
Gefährdungsbeurteilungen/Katalase Wasserstoffperoxid.pdf
```

Gleiche Namen sind hier unproblematisch, weil die Elternordner verschieden sind.

---

## 9. Vorschau und API

### 9.1 Was die Vorschau überschreiben kann

Pro Cluster (`mapping.records[clusterId]`): `include`, `title`, `materialType`, `description`,
`tagNames` (≤ 12), `learningObjectives` (≤ 12), `content`, `fileRoles`, `links`, `solutionTitle`.
Pro Lernzirkel (`mapping.lernzirkel[id]`): `enabled`, `title`.

Dateirollen (`fileRoles[sourceRef]`):

| Rolle | Wirkung bei der Übernahme |
| --- | --- |
| `schueler` | Hauptdatei des Materials (weitere `schueler` → Anhänge) |
| `einzeln` | wie `schueler` |
| `abbildung` | wie `schueler` (Standard im Abbildungsordner) |
| `loesung` | eigenes Material „Musterlösung: <Titel>“, per `musterloesung` verknüpft |
| `anhaengsel` | Anhang am Hauptmaterial |
| `fassung` | zusätzliche Variante des Hauptmaterials |

Ein gut gebautes Paket braucht in der Vorschau **keine** Korrekturen außer einer Sichtprüfung.

### 9.2 Ablauf per API (für Agenten)

1. `POST /api/materials/bulk/analyze` (multipart, Recht „anlegen“)
   - `files`: die Datei(en); bei losen Dateien ist der Dateiname der relative Pfad
   - `relativePaths`: JSON-Array der relativen Pfade in derselben Reihenfolge (bei ZIP unnötig)
   - `mapping`: JSON, z. B.
     ```json
     {
       "subjectName": "Biologie",
       "gradeLevels": ["7", "8"],
       "schoolForm": "gymnasium",
       "defaultMaterialType": "arbeitsblatt",
       "linkDuplicates": true,
       "createLehrwerk": true,
       "lehrwerkTitle": "Natura 7/8"
     }
     ```
     (Gültige Werte für `gradeLevels` siehe `shared/utils/jahrgangsstufen.ts`.)
   - Antwort `202 { runId, fileCount, status: "laeuft", aiEnabled }`
2. `GET /api/materials/bulk/{runId}` abfragen, bis `analysisPending: false` und
   `status: "vorschau"`. Dann `clusters`, `files` (mit `warnings`, `duplicate`) und `mapping.records`
   prüfen.
3. Optional `PATCH /api/materials/bulk/{runId}/mapping` – **immer das vollständige Mapping inkl.
   aller `records` schicken.** Das Mapping wird flach zusammengeführt: ein `records`-Objekt
   ersetzt das bisherige komplett; fehlende Cluster verlieren dabei ihre Entscheidungen (z. B. das
   automatische Überspringen von Dubletten).
4. `POST /api/materials/bulk/{runId}/commit` → `{ status, stats, errors, materialIds }`.
5. Bei Bedarf `POST /api/materials/bulk/{runId}/undo` (entfernt alle angelegten Materialien) oder
   `DELETE /api/materials/bulk/{runId}` (verwirft einen noch nicht übernommenen Stapel).

---

## 10. Titel

- **Mit KI:** Titel aus dem Dokumentinhalt; der Dateiname dient als Fallback.
- **Ohne KI** (oder bei KI-Fehler): aus dem Dateistamm – `-`/`_` → Leerzeichen, führende
  2–4-stellige Nummer mit Trenner entfernt (`07 Zellatmung` → „Zellatmung“), erster Buchstabe groß.
  Präfixe: Versuche → „Versuch …“, Abbildungen → „Abbildungen …“, GFB → „Gefährdungsbeurteilung …“.
- Lösungsmaterialien heißen „Musterlösung: <Titel des Materials>“.

Daher: **Dateinamen sprechend und menschenlesbar wählen** (`K3 AB 04 Fotosynthese im Experiment.docx`
statt `bio_k3_ab04_v2_final.docx`). Ordnungsnummern vorne sind erlaubt; zweistellige werden im
Fallback-Titel entfernt, die Sortierung im Paket bleibt erhalten.

---

## 11. Referenzpaket

Ein vollständiges, ideales Paket für ein Biologie-Lehrwerk:

```
Natura 7 Paket.zip
└── Natura 7 Paket/
    ├── Serviceband/
    │   ├── Natura 7 Serviceband - Fassung Druck (Gesamt).pdf
    │   └── Natura 7 Serviceband - Fassung Digital (Gesamt).pdf
    ├── Loesungsheft/
    │   └── Natura 7 Loesungsheft.pdf
    ├── Kopiervorlagen/
    │   ├── K1 AB 01 Bau der Pflanzenzelle.docx
    │   ├── K1 AB 01 Bau der Pflanzenzelle - Lösung.pdf
    │   ├── K1 AB 02 Mikroskopieren.docx
    │   ├── K1 AB 02 Mikroskopieren - Lösung.docx
    │   └── K2 Steckbrief Laubbaum.pdf
    ├── Arbeitsblätter/
    │   ├── K2 AB 01 Fotosynthese - Fassung Basis (S040-01).pdf
    │   ├── K2 AB 01 Fotosynthese - Fassung Erweitert (S040-02).pdf
    │   ├── K2 AB 01 Fotosynthese - Lösung - Fassung Basis.pdf
    │   └── K2 AB 01 Fotosynthese - Lösung - Fassung Erweitert.pdf
    ├── Klausuren/
    │   ├── Klausur 01 Zellbiologie.docx
    │   ├── Klausur 01 Zellbiologie - Lösung.docx
    │   └── Klausur 02 Fotosynthese.pdf
    ├── Lernkontrollen/
    │   └── K1 Lernkontrolle Zelle.pdf
    ├── Abbildungen/
    │   ├── K1 Pflanzenzelle.pdf
    │   └── K2 Chloroplast.pdf
    ├── Versuche/
    │   ├── Stärkenachweis Iodkaliumiodid.pdf
    │   └── Katalase Wasserstoffperoxid.pdf
    ├── Gefährdungsbeurteilungen/
    │   ├── Stärkenachweis Iodkaliumiodid.pdf
    │   └── Katalase Wasserstoffperoxid.pdf
    ├── Präsentationen/
    │   └── K1 Zellorganellen.pptx
    └── Lernzirkel Wald/
        ├── 00 Laufzettel.pdf
        ├── Station 1 Stockwerke des Waldes.docx
        ├── Station 1 Stockwerke des Waldes - Lösung.pdf
        ├── Station 2 Nahrungsnetz.docx
        ├── Station 2 Nahrungsnetz - Lösung.pdf
        ├── Station 3 Bodenlebewesen.pdf
        └── Materialliste.pdf
```

Stapel-Einstellungen: Fach Biologie, Jahrgang 7, Schulform Gymnasium, Lehrwerk neu „Natura 7“.

Erwartetes Ergebnis:

| Quelle | Ergebnis |
| --- | --- |
| Serviceband (2 Fassungen) | 1 × `serviceband` mit Varianten „Digital“ (Haupt) und „Druck“ |
| Loesungsheft | 1 × `loesungsbuch` |
| K1 AB 01 / AB 02 | je `arbeitsblatt` + verknüpfte `musterloesung` |
| K2 AB 01 Fotosynthese | `arbeitsblatt` mit 2 Varianten, verknüpft mit einer `musterloesung` mit 2 Varianten |
| K2 Steckbrief | `arbeitsblatt` |
| Klausur 01 / 02 | `klausur` (01 mit verknüpfter Lösung) |
| K1 Lernkontrolle | `lernkontrolle` |
| Abbildungen | je `bild` (Fallback-Titel „Abbildungen K1 Pflanzenzelle“) |
| Versuche | je `zusatzmaterial`, per `gehoert_zu` mit der gleichnamigen GFB verknüpft |
| Gefährdungsbeurteilungen | je `gefaehrdungsbeurteilung` |
| K1 Zellorganellen | `praesentation` |
| Lernzirkel Wald | 1 × `lernzirkel` „Lernzirkel Wald“ am Lehrwerk; Laufzettel und 3 Stationen (`arbeitsblatt`, 2 mit Lösung) und Materialliste (`zusatzmaterial`) hängen am Lernzirkel |

Dieses Ergebnis ist gegen `clusterBulkFiles` geprüft (Stand dieses Leitfadens).

Warum es funktioniert:

- Wurzelordner heißt „Natura 7 Paket“ – kein `lehrwerk`/`schulbuch` im Pfad.
- Jede Aufgabe hat höchstens **eine** Begleitdatei, und die trägt die Lösungs-Endung.
- Keine Office-Datei liegt neben einem gleichnamigen PDF-Export.
- Stämme sind dank `K1`/`K2`-Präfix paketweit eindeutig.
- Die Fassungen und ihre Lösungen (`… - Lösung - Fassung …`) liegen gemeinsam in einem Ordner
  ohne „Kopiervorlage“ im Namen. So werden sie verknüpft, und die Lösung wird `musterloesung`.
- Versuch und GFB teilen dasselbe Stichwort, liegen aber in verschiedenen Ordnern.
- „Loesungsheft“ mit „oe“ ergibt `loesungsbuch`.

---

## 12. Checkliste für Agenten

Vor dem Packen prüfen:

- [ ] Nur erlaubte Formate (Abschnitt 2); Bilder in PDF umgewandelt; keine ZIPs im ZIP.
- [ ] ≤ 10.000 Dateien, Gesamtgröße unter dem Importlimit.
- [ ] Ein Fach, ein Jahrgangsbereich pro Paket.
- [ ] Wurzelordner enthält weder `lehrwerk`, `schulbuch`, `schülerbuch` noch `handreichung`.
- [ ] Inhalte nach Rolle in die empfohlenen Ordner sortiert (Abschnitt 4).
- [ ] Für jeden Schlüssel `<Elternordner>::<Stamm>` gilt genau eins:
  - eine Datei, **oder**
  - Aufgabe + **eine** Datei mit Lösungs-Endung, **oder**
  - ≥ 2 Dateien, alle `<Titel> - Fassung <verschiedene Bezeichnung>`; Lösungen dazu als
    `<Titel> - Lösung - Fassung <Bezeichnung>` (nie `<Titel> - Lösung` daneben).
- [ ] Keine Office-Datei neben ihrem eigenen PDF-Export.
- [ ] Lösungen enden auf `Lösung`/`Loesung`/`Lösungen`/`Musterlösung`/`lsg`; Nicht-Lösungen
      enthalten nirgends `lösung`/`loesung`/`_lsg`/`-lsg`.
- [ ] Keine unbeabsichtigten Schlüsselwörter in Dateinamen (`test`, `brief`, `vorlage`, `folien`,
      `klausur`, `abbildung`, `versuch_`).
- [ ] Lösungsbücher als `Loesungsheft`/`Loesungsbuch` (mit „oe“) benannt.
- [ ] Lernzirkel in `Lernzirkel <Thema>/`, mindestens zwei Blätter, Zubehör mit passendem Stichwort.
- [ ] Versuch und Gefährdungsbeurteilung teilen ein markantes Stichwort (≥ 4 Buchstaben).
- [ ] Keine Datei doppelt im Paket; bei Import in ein bestehendes Lehrwerk nur neue Dateien.
- [ ] Dateinamen sprechend; Kapitel-/Ordnungsnummern vorne erlaubt.

Nach der Analyse prüfen: keine Cluster der Art `unklar`, keine Warnungen außer erwarteten
(„Text per Vision/OCR“), Lernzirkel und Versuch↔GFB-Verknüpfungen wie geplant.
