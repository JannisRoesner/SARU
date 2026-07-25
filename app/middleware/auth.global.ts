/**
 * Schützt alle Seiten. Die Sitzung wird einmal pro Aufruf geladen und danach
 * aus dem geteilten Zustand bedient.
 *
 * `/` ist öffentlich: Gäste sehen die Landingpage, angemeldete Nutzer das Dashboard.
 * `/anmelden` leitet Gäste auf die Landingpage mit Anmelde-Modal um.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { benutzer, laden } = useSitzung()

  await laden()

  // Layout muss hier gesetzt werden (vor dem Rendern). setPageLayout in der Page
  // kommt zu spät und lässt Root-Klassen des default-Layouts stehen (lg:flex).
  if (to.path === '/') {
    setPageLayout(benutzer.value ? 'default' : 'landing')
  }

  // Klassischer Login-Pfad → Landing mit Modal (einmalige Umleitung, kein Loop).
  if (!benutzer.value && to.path === '/anmelden') {
    return navigateTo({
      path: '/',
      query: {
        anmelden: '1',
        ...(typeof to.query.weiter === 'string' ? { weiter: to.query.weiter } : {}),
      },
      replace: true,
    })
  }

  const oeffentlich = to.path === '/'

  if (!benutzer.value && !oeffentlich) {
    return navigateTo({
      path: '/',
      query: {
        anmelden: '1',
        weiter: to.fullPath,
      },
      replace: true,
    })
  }

  if (benutzer.value && to.path === '/anmelden') {
    return navigateTo('/', { replace: true })
  }

  // Erzwungener Passwortwechsel – auch vom Dashboard aus.
  if (
    benutzer.value?.mustChangePassword &&
    to.path !== '/einstellungen/konto'
  ) {
    return navigateTo('/einstellungen/konto', { replace: true })
  }
})
