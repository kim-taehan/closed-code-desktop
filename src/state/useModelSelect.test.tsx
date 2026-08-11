// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useModelSelect } from './useModelSelect'
import type { LlmModelStatePayload } from '../../shared/protocol/llmConfig'

// 모델 선택 상태 — 계약의 핵심은 초기화다: 선택은 렌더러 메모리뿐이고
// 대화가 바뀌면(리셋·이력 로드·프로젝트 전환) 기본으로 돌아가야 한다 (runtime 무기억).

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

  it('선택지가 갱신돼 목록 밖이 되면 선택을 버린다 (정책 변경 대비)', () => {
    const { result } = renderHook(() => useModelSelect('A', null))
    act(() => handler!(payload(['m1', 'm2']), 'A'))
    act(() => result.current.select('m2'))

    act(() => handler!(payload(['m1']), 'A'))
    expect(result.current.selected).toBeNull()
  })
})
