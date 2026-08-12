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

    // **`!shiftKey` 를 더하고 싶어지는 자리다.** 더하면 칸 안에서 **이전 탭만** 조용히 죽는다.
    // ⌃⇧Tab 도 셸에는 `ESC[Z` — 맨 ⇧Tab 과 같은 바이트라 역시 구분이 안 된다.
    //
    // 실제 호출자(`DrawerTerminal`)는 **진짜 `KeyboardEvent`** 를 넘기므로 `shiftKey` 가
    // 딸려 온다. `DrawerKeyLike` 가 그 필드를 안 받는 것이 1차 방어이고, 이 케이스는
    // 값이 실려 와도 판정이 안 흔들리는지를 본다.
    it('⌃⇧Tab(이전 탭)도 앱으로 올린다 — shiftKey 가 실려 와도 무시한다', () => {
      const withShift = { key: 'Tab', metaKey: false, ctrlKey: true, shiftKey: true }
      expect(belongsToApp(withShift)).toBe(true)
    })

    // 맨 Tab(자동완성)도 맨 ⇧Tab(`ESC[Z`, 역방향 탭)도 셸 것이다.
    //
    // ⚠️ **이 함수는 그 둘을 구별하지 않는다** — `DrawerKeyLike` 에 `shiftKey` 가 없어서
    // 입력이 같은 값이 된다. 그래서 케이스를 둘로 나누지 않는다: 나누면 같은 것을 두 번
    // 단언하면서 「⇧Tab 을 시험했다」고 믿게 된다 (실제로 그렇게 적었다가 감사에서 잡혔다).
    // 구별할 필요도 없다 — ⌃ 가 없으면 둘 다 셸로 가는 것이 맞는 답이다.
    it('⌃ 없는 Tab 은 셸 것이다 — 맨 Tab 도 ⇧Tab 도', () => {
      expect(belongsToApp(key('Tab'))).toBe(false)
    })
  })

  // **손으로 센 예외 목록은 태어날 때 이미 낡아 있었다** — `⌘/⌃1..9`(프로젝트 직행)가
  // 먼저 들어와 있었는데 "지금 ⌃ 앱 단축키는 ⌃Tab 하나" 라고 적었다.
  // 판정 근거는 xterm 의 ctrl 매핑이다: 숫자는 **3~8 만** 바이트가 있다.
  describe('⌃ + 숫자 — 셸이 받는 것과 안 받는 것', () => {
    // 매핑에 없다 → 셸이 아무것도 안 받는다 → 앱이 가져가도 잃는 것이 없다.
    // 안 빼면 윈도우·리눅스에서 칸에 포커스가 있는 동안 1·2·9번 프로젝트로 못 간다.
    it('⌃1 · ⌃2 · ⌃9 는 앱 것이다 — 셸이 아무 바이트도 안 받는다', () => {
      for (const digit of ['1', '2', '9']) {
        expect(belongsToApp(key(digit, { ctrlKey: true }))).toBe(true)
      }
    })

    // 3~7 → ESC/FS/GS/RS/US, 8 → DEL. **진짜 바이트가 있으므로 뺏으면 대가가 있다.**
    it('⌃3 ~ ⌃8 은 셸 것이다 — 여기는 진짜 거래다', () => {
      for (const digit of ['3', '4', '5', '6', '7', '8']) {
        expect(belongsToApp(key(digit, { ctrlKey: true }))).toBe(false)
      }
    })

    // 앱 메뉴(배율 초기화)가 L0 에서 먼저 먹지만, 셸이 못 받는 것은 마찬가지다
    it('⌃0 도 셸이 안 받는다', () => {
      expect(belongsToApp(key('0', { ctrlKey: true }))).toBe(true)
    })

    // 글자는 전부 ^A..^Z 로 나간다 — 숫자 규칙이 글자까지 삼키면 ⌃C 가 죽는다
    it('숫자 규칙이 글자를 삼키지 않는다', () => {
      for (const letter of ['c', 'w', 'a', 'z']) {
        expect(belongsToApp(key(letter, { ctrlKey: true }))).toBe(false)
      }
    })
  })
})
