// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOpenFiles } from './useOpenFiles'

// 채팅에 실을 편집기 컨텍스트 — 선택 보관 수명과 dirtyFiles 파생.
// (형태 규칙 자체는 editorContext.test.ts 가 잠근다.)

const readFile = vi.fn()
const writeFile = vi.fn()
const gitFileDiff = vi.fn()

beforeEach(() => {
  readFile.mockReset()
  writeFile.mockReset()
  gitFileDiff.mockReset()
  readFile.mockResolvedValue({ ok: true, text: 'hello', mtimeMs: 1 })
  writeFile.mockResolvedValue({ ok: true, mtimeMs: 2 })
  gitFileDiff.mockResolvedValue({ ok: true, diff: '', untracked: false })
  ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
  ;(window as unknown as { davis: unknown }).davis = { readFile, writeFile, gitFileDiff }
})
afterEach(() => vi.restoreAllMocks())

async function run(fn: () => void) {
  await act(async () => {
    fn()
  })
}

describe('편집기 컨텍스트 — 선택 영역', () => {
  it('대화 화면이면 활성 편집기가 없다', () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    expect(result.current.chatContext.activeEditor).toBeUndefined()
  })

  it('파일을 열면 그 파일이 활성 편집기가 된다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('a.ts'))
    expect(result.current.chatContext.activeEditor).toEqual({ filePath: 'a.ts' })
  })

  it('고른 범위가 실린다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('a.ts'))
    await run(() => result.current.setSelection('a.ts', { startLine: 2, endLine: 5 }))
    expect(result.current.chatContext.activeEditor).toEqual({
      filePath: 'a.ts',
      selection: { startLine: 2, endLine: 5 },
    })
  })

  // 편집기는 활성 탭만 마운트된다 — 컴포넌트 안에 두면 탭을 옮기는 순간 사라진다
  it('탭을 옮겼다 돌아와도 선택이 살아 있다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('a.ts'))
    await run(() => result.current.setSelection('a.ts', { startLine: 2, endLine: 5 }))
    await run(() => result.current.open('b.ts'))
    expect(result.current.chatContext.activeEditor).toEqual({ filePath: 'b.ts' })

    await run(() => result.current.select('a.ts'))
    expect(result.current.chatContext.activeEditor?.selection).toEqual({
      startLine: 2,
      endLine: 5,
    })
  })

  // 라인 번호가 밀려 다른 곳을 가리키게 된다 — 잘못 가리키느니 안 보낸다
  it('내용을 고치면 그 파일의 선택을 버린다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('a.ts'))
    await run(() => result.current.setSelection('a.ts', { startLine: 2, endLine: 5 }))
    await run(() => result.current.edit('a.ts', 'hello!'))
    expect(result.current.chatContext.activeEditor).toEqual({ filePath: 'a.ts' })
  })

  it('닫았다 다시 열면 옛 선택이 되살아나지 않는다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('a.ts'))
    await run(() => result.current.setSelection('a.ts', { startLine: 2, endLine: 5 }))
    await run(() => result.current.close('a.ts'))
    await run(() => result.current.open('a.ts'))
    expect(result.current.chatContext.activeEditor).toEqual({ filePath: 'a.ts' })
  })

  it('git diff 탭을 보고 있으면 활성 편집기가 없다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.openDiff('a.ts', false))
    expect(result.current.chatContext.activeEditor).toBeUndefined()
  })
})

describe('편집기 컨텍스트 — 미저장 파일', () => {
  // 나머지 필드와 규칙이 반대다. runtime 이 "dirty 없음" 의 명시 신호로 쓴다
  it('없어도 빈 배열을 싣는다 — 생략하지 않는다', () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    expect(result.current.chatContext.dirtyFiles).toEqual([])
  })

  it('고친 파일이 담긴다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('a.ts'))
    await run(() => result.current.edit('a.ts', 'hello 고침'))
    expect(result.current.chatContext.dirtyFiles).toEqual(['a.ts'])
  })

  it('열기만 한 파일은 담기지 않는다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('a.ts'))
    expect(result.current.chatContext.dirtyFiles).toEqual([])
  })

  it('프로젝트가 바뀌면 비워진다', async () => {
    const { result, rerender } = renderHook(({ id }) => useOpenFiles(id), {
      initialProps: { id: 'p1' },
    })
    await run(() => result.current.open('a.ts'))
    await run(() => result.current.edit('a.ts', 'hello 고침'))
    expect(result.current.chatContext.dirtyFiles).toEqual(['a.ts'])

    await act(async () => rerender({ id: 'p2' }))
    expect(result.current.chatContext.dirtyFiles).toEqual([])
    expect(result.current.chatContext.activeEditor).toBeUndefined()
  })
})
