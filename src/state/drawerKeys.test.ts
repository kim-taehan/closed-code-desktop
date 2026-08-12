import { describe, expect, it } from 'vitest'
import { belongsToApp } from './drawerKeys'

// **이 파일이 지키는 것은 "칸에서 빠져나올 수 있는가" 다.**
//
// 판정이 틀리면 xterm 이 키를 삼켜(`stopPropagation`) 창 단축키가 죽는다. 증상은
// "셸 칸에 들어가면 마우스 없이 못 나온다" 인데, 그때도 게이트는 초록이다 —
// 그래서 계약을 여기 못 박는다.

const key = (k: string, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}) => ({
  key: k,
  metaKey: mods.metaKey ?? false,
  ctrlKey: mods.ctrlKey ?? false,
})

describe('belongsToApp', () => {
  describe('반드시 빠져나가야 하는 것', () => {
    // 이 둘이 막히면 칸이 덫이 된다
    it('⌘↑ · ⌘↓ — 칸을 접고 여는 키', () => {
      expect(belongsToApp(key('ArrowUp', { metaKey: true }))).toBe(true)
      expect(belongsToApp(key('ArrowDown', { metaKey: true }))).toBe(true)
    })

    // 윈도우·리눅스에는 ⌘ 가 없다. 이 예외가 없으면 그 플랫폼에서 칸을 접을 길이 사라진다.
    it('⌃↑ · ⌃↓ — ⌘ 가 없는 플랫폼의 유일한 탈출구', () => {
      expect(belongsToApp(key('ArrowUp', { ctrlKey: true }))).toBe(true)
      expect(belongsToApp(key('ArrowDown', { ctrlKey: true }))).toBe(true)
    })

    // 표를 복사하지 않고 "⌘ 는 앱 것" 이라는 거친 축을 쓰는 덕에, 앱 단축키가 늘어도
    // ⌘ 계열이면 자동으로 통과한다. 그 성질을 못 박는다.
    it('⌘ 가 붙은 것은 전부 — 표가 늘어도 낡지 않는 축이다', () => {
      for (const k of ['p', 'w', 'n', ',', '1', 'ArrowLeft', 'Enter']) {
        expect(belongsToApp(key(k, { metaKey: true }))).toBe(true)
      }
    })
  })

  describe('셸이 가져야 하는 것', () => {
    // ⌃C 를 앱이 먹으면 셸에서 돌던 것을 끊을 수 없다
    it('⌃C — 중단', () => {
      expect(belongsToApp(key('c', { ctrlKey: true }))).toBe(false)
    })

    // ⌃W 를 앱이 먹으면 단어를 지우려다 탭이 닫힌다
    it('⌃W — 단어 지우기', () => {
      expect(belongsToApp(key('w', { ctrlKey: true }))).toBe(false)
    })

    it('⌃A · ⌃E · ⌃D · ⌃U — 줄 편집', () => {
      for (const k of ['a', 'e', 'd', 'u']) {
        expect(belongsToApp(key(k, { ctrlKey: true }))).toBe(false)
      }
    })

    it('맨 키는 전부 셸 것이다', () => {
      for (const k of ['a', 'Enter', 'Tab', 'ArrowUp', 'Escape']) {
        expect(belongsToApp(key(k))).toBe(false)
      }
    })
  })

  // **의도한 거래다.** 터미널에서 Tab 은 자동완성이라 ⌃Tab 을 앱에 주면 그쪽이 다친다.
  // 칸에서 본문 탭을 옮기려면 ⌘↑ 로 나온 뒤 ⌃Tab 을 쓴다. 적어 두지 않으면 나중에
  // "왜 여기서만 ⌃Tab 이 안 먹지" 를 버그로 오해한다.
  it('⌃Tab 은 앱으로 안 올린다 — 칸 안에서는 셸 자동완성이다', () => {
    expect(belongsToApp(key('Tab', { ctrlKey: true }))).toBe(false)
  })
})
