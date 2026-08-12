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

  // **Tab 두 조합의 근거가 정반대다.** 나란히 있어 한 덩어리로 보이므로 함께 못 박는다 —
  // 한쪽을 고치려다 다른 쪽까지 옮기는 것이 여기서 가장 하기 쉬운 실수다.
  describe('⌃Tab 과 ⇧Tab', () => {
    // 셸에 가 봐야 `HT` — 맨 Tab 과 같은 바이트라 셸이 구분조차 못 한다.
    // 안 빼면 앱은 본문 탭 순환을 잃고 셸은 아무것도 얻지 못한다.
    it('⌃Tab 은 앱으로 올린다 — 셸이 얻는 것이 없다', () => {
      expect(belongsToApp(key('Tab', { ctrlKey: true }))).toBe(true)
    })

    // `ESC[Z`(역방향 탭) — **다른 바이트**라 터미널에서 실제로 뜻이 있다
    it('⇧Tab 은 셸 것이다 — 같이 빼지 않는다', () => {
      expect(belongsToApp({ key: 'Tab', metaKey: false, ctrlKey: false })).toBe(false)
    })

    it('맨 Tab 은 셸 것이다 — 자동완성', () => {
      expect(belongsToApp(key('Tab'))).toBe(false)
    })
  })
})
