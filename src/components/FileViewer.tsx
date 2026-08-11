import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import type { EditorSelection } from '../state/editorContext'
import type { OpenFile } from '../state/useOpenFiles'
import { CodeEditor } from './CodeEditor'

// 파일 내용 뷰어.
//
// **연 순간부터 바로 고칠 수 있다** — 편집 모드도, 저장 버튼도 없다.
// 타이핑이 멈추면 알아서 저장한다 (useOpenFiles). 연 뒤 파일이 그 사이 바뀌었으면
// (에이전트도 같은 파일을 고친다) 덮지 않고 알린다 — 판단은 mtime 이 한다.
//
// 마크다운만 미리보기와 원문을 오갈 수 있다. 미리보기는 읽기 전용이고,
// 원문으로 넘기면 다른 파일과 똑같이 고칠 수 있다.

export interface FileViewerProps {
  file: OpenFile
  onEdit: (path: string, draft: string) => void
  /** 편집기에서 포커스가 빠질 때. 기다리지 않고 바로 저장한다. */
  onFlush: (path: string) => void
  /** 편집기에서 고른 범위 (1-based 라인, 빈 선택이면 null). 채팅 컨텍스트로 나간다. */
  onSelection?: (path: string, range: EditorSelection | null) => void
}

export function FileViewer({ file, onEdit, onFlush, onSelection }: FileViewerProps) {
  // 마크다운은 원문과 미리보기 중에 고를 수 있다. 기본은 미리보기 —
  // 문서를 열었으면 읽으려는 것이지 문법을 보려는 게 아니다.
  const [preview, setPreview] = useState(true)
  const markdown = isMarkdown(file.path)

  // 변경 위치로 열었으면(턴 리뷰) 원문으로 넘어간다 — 미리보기에는 줄 개념이 없어 갈 곳이 없다.
  // 한 번 밀어줄 뿐이라 그 뒤 미리보기 버튼은 평소대로 먹는다.
  useEffect(() => {
    if (file.revealLine !== undefined) setPreview(false)
  }, [file.path, file.revealLine])

  if (file.error !== undefined) {
    return <div className="dc-viewer__error">{file.error}</div>
  }

  // 편집 중인 내용이 있으면 그걸 보여준다 (아직 디스크에 안 닿았어도)
  const shown = file.draft ?? file.text
  const lines = shown.split('\n').length

  return (
    <div className="dc-viewer">
      <div className="dc-viewer__modes">
        <span className="dc-viewer__lines">{lines.toLocaleString()}줄</span>
        {markdown && (
          <button
            type="button"
            aria-pressed={preview}
            className={`dc-viewer__mode${preview ? ' dc-viewer__mode--on' : ''}`}
            onClick={() => setPreview(true)}
          >
            미리보기
          </button>
        )}
        {markdown && (
          <button
            type="button"
            aria-pressed={!preview}
            className={`dc-viewer__mode${preview ? '' : ' dc-viewer__mode--on'}`}
            onClick={() => setPreview(false)}
          >
            원문
          </button>
        )}
      </div>

      {markdown && preview ? (
        <div className="dc-viewer__md">
          <Markdown rehypePlugins={[[rehypeHighlight, { detect: true }]]} remarkPlugins={[remarkGfm]}>
            {shown}
          </Markdown>
        </div>
      ) : (
        // key 로 파일마다 편집기를 새로 세운다 — 탭을 옮겼는데 되돌리기 기록이 남아 있으면
        // 다른 파일의 편집이 이 파일에 되살아난다.
        <CodeEditor
          key={file.path}
          path={file.path}
          value={shown}
          onChange={(next) => onEdit(file.path, next)}
          onBlur={() => onFlush(file.path)}
          onSelectionChange={(range) => onSelection?.(file.path, range)}
          {...(file.revealLine !== undefined ? { revealLine: file.revealLine } : {})}
        />
      )}
    </div>
  )
}

function isMarkdown(path: string): boolean {
  const extension = path.split('.').pop()?.toLowerCase()
  return extension === 'md' || extension === 'markdown'
}
