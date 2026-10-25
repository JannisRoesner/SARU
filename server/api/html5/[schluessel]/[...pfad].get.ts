import { sendeHtml5Datei } from '../../../services/html5-paket.service'

/**
 * Datei aus einem HTML5-Paket. Ohne Anmeldung erreichbar: Der signierte Schlüssel im Pfad
 * berechtigt für genau ein Paket (ausgestellt von `…/html5.get.ts` nach Rechteprüfung).
 */
export default defineEventHandler((event) => {
  const roh = getRouterParam(event, 'pfad') ?? ''
  let pfad: string
  try {
    pfad = roh.split('/').map((teil) => decodeURIComponent(teil)).join('/')
  } catch {
    pfad = roh
  }
  return sendeHtml5Datei(event, getRouterParam(event, 'schluessel'), pfad)
})
