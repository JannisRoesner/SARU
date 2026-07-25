import type { RouterConfig } from '@nuxt/schema'

export default {
  scrollBehavior(to, _from, savedPosition) {
    if (to.hash) {
      return { el: to.hash, behavior: 'smooth' as const }
    }
    if (savedPosition) {
      return savedPosition
    }
    return { top: 0, left: 0 }
  },
} satisfies RouterConfig
