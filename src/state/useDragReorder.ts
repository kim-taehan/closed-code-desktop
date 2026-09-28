import { useState, type DragEvent } from 'react'

// 탭 줄 하나의 끌어 옮기기 상태. 탭 줄마다 **따로** 부른다 —
// 끄는 중인 id 를 줄 안에만 두므로, 다른 줄(프로젝트 칩 ↔ 파일 탭)에서 끌려온 것은
// `dragging` 이 비어 있어 놓을 자리로 받지 않는다.
//
// 끄는 id 를 `dataTransfer` 에 싣지 않는다. 실으면 대화 입력창 같은 다른 놓을 자리가
// 그 글자를 받아 붙이고, jsdom 에는 `DataTransfer` 가 없어 시험이 헛초록이 된다.

export interface DragReorder {
  /** 끄는 중인 탭 */
  dragging: string | null
  /** 지금 커서 아래의 놓을 자리 */
  over: string | null
  /** 끌 수 있는 탭에 펼쳐 붙인다. `enabled` 가 false 면 끌리지도 받지도 않는다 */
  handlersFor: (id: string, enabled?: boolean) => DragHandlers
}

export interface DragHandlers {
  draggable: boolean
  onDragStart?: (event: DragEvent) => void
  onDragOver?: (event: DragEvent) => void
  onDrop?: (event: DragEvent) => void
  onDragEnd?: () => void
}

export function useDragReorder(onMove: (from: string, to: string) => void): DragReorder {
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const reset = (): void => {
    setDragging(null)
    setOver(null)
  }

  const handlersFor = (id: string, enabled = true): DragHandlers => {
    if (!enabled) return { draggable: false }
    return {
      draggable: true,
      onDragStart: (event) => {
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
        setDragging(id)
      },
      onDragOver: (event) => {
        if (dragging === null) return
        // 막지 않으면 브라우저가 놓기를 허락하지 않는다
        event.preventDefault()
        if (over !== id) setOver(id)
      },
      onDrop: (event) => {
        if (dragging === null) return
        event.preventDefault()
        if (dragging !== id) onMove(dragging, id)
        reset()
      },
      onDragEnd: reset,
    }
  }

  return { dragging, over, handlersFor }
}
