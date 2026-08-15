// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMcpState } from './useMcpState'
import { EMPTY_MCP_STATE, type McpState } from '../../shared/protocol/mcpConfig'

// 커넥터(MCP) 상태 구독. 어댑터가 프로젝트별로 밀어 주고, 화면은 활성 프로젝트 것만 본다.
// (davis 때는 개인 자격 상태였다 — 봉투는 그대로고 실리는 것만 바뀌었다.)

type McpHandler = (state: McpState, projectId: string) => void

let handler: McpHandler | undefined
const unsub = vi.fn()

function mkState(message: string): McpState {
  return { servers: [], message }
}

beforeEach(() => {
  handler = undefined
  unsub.mockClear()
  ;(window as unknown as { davis: unknown }).davis = {
    onMcpState: (h: McpHandler) => {
      handler = h
      return unsub
    },
  }
})
afterEach(() => vi.restoreAllMocks())

describe('MCP 상태 구독', () => {
  it('아무 것도 안 오면 빈 상태를 준다', () => {
    const { result } = renderHook(() => useMcpState('A'))
    expect(result.current).toBe(EMPTY_MCP_STATE)
  })

  it('활성 프로젝트로 온 상태를 보여준다', () => {
    const { result } = renderHook(() => useMcpState('A'))
    act(() => handler!(mkState('A 메시지'), 'A'))
    expect(result.current.message).toBe('A 메시지')
  })

  it('activeId 가 null 이면 무엇이 와 있어도 빈 상태다', () => {
    const { result } = renderHook(() => useMcpState(null))
    act(() => handler!(mkState('아무개'), 'A'))
    expect(result.current).toBe(EMPTY_MCP_STATE)
  })

  it('프로젝트별로 갈린다 — A 의 상태가 B 로 새지 않는다', () => {
    const { result, rerender } = renderHook(({ id }) => useMcpState(id), {
      initialProps: { id: 'A' as string | null },
    })
    act(() => handler!(mkState('A 것'), 'A'))
    act(() => handler!(mkState('B 것'), 'B'))
    // A 를 보면 A 것
    expect(result.current.message).toBe('A 것')
    // B 로 옮기면 B 것 (A 것이 안 보인다)
    rerender({ id: 'B' })
    expect(result.current.message).toBe('B 것')
  })

  it('활성이 아닌 프로젝트로 온 상태는 화면에 안 나온다', () => {
    const { result } = renderHook(() => useMcpState('A'))
    act(() => handler!(mkState('B 것'), 'B'))
    expect(result.current).toBe(EMPTY_MCP_STATE)
  })

  it('언마운트하면 구독을 끊는다', () => {
    const { unmount } = renderHook(() => useMcpState('A'))
    expect(unsub).not.toHaveBeenCalled()
    unmount()
    expect(unsub).toHaveBeenCalledTimes(1)
  })
})
