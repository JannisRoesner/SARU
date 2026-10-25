/**
 * Virtuelle Herkunft der Paketdateien im Player-iframe. `.invalid` ist reserviert und wird nie
 * aufgelöst; alle Abrufe dorthin beantwortet die Brücke selbst aus dem Paket.
 */
export const PAKET_HERKUNFT = 'https://paket.saru.invalid/'

/**
 * Dokument des Player-iframes: Ruffle-Player plus Brücke für `swfStopped` und Befehle.
 * Der iframe hat keine eigene Herkunft und lädt selbst nichts nach – Ruffle-Skript und
 * WebAssembly holt die Elternseite und reicht sie per Nachricht durch (`fetch` wird umgeleitet).
 *
 * Paket-SWFs (siehe `InteraktivPaket`): Die Elternseite schickt die Hülle samt Verzeichnis
 * (Pfad → Byte-Bereich). Ruffle lädt dann die Start-SWF von `PAKET_HERKUNFT`; jeder weitere
 * Abruf dorthin (loadMovie, LoadVars, Sound, Loader, URLLoader …) wird aus dem Paket bedient.
 * Seitenwechsel per getURL sind abgeschaltet (`openUrlMode: deny`), sonst verließe der iframe
 * den Player.
 */
export function interaktivRahmenDokument(origin: string): string {
  const ruffle = `${origin}/ruffle/`
  const skript = `
    window.RufflePlayer = window.RufflePlayer || {};
    window.RufflePlayer.config = {
      publicPath: ${JSON.stringify(ruffle)},
      allowScriptAccess: true,
      autoplay: 'on',
      unmuteOverlay: 'hidden',
      splashScreen: false,
      contextMenu: 'off',
      letterbox: 'on',
      openUrlMode: 'deny',
      warnOnUnsupportedContent: false,
      logLevel: 'warn'
    };
  `
  const brueke = `
    var player = null, daten = null, paket = null, ruffleDa = false, anfragen = {}, zaehler = 0, fehlend = {};
    var HERKUNFT = ${JSON.stringify(PAKET_HERKUNFT)};
    function an(msg) { parent.postMessage(Object.assign({ saru: 'evt' }, msg), '*'); }
    window.addEventListener('error', function (e) { an({ type: 'warn', text: String(e.message) }); });
    window.swfStopped = function (frame) { an({ type: 'stopped', frame: Number(frame) }); };

    // Pfad wie paketPfad() in shared/utils/interaktiv.ts normalisieren.
    function paketPfad(roh) {
      var p = String(roh).split(/[?#]/)[0];
      try { p = decodeURIComponent(p); } catch (e) {}
      var teile = [];
      p.replace(/\\\\/g, '/').split('/').forEach(function (t) {
        if (!t || t === '.') return;
        if (t === '..') teile.pop(); else teile.push(t);
      });
      return teile.join('/').toLowerCase();
    }
    function paketAntwort(url) {
      var pfad = paketPfad(url.slice(HERKUNFT.length));
      var e = paket && paket.verzeichnis[pfad];
      var antwort;
      if (e) {
        antwort = new Response(new Uint8Array(daten, e.o, e.l), { status: 200, headers: { 'content-type': e.t } });
      } else {
        if (!fehlend[pfad]) { fehlend[pfad] = true; an({ type: 'warn', text: 'Paket: Datei fehlt: ' + pfad }); }
        antwort = new Response('', { status: 404 });
      }
      // Ruffle nimmt die Antwort-URL als Adresse des Films (Grundlage relativer Pfade).
      try { Object.defineProperty(antwort, 'url', { value: url }); } catch (x) {}
      return antwort;
    }

    // Ruffle-Dateien kommen über die Elternseite, Paketdateien aus dem Paket.
    var echtesFetch = window.fetch;
    window.fetch = function (ziel) {
      var url = String(ziel && ziel.url ? ziel.url : ziel);
      if (url.indexOf(HERKUNFT) === 0) return Promise.resolve(paketAntwort(url));
      if (url.indexOf(${JSON.stringify(ruffle)}) !== 0) return echtesFetch.apply(this, arguments);
      return new Promise(function (ok, nein) {
        var id = ++zaehler;
        anfragen[id] = { ok: ok, nein: nein, url: url };
        an({ type: 'abruf', id: id, url: url });
      });
    };

    function ext(name) {
      try {
        var r = player && player.ruffle && player.ruffle();
        if (!r) return;
        return r.callExternalInterface.apply(r, Array.prototype.slice.call(arguments));
      } catch (e) { an({ type: 'warn', text: String(e) }); }
    }
    function warteAufRuffle(versuch) {
      if (typeof window.RufflePlayer.newest === 'function') { ruffleDa = true; an({ type: 'ruffle-bereit' }); return; }
      if (versuch > 100) { an({ type: 'fehler', text: 'Ruffle nicht verfügbar' }); return; }
      setTimeout(function () { warteAufRuffle(versuch + 1); }, 50);
    }
    function start() {
      if (!ruffleDa || !daten) return;
      if (player) { player.remove(); player = null; }
      player = window.RufflePlayer.newest().createPlayer();
      player.style.cssText = 'width:100%;height:100%;display:block';
      document.getElementById('b').appendChild(player);
      // Ruffle meldet „loadedmetadata“/„loadeddata“; „loadedmovie“ gibt es nicht. Unveränderte SWFs melden
      // keinen Haltepunkt, die Ladeanzeige hängt also allein an diesem Ereignis.
      var geladen = false;
      function beiGeladen() { if (geladen) return; geladen = true; try { player.focus(); } catch (e) {} an({ type: 'geladen' }); }
      player.addEventListener('loadedmetadata', beiGeladen);
      player.addEventListener('loadeddata', beiGeladen);
      var optionen = paket
        ? { url: HERKUNFT + paket.start, base: HERKUNFT + paket.basis, parameters: paket.parameter }
        : { data: new Uint8Array(daten.slice(0)) };
      // Anwendungen, die selbst nicht skalieren, auf die Rahmengröße einpassen (passt sich mit dem Fenster an).
      if (paket && paket.skalieren) { optionen.scale = 'showAll'; optionen.forceScale = true; optionen.salign = ''; optionen.forceAlign = true; }
      player.load(optionen).catch(function (e) { an({ type: 'fehler', text: String(e) }); });
    }
    addEventListener('message', function (e) {
      var m = e.data;
      if (!m || m.saru !== 'cmd') return;
      if (m.cmd === 'ruffle') {
        var s = document.createElement('script');
        s.textContent = m.js;
        document.head.appendChild(s);
        warteAufRuffle(0);
      }
      else if (m.cmd === 'antwort') {
        var a = anfragen[m.id]; delete anfragen[m.id];
        if (!a) return;
        if (m.daten) a.ok(new Response(m.daten, { status: 200, headers: { 'content-type': 'application/wasm' } }));
        else a.nein(new TypeError('Abruf fehlgeschlagen: ' + a.url));
      }
      else if (m.cmd === 'laden') { daten = m.daten; paket = m.paket || null; fehlend = {}; start(); }
      else if (m.cmd === 'neustart') { start(); }
      else if (m.cmd === 'weiter') { if (player) player.play(); ext('swfPlay'); }
      else if (m.cmd === 'pause') { if (player) player.pause(); }
      else if (m.cmd === 'fortsetzen') { if (player) player.play(); }
      else if (m.cmd === 'erklaerung') { ext('swfSetExplanationMode', !!m.an); }
      else if (m.cmd === 'springen') { ext('swfGoto', m.frame); }
      else if (m.cmd === 'aufruf') { if ('arg' in m) ext('swfCall', m.fn, m.arg); else ext('swfCall', m.fn); }
      else if (m.cmd === 'frame') {
        var f = Number(ext('swfFrame'));
        if (f > 0) an({ type: 'frame', frame: f });
      }
    });
    an({ type: 'bereit' });
  `
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<style>html,body{margin:0;height:100%;overflow:hidden;background:#fff}#b{width:100%;height:100%}</style>',
    '</head><body><div id="b"></div>',
    `<script>${skript}</` + 'script>',
    `<script>${brueke}</` + 'script>',
    '</body></html>',
  ].join('')
}
