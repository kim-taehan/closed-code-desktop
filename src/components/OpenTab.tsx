import type { EditorSelection } from '../state/editorContext'
import type { OpenFile } from '../state/useOpenFiles'
import { FileViewer } from './FileViewer'
import { FileDiffView } from './FileDiffView'
import { ExtensionHtmlView } from './ExtensionHtmlView'

// 본문 탭 하나를 그린다. 파일 내용이거나 git diff 이거나 **확장 화면**이다.
//
// 어느 쪽인지는 `html`·`rows` 가 있는지로 갈린다. 탭 식별자 접두사로 판단하지 않는다 —
// 식별자는 탭을 구분하려고 있는 것이지 내용을 설명하는 자리가 아니다.

export interface OpenTabProps {
  file: OpenFile
  onEdit: (path: string, draft: string) => void
  onFlush: (path: string) => void
  /** 편집기에서 고른 범위. diff·확장 화면 탭은 편집기가 없어 나오지 않는다. */
  onSelection?: (path: string, range: EditorSelection | null) => void
  /** 확장 화면이 `data-open` 으로 요청한 파일 열기. 확장 화면 탭에서만 쓰인다. */
  onOpenPath?: (path: string, line?: number) => void
}

export function OpenTab({ file, onEdit, onFlush, onSelection, onOpenPath }: OpenTabProps) {
  // 확장 화면이 가장 먼저다 — 파일도 diff 도 아니고, **호스트는 내용을 모른다.**
  // 격리(iframe·CSP·링크 중계)는 `ExtensionHtmlView` 가 통째로 진다.
  if (file.html !== undefined) {
    return <ExtensionHtmlView html={file.html} onOpen={onOpenPath ?? (() => {})} />
  }

  if (file.rows === undefined)
    return (
      <FileViewer file={file} onEdit={onEdit} onFlush={onFlush} {...(onSelection ? { onSelection } : {})} />
    )

  if (file.error !== undefined) {
    return <div className="file-diff-note">{file.error}</div>
  }
  // 빈 화면이면 "변경이 없다" 로 오해한다
  if (file.rows.length === 0) {
    return <div className="file-diff-note">보여줄 변경이 없습니다</div>
  }

  return <FileDiffView rows={file.rows} />
}
