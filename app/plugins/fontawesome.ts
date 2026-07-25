import { config, library } from '@fortawesome/fontawesome-svg-core'
import { fas } from '@fortawesome/free-solid-svg-icons'
import { far } from '@fortawesome/free-regular-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@fortawesome/fontawesome-svg-core/styles.css'

// Nuxt bindet das Stylesheet oben selbst ein; FontAwesome soll nichts nachladen.
config.autoAddCss = false

library.add(fas, far)

/**
 * Muss auch beim Server-Rendering laufen, sonst fehlen die Icons im
 * ausgelieferten HTML und Vue meldet eine unbekannte Komponente.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.component('FontAwesomeIcon', FontAwesomeIcon)
})
