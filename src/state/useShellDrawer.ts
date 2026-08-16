import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addPane,
  initialTabs,
  openPane,
  removePane,
  selectPane,
  SHELL_PANE,
  type PaneTabs,
} from './drawerTabs'
import { usePaneExits, type PaneExits } from './usePaneExits'

// 본문 밑에 붙는 셸 칸. 펴고 접고, 높이를 재고, 어디에 포커스가 갈지를 쥔다.
//
// **펴짐·높이는 앱 전체가 하나를 나눠 쓴다.** 프로젝트마다 다르면 탭을 옮길 때마다 본문
// 높이가 튄다 — 사이드바 폭이 앱 하나인 것과 같은 이유다 (`useSidebarWidth`).
//
// **탭 목록만 프로젝트마다 따로다.** 칸 하나가 pty 하나이고 pty 는 프로젝트에 매여 있다
// (`electron/pty/ptyPool.ts`) — 앱 하나로 두면 A 에서 셸을 셋 열고 B 로 옮기는 순간
// B 의 서버에 셸 셋이 저절로 뜬다. 옮겼다 돌아오면 그대로인 것도 여기서 나온다
// (설계 §1 이 본문 탭을 버린 근거 그대로다).
//
// 공여(develop-desktop)는 이 값을 `ui.json`(`electron/ui/prefs.ts`)에 남겼다. 수용에는
// 그 레인이 아직 없어 **사이드바 폭과 같은 자리(localStorage)** 에 둔다 — 이 컴퓨터의
// 화면 취향일 뿐이라 설정 스토어를 거칠 이유가 없다.

const KEY = 'davis.shellDrawerHeight'
/** 이보다 낮으면 두 줄도 안 보인다 — 접은 것과 다를 바 없다 */
const MIN = 80
const MAX = 720
/**
 * 처음 펼 때 높이. 칸은 **입력창 아래 맨 밑**에 붙으므로 대화가 그만큼 밀린다 —
 * 셸은 곁눈질하는 자리고 주인공은 대화라, 여남은 줄만 보이게 잡는다.
 * 더 크게 쓰던 사람은 끌어 둔 값이 localStorage 에 남아 있어 그대로 복원된다.
 */
const DEFAULT = 160

export interface ShellDrawer {
  open: boolean
  /** 지금 그릴 높이. **접혀 있어도 기억한다** — 0 으로 저장하면 돌아갈 자리를 잃는다. */
  height: number
  /**
   * 한 번이라도 편 적 있는가.
   *
   * 편 적 없으면 셸을 아예 안 띄운다. 열어 본 적도 없는 프로젝트마다 opencode 서버에
   * pty 가 하나씩 도는 것은 낭비다.
   */
  everOpened: boolean
  /** 지금 키가 어디로 가야 하는가 */
  focus: 'main' | 'drawer'
  /** 이 프로젝트의 탭. 셸이 맨 앞이고 그 뒤로 사용자가 연 순서다 */
  tabs: PaneTabs
  /**
   * 끝난 칸의 종료 코드 (`usePaneExits`). 사이드바 「실행」 패널의 점이 이걸로 갈린다.
   *
   * **여기 있는 이유는 수명이다** — 이 훅은 앱이 사는 동안 마운트돼 있고, 종료 신호는
   * 사용자가 그 칸을 안 보고 있을 때도 온다.
   */
  exits: PaneExits
  /** 탭을 고른다. **포커스도 함께 내려간다** — 고른 칸이 키를 받아야 한다 */
  selectTab: (name: string) => void
  /** "+" — 셸 칸 하나를 더 연다 */
  addTab: () => void
  /** 탭의 ✕. **프로세스도 멈춘다** — main 이 pty 를 지운다 (`closeShellPane`) */
  closeTab: (name: string) => void
  /**
   * 셸 칸을 앞에 놓고 편다. `open_terminal`(MCP)이 쓰는 문이다 —
   * 채워 둔 명령이 들어가는 곳이 셸 칸이라(`drawerBridge.fill`), 다른 탭을 보고 있으면
   * 사용자는 채워진 줄을 못 본다.
   */
  showShell: () => void
  /**
   * 그 이름의 칸을 만들어(없으면) 앞에 놓고 편다. `run_project`(MCP)가 쓰는 문이다.
   *
   * **pty 는 이 호출보다 먼저 떠 있다** — main 이 띄우고 나서 알려 준다
   * (`electron/mcp/appWiring.ts`). 여기서 하는 일은 사용자에게 보이게 하는 것뿐이고,
   * 그게 곧 **멈출 수 있게 하는 것**이다 (탭의 ✕ 말고는 멈추는 문이 없다).
   */
  showPane: (name: string) => void
  /** ⌘↓ — 셸로 내려간다. 접혀 있으면 펴면서 간다. */
  goDown: () => void
  /** ⌘↑ — 본문으로 올라오면서 **접는다**. 칸은 내려가 있는 동안만 보인다. */
  goUp: () => void
  /** 접는다. 포커스는 본문으로 돌려준다 — 안 보이는 칸이 키를 쥐고 있으면 안 된다. */
  close: () => void
  startDrag: (event: React.MouseEvent) => void
  dragging: boolean
}

export function useShellDrawer(projectId: string | null): ShellDrawer {
  // **켤 때는 언제나 접혀 있다.** 지난번 상태를 복원하지 않는다 — 앱을 켜면 먼저 보고
  // 싶은 것은 대화지 지난번에 열어 둔 셸이 아니다. ⌘↓ 한 번이면 펴진다.
  const [open, setOpen] = useState(false)
  const [height, setHeight] = useState(loadHeight)
  const [focus, setFocus] = useState<'main' | 'drawer'>('main')
  const [dragging, setDragging] = useState(false)
  const [everOpened, setEverOpened] = useState(false)
  // 드래그 중 상태 갱신마다 리스너를 다시 걸지 않으려고 ref 로 최신 높이를 든다
  const latest = useRef(height)
  // 프로젝트마다 따로. 안 연 프로젝트는 키가 없고, 그때는 기본값(셸 하나)으로 읽는다 —
  // 미리 채워 넣지 않는다: 열어 본 적도 없는 프로젝트의 탭 상태를 들고 있을 이유가 없다.
  const [byProject, setByProject] = useState<Record<string, PaneTabs>>({})
  const tabs = (projectId === null ? undefined : byProject[projectId]) ?? initialTabs
  const exits = usePaneExits(projectId)

  /** 지금 프로젝트의 표만 갈아 끼운다. 프로젝트가 없으면 아무 일도 안 한다. */
  const update = useCallback(
    (change: (current: PaneTabs) => PaneTabs) => {
      if (projectId === null) return
      setByProject((all) => ({ ...all, [projectId]: change(all[projectId] ?? initialTabs) }))
    },
    [projectId],
  )

  const goDown = useCallback(() => {
    setOpen(true)
    setEverOpened(true)
    setFocus('drawer')
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setFocus('main')
  }, [])

  // ⌘↑ 와 ⌄ 는 같은 일이다 — 올라오면 칸은 접힌다.
  // **셸은 죽지 않는다.** opencode 쪽 pty 가 그대로 살아 있고 서버가 스크롤백을 든다
  // (`electron/pty/client.ts` 의 `cursor=0`), 그래서 다시 ⌘↓ 하면 그동안 흘러간 출력이
  // 그대로 돌아온다. 공여(앱이 죽으면 사라짐)보다 나은 자리다.
  const goUp = close

  const startDrag = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    setDragging(true)
  }, [])

  useEffect(() => {
    if (!dragging) return

    // 칸은 **화면 맨 아래**에 붙어 있으므로 바닥에서 커서까지의 거리가 곧 높이다.
    // 예전에는 칸 밑에 입력창이 하나 더 있어서 이 계산이 그 높이(약 110px)만큼 어긋났다 —
    // 손잡이를 잡고 끌면 커서보다 칸이 더 크게 자랐다. 자리를 내리면서 맞아떨어졌다.
    const onMove = (event: MouseEvent): void => {
      const next = clamp(window.innerHeight - event.clientY)
      latest.current = next
      setHeight(next)
    }
    // 끄는 동안이 아니라 손을 뗄 때 한 번만 쓴다
    const onUp = (): void => {
      setDragging(false)
      localStorage.setItem(KEY, String(latest.current))
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  // 접힌 채로는 끌 손잡이가 없다 — 접는 순간 드래그를 끊어 두지 않으면
  // 마우스를 떼는 자리에서 높이가 엉뚱하게 저장된다.
  useEffect(() => {
    if (!open) setDragging(false)
  }, [open])

  // 탭 조작은 전부 **고르면서 편다.** 탭을 눌렀는데 칸이 접혀 있거나 키가 본문으로 가면
  // 방금 고른 칸이 아무 반응도 안 한다.
  const selectTab = useCallback(
    (name: string) => {
      update((current) => selectPane(current, name))
      goDown()
    },
    [update, goDown],
  )

  const addTab = useCallback(() => {
    update(addPane)
    goDown()
  }, [update, goDown])

  /**
   * 탭을 닫는다. **프로세스도 멈춘다** — 화면에서만 사라지고 개발 서버가 계속 도는 것이
   * 이 자리의 실패 모양이다 (설계 §1 「화면이 지켜야 할 것」).
   *
   * 실패해도 탭은 닫는다: main 쪽 `close` 는 이미 없어진 pty 를 지우려는 경우를 삼키고,
   * 여기서 되돌리면 사용자는 안 닫히는 탭을 보게 된다.
   */
  const closeTab = useCallback(
    (name: string) => {
      if (projectId !== null) void window.davis.closeShellPane({ projectId, name })
      update((current) => removePane(current, name))
      // 지난번 종료 코드는 이제 사실이 아니다 — 탭이 없어졌으니 「멈춤」이고,
      // 안 지우면 다시 띄우기 전까지 빨간 점이 남는다
      exits.clear(name)
    },
    [projectId, update, exits],
  )

  const showShell = useCallback(() => selectTab(SHELL_PANE), [selectTab])

  const showPane = useCallback(
    (name: string) => {
      update((current) => openPane(current, name))
      // 방금 다시 띄운 것이라 지난번 종료는 지운다. **여기서 지우는 이유**는 이 문이
      // 띄우는 두 길(도구의 `run_project` · 사이드바의 ▶)이 모두 지나는 자리라서다 —
      // 각자 지우게 두면 한쪽을 빠뜨린 날 그 줄만 빨간 점으로 남는다.
      exits.clear(name)
      goDown()
    },
    [update, goDown, exits],
  )

  return {
    open,
    height,
    everOpened,
    focus,
    tabs,
    exits,
    goDown,
    goUp,
    close,
    startDrag,
    dragging,
    selectTab,
    addTab,
    closeTab,
    showShell,
    showPane,
  }
}

function clamp(value: number): number {
  return Math.max(MIN, Math.min(MAX, value))
}

/** 모르는 값은 기본값으로 돌린다 */
function loadHeight(): number {
  const raw = Number(localStorage.getItem(KEY))
  return Number.isFinite(raw) && raw > 0 ? clamp(raw) : DEFAULT
}
