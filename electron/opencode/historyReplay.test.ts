import { describe, expect, it } from 'vitest'
import { Action, Kind } from '../../shared/protocol/kinds'
import { ChunkType } from '../../shared/protocol/chunkTypes'
import { replayFrames } from './historyReplay'
import type { OpencodeMessage } from './historyApi'

// 실측 페이로드(opencode 1.18.18, 2026-08-15) → davis 재생 프레임.
//
// 아래 세 건은 **손으로 지어낸 것이 아니다.** 이 앱이 실제로 나눈 대화를
// `GET /session/:id/message` 로 받아 `sessionID`·스냅샷 해시·토큰만 덜어낸 것이다.
// 하필 이 대목을 고른 이유가 둘 있다:
//
//   ① 사용자 글에 **우리가 붙인 `<attached_context>` 꼬리표**가 그대로 저장돼 있다
//   ② 사용자 질문 **하나**에 assistant 메시지가 **둘**이다 (도구 호출 → 답변).
//      opencode 는 step 마다 메시지를 따로 남기므로 이게 예외가 아니라 보통이다.
const EXCHANGE: OpencodeMessage[] = [
  {
    info: { id: 'msg_user1', role: 'user' },
    parts: [
      {
        id: 'prt_u1',
        type: 'text',
        text: '@README.md  이 파일 열어줘\n\n<attached_context>\nfile: /proj/README.md\n</attached_context>',
      },
    ],
  },
  {
    info: { id: 'msg_a1', role: 'assistant' },
    parts: [
      { id: 'prt_s1', type: 'step-start' },
      {
        id: 'prt_t1',
        type: 'tool',
        callID: 'call_00_ET_COUN10f433lZtJolero58610',
        tool: 'open-code-desktop_open_file',
        state: {
          status: 'completed',
          input: { path: 'README.md' },
          output: 'README.md 을(를) 화면에 열었습니다',
          time: { start: 1786777573141, end: 1786777573152 },
        },
      },
      // 도구를 부르려고 끊긴 step — **턴은 아직 안 끝났다** (라이브의 `finish==='tool-calls'`)
      { id: 'prt_f1', type: 'step-finish', reason: 'tool-calls' },
    ],
  },
  {
    info: { id: 'msg_a2', role: 'assistant' },
    parts: [
      { id: 'prt_s2', type: 'step-start' },
      { id: 'prt_x2', type: 'text', text: '열었습니다.' },
      { id: 'prt_f2', type: 'step-finish', reason: 'stop' },
    ],
  },
]

function chunks(frames: ReturnType<typeof replayFrames>): Record<string, unknown>[] {
  return frames
    .filter((frame) => frame['action'] === Action.STREAM_CHUNK)
    .map((frame) => frame['data'] as Record<string, unknown>)
}

function actions(frames: ReturnType<typeof replayFrames>): string[] {
  return frames.map((frame) => String(frame['action']))
}

describe('replayFrames', () => {
  it('사용자 글은 청크가 아니라 chat_request 봉투로 되돌린다', () => {
    const frames = replayFrames('ses_1', EXCHANGE)
    const request = frames.find((frame) => frame['action'] === Action.CHAT_REQUEST)
    expect(request?.['kind']).toBe(Kind.CHAT)
    // 위층이 이 자리를 열어 두고 있다 (`session/frameDispatch.ts` 의 onUserQuery)
    expect((request?.['data'] as { query: string }).query).toContain('이 파일 열어줘')
  })

  it('우리가 붙인 꼬리표는 떼고 되돌린다 — 사용자가 치지 않은 줄이다', () => {
    const frames = replayFrames('ses_1', EXCHANGE)
    const query = (frames.find((f) => f['action'] === Action.CHAT_REQUEST)?.['data'] as { query: string }).query
    expect(query).toBe('@README.md  이 파일 열어줘')
    expect(query).not.toContain('attached_context')
  })

  /**
   * 이 자리가 이 파일의 핵심이다. assistant 메시지마다 스트림을 열면 화면의 턴이
   * 메시지 수만큼 쪼개진다 — 도구를 여럿 부른 대화는 여덟 조각이 된다.
   */
  it('도구 호출로 끊긴 step 은 다음 메시지와 한 스트림으로 묶인다', () => {
    const frames = replayFrames('ses_1', EXCHANGE)
    expect(actions(frames).filter((action) => action === Action.STREAM_START)).toHaveLength(1)
    expect(actions(frames).filter((action) => action === Action.STREAM_END)).toHaveLength(1)
    // 그래도 턴 시작은 메시지마다 하나씩이다 (라이브의 `step.started` 와 같다)
    expect(chunks(frames).filter((c) => c['messageType'] === ChunkType.TURN_START)).toHaveLength(2)
  })

  it('turn_end 는 마지막으로 연 턴 id 로 닫는다 — turnMeta 가 활성 턴을 놓는 근거다', () => {
    const frames = replayFrames('ses_1', EXCHANGE)
    const starts = chunks(frames).filter((c) => c['messageType'] === ChunkType.TURN_START)
    const end = chunks(frames).find((c) => c['messageType'] === ChunkType.TURN_END)
    expect(end?.['turnId']).toBe(starts.at(-1)?.['turnId'])
    expect(end?.['terminal']).toBe(true)
  })

  it('도구는 호출과 결과 두 청크로 갈라 낸다 (라이브 매핑과 같은 모양)', () => {
    const body = chunks(replayFrames('ses_1', EXCHANGE))
    const call = body.find((c) => c['messageType'] === ChunkType.TOOL_CALL)
    const result = body.find((c) => c['messageType'] === ChunkType.TOOL_RESULT)
    expect(call).toMatchObject({
      toolName: 'open-code-desktop_open_file',
      toolCallId: 'call_00_ET_COUN10f433lZtJolero58610',
      // 인자는 라이브에 없고 재생에만 있다 — 없으면 도구 행이 이름만 남는다 (`toolFrames` 주석)
      toolArgs: { path: 'README.md' },
    })
    expect(result).toMatchObject({ success: true, result: 'README.md 을(를) 화면에 열었습니다' })
  })

  it('실패한 도구는 원문 사유를 그대로 싣는다', () => {
    const frames = replayFrames('ses_1', [
      {
        info: { id: 'msg_e', role: 'assistant' },
        parts: [
          { id: 'p', type: 'tool', callID: 'c1', tool: 'bash', state: { status: 'error', error: 'exit 1' } },
        ],
      },
    ])
    expect(chunks(frames).find((c) => c['messageType'] === ChunkType.TOOL_RESULT)).toMatchObject({
      success: false,
      error: 'exit 1',
    })
  })

  it('step-start·step-finish 는 청크로 새지 않는다', () => {
    const types = chunks(replayFrames('ses_1', EXCHANGE)).map((c) => c['messageType'])
    expect(types).not.toContain('step-start')
    expect(types).not.toContain('step-finish')
  })

  it('텍스트는 messageID 까지 넣은 segmentId 로 묶는다 (라이브와 같은 규칙)', () => {
    const text = chunks(replayFrames('ses_1', EXCHANGE)).find((c) => c['messageType'] === ChunkType.TEXT)
    expect(text).toMatchObject({ message: '열었습니다.', segmentId: 'msg_a2:prt_x2' })
  })

  it('reasoning 은 thinking 으로 간다 — 답변 텍스트와 섞이지 않는다', () => {
    const frames = replayFrames('ses_1', [
      {
        info: { id: 'msg_r', role: 'assistant' },
        parts: [{ id: 'prt_r', type: 'reasoning', text: '먼저 구조를 본다' }],
      },
    ])
    expect(chunks(frames).find((c) => c['messageType'] === ChunkType.THINKING)).toMatchObject({
      message: '먼저 구조를 본다',
    })
  })

  // 라이브가 `MessageAbortedError` 를 일부러 안 내보내는 것과 같은 판단이다
  // (`translate.ts` 의 SESSION_ERROR 분기). 안 거르면 사용자가 스스로 끊은 대화를
  // **열 때마다** 빨간 오류가 다시 뜬다 — 라이브에서는 한 번도 안 보이던 것이.
  it('중단으로 끝난 메시지는 오류 청크를 내지 않는다', () => {
    const frames = replayFrames('ses_1', [
      {
        info: { id: 'msg_x', role: 'assistant', error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } },
        parts: [{ id: 'prt_x', type: 'text', text: '쓰다 말았다' }],
      },
    ])
    expect(chunks(frames).some((c) => c['messageType'] === ChunkType.ERROR)).toBe(false)
  })

  it('중단이 아닌 오류는 그대로 남긴다 — 실패한 턴이 조용히 사라지지 않는다', () => {
    const frames = replayFrames('ses_1', [
      {
        info: { id: 'msg_y', role: 'assistant', error: { name: 'ProviderError', data: { message: '한도 초과' } } },
        parts: [],
      },
    ])
    expect(chunks(frames).find((c) => c['messageType'] === ChunkType.ERROR)).toMatchObject({ message: '한도 초과' })
  })

  /**
   * ⚠️ **이 케이스는 원래 정반대를 단언하고 있었다** ("결과를 만들지 않는다"). 결과가 없으면
   * `toolStatusOf` 가 `running` 을 주고(`ToolIcon.tsx:58`) `ToolCallRow` 의 경과시간 타이머가
   * **영영 돈다** — 그것도 재생한 시각부터 세서, 옛 대화에 초가 올라간다. `running` 상태는
   * 중단된 세션에 실제로 영속돼 있다 (contract-qa 실측). 지어낸 실패보다 이쪽이 나쁘다.
   */
  it('결과 없이 끝난 도구도 닫는다 — 안 닫으면 스피너가 영영 돈다', () => {
    const frames = replayFrames('ses_1', [
      {
        info: { id: 'msg_t', role: 'assistant' },
        parts: [{ id: 'prt_t', type: 'tool', callID: 'c1', tool: 'bash', state: { status: 'running' } }],
      },
    ])
    const result = chunks(frames).find((c) => c['messageType'] === ChunkType.TOOL_RESULT)
    expect(result).toBeDefined()
    // 성공했다고 하지 않는다 — 무슨 일이 있었는지를 문구로 남긴다
    expect(result).toMatchObject({ success: false, error: '결과가 기록되기 전에 대화가 끝났습니다' })
  })

  /**
   * 대화가 응답 도중 끊겨 `step-finish` 가 없는 경우. 스트림을 열어 둔 채 넘기면
   * `turnGate` 가 그 대화를 **지금 응답 중**으로 읽어 전송 버튼이 잠긴다.
   */
  it('끝나지 않은 대화도 스트림을 닫고 끝낸다', () => {
    const frames = replayFrames('ses_1', [
      { info: { id: 'msg_o', role: 'assistant' }, parts: [{ id: 'p', type: 'text', text: '답하다 말았다' }] },
    ])
    expect(actions(frames).at(-1)).toBe(Action.STREAM_END)
  })

  it('빈 대화는 프레임을 만들지 않는다', () => {
    expect(replayFrames('ses_1', [])).toEqual([])
  })
})
