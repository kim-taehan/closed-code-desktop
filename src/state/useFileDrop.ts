import { useState, type DragEvent } from 'react'

// 외부에서 입력창으로 파일을 끌어다 놓는 길. +버튼과 **같은 경로**로 붙인다 —
// 여기서 따로 처리하면 첨부 규칙이 두 벌이 된다.

export interface FileDrop {
  /** 지금 무언가를 끌고 들어와 있는가 (테두리 표시용) */
  over: boolean
  /** 대상 요소에 그대로 펼친다 */
  handlers: {
    onDragOver: (event: DragEvent) => void
    onDragLeave: () => void
    onDrop: (event: DragEvent) => void
  }
}

export function useFileDrop(addPaths: (paths: string[]) => void): FileDrop {
  const [over, setOver] = useState(false)

  return {
    over,
    handlers: {
      onDragOver: (event) => {
        event.preventDefault()
        setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (event) => {
        event.preventDefault()
        setOver(false)
        // 렌더러는 File 객체에서 경로를 직접 못 읽는다 — main 이 준 다리로 얻는다.
        const paths = Array.from(event.dataTransfer.files)
          .map((file) => window.davis.pathForFile(file))
          .filter((path) => path.length > 0)
        if (paths.length > 0) addPaths(paths)
      },
    },
  }
}
