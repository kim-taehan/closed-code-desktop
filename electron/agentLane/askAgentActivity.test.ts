import { afterEach, describe, expect, it } from 'vitest'
import { FakeRuntimeServer } from '../../tests/fake-runtime/FakeRuntimeServer'
import {
  streamEnd,
  streamStart,
  textChunk,
  textOnlyTurn,
  thinkingChunk,
  toolCallChunk,
  turnStart,
} from '../../tests/fake-runtime/turnScript'
import { askAgent, laneConfigOf, type AgentLaneConfig } from './askAgent'
import type { ChatRequestContext } from '../../tests/fake-runtime/FakeRuntimeServer'

// **답하는 도중의 활동**을 흘리는 통로 (`askAgent.test.ts` 의 짝).
//
// 왜 있나: 질의 하나가 수십 초~수 분이라, 그동안 확장이 화면에 말할 것이 없으면 사람은
// **멈춘 것으로 읽는다** (실측 불만: *"채팅 진행중인 내용도 보여주면 안될까 멈춘것 같아"*).
// `thinking`·`tool_call` 청크는 이미 레인에 들어오는데 텍스트만 남기고 버리고 있었다.
//
// 여기서 잠그는 계약 셋: **답은 그대로일 것**(도구·생각이 섞이면 확장이 그것까지 파싱해야
// 한다) · 받는 쪽이 터져도 질의는 살 것 · 안 주면 예전과 똑같을 것.
//
// 가짜인 것은 runtime 뿐이고 소켓·핸드셰이크·프레임은 전부 실제 코드다.

function script(context: ChatRequestContext) {
  return { ...context, turnId: `turn-${context.streamId}` }
}

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

afterEach(async () => {
  await server?.stop()
})

describe('답하는 도중의 활동', () => {
  it('생각·도구·텍스트를 알리되 답에는 텍스트만 남는다', async () => {
    await boot({
      onChatRequest: (context) => {
        const one = script(context)
        return [
          streamStart(one),
          turnStart(one),
          thinkingChunk(one, '컨트롤러부터 본다'),
          toolCallChunk(one, 'grep_search', 'c1', { pattern: '@RestController' }),
          textChunk(one, '화면 3개'),
          textChunk(one, '를 찾았습니다'),
          streamEnd(one, { terminal: true, failed: false }),
        ]
      },
    })

    const seen: { kind: string; text: string }[] = []
    const answer = await askAgent(lane, '분석해줘', { onActivity: (one) => seen.push(one) })

    // **답은 예전과 똑같다.** 이것이 이 기능의 전제다
    expect(answer).toBe('화면 3개를 찾았습니다')
    expect(seen).toEqual([
      { kind: 'thinking', text: '컨트롤러부터 본다' },
      // 인자를 곁들인다 — 이름만 보이면 `read_file` 이 줄줄이 뜨는데 다 같은 줄이 된다
      { kind: 'tool', text: 'grep_search {"pattern":"@RestController"}' },
      { kind: 'text', text: '화면 3개' },
      { kind: 'text', text: '를 찾았습니다' },
    ])
  })

  it('받는 쪽이 던져도 답은 끝까지 온다 — 곁가지가 질의를 죽이지 않는다', async () => {
    await boot({ onChatRequest: (context) => textOnlyTurn(script(context), '끝') })

    const answer = await askAgent(lane, '분석해줘', {
      onActivity: () => {
        throw new Error('화면이 터졌다')
      },
    })

    expect(answer).toBe('끝')
  })

  it('안 주면 예전과 똑같이 돈다 — 청크를 그냥 버린다', async () => {
    await boot({
      onChatRequest: (context) => {
        const one = script(context)
        return [
          streamStart(one),
          turnStart(one),
          thinkingChunk(one, '버려질 생각'),
          textChunk(one, '답'),
          streamEnd(one, { terminal: true, failed: false }),
        ]
      },
    })

    expect(await askAgent(lane, '분석해줘')).toBe('답')
  })

  it('빈 줄은 안 보낸다 — 화면에 빈 칸만 늘고 아무것도 안 말한다', async () => {
    await boot({
      onChatRequest: (context) => {
        const one = script(context)
        return [
          streamStart(one),
          turnStart(one),
          thinkingChunk(one, '   '),
          textChunk(one, '답'),
          streamEnd(one, { terminal: true, failed: false }),
        ]
      },
    })

    const seen: { kind: string; text: string }[] = []
    await askAgent(lane, '분석해줘', { onActivity: (one) => seen.push(one) })

    expect(seen).toEqual([{ kind: 'text', text: '답' }])
  })
})
