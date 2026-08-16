// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRunList } from './useRunList'

// **격리 경계 둘을 잠근다.** 훅 주석이 증상을 적어 놨다 — *"사용자는 남의 프로젝트 명령을
// 이 프로젝트에서 띄우게 된다."* 실행 목록은 ▶ 를 누르면 **정말로 도는** 명령이라
// 남의 것이 섞이면 남의 개발 서버가 이 프로젝트에서 뜬다.
//
// `RunPanel.test.tsx` 는 IPC 를 스텁하고 **프로젝트 하나로만** 돌아서 이 자리에 닿지 않는다.

type Changed = (payload: unknown, from: string) => void

/** 응답을 손으로 풀어야 **"읽어 오는 동안"** 의 한 프레임을 잴 수 있다 */
const pending: Array<(value: unknown) => void> = []
const readRunList = vi.fn(() => new Promise((resolve) => pending.push(resolve)))

let listener: Changed | null = null
const onRunListChanged = vi.fn((fn: Changed) => {
  listener = fn
  return () => {}
})

const DEV = { name: 'dev', command: 'npm run dev' }

beforeEach(() => {
  pending.length = 0
  listener = null
  readRunList.mockClear()
  onRunListChanged.mockClear()
  window.davis = { readRunList, onRunListChanged } as never
})

/** 가장 오래된 요청 하나에 답한다 */
async function settle(entries: { name: string; command: string }[]) {
  await act(async () => {
    pending.shift()?.({ entries, found: true, stale: false })
  })
}

describe('useRunList — 프로젝트 격리', () => {
  it('프로젝트를 옮기면 앞 목록이 한 프레임도 안 남는다', async () => {
    const { result, rerender } = renderHook(({ id }) => useRunList(id), {
      initialProps: { id: 'A' },
    })
    await settle([DEV])
    expect(result.current.entries).toEqual([DEV])

    rerender({ id: 'B' })

    // **B 의 응답이 오기 전이다.** 여기서 A 의 목록이 보이면 그 한 프레임 동안 ▶ 가
    // 남의 명령을 띄운다 — 비우는 줄을 지우면 이 단언이 빨개진다.
    expect(result.current.entries).toEqual([])
    expect(result.current.found).toBe(false)
    expect(result.current.loading).toBe(true)

    await settle([{ name: 'test', command: 'npm test' }])
    expect(result.current.entries).toEqual([{ name: 'test', command: 'npm test' }])
  })

  it('남의 프로젝트가 목록을 바꿨다는 신호로는 다시 읽지 않는다', async () => {
    const { result } = renderHook(() => useRunList('B'))
    await settle([DEV])
    expect(readRunList).toHaveBeenCalledTimes(1)

    await act(async () => listener?.({}, 'A'))

    expect(readRunList).toHaveBeenCalledTimes(1)
    expect(result.current.entries).toEqual([DEV])
  })

  // 기준선 — 위 단언만 있으면 **아무도 안 읽는** 상태에서도 초록이다.
  it('내 프로젝트의 신호에는 다시 읽는다', async () => {
    renderHook(() => useRunList('B'))
    await settle([DEV])

    await act(async () => listener?.({}, 'B'))

    expect(readRunList).toHaveBeenCalledTimes(2)
  })
})
