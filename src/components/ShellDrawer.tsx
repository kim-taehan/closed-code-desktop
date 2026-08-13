import type { ShellDrawer as DrawerState } from '../state/useShellDrawer'
import type { ThemeChoice } from '../state/useTheme'
import { DrawerTerminal } from './DrawerTerminal'

// **입력창 아래, 화면 맨 밑**에 붙는 셸 칸 (⌘↓ 열기 / ⌘↑ 접기 / 위 테두리를 끌어 높이 조절).
//
// **접혀도 언마운트하지 않는다** — 숨기기만 한다. 내리면 xterm 이 사라져 그때까지 흘러간
// 화면이 통째로 날아간다. (서버 쪽 pty 는 그래도 살아 있지만, 다시 그리는 동안 깜빡인다.)
//
// 한 번도 편 적 없으면 아예 그리지 않는다 (`everOpened`) — 열어 본 적도 없는 프로젝트마다
// opencode 서버에 셸이 하나씩 도는 것은 낭비다.

interface Props {
  /**
   * 어느 프로젝트의 셸인가. 열린 프로젝트가 없으면 `null` 이고 칸도 없다.
   *
   * 공여(develop-desktop)는 프로젝트마다 칸을 하나씩 그려 두고 `projectActive` 로 갈랐지만,
   * 이 앱은 **활성 프로젝트의 화면만 렌더한다** — 그래서 그 구분이 늘 참이라 없앴다.
   * 여러 프로젝트를 동시에 그리게 되면 그때 되살릴 자리다.
   */
  projectId: string | null
  drawer: DrawerState
  theme: ThemeChoice
}

export function ShellDrawer({ projectId, drawer, theme }: Props): React.ReactElement | null {
  if (projectId === null || !drawer.everOpened) return null

  return (
    <div
      className={`drawer${drawer.open ? '' : ' drawer--off'}`}
      style={{ height: `${drawer.height}px` }}
    >
      {/* 1px 선은 정확히 겨냥하기 어렵다 — 띠는 얇게, hit 영역은 넓게 (사이드바와 같다) */}
      <div
        className={`drawer__grip${drawer.dragging ? ' drawer__grip--on' : ''}`}
        onMouseDown={drawer.startDrag}
        role="separator"
        aria-orientation="horizontal"
        aria-label="셸 칸 높이 조절"
        // 띠가 눈에 안 띄어 끌 수 있는 줄 모른다 — 손을 올리면 알려준다
        title="끌어서 높이 조절"
      />

      <div className="drawer__bar">
        <span className="drawer__title">셸</span>
        <span className="drawer__hint">⌘↑ 로 본문으로</span>
        <button type="button" className="drawer__close" onClick={drawer.close} title="셸 칸 접기">
          ⌄
        </button>
      </div>

      <div className="drawer__body">
        <DrawerTerminal
          projectId={projectId}
          active={drawer.open && drawer.focus === 'drawer'}
          theme={theme}
        />
      </div>
    </div>
  )
}
