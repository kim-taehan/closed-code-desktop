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
  //
  // 그래서 여기에 **xterm 의 ctrl 표 자체를 못 박는다.** 다음에 누가 축을 "⌃ 는 다 앱 것"
  // 으로 단순화하거나 반대로 "⌃ 는 다 셸 것" 으로 되돌리면 이 묶음이 빨개진다.
  describe('xterm ctrl 표 — 셸이 바이트를 받는 것과 못 받는 것', () => {
    const shellGets = (key: string) =>
      expect(belongsToApp({ key, metaKey: false, ctrlKey: true })).toBe(false)
    const appGets = (key: string) =>
      expect(belongsToApp({ key, metaKey: false, ctrlKey: true })).toBe(true)

    // ^A..^Z — 중단(⌃C)·단어 지우기(⌃W)·줄 편집(⌃A/⌃E/⌃U)이 전부 여기다.
    // **이 케이스가 없으면 "⌃ 는 다 앱 것" 으로 단순화해도 아무것도 안 빨개진다.**
    it('글자는 셸 것이다 — ⌃C·⌃W·⌃P·⌃N 을 뺏으면 칸에서 셸을 못 쓴다', () => {
      for (const k of ['a', 'c', 'e', 'n', 'p', 'u', 'w', 'z', 'A', 'Z']) shellGets(k)
    })

    it('space 는 셸 것이다 — NUL', () => {
      shellGets(' ')
    })

    // 3~7 → ESC,FS,GS,RS,US · 8 → DEL. **진짜 거래라 뺏으면 대가가 있다.**
    it('숫자 3~8 은 셸 것이다', () => {
      for (const k of ['3', '4', '5', '6', '7', '8']) shellGets(k)
    })

    it('[ \\ ] 는 셸 것이다 — ESC·FS·GS', () => {
      for (const k of ['[', '\\', ']']) shellGets(k)
    })

    // 표에 없다 = 셸이 아무것도 안 받는다 = 앱이 가져가도 잃는 것이 없다.
    // 안 빼면 윈도우·리눅스에서 칸에 포커스가 있는 동안 1·2·9번 프로젝트와 설정이 죽는다.
    it('표에 없는 한 글자는 앱 것이다 — ⌃0·⌃1·⌃2·⌃9·⌃,', () => {
      for (const k of ['0', '1', '2', '9', ',', ';', '/', '.']) appGets(k)
    })

    // ⚠️ **이 케이스가 「왜 축을 뒤집지 않았나」를 지킨다.**
    // 이름이 긴 키는 자기 `case` 에서 따로 바이트를 만든다 — ⌃← 는 ESC[1;5D(단어 이동)다.
    // 그 목록을 우리가 다 모르므로 판단하지 않고 셸에 남긴다.
    it('이름이 긴 키는 판단하지 않고 셸에 남긴다 — ⌃←/⌃→ 는 단어 이동이다', () => {
      for (const k of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'F1', 'Backspace']) {
        shellGets(k)
      }
    })
  })
})
