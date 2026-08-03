# V2-Regressionskorpus

Die PDF-Dateien in diesem Verzeichnis sind reale, lokal bereitgestellte
Arbeitsblätter. Vor dem Einchecken werden PDF-Info-Metadaten, Zeitstempel und
Anwendungskennungen entfernt. KI-Antworten sind nicht Bestandteil der
Eingabedateien.

`golden.json` beschreibt ausschließlich deterministische Erwartungen wie
Seiten- und Zielanzahl. Modellantworten werden in Unit-Tests separat als
aufgezeichnete JSON-Verträge geprüft.

Generierte Musterlösungs-PDFs werden bewusst nicht als Eingabefixtures
verwendet: Sie enthalten bereits Antwort-Overlays und würden die Detektoren mit
Informationen testen, die im ursprünglichen Arbeitsblatt nicht vorhanden sind.
