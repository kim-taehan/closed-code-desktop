import type { DirEntryPayload } from '../../shared/ipc/channels'
import type { FileTreeApi } from '../state/useFileTree'
import { STATUS_LETTER, hasChangesUnder, type GitBadgeMap } from '../state/gitBadge'

// 사이드바 파일 트리.
//
// 펼친 디렉토리만 읽는다.
//
// 파일을 누르면 **연다**. 경로를 대화에 넣는 것은 옆의 ＠ 버튼이다 —
// 한 번의 누름에 두 뜻을 담으면 어느 쪽이 일어날지 예측할 수 없다.

export interface FileTreeProps {
  tree: FileTreeApi
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

  if (root === undefined) {
    return <div className="dc-tree__empty">읽는 중…</div>
  }
  if (root.length === 0) {
    return <div className="dc-tree__empty">파일이 없습니다</div>
  }

  return (
    <div className="dc-tree" role="tree" aria-label="파일 트리">
      <Level entries={root} depth={0} {...props} />
    </div>
  )
}

function Level({
  entries,
  depth,
  ...rest
}: {
  entries: DirEntryPayload[]
  depth: number
} & FileTreeProps) {
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
}: {
  entry: DirEntryPayload
  depth: number
} & FileTreeProps) {
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
        className={`dc-tree__row${entry.isDirectory ? ' dc-tree__row--dir' : ''}`}
        style={{ paddingLeft: `${6 + depth * 12}px` }}
        title={entry.path}
        onClick={() => (entry.isDirectory ? tree.toggle(entry.path) : onOpenFile(entry.path))}
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
