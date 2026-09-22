import { describe, expect, it } from 'vitest'
import { checkUiMessage, UI_MESSAGE_MAX_BYTES } from './uiMessage'

// 웹뷰 메시지 한 통의 규칙 — JSON 만, 1MB 까지 (E3). 자식·main·화면 셋이 이 하나를 부른다.

describe('checkUiMessage', () => {
  it('JSON 값은 통과한다', () => {
    for (const value of [null, 1, 'a', true, [1, 'b'], { a: { b: [null] } }]) {
      expect(checkUiMessage(value)).toEqual({ ok: true })
    }
  })

  it('JSON 으로 그대로 오갈 수 없는 것은 **어디가** 문제인지와 함께 거부한다', () => {
    const cases: [unknown, string][] = [
      [undefined, 'JSON 값이 아닙니다'],
      [{ a: new Date(0) }, '메시지.a: 평범한 객체가 아닙니다'],
      [{ a: new Map() }, '메시지.a: 평범한 객체가 아닙니다'],
      [[1, Number.NaN], '메시지[1]: 유한한 수가 아닙니다'],
      [{ f: () => 1 }, '메시지.f: JSON 값이 아닙니다 (function)'],
      [{ u: undefined }, '메시지.u: JSON 값이 아닙니다 (undefined)'],
    ]
    for (const [value, reason] of cases) {
      const checked = checkUiMessage(value)
      expect(checked.ok).toBe(false)
      if (!checked.ok) expect(checked.reason).toContain(reason)
    }
  })

  it('순환 참조를 거부한다 — 같은 객체를 두 번 가리키는 것은 순환이 아니다', () => {
    const shared = { x: 1 }
    expect(checkUiMessage({ a: shared, b: shared })).toEqual({ ok: true })
    const loop: Record<string, unknown> = {}
    loop['self'] = loop
    expect(checkUiMessage(loop)).toMatchObject({ ok: false, reason: expect.stringContaining('순환') })
  })

  it('1MB 는 JSON **바이트**로 잰다 — 상한까지는 통과, 한 바이트 넘으면 사유와 함께 거부', () => {
    // 문자열은 따옴표 둘이 붙는다
    const atLimit = 'a'.repeat(UI_MESSAGE_MAX_BYTES - 2)
    expect(checkUiMessage(atLimit)).toEqual({ ok: true })
    const over = checkUiMessage(`${atLimit}a`)
    expect(over).toMatchObject({ ok: false, reason: expect.stringContaining('너무 큽니다') })
  })

  it('한글은 글자당 3바이트로 센다 — 글자 수로 재면 상한의 세 배가 통과한다', () => {
    const korean = '가'.repeat(Math.floor(UI_MESSAGE_MAX_BYTES / 3) + 1)
    expect(checkUiMessage(korean).ok).toBe(false)
  })
})
