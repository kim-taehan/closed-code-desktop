import { describe, expect, it } from 'vitest'
import { manifestFingerprint } from './runManifest'

describe('manifestFingerprint', () => {
  it('읽은 순서에 안 흔들린다 — 한쪽은 node fs, 한쪽은 IPC 로 읽는다', () => {
    const a = [
      { path: 'package.json', text: '{"scripts":{"dev":"vite"}}' },
      { path: 'Makefile', text: 'run:\n\tvite\n' },
    ]
    expect(manifestFingerprint(a)).toBe(manifestFingerprint([...a].reverse()))
  })

  it('내용이 한 글자만 달라도 갈린다', () => {
    const before = manifestFingerprint([{ path: 'package.json', text: '{"scripts":{"dev":"vite"}}' }])
    const after = manifestFingerprint([{ path: 'package.json', text: '{"scripts":{"dev":"vite "}}' }])
    expect(after).not.toBe(before)
  })

  it('파일이 새로 생기면 갈린다 — docker-compose.yml 이 생긴 날이 그렇다', () => {
    const before = manifestFingerprint([{ path: 'package.json', text: '{}' }])
    const after = manifestFingerprint([
      { path: 'package.json', text: '{}' },
      { path: 'docker-compose.yml', text: 'services: {}\n' },
    ])
    expect(after).not.toBe(before)
  })

  it('경계가 있다 — 이름과 내용이 이어 붙어 같은 값이 되지 않는다', () => {
    const left = manifestFingerprint([{ path: 'ab', text: 'cd' }])
    const right = manifestFingerprint([{ path: 'a', text: 'bcd' }])
    expect(left).not.toBe(right)
  })

  it('길어져도 32비트 안에 남는다 (Math.imul)', () => {
    const long = manifestFingerprint([{ path: 'package.json', text: 'x'.repeat(200_000) }])
    expect(long).toMatch(/^[0-9a-f]{8}$/)
  })
})
