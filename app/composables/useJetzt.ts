/**
 * Gemeinsamer „jetzt“-Zeitpunkt für SSR und erste Client-Renderung.
 * Verhindert Hydration-Mismatches bei relativen Zeiten / Tageszeiten.
 * Nach dem Mount wird auf die echte Browserzeit aktualisiert.
 */
export function useJetzt() {
  const jetzt = useState<number>('saru:jetzt', () => Date.now())

  onMounted(() => {
    jetzt.value = Date.now()
  })

  return jetzt
}
