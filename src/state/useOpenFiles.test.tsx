// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diffTabKey, useOpenFiles } from './useOpenFiles'

// 열린 파일 탭. window.davis.readFile / gitFileDiff 를 부른다. 프로젝트가 바뀌면 비운다.

const readFile = vi.fn()
const gitFileDiff = vi.fn()
const openInOs = vi.fn()

beforeEach(() => {
  readFile.mockReset()
  gitFileDiff.mockReset()
  openInOs.mockReset()
  readFile.mockResolvedValue({ ok: true, text: 'hello' })
  gitFileDiff.mockResolvedValue({ ok: true, diff: '', untracked: false })
  openInOs.mockResolvedValue({ ok: true })
  ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
  ;(window as unknown as { davis: unknown }).davis = { readFile, gitFileDiff, openInOs }
})
afterEach(() => vi.restoreAllMocks())

/** open 등을 부르고 뒤따르는 .then 상태갱신까지 흘려보낸다 */
async function run(fn: () => void) {
  await act(async () => {
    fn()
  })
}

describe('파일 열기', () => {
  it('열면 탭이 생기고 활성 탭이 그 파일이 된다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('a.ts'))
    expect(result.current.active).toBe('a.ts')
    expect(result.current.files.map((f) => f.path)).toEqual(['a.ts'])
    expect(readFile).toHaveBeenCalledWith({ projectId: 'p1', path: 'a.ts' })
  })

  it('읽기 성공 내용을 탭에 채운다', async () => {
    readFile.mockResolvedValue({ ok: true, text: '본문' })
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('a.ts'))
    expect(result.current.files[0]!.text).toBe('본문')
    expect(result.current.files[0]!.error).toBeUndefined()
  })

  // 턴 리뷰에서 변경 위치로 열 때. 뷰어가 이 값을 보고 스크롤한다.
  it('갈 줄을 주면 탭에 실린다 — 다 읽은 뒤에도 남는다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('a.ts', 42))
    expect(result.current.files[0]!.revealLine).toBe(42)
  })

  it('안 주면 없다 — 트리·검색으로 연 파일은 맨 위 그대로', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('a.ts'))
    expect(result.current.files[0]!.revealLine).toBeUndefined()
  })

  // 같은 파일의 다른 변경 지점을 이어서 누를 수 있다
  it('이미 열린 파일을 다른 줄로 열면 갈 줄이 갱신된다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('a.ts', 42))
    await run(() => result.current.open('a.ts', 7))
    expect(result.current.files).toHaveLength(1)
    expect(result.current.files[0]!.revealLine).toBe(7)
  })

  it('읽기 실패 사유를 한국어 메시지로 보여준다', async () => {
    readFile.mockResolvedValue({ ok: false, text: '', reason: 'too_large' })
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('big.bin'))
    expect(result.current.files[0]!.error).toBe('너무 커서 열 수 없습니다 (512KB 초과)')
  })

  it('알 수 없는 사유는 기본 메시지로 떨어진다', async () => {
    readFile.mockResolvedValue({ ok: false, text: '', reason: 'wat' as never })
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('x'))
    expect(result.current.files[0]!.error).toBe('열지 못했습니다')
  })

  it('이미 연 파일을 또 열면 탭이 중복되지 않는다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('a.ts'))
    await run(() => result.current.open('a.ts'))
    expect(result.current.files.filter((f) => f.path === 'a.ts')).toHaveLength(1)
  })

  it('프로젝트가 null 이면 열지 않는다', async () => {
    const { result } = renderHook(() => useOpenFiles(null))
    await run(() => result.current.open('a.ts'))
    expect(result.current.files).toEqual([])
    expect(readFile).not.toHaveBeenCalled()
  })
})

describe('열기 라우팅 — `/open`(openRouted) 만 OS 로 가른다 (사용자 지시, 2026-07-23)', () => {
  it('트리·검색 경로(open)는 pdf 도 기존대로 뷰어 탭이다 — 라우팅하지 않는다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('docs/스펙.pdf'))
    expect(openInOs).not.toHaveBeenCalled()
    expect(result.current.active).toBe('docs/스펙.pdf')
    expect(readFile).toHaveBeenCalledWith({ projectId: 'p1', path: 'docs/스펙.pdf' })
  })

  it('openRouted 의 텍스트 파일은 뷰어 탭으로 간다 — open 과 같은 경로', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.openRouted('a.ts'))
    expect(openInOs).not.toHaveBeenCalled()
    expect(result.current.active).toBe('a.ts')
  })

  it('pdf 는 탭 대신 OS 기본 앱으로 연다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.openRouted('docs/스펙.pdf'))
    expect(openInOs).toHaveBeenCalledWith({ projectId: 'p1', path: 'docs/스펙.pdf', mode: 'external' })
    expect(readFile).not.toHaveBeenCalled()
    // 탭이 생기지 않고 대화 화면 그대로다
    expect(result.current.files).toEqual([])
    expect(result.current.active).toBe('chat')
  })

  it('zip 은 Finder 에서 위치만 보여준다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.openRouted('dist/app.zip'))
    expect(openInOs).toHaveBeenCalledWith({ projectId: 'p1', path: 'dist/app.zip', mode: 'reveal' })
    expect(readFile).not.toHaveBeenCalled()
  })

  it('외부 열기 실패는 알림으로 알린다 — 화면에 다른 흔적이 없다', async () => {
    openInOs.mockResolvedValue({ ok: false, reason: 'not_allowed' })
    const notify = vi.fn()
    const { result } = renderHook(() => useOpenFiles('p1', notify))
    await run(() => result.current.openRouted('a.pdf'))
    expect(notify).toHaveBeenCalledWith('이 파일은 열 수 없습니다', 'error')
  })

  it('알 수 없는 실패 사유는 그대로 보여준다', async () => {
    openInOs.mockResolvedValue({ ok: false, reason: '연결된 앱이 없습니다' })
    const notify = vi.fn()
    const { result } = renderHook(() => useOpenFiles('p1', notify))
    await run(() => result.current.openRouted('a.pdf'))
    expect(notify).toHaveBeenCalledWith('열지 못했습니다 — 연결된 앱이 없습니다', 'error')
  })

  it('프로젝트가 null 이면 외부 열기도 하지 않는다', async () => {
    const { result } = renderHook(() => useOpenFiles(null))
    await run(() => result.current.openRouted('a.pdf'))
    expect(openInOs).not.toHaveBeenCalled()
  })
})

describe('닫기 · 선택', () => {
  it('보고 있던 탭을 닫으면 대화로 돌아간다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('a.ts'))
    act(() => result.current.close('a.ts'))
    expect(result.current.files).toEqual([])
    expect(result.current.active).toBe('chat')
  })

  it('보지 않던 탭을 닫으면 활성 탭은 그대로다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('a.ts'))
    await run(() => result.current.open('b.ts'))
    expect(result.current.active).toBe('b.ts')
    act(() => result.current.close('a.ts'))
    expect(result.current.active).toBe('b.ts')
    expect(result.current.files.map((f) => f.path)).toEqual(['b.ts'])
  })

  it('select 로 활성 탭을 직접 바꾼다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.open('a.ts'))
    act(() => result.current.select('chat'))
    expect(result.current.active).toBe('chat')
  })
})

describe('git diff 탭', () => {
  it('diffTabKey 는 staged 여부를 구분한다', () => {
    expect(diffTabKey('a.ts', true)).toBe('git:staged:a.ts')
    expect(diffTabKey('a.ts', false)).toBe('git:unstaged:a.ts')
  })

  it('diff 를 열면 키·라벨을 붙인 탭이 생기고 gitFileDiff 를 부른다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.openDiff('src/a.ts', true))
    const tab = result.current.files[0]!
    expect(tab.path).toBe('git:staged:src/a.ts')
    expect(tab.label).toBe('a.ts (담김)')
    expect(result.current.active).toBe('git:staged:src/a.ts')
    expect(gitFileDiff).toHaveBeenCalledWith({ projectId: 'p1', path: 'src/a.ts', staged: true })
  })

  it('변경(비-staged) 라벨을 붙인다', async () => {
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.openDiff('a.ts', false))
    expect(result.current.files[0]!.label).toBe('a.ts (변경)')
  })

  it('unified diff 를 rows 로 푼다', async () => {
    gitFileDiff.mockResolvedValue({
      ok: true,
      untracked: false,
      diff: '@@ -1,1 +1,2 @@\n context\n+added',
    })
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.openDiff('a.ts', false))
    const rows = result.current.files[0]!.rows!
    expect(rows.map((r) => r.kind)).toEqual(['context', 'add'])
  })

  it('추적 안 되는 파일은 내용을 전부 추가 행으로 그린다', async () => {
    gitFileDiff.mockResolvedValue({ ok: true, untracked: true, diff: 'a\nb' })
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.openDiff('new.ts', false))
    const rows = result.current.files[0]!.rows!
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.kind === 'add')).toBe(true)
  })

  it('diff 실패 시 사유를 탭에 남기고 rows 는 비운다', async () => {
    gitFileDiff.mockResolvedValue({ ok: false, diff: '', reason: '권한 없음' })
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.openDiff('a.ts', false))
    expect(result.current.files[0]!.error).toBe('권한 없음')
    expect(result.current.files[0]!.rows).toEqual([])
  })

  it('실패 사유가 없으면 기본 메시지를 쓴다', async () => {
    gitFileDiff.mockResolvedValue({ ok: false, diff: '' })
    const { result } = renderHook(() => useOpenFiles('p1'))
    await run(() => result.current.openDiff('a.ts', false))
    expect(result.current.files[0]!.error).toBe('읽지 못했습니다')
  })

  it('projectId 가 null 이면 diff 를 열지 않는다', async () => {
    const { result } = renderHook(() => useOpenFiles(null))
    await run(() => result.current.openDiff('a.ts', false))
    expect(result.current.files).toEqual([])
    expect(gitFileDiff).not.toHaveBeenCalled()
  })
})

describe('프로젝트 전환', () => {
  it('프로젝트가 바뀌면 탭을 비우고 대화로 돌아간다', async () => {
    const { result, rerender } = renderHook(({ pid }) => useOpenFiles(pid), {
      initialProps: { pid: 'p1' as string | null },
    })
    await run(() => result.current.open('a.ts'))
    expect(result.current.files).toHaveLength(1)

    rerender({ pid: 'p2' })
    expect(result.current.files).toEqual([])
    expect(result.current.active).toBe('chat')
  })
})
