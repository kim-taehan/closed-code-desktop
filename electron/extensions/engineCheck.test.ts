import { describe, expect, it } from 'vitest'
import { EXTENSION_API_VERSION, satisfiesEngine } from './engineCheck'

// 확장이 요구하는 호스트 API 판 판정. 규칙과 이유는 engineCheck.ts 머리말.

describe('satisfiesEngine', () => {
  // 지금 두 확장(code-map · screen-scenario)이 적은 그 값 — 이게 빨개지면 둘 다 안 실린다
  it('지금 확장들이 적은 ^0.1.0 을 이 호스트가 받는다', () => {
    expect(satisfiesEngine('^0.1.0')).toBe(true)
    expect(EXTENSION_API_VERSION).toBe('0.1.0')
  })

  it('0.x 는 minor 가 호환 경계다', () => {
    expect(satisfiesEngine('^0.1.0', '0.1.5')).toBe(true)
    expect(satisfiesEngine('^0.1.0', '0.2.0')).toBe(false)
    expect(satisfiesEngine('^0.2.0', '0.1.9')).toBe(false)
  })

  it('1.x 이상은 major 가 호환 경계다', () => {
    expect(satisfiesEngine('^1.2.0', '1.3.0')).toBe(true)
    expect(satisfiesEngine('^1.2.0', '1.1.9')).toBe(false)
    expect(satisfiesEngine('^1.0.0', '2.0.0')).toBe(false)
  })

  it('정확한 판은 그 판만', () => {
    expect(satisfiesEngine('0.1.0', '0.1.0')).toBe(true)
    expect(satisfiesEngine('0.1.0', '0.1.1')).toBe(false)
  })

  // 통과시키면 이 판정이 있는 이유가 사라진다
  it('모르는 표기는 받지 않는다', () => {
    expect(satisfiesEngine('>=0.1.0')).toBe(false)
    expect(satisfiesEngine('*')).toBe(false)
    expect(satisfiesEngine('')).toBe(false)
  })
})
