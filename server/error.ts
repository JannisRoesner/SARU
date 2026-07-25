import { isError, sendError, type H3Error, type H3Event } from 'h3'
import { toPublicError } from './utils/sanitize-error'

export default function errorHandler(error: H3Error | Error, event: H3Event) {
  if (isError(error) && error.statusCode && error.statusCode < 500) {
    return sendError(event, error)
  }

  return sendError(event, toPublicError(error))
}
