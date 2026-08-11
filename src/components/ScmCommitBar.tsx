import { useEffect, useRef, useState } from 'react'
import type { ScmCommitMenu } from '../state/useScmCommit'

// 변경사항 갈래의 아래 — 커밋바.
//
// 사이드바의 `GitCommitBox` 와 **다른 물건**이다. 여기는 `커밋 ▾` 메뉴(모두 담고 커밋 ·
// 커밋 후 푸시 · 합치기 · 커밋 취소)와 담긴 요약 줄이 붙는다. 사이드바 쪽은 좁아서
// 그것들이 들어가지 않는다 — 그래서 옮기지 않고 따로 뒀다.
//
// **채널이 있는 항목만 메뉴에 넣는다.** 넷 다 이미 선 채널이다 (`useScmCommit`).

interface MenuItem {
  label: string
  /** 눌렀을 때. 메시지가 필요한 항목은 지금 입력칸 내용을 받는다. */
  run: (message: string) => void
  /** 지금 쓸 수 없는 이유가 있으면 회색으로 둔다 (없는 기능이 아니라 지금 조건이 아니다) */
  disabled: boolean
}

export interface ScmCommitBarProps {
  /** 인덱스에 담긴 것이 있는지. 없으면 커밋할 게 없다. */
  hasStaged: boolean
  /** 담긴 파일 수 — 요약 줄 */
  stagedCount: number
  canPush: boolean
  busy: boolean
  onCommit: (message: string) => void
  onPush: () => void
  menu: ScmCommitMenu
}

export function ScmCommitBar(props: ScmCommitBarProps) {
  const [message, setMessage] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismissOnOutside(ref, () => setOpen(false), open)

  const written = message.trim()
  const canCommit = props.hasStaged && written !== '' && !props.busy

  function commit(): void {
    if (!canCommit) return
    props.onCommit(written)
    setMessage('')
  }

  const items: MenuItem[] = [
    { label: '모두 담고 커밋', run: props.menu.onCommitAll, disabled: written === '' || props.busy },
    { label: '커밋 후 푸시', run: props.menu.onCommitPush, disabled: !canCommit },
    { label: '마지막 커밋에 합치기', run: props.menu.onAmend, disabled: written === '' || props.busy },
    { label: '커밋 취소', run: () => props.menu.onUndoCommit(), disabled: props.busy },
  ]

  return (
    <div className="scm-commit">
      <textarea
        className="scm-commit__input"
        placeholder="커밋 메시지"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        // ⌘/Ctrl+↵ 로 커밋 — 줄바꿈과 커밋을 가른다 (`GitCommitBox` 와 같은 규칙)
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') commit()
        }}
        rows={3}
      />

      <div className="scm-commit__side">
        <div className="scm-commit__buttons" ref={ref}>
          <button
            type="button"
            className="scm-btn scm-btn--primary scm-commit__go"
            disabled={!canCommit}
            onClick={commit}
          >
            커밋
          </button>
          <button
            type="button"
            className="scm-btn scm-btn--primary scm-commit__more"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="커밋 방식 더 보기"
            onClick={() => setOpen((value) => !value)}
          >
            ▾
          </button>
          <button type="button" className="scm-btn" disabled={!props.canPush || props.busy} onClick={props.onPush}>
            푸시
          </button>

          {open && (
            <div className="scm-menu" role="menu">
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className="scm-menu__item"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false)
                    item.run(written)
                    // 커밋으로 이어지는 항목은 메시지를 비운다. 「커밋 취소」는 메시지를
                    // 쓰지 않으므로 쓰던 글을 지우지 않는다.
                    if (item.label !== '커밋 취소') setMessage('')
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="scm-commit__meta">
          담긴 파일 {props.stagedCount}개 · <span className="scm-kbd">⌘↵</span> 커밋
        </p>
      </div>
    </div>
  )
}

/** 바깥을 누르면 닫는다. 열려 있을 때만 듣는다 (`SidebarPanelSelect` 와 같은 관행). */
function useDismissOnOutside(
  ref: React.RefObject<HTMLElement | null>,
  onDismiss: () => void,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return

    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, onDismiss, active])
}
