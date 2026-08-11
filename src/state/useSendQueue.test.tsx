// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSendQueue, type SendQueue } from './useSendQueue'
import type { ChatSendPayload } from '../../shared/ipc/channels'

const sendChat = vi.fn()

beforeEach(() => {
  sendChat.mockClear()
  ;(window as unknown as { davis: unknown }).davis = { sendChat }
})
afterEach(() => vi.restoreAllMocks())

// 훅을 감싸 밖에서 조종한다. 큐는 모듈 스토어라 테스트마다 고유 projectId 로 격리한다.
let nextId = 0
function harness(projectId = `p${nextId++}`) {
  const ref: { api?: SendQueue } = {}
  function Probe({ streaming, pid }: { streaming: boolean; pid: string }) {
    ref.api = useSendQueue(pid, streaming)
    return null
  }
  const view = render(<Probe streaming={false} pid={projectId} />)
  const setStreaming = (s: boolean) => view.rerender(<Probe streaming={s} pid={projectId} />)
  const setProject = (pid: string, s: boolean) => view.rerender(<Probe streaming={s} pid={pid} />)
  return { ref, setStreaming, setProject, projectId }
}

const msg = (query: string): ChatSendPayload => ({ query })

describe('전송 대기열', () => {
  it('응답 중이 아니면 바로 보낸다', () => {
    const { ref } = harness()
    act(() => ref.api!.submit(msg('첫 질문')))
    expect(sendChat).toHaveBeenCalledWith({ query: '첫 질문' })
  })

  it('응답 중이면 쌓고 보내지 않는다', () => {
    const { ref, setStreaming } = harness()
    setStreaming(true)
    act(() => ref.api!.submit(msg('대기1')))
    act(() => ref.api!.submit(msg('대기2')))

    expect(sendChat).not.toHaveBeenCalled()
    expect(ref.api!.pending).toBe(2)
  })

  it('턴이 끝나면 쌓인 것을 줄바꿈으로 이어 한 번에 보낸다', () => {
    const { ref, setStreaming } = harness()
    setStreaming(true)
    act(() => ref.api!.submit(msg('하나')))
    act(() => ref.api!.submit(msg('둘')))
    setStreaming(false)

    expect(sendChat).toHaveBeenCalledTimes(1)
    expect(sendChat.mock.calls[0]![0].query).toBe('하나\n둘')
  })

  it('take 는 합친 것을 돌려주고 큐를 비운다 — 보내지 않는다', () => {
    const { ref, setStreaming } = harness()
    setStreaming(true)
    act(() => ref.api!.submit(msg('가')))
    act(() => ref.api!.submit(msg('나')))

    let taken: ChatSendPayload | null = null
    act(() => {
      taken = ref.api!.take()
    })
    expect(taken!.query).toBe('가\n나')
    expect(ref.api!.pending).toBe(0)
    expect(sendChat).not.toHaveBeenCalled()

    // 되돌린 뒤 턴이 끝나도 보낼 게 없다
    setStreaming(false)
    expect(sendChat).not.toHaveBeenCalled()
  })

  it('첨부도 합친다', () => {
    const { ref, setStreaming } = harness()
    setStreaming(true)
    act(() => ref.api!.submit({ query: 'a', images: [{ base64: 'x', mediaType: 'image/png' }] as never }))
    act(() => ref.api!.submit({ query: 'b', files: [{ filePath: '/p', type: 'file' }] as never }))
    setStreaming(false)

    const sent = sendChat.mock.calls[0]![0]
    expect(sent.query).toBe('a\nb')
    expect(sent.images).toHaveLength(1)
    expect(sent.files).toHaveLength(1)
  })

  // 회귀 잠금. merge() 가 필드를 하나씩 골라 다시 쌓던 시절 `model` 이 목록에서 빠져 있어,
  // **두 건 이상 합쳐질 때만** 요청별 모델 오버라이드(DC-1322)가 사라졌다. 단건은 그대로
  // 돌려주므로 안 보였다 — 이 테스트는 옛 구현이면 실패한다.
  it('합쳐도 모델 오버라이드가 살아남는다 (기존 결함)', () => {
    const { ref, setStreaming } = harness()
    setStreaming(true)
    act(() => ref.api!.submit({ query: '하나', model: 'qwen-big' }))
    act(() => ref.api!.submit({ query: '둘', model: 'qwen-big' }))
    setStreaming(false)

    expect(sendChat.mock.calls[0]![0].model).toBe('qwen-big')
  })

  // 이어 붙일 수 없는 컨텍스트는 마지막 입력 시점의 것이 사실이다 (편집기 상태·모델).
  it('이어 붙일 수 없는 필드는 마지막 것이 남는다 — 새 필드도 조용히 새지 않는다', () => {
    const { ref, setStreaming } = harness()
    setStreaming(true)
    act(() => ref.api!.submit({ query: 'a', dirtyFiles: ['x.ts'] }))
    act(() =>
      ref.api!.submit({
        query: 'b',
        dirtyFiles: [],
        activeEditor: { filePath: 'b.ts', selection: { startLine: 3, endLine: 9 } },
      }),
    )
    setStreaming(false)

    const sent = sendChat.mock.calls[0]![0]
    expect(sent.query).toBe('a\nb')
    expect(sent.dirtyFiles).toEqual([])
    expect(sent.activeEditor).toEqual({
      filePath: 'b.ts',
      selection: { startLine: 3, endLine: 9 },
    })
  })

  it('대기열은 프로젝트별로 갈린다 — 다른 프로젝트로 옮기면 그 큐가 보인다', () => {
    const { ref, setProject } = harness('A')
    // A 에서 스트리밍 중 두 건 쌓는다
    setProject('A', true)
    act(() => ref.api!.submit(msg('A-1')))
    act(() => ref.api!.submit(msg('A-2')))
    expect(ref.api!.pending).toBe(2)

    // B 로 옮기면 B 는 비어 있다 (A 의 대기열이 새지 않는다)
    setProject('B', false)
    expect(ref.api!.pending).toBe(0)

    // 다시 A 로 오면 A 의 대기열이 그대로 남아 있다
    setProject('A', true)
    expect(ref.api!.pending).toBe(2)
    expect(ref.api!.queries).toEqual(['A-1', 'A-2'])
  })

  it('탭을 옮긴 사이 그 프로젝트의 턴이 끝나면, 돌아왔을 때 한 번에 보낸다', () => {
    const { ref, setProject } = harness('X')
    setProject('X', true) // X 스트리밍 중
    act(() => ref.api!.submit(msg('기다렸다')))

    // B 로 옮겨 보는 동안 X 는 계속 대기 (아직 안 보냄)
    setProject('B', false)
    expect(sendChat).not.toHaveBeenCalled()

    // X 로 돌아오니 이제 X 의 턴이 끝나 있다(streaming=false) → 쌓인 것을 보낸다
    setProject('X', false)
    expect(sendChat).toHaveBeenCalledTimes(1)
    expect(sendChat.mock.calls[0]![0].query).toBe('기다렸다')
  })
})
