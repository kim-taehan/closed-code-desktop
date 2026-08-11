import { describe, expect, it } from 'vitest'
import { displayDuration, formatDuration } from './formatDuration'

// 설계 §6.2 의 경과시간 포맷. vscode 와 문자열이 정확히 같아야 한다.

describe('formatDuration', () => {
  it('값이 없으면 null 이다', () => {
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration(undefined)).toBeNull()
    expect(formatDuration(Number.NaN)).toBeNull()
  })

  it('1초 미만은 <1s 다', () => {
    expect(formatDuration(0)).toBe('<1s')
    expect(formatDuration(400)).toBe('<1s')
    // 499ms 는 반올림해도 0초
    expect(formatDuration(499)).toBe('<1s')
  })

  it('반올림해서 1초가 되면 1s 다', () => {
    expect(formatDuration(500)).toBe('1s')
    expect(formatDuration(1000)).toBe('1s')
  })

  it('60초 미만은 초로만 쓴다', () => {
    expect(formatDuration(12_000)).toBe('12s')
    expect(formatDuration(59_400)).toBe('59s')
  })

  it('60초 이상은 분과 초로 쓴다', () => {
    expect(formatDuration(60_000)).toBe('1m 0s')
    expect(formatDuration(65_000)).toBe('1m 5s')
    expect(formatDuration(125_000)).toBe('2m 5s')
  })

  it('음수는 0 으로 본다', () => {
    expect(formatDuration(-500)).toBe('<1s')
  })
})

describe('displayDuration', () => {
  it('확정된 durationMs 가 있으면 그것을 쓴다', () => {
    expect(displayDuration(5_000, { isStreaming: true, startedAt: 0, now: 99_000 })).toBe('5s')
  })

  it('스트리밍 중이면 시작 시각부터 지금까지를 센다', () => {
    expect(displayDuration(undefined, { isStreaming: true, startedAt: 1_000, now: 8_000 })).toBe('7s')
  })

  it('스트리밍이 아니고 durationMs 도 없으면 표시하지 않는다', () => {
    expect(displayDuration(undefined, { isStreaming: false, startedAt: 1_000, now: 8_000 })).toBeNull()
  })

  it('시작 시각이 없으면 표시하지 않는다', () => {
    expect(displayDuration(undefined, { isStreaming: true, now: 8_000 })).toBeNull()
  })
})
