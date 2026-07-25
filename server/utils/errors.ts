import { createError, type H3Error } from 'h3'

/**
 * Fehlercodes der Anwendung. Der Client wertet sie aus, um verständliche
 * Meldungen anzuzeigen, ohne interne Details preiszugeben.
 */
export type AppErrorCode =
  | 'NICHT_ANGEMELDET'
  | 'KEINE_BERECHTIGUNG'
  | 'NICHT_GEFUNDEN'
  | 'UNGUELTIGE_EINGABE'
  | 'KONFLIKT'
  | 'DATEI_ZU_GROSS'
  | 'DATEITYP_NICHT_ERLAUBT'
  | 'KI_NICHT_KONFIGURIERT'
  | 'KI_FEHLER'
  | 'IMPORT_FEHLER'
  | 'RATE_LIMIT'
  | 'INTERNER_FEHLER'

const statusByCode: Record<AppErrorCode, number> = {
  NICHT_ANGEMELDET: 401,
  KEINE_BERECHTIGUNG: 403,
  NICHT_GEFUNDEN: 404,
  UNGUELTIGE_EINGABE: 422,
  KONFLIKT: 409,
  DATEI_ZU_GROSS: 413,
  DATEITYP_NICHT_ERLAUBT: 415,
  KI_NICHT_KONFIGURIERT: 400,
  KI_FEHLER: 502,
  IMPORT_FEHLER: 422,
  RATE_LIMIT: 429,
  INTERNER_FEHLER: 500,
}

export interface AppErrorOptions {
  details?: unknown
  cause?: unknown
}

export function appError(
  code: AppErrorCode,
  message: string,
  options: AppErrorOptions = {},
): H3Error {
  return createError({
    statusCode: statusByCode[code],
    statusMessage: code,
    message,
    data: { code, details: options.details },
    cause: options.cause,
  })
}

export const notFound = (was = 'Der Datensatz') =>
  appError('NICHT_GEFUNDEN', `${was} wurde nicht gefunden.`)

export const forbidden = (message = 'Für diese Aktion fehlt die Berechtigung.') =>
  appError('KEINE_BERECHTIGUNG', message)

export const unauthorized = (message = 'Bitte zuerst anmelden.') =>
  appError('NICHT_ANGEMELDET', message)

export const invalidInput = (message: string, details?: unknown) =>
  appError('UNGUELTIGE_EINGABE', message, { details })

export const conflict = (message: string, details?: unknown) =>
  appError('KONFLIKT', message, { details })
