import { describe, expect, it } from 'vitest'
import { parseManifest } from './manifest'

// 매니페스트 3판 `network` — `code.http.fetch` 가 닿아도 되는 출처 (`manifestNetwork.ts`).

function network(version: number, value: unknown): string[] | undefined {
  const parsed = parseManifest({ manifestVersion: version, name: 'jira', version: '1.0.0', main: 'main.js', network: value })
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.manifest.network
}

describe('network', () => {
  it('출처로 편다 — 끝의 /·기본 포트·대문자 호스트는 같은 출처다', () => {
    expect(network(3, ['https://Jira.Example.com/', 'https://jira.example.com:443', 'http://10.0.0.5:8080'])).toEqual([
      'https://jira.example.com',
      'http://10.0.0.5:8080',
    ])
  })

  it('경로·질의·계정이 붙은 것, http(s) 가 아닌 것은 항목 단위로 버린다', () => {
    expect(
      network(3, ['https://jira/rest', 'https://jira/?a=1', 'https://u:p@jira', 'ftp://jira', 'jira', 3, 'https://ok']),
    ).toEqual(['https://ok'])
  })

  it('2판은 적어도 안 읽는다 — 2판 확장은 바깥에 안 닿는다', () => {
    expect(network(2, ['https://jira'])).toBeUndefined()
  })

  it('배열이 아니거나 비면 없는 것이다', () => {
    expect(network(3, 'https://jira')).toBeUndefined()
    expect(network(3, [])).toBeUndefined()
  })
})
