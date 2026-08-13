import { describe, expect, it } from 'vitest'
import { ChatAskBook } from './chatAsk'

// 확장이 채팅으로 물은 것을 되찾는 장부.
//
// 겨누는 실패는 하나다: **남의 턴이 끝났는데 확장의 약속이 풀리는 것.**
// 확장 질의가 사용자 대화와 같은 세션을 나눠 쓰기 때문에 그 구분이 이 장부에만 있다.

describe('ChatAskBook', () => {
  it('보낸 뒤 열린 턴과 묶이고, 그 턴이 끝나면 답으로 풀린다', async () => {
    const book = new ChatAskBook()
    const waiting = book.ask('req1')
    book.markPending('req1')
    book.onStreamStart('st1')
    book.onStreamEnd('st1', '답이다')

    expect(await waiting).toEqual({ status: 'done', text: '답이다' })
  })

  it('**다른 턴**이 끝나도 안 풀린다 — 사용자가 보낸 턴이다', async () => {
    const book = new ChatAskBook()
    let settled: unknown = null
    void book.ask('req1').then((result) => (settled = result))
    book.markPending('req1')
    book.onStreamStart('st1')

    book.onStreamEnd('st9', '사용자 턴의 답')
    await Promise.resolve()
    expect(settled, '남의 턴이 확장의 약속을 풀었다').toBeNull()

    book.onStreamEnd('st1', '내 턴의 답')
    await Promise.resolve()
    expect(settled).toEqual({ status: 'done', text: '내 턴의 답' })
  })

  it('대기 중인 요청이 없으면 턴이 열려도 아무것도 안 묶는다', async () => {
    const book = new ChatAskBook()
    let settled: unknown = null
    void book.ask('req1').then((result) => (settled = result))
    // markPending 없이 사용자가 보낸 턴
    book.onStreamStart('st1')
    book.onStreamEnd('st1', '사용자 답')
    await Promise.resolve()
    expect(settled).toBeNull()
  })

  it('사용자가 끊으면 예외가 아니라 cancelled 로 온다', async () => {
    const book = new ChatAskBook()
    const waiting = book.ask('req1')
    book.markPending('req1')
    book.onStreamStart('st1')
    book.onCancelled('st1')

    expect(await waiting).toEqual({ status: 'cancelled' })
  })

  it('보내지도 못했으면 rejected — 아직 안 묶인 것만 되돌린다', async () => {
    const book = new ChatAskBook()
    const first = book.ask('req1')
    book.markPending('req1')
    book.onStreamStart('st1') // 이건 이미 돈다

    const second = book.ask('req2')
    book.markPending('req2')
    book.rejectPending('세션이 없습니다')

    expect(await second).toEqual({ status: 'rejected', reason: '세션이 없습니다' })
    // 이미 도는 턴은 제 경로로 끝난다
    book.onStreamEnd('st1', '끝났다')
    expect(await first).toEqual({ status: 'done', text: '끝났다' })
  })

  it('호스트가 죽으면 남은 약속을 전부 되돌린다 — 매달린 promise 를 남기지 않는다', async () => {
    const book = new ChatAskBook()
    const bound = book.ask('req1')
    book.markPending('req1')
    book.onStreamStart('st1')
    const pending = book.ask('req2')
    book.markPending('req2')

    book.disposeAll('확장 호스트가 종료되었습니다')

    expect(await bound).toEqual({ status: 'rejected', reason: '확장 호스트가 종료되었습니다' })
    expect(await pending).toEqual({ status: 'rejected', reason: '확장 호스트가 종료되었습니다' })
    expect(book.size).toBe(0)
  })

  it('턴이 끝난 뒤 같은 streamId 가 또 와도 두 번 풀지 않는다', async () => {
    const book = new ChatAskBook()
    const waiting = book.ask('req1')
    book.markPending('req1')
    book.onStreamStart('st1')
    book.onStreamEnd('st1', '처음')
    book.onStreamEnd('st1', '두 번째')

    expect(await waiting).toEqual({ status: 'done', text: '처음' })
    expect(book.size).toBe(0)
  })
})
