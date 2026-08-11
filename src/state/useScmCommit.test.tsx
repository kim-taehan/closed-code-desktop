// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useScmCommit } from './useScmCommit'
import type { ToastApi } from './useToasts'
import type { GitActionResult } from '../../shared/ipc/gitPayloads'

// 순서가 있는 행동(담고 커밋 / 커밋 후 푸시)이 **앞이 실패하면 멈추는지**,
// 되돌리기 어려운 둘(합치기·커밋 취소)이 확인을 받는지.

const gitStageAll = vi.fn<() => Promise<GitActionResult>>()
const gitCommit = vi.fn<() => Promise<GitActionResult>>()
const gitAmend = vi.fn<() => Promise<GitActionResult>>()
const gitUndoCommit = vi.fn<() => Promise<GitActionResult>>()

function mkToasts(): ToastApi {
  return { toasts: [], show: vi.fn(), dismiss: vi.fn() }
}

async function run(cb: () => void) {
  await act(async () => {
    cb()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  gitStageAll.mockReset().mockResolvedValue({ ok: true })
  gitCommit.mockReset().mockResolvedValue({ ok: true })
  gitAmend.mockReset().mockResolvedValue({ ok: true })
  gitUndoCommit.mockReset().mockResolvedValue({ ok: true })
  ;(window as unknown as { davis: unknown }).davis = {
    gitStageAll,
    gitCommit,
    gitAmend,
    gitUndoCommit,
  }
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('모두 담고 커밋', () => {
  it('담은 뒤에 커밋한다', async () => {
    const { result } = renderHook(() => useScmCommit('p1', mkToasts(), vi.fn()))

    await run(() => result.current.onCommitAll('DC-1 feat: x'))

    expect(gitStageAll).toHaveBeenCalledWith({ projectId: 'p1' })
    expect(gitCommit).toHaveBeenCalledWith({ projectId: 'p1', message: 'DC-1 feat: x' })
  })

  // 무엇이 들어갈지 모른 채 커밋하면 안 된다
  it('담기가 실패하면 커밋하지 않는다', async () => {
    gitStageAll.mockResolvedValue({ ok: false, message: 'fatal: …' })
    const toasts = mkToasts()
    const { result } = renderHook(() => useScmCommit('p1', toasts, vi.fn()))

    await run(() => result.current.onCommitAll('메시지'))

    expect(gitCommit).not.toHaveBeenCalled()
    expect(toasts.show).toHaveBeenCalledWith('fatal: …', 'error')
  })
  // 담기는 됐는데 커밋만 실패하는 일이 흔하다 (pre-commit 훅·빈 메시지).
  // 이때 조용하면 "담겼으니 커밋도 됐겠지" 로 읽힌다 — 인덱스에는 남아 있는데.
  it('담긴 뒤 커밋이 실패하면 git 문구를 그대로 알린다', async () => {
    gitCommit.mockResolvedValue({ ok: false, message: 'pre-commit hook failed' })
    const toasts = mkToasts()
    const { result } = renderHook(() => useScmCommit('p1', toasts, vi.fn()))

    await run(() => result.current.onCommitAll('메시지'))

    expect(gitStageAll).toHaveBeenCalled()
    expect(toasts.show).toHaveBeenCalledWith('pre-commit hook failed', 'error')
  })
})

describe('커밋 후 푸시', () => {
  it('커밋이 되면 이어서 올린다', async () => {
    const onPush = vi.fn()
    const { result } = renderHook(() => useScmCommit('p1', mkToasts(), onPush))

    await run(() => result.current.onCommitPush('메시지'))

    expect(gitCommit).toHaveBeenCalledWith({ projectId: 'p1', message: '메시지' })
    expect(onPush).toHaveBeenCalledTimes(1)
  })

  it('커밋이 실패하면 올리지 않는다', async () => {
    gitCommit.mockResolvedValue({ ok: false, message: 'nothing to commit' })
    const onPush = vi.fn()
    const toasts = mkToasts()
    const { result } = renderHook(() => useScmCommit('p1', toasts, onPush))

    await run(() => result.current.onCommitPush('메시지'))

    expect(onPush).not.toHaveBeenCalled()
    expect(toasts.show).toHaveBeenCalledWith('nothing to commit', 'error')
  })
})

describe('합치기 · 커밋 취소 — 확인을 받는다', () => {
  it('합치기는 확인을 받고 부른다', async () => {
    const { result } = renderHook(() => useScmCommit('p1', mkToasts(), vi.fn()))

    await run(() => result.current.onAmend('고친 메시지'))

    expect(window.confirm).toHaveBeenCalled()
    expect(gitAmend).toHaveBeenCalledWith({ projectId: 'p1', message: '고친 메시지' })
  })

  it('취소를 누르면 합치지 않는다', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    const { result } = renderHook(() => useScmCommit('p1', mkToasts(), vi.fn()))

    await run(() => result.current.onAmend('메시지'))

    expect(gitAmend).not.toHaveBeenCalled()
  })

  it('커밋 취소도 확인을 받는다', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    const { result } = renderHook(() => useScmCommit('p1', mkToasts(), vi.fn()))

    await run(() => result.current.onUndoCommit())
    expect(gitUndoCommit).not.toHaveBeenCalled()

    vi.mocked(window.confirm).mockReturnValue(true)
    await run(() => result.current.onUndoCommit())
    expect(gitUndoCommit).toHaveBeenCalledWith({ projectId: 'p1' })
  })
})

describe('되돌리기 어려운 둘이 실패했을 때', () => {
  // 합치기·커밋 취소는 확인까지 받고 누른 행동이다. 실패를 안 알리면 사용자는
  // 됐다고 믿고 다음 수(푸시)로 넘어간다.
  it('합치기 실패는 git 문구를, 사유가 없으면 우리 문구를 낸다', async () => {
    gitAmend.mockResolvedValue({ ok: false, message: 'fatal: 커밋이 없습니다' })
    const toasts = mkToasts()
    const { result, rerender } = renderHook(() => useScmCommit('p1', toasts, vi.fn()))

    await run(() => result.current.onAmend('메시지'))
    expect(toasts.show).toHaveBeenCalledWith('fatal: 커밋이 없습니다', 'error')

    gitAmend.mockResolvedValue({ ok: false })
    rerender()
    await run(() => result.current.onAmend('메시지'))
    expect(toasts.show).toHaveBeenCalledWith('합치지 못했습니다', 'error')
  })

  it('커밋 취소 실패도 알린다', async () => {
    gitUndoCommit.mockResolvedValue({ ok: false, message: 'fatal: HEAD~1 없음' })
    const toasts = mkToasts()
    const { result } = renderHook(() => useScmCommit('p1', toasts, vi.fn()))

    await run(() => result.current.onUndoCommit())

    expect(toasts.show).toHaveBeenCalledWith('fatal: HEAD~1 없음', 'error')
  })
})

// git 이 사유 없이 거절할 때 무엇이 실패했는지는 행동마다 다르게 말해야 한다 —
// "실패했습니다" 하나로 뭉치면 담기가 막힌 건지 커밋이 막힌 건지 알 수 없다.
describe('사유가 비어 있을 때 — 행동마다 제 문구를 낸다', () => {
  it('담기·커밋·커밋취소가 각자 다른 문구를 낸다', async () => {
    const toasts = mkToasts()
    const { result } = renderHook(() => useScmCommit('p1', toasts, vi.fn()))

    gitStageAll.mockResolvedValue({ ok: false })
    await run(() => result.current.onCommitAll('m'))
    expect(toasts.show).toHaveBeenCalledWith('담지 못했습니다', 'error')

    gitStageAll.mockResolvedValue({ ok: true })
    gitCommit.mockResolvedValue({ ok: false })
    await run(() => result.current.onCommitAll('m'))
    expect(toasts.show).toHaveBeenCalledWith('커밋하지 못했습니다', 'error')

    gitUndoCommit.mockResolvedValue({ ok: false })
    await run(() => result.current.onUndoCommit())
    expect(toasts.show).toHaveBeenCalledWith('취소하지 못했습니다', 'error')
  })
})

describe('프로젝트가 없을 때', () => {
  it('넷 다 아무것도 부르지 않는다', async () => {
    const { result } = renderHook(() => useScmCommit(null, mkToasts(), vi.fn()))

    await run(() => result.current.onCommitAll('m'))
    await run(() => result.current.onCommitPush('m'))
    await run(() => result.current.onAmend('m'))
    await run(() => result.current.onUndoCommit())

    expect(gitStageAll).not.toHaveBeenCalled()
    expect(gitCommit).not.toHaveBeenCalled()
    expect(gitAmend).not.toHaveBeenCalled()
    expect(gitUndoCommit).not.toHaveBeenCalled()
  })
})
