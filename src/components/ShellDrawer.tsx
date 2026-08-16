import { PERMANENT_PANES, tabLabel } from '../state/drawerTabs'
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
//
// ## 탭 — **하나가 pty 하나다** (설계 2026-08-16 §1 A안)
//
// 안 보이는 탭도 **언마운트하지 않는다.** 접기와 같은 이유다: 뒤로 돌린 개발 서버 로그가
// 탭을 옮길 때마다 사라지면 이 기능의 무게중심(=보유)이 통째로 없어진다. 그래서 CSS 로만
// 숨기고, xterm 은 살려 둔다.
//
// 로그를 본문 탭이 아니라 여기 두는 근거는 설계 §1 에 있다 — 요지는 *로그는 정독이 아니라
// 곁눈질*이라 대화와 같이 보여야 하고, 본문 탭은 프로젝트를 옮기면 비워지는데(`useOpenFiles`)
// 프로세스는 살아 있어 "탭이 없어졌으니 서버도 죽은 줄" 로 읽힌다는 것이다.

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

      <div className="drawer__bar" role="tablist" aria-label="셸 칸 탭">
        {drawer.tabs.names.map((name) => (
          <span key={name} className={`drawer__tab${name === drawer.tabs.active ? ' drawer__tab--on' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={name === drawer.tabs.active}
              className="drawer__tabName"
              onClick={() => drawer.selectTab(name)}
            >
              {tabLabel(name)}
            </button>
            {/* 셸 칸에는 ✕ 가 없다 — 그건 드로어 자신이라 접는 것(⌘↑)과 다른 일이 아니다 */}
            {PERMANENT_PANES.includes(name) ? null : (
              <button
                type="button"
                className="drawer__tabClose"
                // 닫으면 **프로세스도 멈춘다.** 화면에서만 사라지면 띄운 개발 서버가 계속 돈다
                title={`${tabLabel(name)} 닫기 (프로세스도 멈춥니다)`}
                onClick={() => drawer.closeTab(name)}
              >
                ✕
              </button>
            )}
          </span>
        ))}
        <button type="button" className="drawer__tabAdd" onClick={drawer.addTab} title="셸 칸 추가">
          +
        </button>
        <span className="drawer__hint">⌘↑ 로 본문으로</span>
        <button type="button" className="drawer__close" onClick={drawer.close} title="셸 칸 접기">
          ⌄
        </button>
      </div>

      <div className="drawer__body">
        {drawer.tabs.names.map((name) => (
          <div
            key={name}
            className={`drawer__pane${name === drawer.tabs.active ? '' : ' drawer__pane--off'}`}
          >
            <DrawerTerminal
              projectId={projectId}
              name={name}
              // **고른 탭 하나만 키를 받는다.** 안 가르면 마운트된 터미널이 전부 focus() 를
              // 불러 마지막 것이 이기고, 사용자는 안 보이는 칸에 타이핑하게 된다.
              active={drawer.open && drawer.focus === 'drawer' && name === drawer.tabs.active}
              theme={theme}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
