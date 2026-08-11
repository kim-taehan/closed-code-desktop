// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOpenFiles } from './useOpenFiles'

// 자동 저장. 편집 모드도 저장 버튼도 없다 — 타이핑이 멈추면 쓴다.
// (열기·diff·탭 동작은 useOpenFiles.test.tsx 에 있다. 300줄 상한 때문에 갈랐다.)

const readFile = vi.fn()
const writeFile = vi.fn()
const notify = vi.fn()

beforeEach(() => {
  readFile.mockReset()
  writeFile.mockReset()
  notify.mockReset()
  readFile.mockResolvedValue({ ok: true, text: '원본', mtimeMs: 100 })
  writeFile.mockResolvedValue({ ok: true, mtimeMs: 200 })
  ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
  ;(window as unknown as { davis: unknown }).davis = { readFile, writeFile }
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** 부르고 뒤따르는 .then 상태갱신까지 흘려보낸다 */
async function run(fn: () => void) {
  await act(async () => {
    fn()
  })
}

/** 자동 저장이 일어날 만큼 조용히 둔다 */
async function idle() {
  await act(async () => {
    vi.advanceTimersByTime(600)
  })
}

/** 파일 하나를 열어 둔 훅 */
async function opened() {
  const hook = renderHook(() => useOpenFiles('p1', notify))
  await run(() => hook.result.current.open('a.ts'))
  return hook
}

describe('자동 저장', () => {
  it('타이핑이 멈추면 저장한다 — 저장 버튼이 없다', async () => {
    const { result } = await opened()
    await run(() => result.current.edit('a.ts', '고침'))
    expect(writeFile).not.toHaveBeenCalled()

    await idle()
    expect(writeFile).toHaveBeenCalledWith({
      projectId: 'p1',
      path: 'a.ts',
      text: '고침',
      expectedMtimeMs: 100,
    })
  })

  // 글자마다 쓰면 에이전트가 읽는 파일이 반쯤 쓰다 만 상태로 계속 바뀐다
  it('연달아 치면 마지막 것만 한 번 쓴다', async () => {
    const { result } = await opened()
    await run(() => result.current.edit('a.ts', '고'))
    await run(() => result.current.edit('a.ts', '고침'))

    await idle()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile.mock.calls[0]![0].text).toBe('고침')
  })

  it('저장하면 미저장 표시가 풀리고 mtime 이 갱신된다', async () => {
    const { result } = await opened()
    await run(() => result.current.edit('a.ts', '고침'))
    await idle()

    expect(result.current.files[0]!.text).toBe('고침')
    expect(result.current.files[0]!.mtimeMs).toBe(200)
  })

  it('바뀐 게 없으면 쓰지 않는다', async () => {
    const { result } = await opened()
    await run(() => result.current.edit('a.ts', '원본'))
    await idle()
    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('마지막 타이핑 지키기', () => {
  it('flush 는 기다리지 않고 지금 쓴다 — 포커스가 빠질 때', async () => {
    const { result } = await opened()
    await run(() => result.current.edit('a.ts', '고침'))

    await run(() => result.current.flush('a.ts'))
    expect(writeFile).toHaveBeenCalledTimes(1)
  })

  it('탭을 닫아도 마지막 타이핑을 잃지 않는다', async () => {
    const { result } = await opened()
    await run(() => result.current.edit('a.ts', '고침'))

    await run(() => result.current.close('a.ts'))
    expect(writeFile.mock.calls[0]![0].text).toBe('고침')
    expect(result.current.files).toEqual([])
  })

  // save 는 **지금** projectId 로 쓴다 — 그대로 두면 이전 프로젝트 파일을 새 프로젝트에 쓴다
  it('프로젝트가 바뀌면 기다리던 저장은 버린다', async () => {
    const { result, rerender } = renderHook(({ pid }) => useOpenFiles(pid), {
      initialProps: { pid: 'p1' as string | null },
    })
    await run(() => result.current.open('a.ts'))
    await run(() => result.current.edit('a.ts', '고침'))

    rerender({ pid: 'p2' })
    await idle()
    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('그 사이 파일이 바뀌었을 때', () => {
  beforeEach(() => writeFile.mockResolvedValue({ ok: false, reason: 'stale' }))

  // 에이전트도 같은 파일을 고친다. 덮으면 방금 한 수정이 조용히 사라진다.
  it('덮지 않고 알린다', async () => {
    const { result } = await opened()
    await run(() => result.current.edit('a.ts', '고침'))
    await idle()

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('그 사이 바뀌었습니다'), 'error')
    // 고친 내용은 화면에 남는다 — 지우면 사용자가 쓴 것이 사라진다
    expect(result.current.files[0]!.draft).toBe('고침')
  })

  it('그 뒤로는 칠 때마다 다시 시도하지 않는다', async () => {
    const { result } = await opened()
    await run(() => result.current.edit('a.ts', '고침'))
    await idle()
    expect(writeFile).toHaveBeenCalledTimes(1)

    await run(() => result.current.edit('a.ts', '더 고침'))
    await idle()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledTimes(1)
  })
})
