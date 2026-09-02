import { useRef, useState } from 'react'
import type { DirEntryPayload } from '../../shared/ipc/channels'
import type { FileTreeApi } from '../state/useFileTree'
import { STATUS_LETTER, hasChangesUnder, type GitBadgeMap } from '../state/gitBadge'
import { treeKeyAction, visibleRows } from '../state/fileTreeKeys'

// 사이드바 파일 트리.
//
// 펼친 디렉토리만 읽는다.
//
// 파일을 누르면 **연다**. 경로를 대화에 넣는 것은 옆의 ＠ 버튼이다 —
// 한 번의 누름에 두 뜻을 담으면 어느 쪽이 일어날지 예측할 수 없다.
//
// **화살표로 다닌다** (IntelliJ 프로젝트 창과 같은 규칙 — `state/fileTreeKeys.ts`).
// 초점은 트리 전체에서 **한 줄만** 갖는다(roving tabindex): 줄마다 tab 이 서면
// 903줄짜리 트리에서 Tab 한 번에 사이드바를 못 빠져나간다.

export interface FileTreeProps {
  tree: FileTreeApi
  /**
   * 우클릭. 화면 좌표를 함께 준다 — 메뉴는 트리 **바깥**에 떠야 한다 (스크롤 칸 안에
   * 그리면 잘린다). 안 주면 브라우저 기본 메뉴가 그대로 뜬다.
   */
  onContextMenu?: (path: string, isDirectory: boolean, x: number, y: number) => void
  /** 뷰어로 연다 */
  onOpenFile: (path: string) => void
  /** 경로를 입력창에 넣는다 */
  onPickFile: (path: string) => void
  /**
   * 경로 → git 상태. **트리는 git 을 직접 부르지 않는다** — 트리가 IPC 를 알면
   * 트리 테스트마다 git 이 필요해진다. 없으면 배지 없이 전과 똑같이 그린다.
   */
  badges?: GitBadgeMap
}

export function FileTree(props: FileTreeProps) {
  const { tree } = props
  const root = tree.children['']
  const host = useRef<HTMLDivElement>(null)
  // 초점을 가진 줄. `null` 이면 첫 줄이 tab 자리를 갖는다 — Tab 으로 트리에 들어오면 맨 위다.
  const [active, setActive] = useState<string | null>(null)

  /**
   * 옮겨 간 줄에 **초점을 직접 준다.** 상태만 바꾸면 tabindex 만 옮겨 갈 뿐 키보드는
   * 그 자리에 남아, 다음 화살표가 옛 줄에서 다시 계산된다.
   *
   * 이미 그려져 있는 줄로만 옮기므로(보이는 줄 목록에서 골랐다) 여기서 찾으면 늘 있다.
   *
   * **선택자로 찾지 않는다.** 경로에는 따옴표·괄호·공백이 들어오고, 그걸 담으려면
   * `CSS.escape` 가 필요한데 그 함수는 브라우저에만 있다 — jsdom 에서 터진다(실측).
   * 값을 직접 비교하면 이스케이프할 것이 없다.
   */
  const focus = (path: string) => {
    setActive(path)
    const rows = host.current?.querySelectorAll<HTMLElement>('[data-tree-path]') ?? []
    for (const row of rows) {
      if (row.dataset['treePath'] === path) {
        row.focus()
        return
      }
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // 조합키가 끼면 우리 것이 아니다 — ⌘↑/⌘↓ 는 셸 칸, ⌥→ 는 낱말 이동이다
    if (event.metaKey || event.ctrlKey || event.altKey) return

    const rows = visibleRows(tree.children, tree.expanded)
    const action = treeKeyAction(rows, active, event.key)
    if (action === null) return
    // **여기서만 삼킨다.** 위에서 `null` 을 받은 키는 그대로 흘려보낸다 — 다 막으면
    // 트리 안에서 Tab 도 글자 입력도 죽는다.
    event.preventDefault()

    if (action.kind === 'move') return focus(action.path)
    if (action.kind === 'open') return props.onOpenFile(action.path)
    // 펼치기/접기는 한쪽으로만 간다. 이미 그 상태면 아무 일도 안 한다 —
    // 방향키가 반대로 도는 것을 막는 자리다 (`fileTreeKeys.ts` 의 `TreeKeyAction`).
    if (action.kind === 'expand' && tree.expanded.has(action.path)) return
    if (action.kind === 'collapse' && !tree.expanded.has(action.path)) return
    setActive(action.path)
    tree.toggle(action.path)
  }

  if (root === undefined) {
    return <div className="dc-tree__empty">읽는 중…</div>
  }
  if (root.length === 0) {
    return <div className="dc-tree__empty">파일이 없습니다</div>
  }

  return (
    <div className="dc-tree" role="tree" aria-label="파일 트리" ref={host} onKeyDown={onKeyDown}>
      <Level entries={root} depth={0} active={active ?? root[0]?.path ?? null} onFocusRow={setActive} {...props} />
    </div>
  )
}

/** 초점 자리를 아래로 나르는 것들. 그리기 인자와 섞이지 않게 따로 둔다. */
interface FocusProps {
  /** tab 자리를 가진 한 줄. 나머지는 `-1` 이라 Tab 이 건너뛴다 */
  active: string | null
  /** 마우스로 누른 줄도 초점 자리가 된다 — 그다음 화살표가 거기서 이어져야 한다 */
  onFocusRow: (path: string) => void
}

function Level({
  entries,
  depth,
  ...rest
}: {
  entries: DirEntryPayload[]
  depth: number
} & FileTreeProps &
  FocusProps) {
  return (
    <>
      {entries.map((entry) => (
        <Node key={entry.path} entry={entry} depth={depth} {...rest} />
      ))}
    </>
  )
}

function Node({
  entry,
  depth,
  tree,
  onOpenFile,
  onPickFile,
  badges,
  active,
  onFocusRow,
  onContextMenu,
}: {
  entry: DirEntryPayload
  depth: number
} & FileTreeProps &
  FocusProps) {
  const open = tree.expanded.has(entry.path)
  const loading = tree.loading.has(entry.path)
  const children = tree.children[entry.path]

  return (
    <>
      <div className="dc-tree__line">
      <button
        type="button"
        role="treeitem"
        aria-expanded={entry.isDirectory ? open : undefined}
        // 화면낭독기가 「몇 번째 / 몇 단계」를 읽으려면 깊이가 필요하다. 형제 번호는
        // 안 준다 — 그러려면 부모의 자식 수를 여기서 알아야 하고, 안 읽힌 폴더는 그 수가 없다.
        aria-level={depth + 1}
        // 화살표로 옮겨 갈 때 찾는 표. 고르는 쪽은 선택자가 아니라 값을 직접 비교한다
        // (위 `focus` — 경로에 따옴표·괄호가 들어와도 이스케이프할 것이 없다).
        data-tree-path={entry.path}
        // **초점은 한 줄만.** 나머지는 -1 이라 Tab 이 건너뛴다 (roving tabindex)
        tabIndex={active === entry.path ? 0 : -1}
        className={`dc-tree__row${entry.isDirectory ? ' dc-tree__row--dir' : ''}`}
        style={{ paddingLeft: `${6 + depth * 12}px` }}
        title={entry.path}
        // 마우스로 짚은 줄에서 화살표가 이어져야 한다 — 안 그러면 옛 줄에서 다시 센다
        onFocus={() => onFocusRow(entry.path)}
        onContextMenu={(event) => {
          if (onContextMenu === undefined) return
          // 브라우저 기본 메뉴를 막는다 — 둘이 겹쳐 뜨면 우리 것이 뒤에 깔린다
          event.preventDefault()
          // 우클릭한 줄이 초점도 가져간다. 그래야 메뉴를 닫은 뒤 화살표가 거기서 이어진다
          onFocusRow(entry.path)
          onContextMenu(entry.path, entry.isDirectory, event.clientX, event.clientY)
        }}
        onClick={() => (entry.isDirectory ? tree.toggle(entry.path) : onOpenFile(entry.path))}
        draggable={!entry.isDirectory}
        onDragStart={(event) => {
          if (entry.isDirectory) return
          event.dataTransfer.setData('text/plain', entry.path)
          event.dataTransfer.effectAllowed = 'copy'
        }}
      >
        {/* 글자(▸)로 그리면 작은 크기에서 점처럼 뭉개진다 — CSS 로 그린다 */}
        <span
          className={`dc-tree__caret${entry.isDirectory ? ' dc-tree__caret--dir' : ''}${
            open ? ' dc-tree__caret--open' : ''
          }`}
          aria-hidden="true"
        />
        <span className="dc-tree__name">{entry.name}</span>
        {/* 배지는 row 버튼 **안**, 이름 다음이다. line 에 넣으면 ＠ 와 자리를 다퉈
            파일명이 먼저 잘린다. */}
        <Badge entry={entry} badges={badges} />
      </button>

      {!entry.isDirectory && (
        <button
          type="button"
          className="dc-tree__mention"
          title="대화에 경로 넣기"
          onClick={() => onPickFile(entry.path)}
        >
          ＠
        </button>
      )}
      </div>

      {/* 아직 안 읽혔으면 자리만 비운다 — 빈 폴더로 잘못 보이지 않게 */}
      {open && loading && children === undefined && (
        <div className="dc-tree__loading" style={{ paddingLeft: `${18 + depth * 12}px` }}>
          …
        </div>
      )}
      {open && children !== undefined && (
        <Level
          entries={children}
          depth={depth + 1}
          tree={tree}
          onOpenFile={onOpenFile}
          onPickFile={onPickFile}
          badges={badges}
          active={active}
          onFocusRow={onFocusRow}
          {...(onContextMenu ? { onContextMenu } : {})}
        />
      )}
    </>
  )
}

/**
 * 파일은 상태 글자, 폴더는 점 하나.
 *
 * 폴더에 개수를 적지 않는 이유는 트리가 **펼친 곳만** 읽기 때문이다.
 * 안 펼친 폴더의 정확한 수를 알 수 없는데 수를 적으면 틀린 값이 보인다.
 */
function Badge({ entry, badges }: { entry: DirEntryPayload; badges?: GitBadgeMap }) {
  if (badges === undefined) return null

  if (entry.isDirectory) {
    return hasChangesUnder(badges, entry.path) ? (
      <span className="dc-tree__badge dc-tree__badge--dir" aria-hidden="true" />
    ) : null
  }

  const status = badges.get(entry.path)
  if (status === undefined) return null

  return (
    <span className={`dc-tree__badge dc-tree__badge--${status}`} title={status}>
      {STATUS_LETTER[status]}
    </span>
  )
}
