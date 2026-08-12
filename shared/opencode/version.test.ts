import { describe, expect, it } from 'vitest'
import { MIN_OPENCODE_VERSION, compareVersions, meetsMinimum } from './version'

// **이 파일이 존재하는 이유는 한 줄이다:** `'1.9.0' > '1.17.18'` 이 문자열 비교에서 참이다.
// 하한선을 문자열로 짜면 1.9.0 이 통과하고, 증상은 진단이 "정상" 이라고 적은 뒤에야
// 다른 모양(어댑터가 없는 경로를 부름)으로 나타난다.

describe('compareVersions', () => {
  // 문자열 비교로 짜면 여기서 깨진다 — 이 한 케이스가 이 모듈의 존재 이유다
  it("'1.9.0' 은 '1.17.18' 보다 낮다", () => {
    expect(compareVersions('1.9.0', '1.17.18')).toBeLessThan(0)
    expect('1.9.0' > '1.17.18').toBe(true) // ← 문자열로 하면 이렇게 뒤집힌다
  })

  it('같으면 0 이다', () => {
    expect(compareVersions('1.17.18', '1.17.18')).toBe(0)
  })

  it('높으면 양수다', () => {
    expect(compareVersions('1.18.16', '1.17.18')).toBeGreaterThan(0)
  })

  // 자리마다 따로 본다 — 붙여 읽으면 1.17.18 이 1.2.0 보다 작아진다
  it('앞자리가 이기면 뒷자리는 안 본다', () => {
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
    expect(compareVersions('1.17.18', '1.2.0')).toBeGreaterThan(0)
  })

  it('자리 수가 달라도 짧은 쪽을 0 으로 채운다', () => {
    expect(compareVersions('1.17', '1.17.0')).toBe(0)
    expect(compareVersions('1.17', '1.17.1')).toBeLessThan(0)
  })

  it('앞의 v 와 공백은 무시한다', () => {
    expect(compareVersions(' v1.17.18 ', '1.17.18')).toBe(0)
  })

  // 프리릴리스는 그 기반 버전으로 본다 — 막지 않는 쪽이다 (파일 주석 참조)
  it('숫자로 못 읽는 자리는 0 으로 본다', () => {
    expect(compareVersions('1.18.0-beta.1', '1.18.0')).toBe(0)
  })
})

describe('meetsMinimum — 하한선만 있고 상한은 없다', () => {
  it('하한선과 같으면 통과다', () => {
    expect(meetsMinimum(MIN_OPENCODE_VERSION)).toBe(true)
  })

  it('낮으면 막는다', () => {
    expect(meetsMinimum('1.9.0')).toBe(false)
    expect(meetsMinimum('0.9.0')).toBe(false)
  })

  // **상한을 두면 안 된다.** 안 재 본 새 버전을 막으면 사용자가 opencode 를 올릴 때마다
  // 앱이 거짓말을 한다. 우리가 아는 것은 "이 아래는 위험하다" 뿐이다.
  it('한참 높은 버전도 막지 않는다', () => {
    expect(meetsMinimum('2.0.0')).toBe(true)
    expect(meetsMinimum('99.0.0')).toBe(true)
  })
})
