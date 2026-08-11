import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntimeServer } from '../../tests/fake-runtime/FakeRuntimeServer'
import { textOnlyTurn, streamEnd, streamStart, turnStart, textChunk } from '../../tests/fake-runtime/turnScript'
import { Action, Kind } from '../../shared/protocol/kinds'
import { askAgent, askViaLane, laneConfigOf, type AgentLaneConfig } from './askAgent'
import type { ChatRequestContext } from '../../tests/fake-runtime/FakeRuntimeServer'

/** 대본 헬퍼가 요구하는 모양. 서버가 주는 문맥에는 turnId 가 없다. */
function script(context: ChatRequestContext) {
  return { ...context, turnId: `turn-${context.streamId}` }
}

// 확장 질의 레인을 **진짜로 굴려** 본다. 가짜인 것은 runtime 뿐이고, 소켓·핸드셰이크·
// 프레임 직렬화는 전부 실제 코드다 (`fake-runtime-replay` 스킬의 하네스).
//
// 여기서 잡으려는 것은 "타입은 맞는데 턴이 안 끝난다" 류다 — 종료 신호를 봉투의 action
// 이 아니라 messageType 으로 잘못 보면 타입은 멀쩡하고 약속만 영원히 안 풀린다.

let server: FakeRuntimeServer
let lane: AgentLaneConfig

async function boot(options: ConstructorParameters<typeof FakeRuntimeServer>[0] = {}): Promise<void> {
  server = new FakeRuntimeServer(options)
  const port = await server.start()
  lane = laneConfigOf(
    { host: '127.0.0.1', port, source: 'test' },
    { workspacePath: '/tmp/프로젝트', projectName: '프로젝트' },
  )
}

beforeEach(() => {
  // 각 시험이 자기 서버를 띄운다 — 대본이 다르다
})

afterEach(async () => {
  await server?.stop()
})

describe('확장 질의 레인', () => {
  it('핸드셰이크를 마치고 답 텍스트를 돌려준다', async () => {
    await boot({ onChatRequest: (context) => textOnlyTurn(script(context), '화면 3개를 찾았습니다') })

    const answer = await askAgent(lane, '이 프로젝트의 화면을 찾아줘')

    expect(answer).toBe('화면 3개를 찾았습니다')
  })

  it('읽기 전용을 chat_request 보다 **먼저** 건다', async () => {
    // 순서가 뒤집히면 그 사이에 에이전트가 편집 도구를 잡을 수 있다.
    await boot({ onChatRequest: (context) => textOnlyTurn(script(context), '끝') })

    await askAgent(lane, '분석해줘')

    const actions = server.received.map((frame) => frame.action)
    const permissionAt = actions.indexOf(Action.SET_PERMISSION_MODE)
    const chatAt = actions.indexOf(Action.CHAT_REQUEST)
    expect(permissionAt).toBeGreaterThan(-1)
    expect(permissionAt).toBeLessThan(chatAt)
    // plan = 읽기 전용 (runtime agent/permission.py)
    expect(server.received[permissionAt]?.data?.['mode']).toBe('plan')
  })

  it('워크스페이스 동기화를 거친다 — 빠뜨리면 runtime 이 chat 을 거부한다', async () => {
    await boot({ onChatRequest: (context) => textOnlyTurn(script(context), '끝') })

    await askAgent(lane, '분석해줘')

    expect(server.received.map((frame) => frame.action)).toContain(Action.WORKSPACE_SYNC)
  })

  it('여러 텍스트 청크를 이어 붙이고 도구 과정은 버린다', async () => {
    // 확장이 원하는 것은 결론이다. 중간 과정이 섞이면 확장이 그걸 파싱해야 한다.
    await boot({
      onChatRequest: (context) => [
        streamStart(script(context)),
        turnStart(script(context)),
        textChunk(script(context), '앞', { semanticType: 'reply' }),
        textChunk(script(context), '뒤', { semanticType: 'reply' }),
        streamEnd(script(context), { terminal: true, failed: false }),
      ],
    })

    expect(await askAgent(lane, '분석해줘')).toBe('앞뒤')
  })

  it('사용자 대화와 섞이지 않게 자기 csid 로 붙는다', async () => {
    await boot({ onChatRequest: (context) => textOnlyTurn(script(context), '끝') })

    await askAgent(lane, '분석해줘')
    await askAgent(lane, '한 번 더')

    // 같은 csid 로 둘을 열면 runtime 이 앞엣것을 끊는다
    expect(new Set(server.connectedCsids).size).toBe(server.connectedCsids.length)
    expect(server.connectedCsids.every((csid) => csid.startsWith('desktop-ext-'))).toBe(true)
  })

  it('에러 청크는 타임아웃까지 매달리지 않고 그 자리에서 올린다', async () => {
    await boot({
      onChatRequest: (context) => [
        streamStart(script(context)),
        {
          kind: Kind.CHAT,
          action: Action.STREAM_CHUNK,
          data: { messageType: 'error', message: '모델이 응답하지 않습니다', chatId: context.chatId },
        },
      ],
    })

    await expect(askAgent(lane, '분석해줘', { timeoutMs: 5_000 })).rejects.toThrow('모델이 응답하지 않습니다')
  })

  it('답이 안 오면 시간 안에 포기한다', async () => {
    // 대본이 없다 = runtime 이 아무 말도 안 한다. 안 끊으면 확장이 영원히 매달린다.
    await boot({})

    await expect(askAgent(lane, '분석해줘', { timeoutMs: 300 })).rejects.toThrow('답하지 않았습니다')
  })
})

describe('연결이 없을 때', () => {
  it('빈 답이 아니라 사유와 함께 거절한다', async () => {
    // 빈 문자열을 주면 확장은 "못 찾았다" 로 읽고 빈 산출물을 낸다.
    await expect(askViaLane(null, '분석해줘')).rejects.toThrow('연결돼 있지 않습니다')
  })
})
