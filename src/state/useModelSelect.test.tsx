// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useModelSelect } from './useModelSelect'
import type { LlmModelStatePayload } from '../../shared/protocol/llmConfig'

// 모델 선택 상태 — 계약의 핵심은 **무엇이 초기화를 부르는가**다. 선택은 렌더러 메모리뿐이고
// **대화가 바뀌면**(리셋·이력 로드) 기본으로 돌아간다 (runtime 무기억).
//
// ⚠️ 이 머리말은 한때 **「·프로젝트 전환」** 도 그 목록에 넣고 있었고 코드도 그랬다.
// 대화 이력을 되살린 뒤 거짓이 됐다 — 돌아오면 대화는 그대로인데 모델만 기본으로 돌아가
// **같은 대화를 다른 모델로 잇게 된다** (2026-08-16 사용자 지적). 지금은 프로젝트별로 든다.

type Handler = (payload: LlmModelStatePayload, projectId: string) => void

let handler: Handler | undefined
const requestModelOptions = vi.fn(() => Promise.resolve())

function payload(options: string[]): LlmModelStatePayload {
  return {
    status: { source: 'project', model: 'cur', providerType: '', baseUrl: '', allowedModels: options },
    options,
    loading: false,
    error: null,
  }
}

beforeEach(() => {
  handler = undefined
  requestModelOptions.mockClear()
  ;(window as unknown as { davis: unknown }).davis = {
    onModelState: (h: Handler) => {
      handler = h
      return () => {}
    },
    requestModelOptions,
  }
})
afterEach(() => vi.restoreAllMocks())

describe('useModelSelect', () => {
  it('프로젝트가 정해지면 상태를 요청하고, 그 프로젝트의 push 만 담는다', () => {
    const { result } = renderHook(() => useModelSelect('A', null))
    expect(requestModelOptions).toHaveBeenCalledOnce()

    act(() => handler!(payload(['m1']), 'B')) // 남의 프로젝트 — 무시
    expect(result.current.state.options).toEqual([])
    act(() => handler!(payload(['m1']), 'A'))
    expect(result.current.state.options).toEqual(['m1'])
  })

  it('선택값을 들고 있다가 chatId 가 바뀌면(리셋·이력 로드) 기본으로 돌아간다', () => {
    const { result, rerender } = renderHook(({ chatId }) => useModelSelect('A', chatId), {
      initialProps: { chatId: 'c1' as string | null },
    })
    act(() => handler!(payload(['m1']), 'A'))
    act(() => result.current.select('m1'))
    expect(result.current.selected).toBe('m1')

    rerender({ chatId: 'c2' })
    expect(result.current.selected).toBeNull()
  })

  // ⭐ 이 셋이 이번 변경이 겨누는 자리다 — 되돌리면(`[projectId, chatId]` 로) 전부 빨개진다
  it('프로젝트를 옮겼다 돌아오면 선택이 남는다 — 대화가 남아 있으니 모델도 남아야 한다', () => {
    const { result, rerender } = renderHook(({ id }) => useModelSelect(id, null), {
      initialProps: { id: 'A' },
    })
    act(() => handler!(payload(['m1']), 'A'))
    act(() => result.current.select('m1'))

    rerender({ id: 'B' })
    expect(result.current.selected).toBeNull() // B 는 아직 안 골랐다

    rerender({ id: 'A' })
    expect(result.current.selected).toBe('m1')
  })

  it('프로젝트마다 따로 든다 — 한쪽 선택이 다른 쪽에 새지 않는다', () => {
    const { result, rerender } = renderHook(({ id }) => useModelSelect(id, null), {
      initialProps: { id: 'A' },
    })
    act(() => handler!(payload(['m1', 'm2']), 'A'))
    act(() => result.current.select('m1'))

    rerender({ id: 'B' })
    act(() => handler!(payload(['m1', 'm2']), 'B'))
    act(() => result.current.select('m2'))
    expect(result.current.selected).toBe('m2')

    rerender({ id: 'A' })
    expect(result.current.selected).toBe('m1')
  })

  // 목록 밖 판정이 **남의 프로젝트 선택까지** 재면 멀쩡한 것이 버려진다.
  // B 의 목록은 좁은데 A 의 선택이 그것으로 재이면 A 가 조용히 기본으로 돌아간다.
  it('목록 밖 판정은 지금 프로젝트 것만 본다', () => {
    const { result, rerender } = renderHook(({ id }) => useModelSelect(id, null), {
      initialProps: { id: 'A' },
    })
    act(() => handler!(payload(['m1', 'm2']), 'A'))
    act(() => result.current.select('m2'))

    rerender({ id: 'B' })
    act(() => handler!(payload(['m1']), 'B')) // B 에는 m2 가 없다

    rerender({ id: 'A' })
    expect(result.current.selected).toBe('m2')
  })

  it('선택지가 갱신돼 목록 밖이 되면 선택을 버린다 (정책 변경 대비)', () => {
    const { result } = renderHook(() => useModelSelect('A', null))
    act(() => handler!(payload(['m1', 'm2']), 'A'))
    act(() => result.current.select('m2'))

    act(() => handler!(payload(['m1']), 'A'))
    expect(result.current.selected).toBeNull()
  })
})
