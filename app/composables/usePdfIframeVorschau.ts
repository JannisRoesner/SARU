/**
 * Mobile Browser (Android, iOS, Samsung Internet) können PDFs in iframes
 * nicht zuverlässig anzeigen – stattdessen Server-Seitenbilder nutzen.
 */
export function usePdfIframeVorschau() {
  function iframeUnterstuetzt(): boolean {
    if (!import.meta.client) return true
    const ua = navigator.userAgent
    const mobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)
    const schmal = window.matchMedia?.('(max-width: 768px)')?.matches ?? false
    return !(mobile || schmal)
  }

  const pdfIframeUnterstuetzt = ref(iframeUnterstuetzt())

  onMounted(() => {
    pdfIframeUnterstuetzt.value = iframeUnterstuetzt()
  })

  return { pdfIframeUnterstuetzt }
}
