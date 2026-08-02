import { afterEach, describe, expect, it, vi } from 'vitest'

describe('Logger', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('schreibt menschenlesbare Zeilen mit Symbol, Scope und Kontext', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T12:34:56.789'))
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { createLogger } = await import('../../server/utils/logger')

    createLogger('materials').info('Material angelegt', {
      materialId: 'abc-123',
      title: 'Arbeitsblatt',
      apiKey: 'geheim',
    })

    expect(output).toHaveBeenCalledWith(
      '02.08 12:34 ✓ INFO  [MAT] Material angelegt — materialId="abc-123" · title="Arbeitsblatt" · apiKey="[entfernt]"',
    )
  })

  it('filtert Einträge unterhalb des konfigurierten Log-Levels', async () => {
    vi.stubEnv('NUXT_LOG_LEVEL', 'warn')
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { createLogger } = await import('../../server/utils/logger')

    createLogger('materials').info('Wird nicht ausgegeben')

    expect(output).not.toHaveBeenCalled()
  })
})
