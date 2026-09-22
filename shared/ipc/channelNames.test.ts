import { describe, expect, it } from 'vitest'
import { Channel, disjoint } from './channelNames'

// **컴파일러가 막는 것은 키뿐이다.** 이 파일 머리말이 *"객체 리터럴 하나라 키가 겹치면
// 컴파일이 막는다"* 고 적었는데, 그건 참이면서 절반이다 — **값(문자열)이 겹치는 것은
// 아무도 못 본다.** 겹치면 `ipcMain.handle` 이 나중 것으로 덮어써서 **한 핸들러가 다른
// 채널을 조용히 가로챈다.** 증상은 "그 버튼만 아무 일도 안 일어난다" 이고, 원인이
// 등록부에 있으니 아무도 거기를 안 본다.
//
// ⚠️ **이 파일이 쪼개졌다** (2026-09-22, 299줄에서 확장 채널을 `extensionChannelNames.ts` 로).
// 머리말이 *"도메인별로 쪼개 spread 로 합치지 말라"* 고 막아 둔 그 순간에 이 그물이 필요했고,
// 쪼개기 **전에** 깔아 둔 것이 그대로 받친다. 키 쪽은 `disjoint` 가 컴파일에서 막는다 (아래).

describe('Channel 등록부', () => {
  it('값이 겹치지 않는다 — 겹치면 한 핸들러가 다른 채널을 가로챈다', () => {
    const values = Object.values(Channel)
    const seen = new Map<string, string[]>()
    for (const [name, value] of Object.entries(Channel)) {
      seen.set(value, [...(seen.get(value) ?? []), name])
    }
    const collisions = [...seen].filter(([, names]) => names.length > 1)

    // 겹친 것이 있으면 **어느 키끼리인지** 보여 준다 — 개수만 틀리면 찾는 데 시간이 든다
    expect(collisions).toEqual([])
    expect(new Set(values).size).toBe(values.length)
  })

  // 기준선 — 위가 빈 객체에도 초록이라 등록부가 통째로 사라져도 안 걸린다
  it('등록부가 비어 있지 않다', () => {
    expect(Object.keys(Channel).length).toBeGreaterThan(100)
  })

  // 쪼갠 뒤의 두 묶음이 **정말 합쳐졌나** — 확장 채널이 빠지면 핸들러는 있는데 preload 가 못 부른다
  it('확장 채널도 등록부에 있다', () => {
    expect(Channel.EXTENSION_LIST).toBe('extension:list')
    expect(Channel.EXTENSION_UI_SEND).toBe('extension:uiSend')
  })

  it('disjoint 는 키가 겹치면 컴파일에서 멈추고, 눌러도 런타임에서 던진다', () => {
    // @ts-expect-error — 키가 겹치면 타입 오류다. 이 줄에서 오류가 안 나면 typecheck 가 빨갛다
    const merge = () => disjoint({ A: 'a' } as const, { A: 'b' } as const)
    expect(merge).toThrow('채널 키가 겹칩니다: A')
    expect(disjoint({ A: 'a' } as const, { B: 'b' } as const)).toEqual({ A: 'a', B: 'b' })
  })
})
