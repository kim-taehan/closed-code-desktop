// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitBulkActions } from './useGitBulkActions'
import type { ToastApi } from './useToasts'
import type { GitActionResult } from '../../shared/ipc/gitPayloads'

// 묶음 행동 — 실패만 알린다. 성공은 목록이 통째로 옮겨가는 것으로 보인다.

const gitStageAll = vi.fn<() => Promise<GitActionResult>>()
const gitUnstageAll = vi.fn<() => Promise<GitActionResult>>()

function mkToasts(): ToastApi {
  return { toasts: [], show: vi.fn(), dismiss: vi.fn() }
}

async function run(cb: () => void) {
  await act(async () => {
    cb()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  gitStageAll.mockReset().mockResolvedValue({ ok: true })
  gitUnstageAll.mockReset().mockResolvedValue({ ok: true })
  ;(window as unknown as { davis: unknown }).davis = { gitStageAll, gitUnstageAll }
})

describe('모두 담기 / 모두 취소', () => {
  it('겉봉에 프로젝트를 실어 부른다', async () => {
    const { result } = renderHook(() => useGitBulkActions('p1', mkToasts()))

    await run(() => result.current.onStageAll())
    expect(gitStageAll).toHaveBeenCalledWith({ projectId: 'p1' })

    await run(() => result.current.onUnstageAll())
    expect(gitUnstageAll).toHaveBeenCalledWith({ projectId: 'p1' })
  })

  it('프로젝트가 없으면 아예 부르지 않는다', async () => {
    const { result } = renderHook(() => useGitBulkActions(null, mkToasts()))

    await run(() => result.current.onStageAll())
    await run(() => result.current.onUnstageAll())
    expect(gitStageAll).not.toHaveBeenCalled()
    expect(gitUnstageAll).not.toHaveBeenCalled()
  })

  // 목록이 통째로 자리를 옮기는 것이 곧 결과다 — 체크 한 개 토글에 토스트가 없는 것과 같다
  it('성공에는 토스트를 띄우지 않는다', async () => {
    const toasts = mkToasts()
    const { result } = renderHook(() => useGitBulkActions('p1', toasts))

    await run(() => result.current.onStageAll())
    expect(toasts.show).not.toHaveBeenCalled()
  })

  // ⚠ 첫 커밋 전 저장소의 실측 실패다. 우리 문구로 갈아끼우면 검색이 안 된다.
  it('실패하면 git 문구를 그대로 보여준다', async () => {
    gitUnstageAll.mockResolvedValue({ ok: false, message: 'fatal: could not resolve HEAD' })
    const toasts = mkToasts()
    const { result } = renderHook(() => useGitBulkActions('p1', toasts))

    await run(() => result.current.onUnstageAll())
    expect(toasts.show).toHaveBeenCalledWith('fatal: could not resolve HEAD', 'error')
  })

  it('사유 없는 실패에도 실패했다는 것은 알린다', async () => {
    gitStageAll.mockResolvedValue({ ok: false })
    const toasts = mkToasts()
    const { result } = renderHook(() => useGitBulkActions('p1', toasts))

    await run(() => result.current.onStageAll())
    expect(toasts.show).toHaveBeenCalledWith('담지 못했습니다', 'error')
  })
})
