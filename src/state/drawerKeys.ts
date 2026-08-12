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
// 일부러 그렇게 뒀다 — 표를 복사하면 표가 늘 때마다 여기가 낡는다.
//
// ## 축: ⌘ 는 앱 것, ⌃ 는 **셸이 실제로 바이트를 받는 것만** 터미널 것
//
// 처음에는 "⌃ 는 전부 터미널 것 + 예외 몇 개" 로 적었다. **그 목록은 태어날 때 이미
// 낡아 있었다** — `⌘/⌃1..9`(프로젝트 직행)가 먼저 들어와 있었는데 "지금 ⌃ 앱 단축키는
// ⌃Tab 하나" 라고 적었다. `useShortcuts` 는 `metaKey || ctrlKey` 를 수식키로 보므로
// (`:79`) 윈도우·리눅스에서 그것들은 전부 ⌃ 조합이다.
//
// 그래서 **개수를 세지 않고 판정 근거를 쓴다.** 셸이 무엇을 받는지가 유일한 기준이고,
// 정본은 xterm 의 ctrl 분기다 (5.5.0 `evaluateKeyboardEvent`, `default:` 갈래):
//
// ```js
// keyCode 65..90  → ^A..^Z          // 글자: 진짜 바이트
// keyCode 32      → NUL             // space
// keyCode 51..55  → ESC,FS,GS,RS,US // 숫자 3~7
// keyCode 56      → DEL             // 숫자 8
// keyCode 219/220/221 → ESC,FS,GS   // [ \ ]
// // 그 밖의 ⌃조합은 **아무 바이트도 안 만든다**
// ```
//
// 여기서 나오는 판정 셋:
//   · `⌃A`~`⌃Z`·`⌃space`·`⌃[ \ ]` → 셸 것. 뺏으면 중단·단어 지우기 같은 것이 죽는다
//   · **`⌃1`·`⌃2`·`⌃9`·`⌃0` → 앱 것.** 매핑에 없어 셸이 아무것도 안 받는다.
//     `⌃3`~`⌃8` 은 진짜 바이트가 있으므로 셸에 남긴다 — 그래서 숫자를 통으로 못 넘긴다
//   · `⌃↑`/`⌃↓`/`⌃Tab` → 앱 것 (근거는 아래 각 줄)
//
// **새 ⌃ 단축키를 더할 때 이 목록을 세지 말고 위 표를 봐라.** 셸이 못 받는 조합이면
// 앱 것이고, 받는 조합이면 뺏는 대가가 있다.
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
// **⌃⇧Tab(이전 탭)도 같이 나간다** — `ctrlKey` 만 보고 `shiftKey` 는 안 본다. 근거가 같다:
// 위 `case 9` 는 shift 가 있으면 `ESC[Z` 를 내는데 그건 **맨 ⇧Tab 과 같은 바이트**라
// 셸이 역시 구분하지 못한다. 앱은 `useShortcuts.ts:85` 에서 둘을 다음/이전으로 갈라 쓰므로,
// 여기서 `!shiftKey` 를 더하면 **칸 안에서 이전 탭만 조용히 죽는다.**
//
// **맨 ⇧Tab 은 같이 빼지 않는다.** ⌃ 가 없으면 위 두 번째 줄에서 걸러져 셸로 간다 —
// `ESC[Z` 는 터미널에서 실제로 뜻이 있고, 앱 쪽 ⇧Tab 은 입력창 안에서만 쓴다
// (`PermissionModeSwitch`). 세 줄이 나란히 있어 한 덩어리로 보이지만 근거가 갈린다.

/**
 * 판정에 필요한 것만. 진짜 KeyboardEvent 없이도 시험할 수 있게 좁혀 뒀다.
 *
 * **`shiftKey` 를 일부러 안 받는다.** 받아 두면 언젠가 `!shiftKey` 를 더하고 싶어지는데,
 * 그러면 ⌃⇧Tab(이전 탭)이 칸 안에서만 죽는다 (머리말). 없는 필드는 못 본다.
 */
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
  // 윈도우·리눅스엔 ⌘ 가 없다. 안 빼면 **칸을 접을 길이 아예 사라진다.**
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') return true
  // ⌃Tab·⌃⇧Tab 이 셸에 주는 바이트는 맨 Tab·맨 ⇧Tab 과 **같아서** 구별되지 않는다
  if (event.key === 'Tab') return true
  return isSilentCtrlDigit(event.key)
}

/**
 * ⌃+숫자 중 **셸이 아무 바이트도 못 받는** 것인가 (머리말의 xterm 표에서 바로 나온다).
 *
 * 열거가 아니라 **범위의 여집합**으로 쓴다 — `3`~`8` 만 매핑이 있으므로 나머지 숫자는
 * 전부 조용히 사라진다. 앱이 ⌘/⌃1..9 를 프로젝트 직행에 쓰므로(`useShortcuts`),
 * 이걸 안 빼면 윈도우·리눅스에서 칸에 포커스가 있는 동안 **1·2·9 번 프로젝트로 못 간다.**
 */
function isSilentCtrlDigit(key: string): boolean {
  if (key.length !== 1 || key < '0' || key > '9') return false
  return key < '3' || key > '8'
}

/**
 * 지금 셸 칸 안에서 누르고 있는가.
 *
 * `belongsToApp` 이 못 미치는 경로가 하나 있다 — **`useShortcuts` 의 Esc 는 캡처 단계**라
 * xterm 보다 **먼저** 돌고, 처리하면 `stopPropagation` 까지 해서 xterm 은 그 키를 보지도
 * 못한다. 즉 `attachCustomKeyEventHandler` 로는 표를 던질 수 없다.
 *
 * 그래서 Esc 만 이 판정으로 따로 가른다. `borrowed()` 의 열거가 보는 것은
 * `[role=menu/listbox/dialog]` 와 `HTMLInputElement` 뿐인데 xterm 의 숨은 입력 요소는
 * 어느 것도 아니다 — 그 주석이 스스로 *"이건 열거다, 화면을 덮는 표식이 새로 생기면
 * 여기도 늘어야 한다"* 고 적어 뒀고 **셸 칸이 그 새 표식이다.**
 *
 * 태그가 아니라 **컨테이너**로 가른다 (`PermissionModeSwitch` 의 `inComposer` 와 같은 방식) —
 * 칸의 포커스는 xterm 이 숨겨 둔 `<textarea>` 라 태그로는 입력창과 구별되지 않는다.
 */
export function inShellDrawer(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.drawer') !== null
}
