import { describe, expect, it } from 'vitest'
import {
  createWopiAccessToken,
  parseDiscoveryActions,
  rewriteToBaseOrigin,
  verifyWopiAccessToken,
} from '../../server/services/collabora.service'

describe('collabora WOPI token', () => {
  it('roundtrips canWrite=true', () => {
    const token = createWopiAccessToken({
      assetId: '11111111-1111-1111-1111-111111111111',
      userId: '22222222-2222-2222-2222-222222222222',
      userName: 'Lehrkraft',
      canWrite: true,
    })
    const claims = verifyWopiAccessToken(token)
    expect(claims?.canWrite).toBe(true)
    expect(claims?.userName).toBe('Lehrkraft')
  })

  it('roundtrips canWrite=false for readers', () => {
    const token = createWopiAccessToken({
      assetId: '11111111-1111-1111-1111-111111111111',
      userId: '22222222-2222-2222-2222-222222222222',
      userName: 'Leser',
      canWrite: false,
    })
    expect(verifyWopiAccessToken(token)?.canWrite).toBe(false)
  })

  it('rejects tampered tokens', () => {
    const token = createWopiAccessToken({
      assetId: '11111111-1111-1111-1111-111111111111',
      userId: '22222222-2222-2222-2222-222222222222',
      userName: 'X',
      canWrite: true,
    })
    const [encoded] = token.split('.')
    expect(verifyWopiAccessToken(`${encoded}.invalid`)).toBeNull()
  })
})

describe('parseDiscoveryActions', () => {
  it('prefers attribute order variants and keeps action names', () => {
    const xml = `
      <net-zone>
        <app name="writer">
          <action name="view" ext="docx" urlsrc="https://office.example/browser/dist/cool.html?"/>
          <action urlsrc="https://office.example/browser/dist/cool.html?" ext="docx" name="edit"/>
          <action name="edit" ext="odt" urlsrc="/browser/dist/cool.html?"/>
        </app>
      </net-zone>
    `
    const actions = parseDiscoveryActions(xml)
    expect(actions).toEqual([
      { name: 'view', ext: 'docx', urlsrc: 'https://office.example/browser/dist/cool.html?' },
      { name: 'edit', ext: 'docx', urlsrc: 'https://office.example/browser/dist/cool.html?' },
      { name: 'edit', ext: 'odt', urlsrc: '/browser/dist/cool.html?' },
    ])
  })
})

describe('rewriteToBaseOrigin', () => {
  it('rewrites discovered host to configured Collabora origin', () => {
    expect(
      rewriteToBaseOrigin(
        'http://internal:9980/browser/dist/cool.html?x=1',
        'https://office.roesner.family',
      ),
    ).toBe('https://office.roesner.family/browser/dist/cool.html?x=1')
  })
})
