// 셸 칸에 포커스가 있을 때 **이 키가 누구 것인가.**
//
// xterm 은 자기가 처리한 키에 `preventDefault` + **`stopPropagation`** 을 건다. 그래서
// 아무 조치도 안 하면 칸에 포커스가 있는 동안 창 단축키가 **통째로 죽는다.**
// `attachCustomKeyEventHandler` 가 `false` 를 돌려주면 xterm 이 그 키를 처리하지 않고,
// 이벤트는 그대로 window 까지 올라가 `useShortcuts` 가 받는다.
//
// `composerArrowKeys.ts` 와 같은 자리·같은 이유로 컴포넌트 밖에 있다 — "이 키는 누구
// 것인가" 는 이름이 붙을 만한 판단이고, 이 판단이 틀리면 **칸에서 마우스 없이 못 나온다.**
// 그런데 그 증상은 게이트가 초록인 채로 난다 (`DrawerTerminal` 은 렌더 테스트가 없다).
//
// ⚠️ **판정이 두 벌이다.** 창 단축키의 정본은 `useShortcuts.ts` 이고 여기는 그것을 모른다.
// 일부러 그렇게 뒀다 — 표를 복사하면 표가 늘 때마다 여기가 낡는다. 대신 **거친 축**만 쓴다:
// **⌘ 는 앱 것, ⌃ 는 터미널 것.** 그래서 앱 단축키가 늘어도 ⌘ 계열이면 자동으로 통과한다.
//
// 대신 이 축이 못 덮는 자리가 있다:
//   · **⌃ 로 시작하는 앱 단축키를 새로 만들면 칸 안에서만 조용히 안 먹는다.** 그래서 예외를
//     손으로 적는다 (아래 `⌃↑`/`⌃↓`/`⌃Tab`).
//   · 새로 만들 때 이 표를 안 보면 아무 테스트도 안 빨개진다. 그래서 아래 테스트가
//     "무엇이 통과하고 무엇이 안 통과하는가" 를 못 박아 둔다.
//
// ## ⌃Tab 은 빼고 ⇧Tab 은 안 뺀다 — 둘을 헷갈리지 말 것
//
// 한때 이 자리에 "⌃Tab 을 셸에 주는 것은 **의도한 거래**(터미널에서 Tab 은 자동완성)" 라고
// 적혀 있었다. **그 거래는 없다.** xterm 5.5.0 소스가 근거다:
//
// ```js
// case 8: o.key = e.ctrlKey ? "\b" : DEL, …        // Backspace 는 ctrlKey 를 본다
// case 9: if (e.shiftKey) { o.key = ESC+"[Z"; break }
//         o.key = HT, o.cancel = true; break        // Tab 은 ctrlKey 를 **안** 본다
// ```
//
// ⌃Tab 이 셸에 가 봐야 `HT`(0x09) — **맨 Tab 과 같은 바이트라 셸이 구분조차 못 한다.**
// 앱은 본문 탭 순환을 잃고 셸은 아무것도 얻지 못하므로 거래가 아니라 순손실이다. 그래서 뺀다.
//
// **⇧Tab 은 같이 빼지 않는다.** 그쪽은 `ESC[Z`(역방향 탭)라 **다른 바이트**이고 터미널에서
// 실제로 뜻이 있다. 두 줄이 나란히 있어 한 덩어리로 보이지만 근거가 정반대다.

/** 판정에 필요한 것만. 진짜 KeyboardEvent 없이도 시험할 수 있게 좁혀 뒀다. */
export interface DrawerKeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
}

/**
 * 이 키를 xterm 이 먹지 말고 창까지 올려보내야 하는가.
 *
 * ⌃C 를 가로채면 셸에서 돌던 것을 끊을 수 없고, ⌃W(단어 지우기)를 앱이 먹으면 탭이 닫힌다.
 * 그래서 ⌃ 는 기본이 셸 것이고, **예외는 둘뿐이며 근거가 서로 다르다:**
 *
 *   · `⌃↑`/`⌃↓` — 윈도우·리눅스에는 ⌘ 가 없다. 안 빼면 **칸을 접을 길이 아예 사라진다**
 *     (마우스로만 나올 수 있는 칸이 된다).
 *   · `⌃Tab` — 셸에 가 봐야 맨 Tab 과 **같은 바이트**라 잃는 것이 없다 (머리말의 xterm 소스).
 *
 * `⇧Tab` 은 여기 없다. 그쪽은 `ESC[Z` 로 다른 바이트라 터미널에서 뜻이 있다.
 */
export function belongsToApp(event: DrawerKeyLike): boolean {
  if (event.metaKey) return true
  if (!event.ctrlKey) return false
  return event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Tab'
}
