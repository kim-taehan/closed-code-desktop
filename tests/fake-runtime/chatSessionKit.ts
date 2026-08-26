import type { TurnEvent } from '../../shared/ipc/channels'
import { MemoryConnection } from './MemoryConnection'
import type { FakeRuntimeOptions, FakeRuntimeProtocol } from './runtimeProtocol'
import { Handshake } from '../../electron/session/handshake'
import { ChatSession } from '../../electron/session/chatSession'

// ChatSession 테스트 공용 준비 코드.
// 여러 테스트 파일이 같은 배선(연결 → 핸드셰이크 → 채팅)을 필요로 하므로 한곳에 둔다.
//
// **`server` 는 이제 소켓 서버가 아니다 (2026-08-26).** 예전에는 진짜 WebSocket 서버
// (`FakeRuntimeServer`)를 띄우고 `WsConnection` 으로 붙었는데, 앱이 opencode 로 옮겨가며
// davis WS 전송이 죽어 그 부분만 걷어냈다. 이름을 남긴 것은 열 몇 개 시험이 가리키는
// 대상이 그대로이기 때문이다 — **대화 상대편**. 지금 그 자리에 있는 것은
// `MemoryConnection` 이 들고 있는 인메모리 프로토콜 대역이다.

export interface SessionFixture {
  chat: ChatSession
  events: TurnEvent[]
  handshake: Handshake
  /** 상대편(런타임 흉내). `received` 를 단언하고 `push` 로 프레임을 밀어 넣는다. */
  server: FakeRuntimeProtocol
  /** 끊김을 만들려면 여기서 `drop()` 한다 — 예전에는 소켓 서버를 껐다 */
  connection: MemoryConnection
  dispose(): Promise<void>
}

export async function connectAndHandshake(
  serverOptions: FakeRuntimeOptions = {},
  chatOptions: ConstructorParameters<typeof ChatSession>[1] = {},
): Promise<SessionFixture> {
  const connection = new MemoryConnection(serverOptions)

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
    server: connection.runtime,
    connection,
    async dispose() {
      handshake.dispose()
      chat.stop()
      connection.dispose()
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
