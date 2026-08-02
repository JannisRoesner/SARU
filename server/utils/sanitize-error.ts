import { isError, type H3Error } from 'h3'
import { istTechnischeMeldung, oeffentlicheFehlermeldung } from '#shared/utils/public-error'
import { appError } from './errors'
import { createLogger } from './logger'

const log = createLogger('errors')

export function toPublicError(
  error: unknown,
  fallback = 'Es ist ein interner Fehler aufgetreten. Bitte später erneut versuchen.',
): H3Error {
  if (isError(error) && error.statusCode && error.statusCode < 500) {
    return error
  }

  if (isError(error) && error.message && !istTechnischeMeldung(error.message)) {
    return error
  }

  log.error('Unbehandelter Serverfehler', { err: error })
  return appError('INTERNER_FEHLER', oeffentlicheFehlermeldung(error, fallback), { cause: error })
}
