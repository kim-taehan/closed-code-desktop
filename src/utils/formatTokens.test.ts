import { describe, expect, it } from 'vitest'
import { contextRatioColor, formatPercent, formatTokenCount } from './formatTokens'

// 토큰 표기·경고색·퍼센트 포맷 (설계 §6.1). 경계값 위주.

describe('formatTokenCount — 단위 표기', () => {
  it('1000 미만은 천단위 구분으로 그대로 쓴다', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(1234)).toBe('1.2K') // 1000 이상은 K
  })

  it('999 은 천단위 구분자 없이 나온다', () => {
    expect(formatTokenCount(500)).toBe('500')
  })

  it('1000 이상은 K, 소수 첫째 자리까지', () => {
    expect(formatTokenCount(1_000)).toBe('1.0K')
    expect(formatTokenCount(1_500)).toBe('1.5K')
    expect(formatTokenCount(12_345)).toBe('12.3K')
    expect(formatTokenCount(999_999)).toBe('1000.0K') // 아직 1M 미만
  })

  it('1,000,000 이상은 M', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.0M')
    expect(formatTokenCount(2_500_000)).toBe('2.5M')
  })

  it('경계 정확히 1000 은 K 로 넘어간다', () => {
    expect(formatTokenCount(1_000)).toBe('1.0K')
    expect(formatTokenCount(999)).not.toContain('K')
  })
})

describe('contextRatioColor — 사용 비율 경고색', () => {
  it('80% 미만은 색 없음', () => {
    expect(contextRatioColor(0)).toBeUndefined()
    expect(contextRatioColor(0.5)).toBeUndefined()
    expect(contextRatioColor(0.799)).toBeUndefined()
  })

  it('80% 이상 90% 미만은 주의색', () => {
    expect(contextRatioColor(0.8)).toBe('var(--dc-status-warn)')
    expect(contextRatioColor(0.85)).toBe('var(--dc-status-warn)')
    expect(contextRatioColor(0.899)).toBe('var(--dc-status-warn)')
  })

  it('90% 이상은 위험색', () => {
    expect(contextRatioColor(0.9)).toBe('var(--dc-status-error)')
    expect(contextRatioColor(1)).toBe('var(--dc-status-error)')
    expect(contextRatioColor(1.5)).toBe('var(--dc-status-error)')
  })
})

describe('formatPercent — 반올림 퍼센트', () => {
  it('비율을 정수 퍼센트로 반올림한다', () => {
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.5)).toBe('50%')
    expect(formatPercent(1)).toBe('100%')
  })

  it('반올림 규칙을 따른다', () => {
    expect(formatPercent(0.004)).toBe('0%')
    expect(formatPercent(0.005)).toBe('1%')
    expect(formatPercent(0.126)).toBe('13%')
  })
})
