import { useEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal as Xterm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { ThemeChoice } from '../state/useTheme'

// 셸 드로어 안의 터미널.
//
// 공여(`develop-desktop/src/components/Terminal.tsx`, 235줄)의 축약본이다. 뺀 것 셋:
//   · 찾기(`@xterm/addon-search`·`TerminalFind`) — 드로어 범위 밖
//   · CLI 종류 구분(`kind`)·`resumeId` — 이 앱은 CLI 를 띄우지 않는다
//   · 죽은 뒤 Enter 로 되살리기 — 여기서는 ⌘↑ 로 접었다 ⌘↓ 로 다시 펴면 된다
//
// **셸은 opencode 서버가 굴린다.** 우리는 바이트를 나르기만 하고, WS 는 main 이 쥔다
// (`electron/pty/drawerBridge.ts` — 렌더러에서 열면 CSP 에 막힌다).

/**
 * 이보다 좁게 잡히면 잰 것이 아니라 못 잰 것이다.
 *
 * 접힌 드로어는 `display:none` 이라 잴 것이 없고, 펴는 순간에는 잠깐 0에 가까운 폭이
 * 잡힌다. 그 값을 pty 로 내보내면 셸이 글자마다 줄을 바꿔 출력하고, 폭을 되돌려도
 * **이미 흘러간 출력은 그 모양으로 남는다** — 스크롤백을 되돌릴 방법이 없다.
 */
const MIN_COLS = 20

/**
 * 지금 테마의 터미널 색. **CSS 변수에서 읽는다** — 팔레트를 두 벌 두면 테마를 하나
 * 고칠 때마다 여기도 같이 고쳐야 하고, 잊으면 터미널만 옛 색으로 남는다.
 */
function terminalColors(): { background: string; foreground: string } {
  const style = getComputedStyle(document.documentElement)
  const pick = (name: string, fallback: string): string => {
    const value = style.getPropertyValue(name).trim()
    return value === '' ? fallback : value
  }
  // 이름은 이 레포의 것(`--dc-*`)이다. 공여는 `--bg`/`--text` 였다 — 베끼면 늘 fallback 이 나가
  // 터미널만 테마를 안 따라간다 (화면에는 "색이 좀 다르네" 로만 보여 알아채기 어렵다).
  return { background: pick('--dc-bg', '#0d1117'), foreground: pick('--dc-text', '#e6edf3') }
}

/**
 * 이 키를 xterm 이 먹지 말고 창까지 올려보내야 하는가.
 *
 * macOS 의 갈래를 그대로 쓴다 — **⌘ 는 앱 것, ⌃ 는 터미널 것**이다. ⌃C 를 가로채면
 * 셸에서 돌던 것을 끊을 수 없고, ⌃W(단어 지우기)를 앱이 먹으면 탭이 닫힌다.
 * 예외는 ⌃↑/⌃↓ 하나다 — 윈도우·리눅스에는 ⌘ 가 없어 드로어를 접을 길이 사라진다.
 */
function belongsToApp(event: KeyboardEvent): boolean {
  if (event.metaKey) return true
  return event.ctrlKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')
}

interface Props {
  /** 프로젝트가 바뀌면 터미널을 새로 세운다 — 남의 프로젝트 스크롤백이 남으면 안 된다 */
  projectId: string
  /** 보고 있고 펴져 있는가. 숨은 칸이 키를 가져가면 안 된다. */
  active: boolean
  /** 값 자체는 안 쓰고 "바뀌었다" 는 신호로만 쓴다 — 색은 CSS 에서 읽는다 */
  theme: ThemeChoice
}

export function DrawerTerminal({ projectId, active, theme }: Props): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Xterm | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const xterm = new Xterm({
      convertEol: false,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: terminalColors(),
    })
    // false 를 주면 xterm 이 그 키를 처리하지 않고, preventDefault 도 안 해서
    // 이벤트가 window 까지 올라간다 (`useShortcuts` 가 거기서 듣는다).
    //
    // ⌘C 만은 여기서 끝낸다. 앱 메뉴의 복사는 **DOM 선택**만 보는데, 터미널의 선택은
    // xterm 이 자기가 그리는 것이라 DOM 에 없다 — 그래서 선택이 보이는데도 ⌘C 가
    // 빈손으로 돈다 (공여가 실측으로 겪은 자리). 고른 것이 없으면 그대로 넘긴다.
    xterm.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && event.metaKey && event.key.toLowerCase() === 'c' && xterm.hasSelection()) {
        // 실패해도 조용히 둔다 — 되는 길이 없던 자리라, 못 해도 지금보다 나빠지지 않는다
        void navigator.clipboard?.writeText(xterm.getSelection()).catch(() => {})
        return false
      }
      return !belongsToApp(event)
    })

    const fit = new FitAddon()
    xterm.loadAddon(fit)
    xterm.open(host)

    /** 잰 크기를 터미널과 pty 에 함께 맞춘다. **못 잴 형편이면 아무것도 안 한다** (MIN_COLS). */
    const applyFit = (): void => {
      const size = fit.proposeDimensions()
      if (size === undefined || Number.isNaN(size.cols) || size.cols < MIN_COLS) return
      xterm.resize(size.cols, size.rows)
      // 묶어 보내는 일은 main 이 한다 (`drawerBridge` 의 디바운스) — 여기서 또 묶으면 두 겹이 된다
      void window.davis.resizeShell({ rows: size.rows, cols: size.cols })
    }

    // **내 프로젝트 것만 받는다.** 겉봉을 벗기는 자리에서 거르지 않으면, 프로젝트를 옮기는
    // 순간 도착한 이전 프로젝트의 출력이 이 화면에 섞인다.
    const offData = window.davis.onShellData((payload, from) => {
      if (from === projectId) xterm.write(payload.chunk)
    })
    const offExit = window.davis.onShellExit((payload, from) => {
      if (from !== projectId) return
      const code = payload.exitCode === null ? '?' : String(payload.exitCode)
      xterm.writeln(`\r\n\x1b[90m[셸이 끝났습니다 — exit ${code}] · ⌘↑ 로 접었다 ⌘↓ 로 다시 여세요\x1b[0m`)
    })

    xterm.onData((data) => window.davis.sendShellInput({ data }))

    void window.davis.openShellDrawer().then((result) => {
      // 못 띄우면 빈 화면 대신 사유를 적는다 — 서버가 안 떠 있는 것이 가장 흔한 이유다
      if (!result.ok) xterm.writeln(`\x1b[31m${result.error ?? '셸을 띄우지 못했습니다'}\x1b[0m`)
      else applyFit()
    })

    const observer = new ResizeObserver(applyFit)
    observer.observe(host)
    xtermRef.current = xterm

    return () => {
      observer.disconnect()
      offData()
      offExit()
      // **셸은 죽이지 않는다** — 소켓만 접는다. 서버가 스크롤백을 들고 있어 다시 열면 돌아온다.
      window.davis.detachShellDrawer()
      xterm.dispose()
      xtermRef.current = null
    }
  }, [projectId])

  // 테마를 바꿔도 터미널은 다시 세우지 않는다 — 세우면 화면이 한 번 깜빡인다.
  // 색만 갈아 끼운다. data-theme 이 이미 바뀐 뒤라 CSS 에서 새 값이 읽힌다.
  useEffect(() => {
    const xterm = xtermRef.current
    if (xterm !== null) xterm.options.theme = terminalColors()
  }, [theme])

  useEffect(() => {
    if (active) xtermRef.current?.focus()
  }, [active])

  return <div className="drawer__term" ref={hostRef} />
}
