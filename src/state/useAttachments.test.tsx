// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAttachments } from './useAttachments'
import type { PickedAttachment } from '../../shared/ipc/attachmentPayloads'

// 보내기 전에 붙여 둔 것들. pickAttachments / resolveAttachments 로 목록에 합친다.
// 이미지는 5장까지, 초과하면 목록을 그대로 두고 error 만 세운다.

const pickAttachments = vi.fn()
const resolveAttachments = vi.fn()

beforeEach(() => {
  pickAttachments.mockReset()
  resolveAttachments.mockReset()
  ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
  ;(window as unknown as { davis: unknown }).davis = { pickAttachments, resolveAttachments }
})
afterEach(() => vi.restoreAllMocks())

const img = (name: string): PickedAttachment => ({
  kind: 'image',
  name,
  bytes: 10,
  data: 'zzz',
  mediaType: 'image/png',
})
const file = (name: string): PickedAttachment => ({ kind: 'file', name, filePath: `/w/${name}`, type: 'file' })
const err = (name: string): PickedAttachment => ({ kind: 'error', name, error: '못 읽음' })

async function run(fn: () => void) {
  await act(async () => {
    fn()
  })
}

describe('붙이기', () => {
  it('pick 은 고른 것을 목록에 합친다', async () => {
    pickAttachments.mockResolvedValue([img('a.png'), file('b.ts')])
    const { result } = renderHook(() => useAttachments())
    await run(() => result.current.pick())
    expect(result.current.items).toHaveLength(2)
    expect(result.current.error).toBeNull()
  })

  it('addPaths 는 resolveAttachments 로 풀어 합친다', async () => {
    resolveAttachments.mockResolvedValue([file('a.ts')])
    const { result } = renderHook(() => useAttachments())
    await run(() => result.current.addPaths(['/w/a.ts']))
    expect(resolveAttachments).toHaveBeenCalledWith(['/w/a.ts'])
    expect(result.current.items).toHaveLength(1)
  })

  it('빈 경로 배열이면 아무것도 부르지 않는다', async () => {
    const { result } = renderHook(() => useAttachments())
    await run(() => result.current.addPaths([]))
    expect(resolveAttachments).not.toHaveBeenCalled()
  })

  it('여러 번 붙이면 뒤에 이어 쌓인다', async () => {
    pickAttachments.mockResolvedValueOnce([file('a.ts')]).mockResolvedValueOnce([file('b.ts')])
    const { result } = renderHook(() => useAttachments())
    await run(() => result.current.pick())
    await run(() => result.current.pick())
    expect(result.current.items.map((i) => i.name)).toEqual(['a.ts', 'b.ts'])
  })
})

describe('이미지 한도', () => {
  it('5장까지는 받는다', async () => {
    pickAttachments.mockResolvedValue([img('1'), img('2'), img('3'), img('4'), img('5')])
    const { result } = renderHook(() => useAttachments())
    await run(() => result.current.pick())
    expect(result.current.items).toHaveLength(5)
    expect(result.current.error).toBeNull()
  })

  it('6장째는 목록을 그대로 두고 error 를 세운다', async () => {
    pickAttachments.mockResolvedValue([img('1'), img('2'), img('3'), img('4'), img('5'), img('6')])
    const { result } = renderHook(() => useAttachments())
    await run(() => result.current.pick())
    expect(result.current.items).toEqual([])
    expect(result.current.error).toBe('이미지는 한 번에 5장까지 붙일 수 있습니다')
  })

  it('파일은 장수 제한이 없다', async () => {
    const files = Array.from({ length: 8 }, (_, i) => file(`f${i}`))
    pickAttachments.mockResolvedValue(files)
    const { result } = renderHook(() => useAttachments())
    await run(() => result.current.pick())
    expect(result.current.items).toHaveLength(8)
    expect(result.current.error).toBeNull()
  })
})

describe('빼기 · 비우기', () => {
  it('remove 는 그 자리의 것만 빼고 error 를 지운다', async () => {
    pickAttachments.mockResolvedValue([file('a'), file('b'), file('c')])
    const { result } = renderHook(() => useAttachments())
    await run(() => result.current.pick())
    act(() => result.current.remove(1))
    expect(result.current.items.map((i) => i.name)).toEqual(['a', 'c'])
    expect(result.current.error).toBeNull()
  })

  it('clear 는 전부 비우고 error 도 지운다', async () => {
    pickAttachments.mockResolvedValue([img('1'), img('2'), img('3'), img('4'), img('5'), img('6')])
    const { result } = renderHook(() => useAttachments())
    await run(() => result.current.pick()) // error 세팅됨
    act(() => result.current.clear())
    expect(result.current.items).toEqual([])
    expect(result.current.error).toBeNull()
  })
})

describe('보낼 형태로 가르기', () => {
  it('images/files/summaries 를 종류별로 나눠 낸다', async () => {
    pickAttachments.mockResolvedValue([img('a.png'), file('b.ts'), err('c.bin')])
    const { result } = renderHook(() => useAttachments())
    await run(() => result.current.pick())

    expect(result.current.images).toEqual([{ data: 'zzz', mediaType: 'image/png' }])
    expect(result.current.files).toEqual([{ filePath: '/w/b.ts', type: 'file' }])
    // error 종류는 요약에서 빠진다 — 나머지만 남긴다
    expect(result.current.summaries).toEqual([
      { name: 'a.png', kind: 'image', bytes: 10 },
      { name: 'b.ts', kind: 'file' },
    ])
  })
})
