// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePaneExits } from './usePaneExits'

type ExitListener = (payload: { name: string; exitCode: number | null }, from: string) => void

let listener: ExitListener | null = null
const onShellExit = vi.fn((fn: ExitListener) => {
  listener = fn
  return () => {}
})

beforeEach(() => {
  listener = null
  onShellExit.mockClear()
  window.davis = { onShellExit } as never
})

const fire = (from: string, name: string, exitCode: number | null) =>
  act(() => listener?.({ name, exitCode }, from))

describe('usePaneExits', () => {
  // 신호는 프로젝트를 안 가리고 한 채널로 온다 — 키가 프로젝트를 안 담으면
  // 남의 프로젝트에서 죽은 칸이 내 화면의 점을 끈다. 키 경계는 `keyOf` 의 U+0000 이고,
  // 그 값이 소스에 날 NUL 바이트로 박혀 있던 것을 `'\0'` 이스케이프로 바꿨다.
  it('남의 프로젝트에서 온 종료는 내 칸에 안 묻는다', () => {
    const { result } = renderHook(() => usePaneExits('A'))
    fire('B', 'shell', 0)

    expect(result.current.exitOf('shell')).toBeUndefined()
  })

  it('내 프로젝트에서 온 종료는 코드까지 그대로 온다', () => {
    const { result } = renderHook(() => usePaneExits('A'))
    fire('A', 'shell', 130)

    expect(result.current.exitOf('shell')).toBe(130)
  })

  // 이름만으로 키를 지으면 `ab`+`c` 와 `a`+`bc` 가 겹친다.
  it('프로젝트 id 와 이름이 이어 붙어 같은 칸이 되지 않는다', () => {
    const { result } = renderHook(() => usePaneExits('ab'))
    fire('a', 'bc', 0)

    expect(result.current.exitOf('c')).toBeUndefined()
  })
})
