import { describe, expect, it } from 'vitest'
import { MessageStore } from './messageStore'

// 카탈로그(errorMessages.ts)는 24종에 심각도를 매겨 두었는데 아무도 쓰지 않았다.
// 전부 같은 빨강으로 그리면 "잠시 후 다시 시도해주세요" 같은 안내가 치명적 오류처럼
// 보인다 — 24종 중 warning 11 · info 2 로 절반이 빨강일 이유가 없다.

function lastOf(store: MessageStore) {
  const items = store.snapshot()
  return items[items.length - 1]
}

describe('에러 심각도', () => {
  it('카탈로그의 심각도를 메시지에 싣는다', () => {
    const store = new MessageStore()
    // "잠시 후 다시 시도" 계열 — 치명적 오류가 아니다
    store.addError({ message: 'x', code: 'OPENAI_TOO_MANY_REQUESTS' })
    expect(lastOf(store)?.severity, '심각도가 유실돼 전부 빨강으로 그려진다').toBe('warning')
  })

  it('진짜 오류는 error 그대로다', () => {
    const store = new MessageStore()
    store.addError({ message: 'x', code: 'OPENAI_UNAUTHORIZED' })
    expect(lastOf(store)?.severity).toBe('error')
  })

  it('카탈로그에 없는 코드는 error 로 둔다', () => {
    // 모르는 것을 가볍게 보이는 쪽이 더 위험하다 — 안전한 기본값은 error 다
    const store = new MessageStore()
    store.addError({ message: '알 수 없는 문제', code: 'NOPE_UNKNOWN_CODE' })
    expect(lastOf(store)?.severity).toBe('error')
  })

  it('코드가 아예 없어도 error 로 둔다', () => {
    const store = new MessageStore()
    store.addError({ message: '연결이 끊겼습니다' })
    expect(lastOf(store)?.severity).toBe('error')
  })
})
