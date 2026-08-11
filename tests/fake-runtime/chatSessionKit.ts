import { FakeRuntimeServer } from './FakeRuntimeServer'
import type { TurnEvent } from '../../shared/ipc/channels'
import { WsConnection } from '../../electron/ws/connection'
import { Handshake } from '../../electron/session/handshake'
import { ChatSession } from '../../electron/session/chatSession'

// ChatSession 테스트 공용 준비 코드.
// 여러 테스트 파일이 같은 배선(연결 → 핸드셰이크 → 채팅)을 필요로 하므로 한곳에 둔다.

export interface SessionFixture {
  chat: ChatSession
  events: TurnEvent[]
  handshake: Handshake
  server: FakeRuntimeServer
  connection: WsConnection
  dispose(): Promise<void>
}

export async function connectAndHandshake(
  serverOptions: ConstructorParameters<typeof FakeRuntimeServer>[0],
  chatOptions: ConstructorParameters<typeof ChatSession>[1] = {},
): Promise<SessionFixture> {
  const server = new FakeRuntimeServer(serverOptions)
  const port = await server.start()
  const connection = new WsConnection({ url: `ws://127.0.0.1:${port}/ws?csid=c1`, autoReconnect: false })

  const chat = new ChatSession(connection, chatOptions)
  const events: TurnEvent[] = []
  chat.onEvent((event) => events.push(event))
  chat.start()

  const handshake = new Handshake(connection, { workspacePath: '/tmp/project' })
  const ready = handshake.run()
  await connection.connect()
  await ready

  return {
    chat,
    events,
    handshake,
    server,
    connection,
    async dispose() {
      handshake.dispose()
      chat.stop()
      connection.dispose()
      await server.stop()
    },
  }
}

/** 이벤트에서 텍스트만 뽑아 순서대로 돌려준다 */
export function textsOf(events: TurnEvent[]): string[] {
  return events
    .filter((event): event is Extract<TurnEvent, { type: 'text' }> => event.type === 'text')
    .map((event) => event.text)
}

export function countOf(events: TurnEvent[], type: TurnEvent['type']): number {
  return events.filter((event) => event.type === type).length
}
