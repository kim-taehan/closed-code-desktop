import { describe, expect, it } from 'vitest'
import { Channel } from './channelNames'

// **컴파일러가 막는 것은 키뿐이다.** 이 파일 머리말이 *"객체 리터럴 하나라 키가 겹치면
// 컴파일이 막는다"* 고 적었는데, 그건 참이면서 절반이다 — **값(문자열)이 겹치는 것은
// 아무도 못 본다.** 겹치면 `ipcMain.handle` 이 나중 것으로 덮어써서 **한 핸들러가 다른
// 채널을 조용히 가로챈다.** 증상은 "그 버튼만 아무 일도 안 일어난다" 이고, 원인이
// 등록부에 있으니 아무도 거기를 안 본다.
//
// ⚠️ **이 파일이 곧 쪼개진다** (299줄). 머리말이 *"도메인별로 쪼개 spread 로 합치지 말라"*
// 고 막아 둔 그 순간에 이 그물이 필요하다 — 쪼개기 **전에** 깔아 두는 것이 요점이다.

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
})
