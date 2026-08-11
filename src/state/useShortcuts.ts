import { useEffect } from 'react'

// 창 전체 단축키.
//
// **한곳에 모은다** — 여기저기 흩어지면 무엇이 등록돼 있는지 알 수 없고,
// 설정의 단축키 목록과도 어긋난다 (목록에 있는데 안 먹는 것이 가장 나쁘다).
//
// macOS 는 Cmd, 그 밖은 Ctrl 을 쓴다.

export interface ShortcutHandlers {
  onQuickOpen: () => void
  onSearch: () => void
  onNewChat: () => void
  onSettings: () => void
  /** ⌘/Ctrl+W — 활성 파일/로그 탭 닫기. 닫을 탭이 없으면 무시(창 닫기 금지, 사용자 결정). */
  onCloseTab: () => void
  /** Ctrl+Tab / Ctrl+Shift+Tab — 본문 탭 순환 (크롬 관례라 macOS 도 Ctrl 이다) */
  onNextTab: () => void
  onPrevTab: () => void
  /** ⌘/Ctrl + Alt + → / ← — 프로젝트 탭 전환 (크롬 macOS 탭 전환 조합) */
  onNextProject: () => void
  onPrevProject: () => void
  /** Esc — 응답 중단. 중단 버튼(TurnControls)이 이미 "응답 중단 (Esc)" 로 광고하는 그 키다. */
  onCancelTurn: () => void
  /** ⌘/Ctrl+Enter — 활성 턴 리뷰 전체 적용 */
  onAcceptReview: () => void
  /**
   * ⌘/Ctrl+L — 로그 탭 열기. **개발자 모드에서만 넘어온다.**
   *
   * 있고 없고가 곧 등록 여부다 — ⚙ 메뉴의 「로그 보기」 항목과 설정의 단축키 행이
   * 같은 `developerMode` 하나로 움직인다. 보이는 것과 먹는 것이 갈리면 안 된다.
   */
  onLogs?: () => void
}

/**
 * 지금 이 키가 누구 것인가.
 *
 * Esc 하나를 둘(응답 중단·입력창 비우기)이 노린다. 임자를 여기서 가르고,
 * 우리 것이 아닐 때는 손대지 않아 원래 동작이 그대로 남게 한다.
 */
export interface ShortcutContext {
  /** 응답을 받는 중인가 */
  streaming: boolean
  /** 지금 ⌘Enter 로 적용할 수 있는 턴 리뷰가 있는가 (런타임이 허용한 액션 기준) */
  canAcceptReview: boolean
}

export function useShortcuts(
  handlers: ShortcutHandlers,
  enabled: boolean,
  context: ShortcutContext,
): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      // macOS 는 Cmd, 나머지는 Ctrl. 둘 다 받으면 다른 단축키와 부딪힌다
      const modifier = event.metaKey || event.ctrlKey
      if (!modifier) return

      const key = event.key.toLowerCase()

      // 크롬 관례: 탭 순환은 macOS 에서도 Ctrl (Cmd+Tab 은 OS 앱 전환이다)
      if (key === 'tab' && event.ctrlKey) {
        event.preventDefault()
        ;(event.shiftKey ? handlers.onPrevTab : handlers.onNextTab)()
        return
      }
      // 프로젝트 탭 전환. 본문 탭(Ctrl+Tab)과 층이 다르므로 키도 다르게 둔다.
      // Alt 를 함께 요구하는 이유: 맨 ⌘+←·→ 는 입력창에서 줄 처음/끝 이동이라
      // 뺏으면 타이핑이 망가진다. Alt 를 끼우면 어디서 눌러도 부딪히지 않는다.
      if ((key === 'arrowleft' || key === 'arrowright') && event.altKey) {
        event.preventDefault()
        ;(key === 'arrowright' ? handlers.onNextProject : handlers.onPrevProject)()
        return
      }
      if (key === 'w' && !event.shiftKey) {
        // 기본 메뉴의 Close Window 는 appMenu.ts 가 이미 뺐다 — 여기가 유일한 ⌘W 처리다
        event.preventDefault()
        handlers.onCloseTab()
        return
      }
      if (key === 'p' && !event.shiftKey) {
        event.preventDefault()
        handlers.onQuickOpen()
        return
      }
      if (key === 'f' && event.shiftKey) {
        event.preventDefault()
        handlers.onSearch()
        return
      }
      if (key === 'n' && !event.shiftKey) {
        event.preventDefault()
        handlers.onNewChat()
        return
      }
      // 핸들러가 없으면(개발자 모드 아님) 손대지 않는다 — 브라우저/OS 의 ⌘L 이 그대로 남는다
      if (key === 'l' && !event.shiftKey && handlers.onLogs) {
        event.preventDefault()
        handlers.onLogs()
        return
      }
      // macOS·VS Code 관례. 쉼표는 shift 여부를 따지지 않는다
      if (key === ',') {
        event.preventDefault()
        handlers.onSettings()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handlers, enabled])

  // Esc·⌘Enter 는 **캡처 단계**로 받는다.
  //
  // 위 리스너는 버블이라 입력창보다 늦게 돈다. 그런데 입력창은 Esc 를 두 번 눌러 비우고
  // (Composer.tsx:210) Enter 로 전송한다 — 버블로 받으면 "중단하려고 Esc 를 눌렀는데
  // 입력창까지 지워지는" 두 겹 발동을 막을 방법이 없다. 캡처로 먼저 잡아, **우리가 처리한
  // 경우에만** 전파를 끊는다. 처리하지 않으면 그대로 흘려보내 기존 동작이 그대로 남는다.
  useEffect(() => {
    if (!enabled) return

    const onCapture = (event: KeyboardEvent) => {
      const escape = event.key === 'Escape'
      const accept = event.key === 'Enter' && (event.metaKey || event.ctrlKey)
      if (!escape && !accept) return

      // 이 키를 이미 쓰고 있는 곳이 있으면 넘긴다 — 임자가 있으면 우리 것이 아니다.
      if (borrowed(event)) return

      if (accept) {
        if (!context.canAcceptReview) return
        stop(event)
        handlers.onAcceptReview()
        return
      }

      // Esc 가 하는 일은 **응답 중단 하나뿐이다.**
      //
      // 턴 리뷰 거절은 여기 걸지 않는다 (되살리지 말 것). vscode 를 근거로 넣었다가
      // 원본을 열어 보고 뺐다 — vscode 에는 **Esc 로 파일이 되돌아가는 경로가 없다**:
      //   · 키바인딩 5개 전부 `when: activeWebviewPanelId == 'davisDiffPopup'` 로
      //     전용 diff 패널 한정이다 (우리처럼 앱 전역이 아니다)
      //   · 웹뷰의 Esc 는 `DiffApp.tsx:381` → `handleClose()`, 그냥 닫기다
      //   · `davis.diff.reject` 명령은 주석 그대로 "now saves all changes" 라
      //     `_handleApplyAll()` 을 부른다 — 이름만 reject, 동작은 **적용**이다
      //     (`DiffPopupPanel.ts:342-344`)
      // 거절은 카드의 `거부` 버튼이 담당한다. 확인 절차 없는 파일 되돌림을 화면 전역의
      // Esc 에 거는 것은, 이 앱의 Esc 소비자가 10개를 넘는 이상 안전하게 만들 수 없다.
      if (!context.streaming) return
      stop(event)
      handlers.onCancelTurn()
    }

    window.addEventListener('keydown', onCapture, true)
    return () => window.removeEventListener('keydown', onCapture, true)
  }, [handlers, enabled, context])
}

/**
 * 이 키를 이미 쓰고 있는 화면 요소가 있는가.
 *
 * 우리는 window **캡처**라 전파 경로의 뒤쪽을 전부 막는다 — document 버블로 듣는
 * 드롭다운들(ComposerAdd·ModelSwitch·PermissionModeSwitch·ThemeSelect)과 React
 * onKeyDown 으로 듣는 팔레트·이름 편집이 전부 그 뒤쪽이다. 먼저 삼키면 그것들은 열린 채
 * 남고 엉뚱하게 턴이 끊긴다.
 *
 * **열려 있을 때만 DOM 에 있는 것**으로만 판정한다:
 * - `[role=menu]`·`[role=listbox]` — 드롭다운 6종과 슬래시·@멘션 팝업이 전부 이 둘이고,
 *   모두 `{open && …}` 안에서만 그려진다
 * - `[role=dialog]:not([data-interrupt])` — 모달 9종이 공유하는 표식. **Esc 를 안 듣는
 *   모달도 포함해야 한다** (`SkillPicker.tsx:34` 는 백드롭 클릭으로만 닫힌다). 화면을 덮고
 *   있는데 뒤에서 턴이 끊기면 안 되므로, 판정 기준은 "Esc 를 듣는가" 가 아니라 "덮고 있는가" 다.
 *
 *   **단 HIL 인터럽트(승인·질문·계획)는 뺀다** (`data-interrupt`, InterruptCards.tsx).
 *   그 셋은 "턴이 사용자를 기다리는" 상태라 성격이 반대다 — 턴은 멈춰 있고, `.dc-modal` 이
 *   `position:fixed; inset:0` 로 화면을 덮어 중단 버튼도 못 누른다. 여기서 Esc 까지 막으면
 *   **턴을 접을 길이 아예 없어진다** (승인에 "거부" 로 답하는 것은 도구 하나를 막는 것이지
 *   턴 중단이 아니다). 중단하면 `turn_ended` 가 큐를 통째로 비워 카드도 함께 정리된다
 *   (`turnGate.end` → `sessionSlice.ts` 의 `turn_ended`). 인터럽트 위에 다른 모달이 겹쳐 있으면
 *   그쪽이 `:not()` 에 걸려 임자가 되므로, 겹친 경우는 종전대로 막힌다.
 * - 편집 중인 `<input>` — 빠른 열기·검색·프로젝트 이름 편집이 Esc 로 닫힌다.
 *   입력창(Composer)은 `<textarea>` 라 여기 안 걸린다 — "스트리밍 중이면 두 번 눌러
 *   비우기보다 중단이 앞선다" 는 판정은 그대로 살아 있다.
 *
 * ⚠️ `[aria-expanded=true]` 로 판정하지 않는다. 트리의 열린 폴더(`FileTree.tsx:81`)와
 * 펼친 턴 헤더(`TurnHeader.tsx:61`)가 **평상시에** 참이라, 그걸 보면 Esc 가 아예 안 먹는다.
 *
 * ⚠️ 이건 **열거**다 — 구조적 해결이 아니고, 화면을 덮는 표식이 새로 생기면 여기도 늘어야
 * 한다. 다만 Esc 에서 리뷰 거절을 뺀 뒤로 **빠뜨렸을 때의 최악이 "턴이 끊긴다" 로 내려왔다**
 * (전에는 확인 없는 파일 되돌림이었다). 되돌릴 수 있는 손해라 열거로 감당 가능한 구조다 —
 * 파괴적 동작을 다시 이 키에 걸면 그 전제가 깨진다.
 */
function borrowed(event: KeyboardEvent): boolean {
  const owner = '[role="menu"],[role="listbox"],[role="dialog"]:not([data-interrupt])'
  if (document.querySelector(owner) !== null) return true
  return event.target instanceof HTMLInputElement
}

/** 이 키는 우리가 처리했다 — 입력창·팝업까지 내려가지 않게 막는다 */
function stop(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
}
