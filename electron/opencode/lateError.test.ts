import { describe, expect, it } from 'vitest'
import { ChunkType } from '../../shared/protocol/chunkTypes'
import { fakeServer, makeTransport, tick } from './transportTestKit'

/**
 * **턴이 열려 있지 않을 때 도착한 오류.**
 *
 * `onEvent` 는 턴이 없는 동안 오는 스트림 프레임을 버린다 — 종료 신호가 겹칠 때
 * `stream_end` 가 두 번 나가는 것을 막으려는 방어다. 그런데 그 그물이 **오류까지**
 * 걷어내서, 턴이 닫힌 뒤(또는 열리기 전) 온 `session.error` 는 화면에 아무것도 안 남긴다.
 * 사용자에게는 "아무 일도 없었다" 로 보인다.
 *
 * 같은 파일의 `onCancel` 이 이미 반대 원칙을 적어 뒀다 — *"조용히 버리지 않는다."*
 * 그 선례를 오류에도 적용한다. **닫는 프레임은 계속 버린다** — 닫을 턴이 없다.
 */
describe('턴 밖에서 온 오류', () => {
  async function connected() {
    const server = fakeServer()
    const transport = makeTransport(server)
    const seen: string[] = []
    transport.onMessage((raw) => seen.push(raw))
    transport.open()
    await tick()
    server.emit('server.connected')
    await tick()
    return { server, transport, seen }
  }

  it('턴이 없어도 오류는 화면까지 올린다', async () => {
    const { server, transport, seen } = await connected()

    server.emit('session.error', { error: { data: { message: '분당 요청 수 한도를 넘겼습니다' } } })
    await tick()

    const frames = seen.map((raw) => JSON.parse(raw) as Record<string, unknown>)
    const error = frames.find(
      (frame) => (frame['data'] as Record<string, unknown> | undefined)?.['messageType'] === ChunkType.ERROR,
    )
    expect(error, '턴이 없다고 오류를 삼키면 사용자는 아무것도 못 본다').toBeDefined()
    expect((error?.['data'] as Record<string, unknown>)['message']).toBe('분당 요청 수 한도를 넘겼습니다')

    transport.close()
  })

  /** 닫을 턴이 없는데 `stream_end` 를 내보내면 위층이 없는 턴을 닫는다 */
  it('그래도 턴을 닫는 프레임은 안 내보낸다', async () => {
    const { server, transport, seen } = await connected()

    server.emit('session.error', { error: { data: { message: '터졌다' } } })
    await tick()

    const actions = seen.map((raw) => (JSON.parse(raw) as Record<string, unknown>)['action'])
    expect(actions).not.toContain('stream_end')

    transport.close()
  })
})
