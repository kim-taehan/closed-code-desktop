import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  planApprovalChunk,
  streamEnd,
  streamStart,
  textChunk,
  toolApprovalRequestChunk,
  turnPausedForQuestion,
  turnStart,
  userQuestionChunk,
  type ServerFrame,
} from '../../tests/runtime-protocol/turnScript'
import { connectAndHandshake, countOf, textsOf, type SessionFixture } from '../../tests/runtime-protocol/chatSessionKit'
import { ChatHistoryController } from './chatHistory'

// 이력 재생 중 죽은 인터럽트 억제 (vscode DC-866 미러).
//
// runtime 은 HIL 3종 청크를 JSONL 에 영속하고 재생 시 타입 필터 없이 원형 재전송한다 —
// chat 청크에 재생 표식이 없어 억제는 IDE 책임이다. 안 거르면 응답할 곳 없는
// 죽은 승인 모달/질문·계획 카드가 이력을 열 때마다 나타난다.

let fixture: SessionFixture | null = null
let history: ChatHistoryController | null = null

afterEach(async () => {
  history?.stop()
  history = null
  await fixture?.dispose()
  fixture = null
})

/** projectSession.loadHistory 와 같은 배선으로 이력 로드를 시작한다 */
function wireAndLoad(chatId: string): ChatHistoryController {
  history = new ChatHistoryController(fixture!.connection)
  history.onLoadComplete(() => fixture!.chat.endHistoryReplay())
  history.start()
  fixture!.chat.reset()
  fixture!.chat.beginHistoryReplay()
  history.load(chatId)
  return history
}

/** HIL 3종이 모두 있던 대화의 재생 프레임. 재생된 stream_end 에는 terminal 이 없다 (JSONL 실측). */
function replayedHilTurn(chatId: string): ServerFrame[] {
  const o = { reqId: 'replay', streamId: 's-old', chatId, turnId: 'turn-old' }
  return [
    streamStart(o),
    turnStart(o),
    toolApprovalRequestChunk(o, 'r-old', 'edit_file'),
    userQuestionChunk(o, 'q-old', '예전 질문?'),
    planApprovalChunk(o, 'p-old', '예전 계획'),
    textChunk(o, '예전 답변'),
    streamEnd(o, {}),
  ]
}

describe('재생 중 억제', () => {
  it('재생된 인터럽트 3종은 이벤트로 올리지 않는다 — 메시지 복원은 그대로', async () => {
    fixture = await connectAndHandshake({ onHistoryLoad: (chatId) => replayedHilTurn(chatId) })
    wireAndLoad('c1')

    await vi.waitFor(() => expect(textsOf(fixture!.events)).toContain('예전 답변'))
    await vi.waitFor(() => expect(history!.state.loading).toBe(false))

    expect(countOf(fixture.events, 'approval_requested')).toBe(0)
    expect(countOf(fixture.events, 'question_requested')).toBe(0)
    expect(countOf(fixture.events, 'plan_requested')).toBe(0)
  })

  // 과거 대화에 남은 error 청크도 라이브와 같은 chunkRouter → addError 를 탄다.
  // 재생 경로가 카탈로그를 우회하면 옛 코드값이 이력을 열 때마다 다시 뜬다 (QA 재생 #6).
  // 순서·상태 의존이라 정적 검증으로는 안 잡힌다.
  it('재생된 error 청크도 카탈로그 문구로 복원된다 — 코드값이 다시 뜨지 않는다', async () => {
    fixture = await connectAndHandshake({
      onHistoryLoad: (chatId) => {
        const o = { reqId: 'replay', streamId: 's-old', chatId, turnId: 'turn-old' }
        return [
          streamStart(o),
          turnStart(o),
          {
            ...streamStart(o),
            action: 'stream_chunk',
            data: { messageType: 'error', code: 'OPENAI_TOO_MANY_REQUESTS', message: 'rate limited' },
          },
          streamEnd(o, {}),
        ]
      },
    })
    wireAndLoad('c1')

    await vi.waitFor(() => expect(history!.state.loading).toBe(false))

    const error = fixture.chat.snapshot().messages.find((m) => m.kind === 'error')
    expect(error?.content).toContain('요청 한도 초과')
    expect(error?.content).not.toContain('OPENAI_TOO_MANY_REQUESTS')
    expect(error?.content).not.toContain('rate limited')
  })

  it('autoApprove 세션이어도 재생된 승인에 자동 응답을 보내지 않는다 — 죽은 requestId 다', async () => {
    fixture = await connectAndHandshake(
      { onHistoryLoad: (chatId) => replayedHilTurn(chatId) },
      { autoApprove: true },
    )
    wireAndLoad('c1')

    await vi.waitFor(() => expect(history!.state.loading).toBe(false))
    expect(fixture.server.received.some((frame) => frame.action === 'tool_approval_response')).toBe(false)
  })
})

describe('재생 종료 후', () => {
  it('load_complete 뒤 라이브 인터럽트는 정상 동작한다', async () => {
    fixture = await connectAndHandshake({
      onHistoryLoad: (chatId) => replayedHilTurn(chatId),
      onChatRequest: (context) =>
        turnPausedForQuestion({ ...context, turnId: 'turn-live' }, 'q-live', '라이브 질문?'),
    })
    wireAndLoad('c1')
    await vi.waitFor(() => expect(history!.state.loading).toBe(false))

    fixture.chat.send('진행해줘')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'question_requested')).toBe(1))
    // 재생분(q-old)은 억제되고 라이브(q-live)만 올라와야 한다
    expect(fixture.events.find((event) => event.type === 'question_requested')).toMatchObject({
      questionId: 'q-live',
    })
  })

  it('load_complete 가 유실되면 폴백 타임아웃이 억제를 푼다', async () => {
    // 로드 중 오류 등으로 load_complete 가 안 오면 억제가 영영 남는다 — 시간이 지나면 스스로 푼다
    fixture = await connectAndHandshake({ onChatRequest: () => [] })
    const o = { reqId: 'replay', streamId: 's-old', chatId: 'c1', turnId: 'turn-old' }

    fixture.chat.beginHistoryReplay()
    fixture.server.push([
      streamStart(o),
      turnStart(o),
      toolApprovalRequestChunk(o, 'r-old', 'edit_file'),
      textChunk(o, '재생 중'),
    ])
    // 텍스트가 도착했는데 승인 이벤트가 없다 = 억제가 걸려 있다
    await vi.waitFor(() => expect(textsOf(fixture!.events)).toContain('재생 중'))
    expect(countOf(fixture.events, 'approval_requested')).toBe(0)

    // 폴백 타이머를 fake 타이머 아래에서 다시 건다 — begin 은 재호출 시 타이머를 재장전한다.
    // (실타이머로 걸린 타이머는 fake 시간 전진으로 발화하지 않는다)
    vi.useFakeTimers()
    try {
      fixture.chat.beginHistoryReplay()
      await vi.advanceTimersByTimeAsync(10_000)
    } finally {
      vi.useRealTimers()
    }

    // 폴백이 풀었으니 이후 인터럽트는 다시 올라온다
    fixture.server.push([toolApprovalRequestChunk(o, 'r-live', 'run_command')])
    await vi.waitFor(() => expect(countOf(fixture!.events, 'approval_requested')).toBe(1))
  })
})
