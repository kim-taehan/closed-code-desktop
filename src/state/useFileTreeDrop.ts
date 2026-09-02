import { useState, type DragEvent } from 'react'

// 내부 파일 트리에서 파일을 끌어 입력창에 놓는 길. OS 외부 파일 드롭
// (`useFileDrop`)과 **다른 통로**다 — 저쪽은 `dataTransfer.files` 로 OS File
// 객체를 읽고 main 이 경로를 풀어 줌, 이쪽은 `dataTransfer` 의 `text/plain` 에
// 이미 상대경로가 들어 있어 main 경유가 불필요하다.
//
// 목적이 다르다 — OS 드롭은 첨부(attachments)로 가고, 트리 드롭은 입력창에
// 텍스트로 insert 한다. 두 통로를 한 훅으로 합치면 목적을 보는 분기가 생겨
// 첨부 규칙이 두 벌이 되는 것과 같은 범위를 지킨다.

export interface FileTreeDrop {
  /** 지금 내부 파일을 끌고 들어와 있는가 (테두리 표시용 — `useFileDrop` 과 같다) */
  over: boolean
  /** 대상 요소에 그대로 펼친다 */
  handlers: {
    onDragOver: (event: DragEvent) => void
    onDragLeave: () => void
    onDrop: (event: DragEvent) => void
  }
}

export function useFileTreeDrop(onInsertPath: (path: string) => void): FileTreeDrop {
  const [over, setOver] = useState(false)

  return {
    over,
    handlers: {
      onDragOver: (event) => {
        // 내부 트리의 드래그만 허용. OS File 객체가 포함된 드래그는
        // `useFileDrop` 이 담당이므로 여기선 무시한다.
        if (!event.dataTransfer.types.includes('text/plain')) return
        event.preventDefault()
        setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (event) => {
        event.preventDefault()
        setOver(false)
        const path = event.dataTransfer.getData('text/plain')
        if (path.length > 0) onInsertPath(path)
      },
    },
  }
}
