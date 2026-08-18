import { useEffect, useRef } from 'react'
import { useDismissOnOutside } from '../state/useDismiss'

// 파일 트리 우클릭 메뉴 — 만들기·이름변경·휴지통.
//
// **트리 안에 그리지 않는다.** 트리는 스크롤 칸 안이라 그 안에 두면 메뉴가 잘린다.
// 좌표로 받아 `position: fixed` 로 띄우고, 부르는 쪽이 칸 바깥에 건다 —
// 탭 우클릭 메뉴(`MainTabMenu`)가 같은 이유로 같은 모양이고, 껍데기 CSS 도 그것을 쓴다.
//
// **여기서는 아무것도 안 한다.** 무엇을 만들지·어떤 이름인지 묻는 것은 부르는 쪽이고,
// 이 파일은 「무엇을 골랐나」만 돌려준다. 되돌릴 수 없는 것(휴지통)을 이 안에서 바로
// 실행하면, 확인을 넣을 자리가 메뉴 안이 되어 메뉴가 대화상자를 아는 컴포넌트가 된다.

/** 고른 것. 대상 경로는 부르는 쪽이 이미 안다 */
export type FileTreeMenuPick = 'newFile' | 'newDir' | 'rename' | 'trash'

export interface FileTreeMenuProps {
  /** 화면 좌표 (contextmenu 이벤트의 clientX/Y) */
  x: number
  y: number
  /**
   * 대상이 폴더인가. **만들기의 뜻이 갈린다** — 폴더 위에서는 그 안에, 파일 위에서는
   * 그 파일이 든 폴더에 만든다. 문구를 바꾸지는 않는다: 어느 쪽이든 「새 파일」이 맞고,
   * 어디에 생기는지는 고른 줄이 이미 말하고 있다.
   */
  isDirectory: boolean
  onPick: (pick: FileTreeMenuPick) => void
  onDismiss: () => void
}

/** 순서는 만드는 것 → 고치는 것 → 버리는 것. 버리는 것이 맨 아래여야 손이 미끄러지지 않는다 */
const ITEMS: { pick: FileTreeMenuPick; label: string; danger?: boolean }[] = [
  { pick: 'newFile', label: '새 파일…' },
  { pick: 'newDir', label: '새 폴더…' },
  { pick: 'rename', label: '이름 변경…' },
  { pick: 'trash', label: '휴지통으로', danger: true },
]

export function FileTreeMenu({ x, y, isDirectory, onPick, onDismiss }: FileTreeMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  useDismissOnOutside(ref, onDismiss, true)

  // Esc 로도 닫는다 — 열어 놓고 아무것도 안 고르는 것이 흔한 경로다
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onDismiss])

  return (
    <div className="tab-menu" role="menu" ref={ref} style={{ left: x, top: y }} aria-label="파일 메뉴">
      {ITEMS.map((item) => (
        <button
          key={item.pick}
          type="button"
          role="menuitem"
          className={`tab-menu__item${item.danger === true ? ' tab-menu__item--danger' : ''}`}
          // 폴더 위에서 「새 …」 은 그 안에, 파일 위에서는 그 옆에 만든다. 둘 다 뜻이 있어
          // 잠그지 않는다 — 잠그면 파일을 고른 채로는 아무것도 못 만든다. 대신 파일을
          // 골랐을 때만 어디에 생기는지 말해 준다 (이름변경·휴지통은 대상이 분명하다).
          {...(!isDirectory && (item.pick === 'newFile' || item.pick === 'newDir')
            ? { title: '이 파일이 든 폴더에 만듭니다' }
            : {})}
          onClick={() => {
            onPick(item.pick)
            onDismiss()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
