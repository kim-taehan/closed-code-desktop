import { useCallback, useEffect, useRef, useState } from 'react'

// 본문 밑에 붙는 셸 칸. 펴고 접고, 높이를 재고, 어디에 포커스가 갈지를 쥔다.
//
// **앱 전체가 하나를 나눠 쓴다.** 프로젝트마다 다르면 탭을 옮길 때마다 본문 높이가
// 튄다 — 사이드바 폭이 앱 하나인 것과 같은 이유다 (`useSidebarWidth`). 칸 자체는
// 프로젝트마다 그려지고 여기서 정하는 것은 "펴져 있는가·얼마나·어디를 보는가" 뿐이다.
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
  /** ⌘↓ — 셸로 내려간다. 접혀 있으면 펴면서 간다. */
  goDown: () => void
  /** ⌘↑ — 본문으로 올라오면서 **접는다**. 칸은 내려가 있는 동안만 보인다. */
  goUp: () => void
  /** 접는다. 포커스는 본문으로 돌려준다 — 안 보이는 칸이 키를 쥐고 있으면 안 된다. */
  close: () => void
  startDrag: (event: React.MouseEvent) => void
  dragging: boolean
}

export function useShellDrawer(): ShellDrawer {
  // **켤 때는 언제나 접혀 있다.** 지난번 상태를 복원하지 않는다 — 앱을 켜면 먼저 보고
  // 싶은 것은 대화지 지난번에 열어 둔 셸이 아니다. ⌘↓ 한 번이면 펴진다.
  const [open, setOpen] = useState(false)
  const [height, setHeight] = useState(loadHeight)
  const [focus, setFocus] = useState<'main' | 'drawer'>('main')
  const [dragging, setDragging] = useState(false)
  const [everOpened, setEverOpened] = useState(false)
  // 드래그 중 상태 갱신마다 리스너를 다시 걸지 않으려고 ref 로 최신 높이를 든다
  const latest = useRef(height)

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

  return { open, height, everOpened, focus, goDown, goUp, close, startDrag, dragging }
}

function clamp(value: number): number {
  return Math.max(MIN, Math.min(MAX, value))
}

/** 모르는 값은 기본값으로 돌린다 */
function loadHeight(): number {
  const raw = Number(localStorage.getItem(KEY))
  return Number.isFinite(raw) && raw > 0 ? clamp(raw) : DEFAULT
}
