import { useRef, useState } from 'react'
import type { GitBranchEntry } from '../../shared/git/gitRefs'
import { useDismissOnOutside } from '../state/useDismiss'
import { ScmNameForm } from './ScmNameForm'

// 브랜치 칩 — 사이드바 맨 윗줄과 소스 관리 탭이 같은 모습을 쓴다.
//
// **캐럿(▾)은 메뉴를 받았을 때만 그린다** — 눌리지 않는 캐럿을 그려두면 "왜 안 열리지"
// 하는 잡음만 남는다.
//
// 사이드바(`GitPanel`)와 소스 관리 탭이 **둘 다 준다.** 1단계에 사이드바가 안 준 것은
// 전환·생성 채널이 없어서였는데, 3단계에서 채널이 생긴 뒤에도 되돌아오지 않아 칩이
// 눌리지 않는 채로 남아 있었다 (QA D6 — `useAppGit` 이 사이드바 몫을 만든다).

export interface GitBranchMenu {
  /** 옮겨 갈 수 있는 **로컬** 브랜치. 원격은 받아오기가 따로라 여기 넣지 않는다. */
  branches: GitBranchEntry[]
  busy: boolean
  onSwitch: (name: string) => void
  onCreate: (name: string) => void
}

export interface GitBranchChipProps {
  /** 분리된 HEAD 이거나 커밋이 하나도 없으면 null */
  branch: string | null
  /** 주지 않으면 누를 것을 그리지 않는다 (위 머리말) */
  menu?: GitBranchMenu
}

export function GitBranchChip({ branch, menu }: GitBranchChipProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  // 바깥 클릭 닫기는 `SidebarPanelSelect` 의 것을 그대로 쓴다 — 레포에 이미 여러 벌이 있어
  // 다섯 번째를 만들지 않는다 (걷어내는 일은 이 작업의 범위 밖이다).
  useDismissOnOutside(ref, () => setOpen(false), open)

  const name = <span className="git-chip__name">{branch ?? 'HEAD 분리됨'}</span>

  if (menu === undefined) {
    return (
      <span className="git-chip" title={branch ?? ''}>
        <Icon />
        {name}
      </span>
    )
  }

  return (
    <span className="git-chip git-chip--menu" ref={ref} title={branch ?? ''}>
      <button
        type="button"
        className="git-chip__toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon />
        {name}
        <span className="git-chip__caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="scm-branch-menu" role="menu">
          {/* 지금 있는 브랜치는 옮길 곳이 아니다 */}
          {menu.branches.filter((entry) => !entry.current).length === 0 ? (
            <p className="scm-branch-menu__empty">옮겨 갈 브랜치가 없습니다.</p>
          ) : (
            menu.branches
              .filter((entry) => !entry.current)
              .map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  role="menuitem"
                  className="scm-menu__item"
                  disabled={menu.busy}
                  onClick={() => {
                    menu.onSwitch(entry.name)
                    setOpen(false)
                  }}
                >
                  {entry.name}
                </button>
              ))
          )}

          <div className="scm-branch-menu__foot">
            <ScmNameForm
              label="+ 새 브랜치"
              placeholder="새 브랜치 이름"
              onSubmit={(value) => {
                menu.onCreate(value)
                setOpen(false)
              }}
            />
          </div>
        </div>
      )}
    </span>
  )
}

function Icon() {
  return (
    <span className="git-chip__icon" aria-hidden="true">
      ⎇
    </span>
  )
}
