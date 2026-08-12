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
// ## 축: ⌘ 는 앱 것, **⌃ 의 기본은 셸 것** — 잰 것만 앱으로 올린다
//
// 처음에는 "⌃ 는 전부 터미널 것 + 예외 몇 개" 로 적었고 **그 목록은 태어날 때 이미
// 낡아 있었다** — `⌘/⌃1..9`(프로젝트 직행)가 먼저 들어와 있었는데 "지금 ⌃ 앱 단축키는
// ⌃Tab 하나" 라고 적었다. `useShortcuts` 는 `metaKey || ctrlKey` 를 수식키로 보므로
// (`:81`) 윈도우·리눅스에서 그것들은 전부 ⌃ 조합이다. 그래서 개수 세기를 버렸다.
//
// ### 왜 축을 **뒤집지는** 않았나 (뒤집자는 제안이 있었다 — 되살리지 말 것)
//
// "셸이 바이트를 받는 조합만 터미널 것" 으로 기본을 앱에 두자는 안이 있었다. 그 안의
// 정본은 ctrl 표(`A~Z`·space·`3~8`)였는데 **그 표는 불완전하다.** xterm 은 그 표 말고도
// 바이트를 만든다 — 수식키 붙은 화살표가 그 증거다 (5.5.0 `case 37`):
//
// ```js
// case 37: if (e.metaKey) break
//          a ? (o.key = ESC+"[1;"+(a+1)+"D", …)   // ⌃← → ESC[1;5D — 셸의 단어 단위 이동
// ```
//
// **틀리는 방향이 다르다.** 기본이 셸이면 빠뜨렸을 때 앱 단축키가 칸에서 안 먹는다(성가심).
// 기본이 앱이면 빠뜨렸을 때 **셸 키를 뺏는다**(칸에서 셸을 못 쓴다). 우리가 xterm 이
// 바이트를 내는 조합을 다 알지 못하므로, **모르는 것은 셸에 남기는 쪽**을 고른다.
//
// ### 그래서 앱으로 올리는 것은 셋뿐이고 근거가 두 종류다
//
// | 무엇 | 근거 | 성격 |
// |---|---|---|
// | `⌃↑`·`⌃↓` | 윈도우·리눅스엔 ⌘ 가 없어, 안 빼면 **칸을 접을 길이 사라진다** | **구조적** — 드로어 자신의 키라 목록이 안 는다 |
// | `⌃Tab`·`⌃⇧Tab` | 셸이 받는 바이트가 맨 Tab·맨 ⇧Tab 과 **같다** | 키별 실측 |
// | `⌃` + 한 글자 중 표에 없는 것 | 셸이 **아무 바이트도 안 받는다** | 키별 실측을 **규칙**으로 (`isSilentCtrlChar`) |
//
// 셋째 줄이 목록이 아니라 규칙인 것이 요점이다 — `⌃,`·`⌃0`·`⌃1`·`⌃2`·`⌃9` 가 전부 여기서
// 나오고, 앱 단축키가 늘어도 안 낡는다. **둘을 한 `if` 에 섞지 않는다**: 섞으면 다음 사람이
// 어느 근거로 들어온 예외인지 못 가리고 거기서부터 목록이 자란다.
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
  // **기본은 셸이다.** 아래 셋만 앱으로 올린다 (머리말의 표).
  if (!event.ctrlKey) return false

  // ① 구조적 — 윈도우·리눅스엔 ⌘ 가 없다. 안 빼면 **칸을 접을 길이 아예 사라진다.**
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') return true
  // ② 키별 실측 — ⌃Tab·⌃⇧Tab 이 셸에 주는 바이트는 맨 Tab·맨 ⇧Tab 과 **같다**
  if (event.key === 'Tab') return true
  // ③ 키별 실측을 규칙으로 — 셸이 아무것도 못 받는 한 글자 키
  return isSilentCtrlChar(event.key)
}

/**
 * ⌃ + **한 글자** 중 셸이 아무 바이트도 못 받는 것인가.
 *
 * **여집합으로 쓰므로 앱 단축키가 늘어도 안 낡는다.** 대신 여집합은 **근거의 범위를 못
 * 넘는다** — 그래서 근거가 어디까지인지를 함께 적는다.
 *
 * ### 근거 ① plain ⌃ 갈래 (`ctrlKey && !shiftKey && !altKey && !metaKey`)
 *
 * ```js
 * keyCode 65..90      → ^A..^Z           // 글자
 * keyCode 32          → NUL              // space
 * keyCode 51..55      → ESC,FS,GS,RS,US  // 숫자 3~7
 * keyCode 56          → DEL              // 숫자 8
 * keyCode 219/220/221 → ESC,FS,GS        // [ \ ]
 * ```
 *
 * ### 근거 ② shift 가 섞이는 갈래 — **처음에 이걸 빠뜨려 구멍이 났다**
 *
 * 위 표는 plain ⌃ 일 때만 도는 갈래에서 떴다. shift 가 끼면 다른 갈래로 가는데 거기에도
 * ⌃ 처리가 있다 (5.5.0, 이 둘이 전부다):
 *
 * ```js
 * e.key && e.ctrlKey && ("_" === e.key && (o.key = US),   // ⌃⇧- → US  (readline undo)
 *                        "@" === e.key && (o.key = NUL))  // ⌃⇧2 → NUL (readline set-mark)
 * ```
 *
 * `DrawerKeyLike` 가 `shiftKey` 를 안 받으므로(⌃⇧Tab 을 살리려는 판단) 이 둘은 여기서
 * **한 글자 `_`·`@` 로만 보인다.** 제외에 안 넣으면 칸에서 undo·set-mark 가 앱으로 새고,
 * 앱에는 그 단축키가 없어 **아무 일도 안 일어난다** — "가끔 undo 가 안 먹는다" 로만 겪힌다.
 *
 * ### 근거 ③ `⌥` 가 섞이는 갈래 — **아직 안 덮었다 (알려진 범위 밖)**
 *
 * 갈래가 셋이다. 세 번째는 `⌥` 가 걸릴 때 도는데, 도달 조건이 플랫폼을 탄다:
 *
 * ```js
 * evaluateKeyboardEvent(e, applicationCursorKeys, isMac, macOptionIsMeta)  // 인자 순서
 * if (isMac && !macOptionIsMeta || !e.altKey || e.metaKey) { …② }
 * else { o.key = ESC + <문자> }                                            // ③
 * ```
 *
 * `macOptionIsMeta` 를 우리가 안 켜므로 **mac 에서는 ③ 이 아예 안 돈다** — `⌥⌃,` 는 ②
 * 로 가서 바이트가 없고, 앱이 가져가도 잃는 것이 없다. **Win/Linux 에서만** ③ 이 돌아
 * `ESC + ","` 를 낸다. `DrawerKeyLike` 가 `altKey` 를 안 받으니 여기서는 그냥 `,` 로 보이고
 * **앱이 가져간다.**
 *
 * **안 고쳤다.** mac 은 영향이 없고 Win/Linux 는 이 환경에서 **실행할 수 없다**(보고서의
 * `W-plat`). 실행 근거 없이 손대면 이번엔 반대 방향으로 틀릴 수 있다 — 지금은 `⌥⌃` 조합이
 * 드물어 손해가 작고, 실행이 되는 자리에서 함께 보는 편이 낫다.
 *
 * 고치게 되면 `DrawerKeyLike` 에 `altKey` 를 더하고 `altKey → false`(셸 것)다. 그때
 * **`shiftKey` 를 일부러 뺀 사유(⌃⇧Tab)가 `altKey` 에는 해당하지 않는다는 것**을 함께
 * 적어야 한다 — 안 그러면 다음 사람이 "왜 하나는 받고 하나는 안 받나" 에서 막힌다.
 *
 * ⚠️ **한 글자가 아니면 무조건 false(= 셸 것)다.** `ArrowLeft`·`Home`·`F1` 처럼 이름이 긴
 * 키는 위 갈래에 오지도 않고 **자기 `case` 에서 따로 바이트를 만든다** — `⌃←`/`⌃→` 가
 * `ESC[1;5D`/`ESC[1;5C`(단어 단위 이동)를 낸다. 그 목록을 우리가 다 알지 못하므로
 * 여기서는 아예 판단하지 않고 셸에 남긴다 (머리말 「왜 뒤집지 않았나」).
 *
 * 여기서 나오는 실제 이득: 윈도우·리눅스에서 칸에 포커스가 있어도 **⌃1·⌃2·⌃9**(프로젝트
 * 직행)와 **⌃,**(설정)가 먹는다. `⌃3`~`⌃8` 은 진짜 제어문자라 셸에 남는다 —
 * **1·2·9 만 되고 3~8 은 안 되는 비대칭은 여기서 나온다.** 우리가 고른 것이 아니다.
 */
function isSilentCtrlChar(key: string): boolean {
  if (key.length !== 1) return false
  // ① plain ⌃ 갈래
  if (key >= 'a' && key <= 'z') return false
  if (key >= 'A' && key <= 'Z') return false
  if (key === ' ') return false
  if (key >= '3' && key <= '8') return false
  if (key === '[' || key === '\\' || key === ']') return false
  // ② shift 가 섞이는 갈래 — `_`(US, undo) · `@`(NUL, set-mark)
  return key !== '_' && key !== '@'
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
