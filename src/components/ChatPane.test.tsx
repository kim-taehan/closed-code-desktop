// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createRef } from 'react'
import { ChatPane } from './ChatPane'
import { EMPTY_SLICE, type SessionSlice } from '../state/sessionSlice'
import type { MouseGestureApi } from '../state/useMouseGesture'

// 전송 직후의 낙관 「응답 중」이 진행 표시로도 이어지는가 (useOptimisticBusy 공유).
//
// isStreaming(=turn_started 수신)만 보던 시절에는 전송 후 첫 이벤트까지 화면이
// 조용했다 — LLM 이 느리면 그 공백이 수 초라 멈춘 것처럼 보였다 (사용자 지적, 2026-08-26).

afterEach(cleanup)

const noop = () => {}
const gesture: MouseGestureApi = {
  handlers: {
    onPointerDown: noop,
    onPointerMove: noop,
    onPointerUp: noop,
    onPointerLeave: noop,
    onPointerCancel: noop,
    onContextMenu: noop,
  },
  subscribeTrail: () => () => {},
}

function paneOf(slice: SessionSlice, busy: boolean) {
  return render(
    <ChatPane
      slice={slice}
      optimistic={{ busy, markSent: () => {}, reset: () => {} }}
      gesture={gesture}
      scrollRef={createRef<HTMLDivElement>()}
      chatContext={{ dirtyFiles: [] }}
      onOpenFile={() => {}}
    />,
  )
}

describe('진행 표시와 낙관 상태', () => {
  it('turn_started 전이라도 busy 면 진행 표시가 뜬다', () => {
    // 전송 직후의 상태 그대로 — 스트리밍 이벤트는 아직 없다
    const { container } = paneOf(EMPTY_SLICE, true)
    expect(container.querySelector('.chat-gutter .message.assistant')).toBeTruthy()
  })

  it('아무것도 진행 중이 아니면 진행 표시가 없다', () => {
    const { container } = paneOf(EMPTY_SLICE, false)
    expect(container.querySelector('.chat-gutter .message.assistant')).toBeNull()
  })
})
