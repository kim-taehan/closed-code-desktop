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
//   · **⌃ 로 시작하는 앱 단축키를 새로 만들면 칸 안에서만 조용히 안 먹는다.** 지금 그런 것은
//     `⌃Tab`(본문 탭 순환) 하나이고, **의도한 거래다** — 터미널에서 Tab 은 자동완성이다.
//     칸에서 탭을 옮기려면 ⌘↑ 로 나온 뒤 ⌃Tab 을 쓴다.
//   · 새로 만들 때 이 표를 안 보면 아무 테스트도 안 빨개진다. 그래서 아래 테스트가
//     "무엇이 통과하고 무엇이 안 통과하는가" 를 못 박아 둔다.

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
 * 예외는 **⌃↑/⌃↓ 하나**다 — 윈도우·리눅스에는 ⌘ 가 없어, 이걸 안 빼면 칸을 접을 길이
 * 아예 사라진다 (마우스로만 나올 수 있는 칸이 된다).
 */
export function belongsToApp(event: DrawerKeyLike): boolean {
  if (event.metaKey) return true
  return event.ctrlKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')
}
