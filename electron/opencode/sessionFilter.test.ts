import { describe, expect, it } from 'vitest'
import { fakeServer, makeTransport, tick } from './transportTestKit'

/**
 * **보던 대화를 턴 도중에 지웠을 때의 격리** (`sessionFilter.ts` ⚠️ 절).
 *
 * 세션 id 가 null 이 된 채 턴이 살아 있다. 예전 필터는 세션이 null 이면 전부 통과시켜서
 * 남의 세션 승인·질문이 내 카드로 떴다. 동시에, 그 턴 자신의 종료 신호는 받아야 턴이 닫힌다.
 */
describe('턴 도중 보던 대화를 지웠다', () => {
  async function deletedMidTurn() {
    const server = fakeServer()
    const transport = makeTransport(server)
    const seen: Record<string, unknown>[] = []
    transport.onMessage((raw) => seen.push(JSON.parse(raw) as Record<string, unknown>))
    transport.open()
    await tick()
    server.emit('server.connected')
    await tick()
    const send = (frame: Record<string, unknown>) => transport.send(JSON.stringify({ reqId: 'r', ...frame }))
    send({ kind: 'workspace', action: 'workspace_sync', data: { workspace: { workspacePath: '/tmp/proj' } } })
    await tick()
    send({ kind: 'chat', action: 'chat_request', data: { query: '길게' } })
    await tick()
    send({ kind: 'chat_history', action: 'chat_history_remove', data: { chat_id: 'ses_fake' } })
    await tick()
    // 전제: 지웠다는 봉투가 나갔고, 턴은 아직 열려 있다
    expect(seen.some((frame) => frame['action'] === 'chat_history_remove')).toBe(true)
    expect(seen.some((frame) => frame['action'] === 'stream_end')).toBe(false)
    return { server, transport, seen }
  }

  const cards = (seen: Record<string, unknown>[]) =>
    seen.filter((frame) => {
      const type = (frame['data'] as Record<string, unknown> | undefined)?.['messageType']
      return type === 'tool_approval_request' || type === 'user_question'
    })

  it('남의 세션 승인·질문은 카드로 뜨지 않는다', async () => {
    const { server, transport, seen } = await deletedMidTurn()

    server.emit('permission.asked', {
      id: 'per_남',
      sessionID: 'ses_남의것',
      permission: 'bash',
      patterns: ['rm -rf /'],
    })
    server.emit('question.asked', {
      id: 'que_남',
      sessionID: 'ses_남의것',
      questions: [{ question: '남의 질문', options: [{ label: '예' }] }],
    })
    await tick()

    expect(cards(seen), '세션이 null 이라고 열어 두면 남의 카드가 내 화면에 뜬다').toEqual([])
    transport.close()
  })

  it('지운 대화의 턴은 제 종료 신호로 닫힌다', async () => {
    const { server, transport, seen } = await deletedMidTurn()

    server.emit('session.idle', { sessionID: 'ses_fake' })
    await tick()

    expect(seen.filter((frame) => frame['action'] === 'stream_end')).toHaveLength(1)
    transport.close()
  })
})
