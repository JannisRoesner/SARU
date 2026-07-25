import type { SafeUser } from '../utils/auth'

declare module 'h3' {
  interface H3EventContext {
    /** Wird von `resolveUser` gesetzt; `null` bedeutet „nicht angemeldet“. */
    saruUser?: SafeUser | null
  }
}

export {}
