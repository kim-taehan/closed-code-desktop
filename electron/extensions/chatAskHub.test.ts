import { describe, expect, it } from 'vitest'
import { ChatAskHub } from './chatAskHub'

// 프로젝트별 장부. 겨누는 실패는 **A 프로젝트의 확장 요청이 B 의 턴에 묶이는 것**이다.

describe('ChatAskHub', () => {
  it('요청을 그 프로젝트의 화면으로 밀어 넣는다', async () => {
    const sent: { projectId: string; requestId: string; query: string }[] = []
    const hub = new ChatAskHub((projectId, payload) => {
      sent.push({ projectId, ...payload })
      return true
    })

    const waiting = hub.ask('p1', '분석해줘')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ projectId: 'p1', query: '분석해줘' })

    // **표시는 실제로 나갈 때 세션이 한다** — 화면 큐에 쌓여 있는 동안 사용자 턴이 먼저
    // 열려도 그 턴에 묶이면 안 되기 때문이다 (`ChatSession.send`).
    const book = hub.bookFor('p1')
    book.markPending(sent[0]!.requestId)
    book.onStreamStart('st1')
    book.onStreamEnd('st1', '답')
    expect(await waiting).toEqual({ status: 'done', text: '답' })
  })

  it('프로젝트마다 장부가 갈린다 — 남의 턴에 묶이지 않는다', async () => {
    const ids: Record<string, string> = {}
    const hub = new ChatAskHub((projectId, payload) => {
      ids[projectId] = payload.requestId
      return true
    })
    const first = hub.ask('p1', 'A 질문')
    hub.ask('p2', 'B 질문')
    hub.bookFor('p1').markPending(ids['p1']!)
    hub.bookFor('p2').markPending(ids['p2']!)

    // p2 의 턴이 먼저 끝나도 p1 의 약속은 그대로다
    const p2 = hub.bookFor('p2')
    p2.onStreamStart('st-b')
    p2.onStreamEnd('st-b', 'B 답')

    let settled: unknown = null
    void first.then((result) => (settled = result))
    await Promise.resolve()
    expect(settled).toBeNull()

    const p1 = hub.bookFor('p1')
    p1.onStreamStart('st-a')
    p1.onStreamEnd('st-a', 'A 답')
    expect(await first).toEqual({ status: 'done', text: 'A 답' })
  })

  it('열린 프로젝트가 없으면 곧바로 거절한다', async () => {
    const hub = new ChatAskHub(() => true)
    expect(await hub.ask(null, '어디에?')).toEqual({
      status: 'rejected',
      reason: '열린 프로젝트가 없습니다',
    })
  })

  it('화면이 없으면 기다리게 두지 않고 거절한다 — 확장이 영영 매달리면 안 된다', async () => {
    const hub = new ChatAskHub(() => false)
    expect(await hub.ask('p1', '보내줘')).toEqual({
      status: 'rejected',
      reason: '채팅 화면이 없어 보내지 못했습니다',
    })
  })

  it('프로젝트를 닫으면 그 프로젝트의 약속만 되돌린다', async () => {
    const hub = new ChatAskHub(() => true)
    const closing = hub.ask('p1', 'A')
    const staying = hub.ask('p2', 'B')

    hub.dispose('p1', '프로젝트를 닫았습니다')

    expect(await closing).toEqual({ status: 'rejected', reason: '프로젝트를 닫았습니다' })

    let settled: unknown = null
    void staying.then((result) => (settled = result))
    await Promise.resolve()
    expect(settled).toBeNull()
  })
})
