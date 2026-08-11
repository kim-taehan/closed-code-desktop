import { describe, expect, it } from 'vitest'
import { ERROR_MESSAGES, findErrorMessage } from './errorMessages'

// 세 IDE 가 공유하는 error-messages.json(_version 1.1.0, 24종)의 TS 재선언.
// 조회 규칙은 vscode resolver 와 같다 — 대문자 정규화, 미등재는 null.

describe('에러 문구 카탈로그', () => {
  // 구판(22종)으로 되돌아가거나 항목이 새면 여기서 막는다.
  // 종수를 줄이는 방향의 변경은 실패해야 한다 — 옛 판본이면 통과할 값을 거부한다.
  it('24종을 모두 담는다', () => {
    expect(Object.keys(ERROR_MESSAGES)).toHaveLength(24)
  })

  it('22종 구판에 없던 두 코드가 있다', () => {
    expect(findErrorMessage('OPENAI_BADREQUEST_IMAGE_UNSUPPORTED')).not.toBeNull()
    expect(findErrorMessage('OPENAI_BADREQUEST_CONTEXT_EXCEEDED')).not.toBeNull()
  })

  it('모든 항목이 title·message·severity 를 갖는다', () => {
    for (const [code, entry] of Object.entries(ERROR_MESSAGES)) {
      expect(entry.title, code).toBeTruthy()
      expect(entry.message, code).toBeTruthy()
      expect(['info', 'warning', 'error'], code).toContain(entry.severity)
    }
  })
})

describe('findErrorMessage', () => {
  it('등재된 코드는 항목을 준다', () => {
    expect(findErrorMessage('OPENAI_BADREQUEST')).toEqual({
      title: 'AI 모델 요청 오류',
      message: 'AI 모델이 요청을 처리하지 못했습니다. 반복되면 관리자에게 문의하세요.',
      severity: 'warning',
    })
  })

  it('소문자로 와도 대문자로 정규화해 찾는다 (vscode resolver 와 동일)', () => {
    expect(findErrorMessage('openai_badrequest')?.title).toBe('AI 모델 요청 오류')
  })

  it('미등재 코드·빈 값·undefined 는 null — 호출부의 기존 폴백을 살린다', () => {
    expect(findErrorMessage('NOPE_UNKNOWN')).toBeNull()
    expect(findErrorMessage('')).toBeNull()
    expect(findErrorMessage(undefined)).toBeNull()
  })

  it('프로토타입 키를 코드로 넘겨도 항목으로 오인하지 않는다', () => {
    expect(findErrorMessage('constructor')).toBeNull()
    expect(findErrorMessage('toString')).toBeNull()
  })
})
