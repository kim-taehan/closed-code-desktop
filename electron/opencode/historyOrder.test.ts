import { describe, expect, it } from 'vitest'
import { Action, Kind } from '../../shared/protocol/kinds'
import { Handshake } from '../session/handshake'
import { fakeServer, makeTransport, tick } from './transportTestKit'

// **「새 대화」가 조용히 죽는 자리의 순서를 잠근다** (`chatHistory.ts` 의 `addChat`).
//
// 거기 `if (!reused && !deps.directory) return null` 이 있다. 닿으면 봉투를 하나도 안 내므로
// 위층 `requestNewChat()` 은 응답을 **영영** 못 받는다 — 에러도 로그도 없다.
//
// 안 닿는 근거는 **순서 하나뿐이다**: `directory` 를 채우는 것은 `workspace_sync` 뿐이고
// (`transport.ts` 의 `onWorkspaceSync`), 그 프레임이 나가야 핸드셰이크가 ready 가 되고,
// 그제서야 `session/sessionReady.ts` 의 `primeOnFirstReady` 가 「새 대화」를 부른다.
//
// **그 순서를 잠근 시험이 없었다.** `chatHistory.test.ts` 는 `directory` 를 손으로 넣어
// 주므로 이 자리에 닿지 않는다. 그래서 여기서는 **진짜 `Handshake` 를 물려** 순서대로 밟는다.

async function readyTransport() {
  const server = fakeServer()
  const transport = makeTransport(server)
  const seen: string[] = []
  transport.onMessage((raw) => seen.push(raw))

  const done = new Handshake(transport, { workspacePath: '/tmp/proj', projectName: 'proj' }).run()
  transport.open()
  await tick()
  server.emit('server.connected')
  await tick()
  await done

  return { server, transport, seen }
}

function send(transport: { send: (raw: string) => void }, kind: string, action: string, data = {}) {
  transport.send(JSON.stringify({ kind, action, reqId: 'r', data }))
}

const addFrames = (seen: string[]) => seen.filter((raw) => raw.includes(Action.CHAT_HISTORY_ADD))

describe('「새 대화」는 workspace_sync 뒤에만 온다', () => {
  // 핸드셰이크가 만들어 둔 빈 세션을 그대로 준다. 여기서 또 만들면 방금 붙은 세션을 버린다.
  it('ready 직후 — 핸드셰이크가 만든 세션을 재사용해 봉투를 낸다', async () => {
    const { transport, seen } = await readyTransport()

    send(transport, Kind.CHAT_HISTORY, Action.CHAT_HISTORY_ADD)
    await tick()

    expect(addFrames(seen)).toHaveLength(1)
    expect(addFrames(seen)[0]).toContain('"state":"ready"')
    transport.close()
  })

  // **이쪽이 그 가지를 실제로 지난다.** 말을 건 뒤에는 재사용할 세션이 없어(`emptySession=false`)
  // `directory` 가 유일한 근거가 된다 — 비어 있으면 여기서 조용히 null 이 나간다.
  it('말을 건 뒤에도 — directory 가 남아 있어 새 세션을 만든다', async () => {
    const { transport, seen } = await readyTransport()

    send(transport, Kind.CHAT, Action.CHAT_REQUEST, { message: '안녕' })
    await tick()
    send(transport, Kind.CHAT_HISTORY, Action.CHAT_HISTORY_ADD)
    await tick()

    expect(addFrames(seen)).toHaveLength(1)
    expect(addFrames(seen)[0]).toContain('"state":"created"')
    transport.close()
  })

  // 순서가 깨졌을 때의 **모양**을 적어 둔다. 이 케이스가 초록인 것은 결함이 없다는 뜻이
  // 아니라, 위 둘이 겨누는 것이 진짜로 「순서」라는 근거다 — workspace_sync 없이 부르면
  // 아무 봉투도 안 나온다. 프라이밍을 앞으로 당기는 사람은 이 줄을 먼저 보라.
  it('workspace_sync 전에 부르면 봉투가 하나도 안 나온다 — 조용히 죽는다', async () => {
    const server = fakeServer()
    const transport = makeTransport(server)
    const seen: string[] = []
    transport.onMessage((raw) => seen.push(raw))
    transport.open()
    await tick()
    server.emit('server.connected')
    await tick()

    send(transport, Kind.CHAT_HISTORY, Action.CHAT_HISTORY_ADD)
    await tick()

    expect(addFrames(seen)).toHaveLength(0)
    transport.close()
  })
})
