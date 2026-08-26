import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryConnection } from '../../tests/fake-runtime/MemoryConnection'
import { Heartbeat } from './heartbeat'

// 하트비트 (설계 §4.3).
//
// **이 네 건은 `connection.test.ts` 에서 옮겨 왔다 (2026-08-26).** 그 파일은 davis
// `WsConnection` 을 재던 것이라 전송이 죽으면서 함께 없어졌는데, `Heartbeat` 는 죽지 않았다 —
// `session/sessionWiring.ts:66` 이 **지금도 프로덕션에서 만든다.** 다만 opencode 경로에서는
// `watchdogMs: 0` 으로 감시를 끈다: opencode 에는 ping/pong 자체가 없고 SSE 하트비트는
// `data:` 가 아닌 주석 줄이라 프레임으로 올라오지도 않아, 켜 두면 90초마다 오발한다.
//
// 그래서 **와치독 두 건은 지금 프로덕션이 안 밟는 길을 잰다.** 지운 것이 아니라 남긴 것이고,
// 이유는 `Heartbeat` 가 `Transport` 만 알아 davis 든 opencode 든 갈아끼울 수 있는 부품이기
// 때문이다 — ping 을 주는 상대가 다시 생기면 그날 이 두 건이 그 자리를 지킨다.
//
// 구동은 인메모리 대역이다. `Heartbeat` 는 `Transport` 인터페이스만 요구하므로
// (설계 §10 DIP) 소켓이 없어도 재는 것이 달라지지 않는다.

let connection: MemoryConnection | null = null

afterEach(() => {
  connection?.dispose()
  connection = null
})

async function setup(options: ConstructorParameters<typeof Heartbeat>[1]) {
  connection = new MemoryConnection()
  const heartbeat = new Heartbeat(connection, options)
  heartbeat.start()
  await connection.connect()
  return { heartbeat, runtime: connection.runtime }
}

describe('Heartbeat', () => {
  it('ping 에 같은 ping_id 로 pong 을 회신한다', async () => {
    const { heartbeat, runtime } = await setup({ watchdogMs: 0 })

    runtime.sendPing('p-42')

    await vi.waitFor(() => expect(runtime.pongIds).toEqual(['p-42']))
    expect(heartbeat.pongsSent).toBe(1)
    expect(heartbeat.lastPingId).toBe('p-42')
  })

  it('ping 이 아닌 프레임에는 반응하지 않는다', async () => {
    const { heartbeat, runtime } = await setup({ watchdogMs: 0 })

    // connected 프레임이 이미 왔지만 pong 은 없어야 한다
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(heartbeat.pongsSent).toBe(0)
    expect(runtime.pongIds).toEqual([])
  })

  it('ping 이 오지 않으면 와치독이 발화한다', async () => {
    let fired = false
    const { heartbeat } = await setup({ watchdogMs: 60, onWatchdogTimeout: () => (fired = true) })

    await vi.waitFor(() => expect(fired).toBe(true), { timeout: 1000 })
    heartbeat.stop()
  })

  it('ping 을 받으면 와치독이 다시 무장된다', async () => {
    let fired = false
    const { heartbeat, runtime } = await setup({ watchdogMs: 150, onWatchdogTimeout: () => (fired = true) })

    // 100ms 마다 ping 을 보내 와치독이 발화하지 못하게 한다
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      runtime.sendPing(`p-${i}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(fired).toBe(false)
    expect(heartbeat.pongsSent).toBe(3)
    heartbeat.stop()
  })
})
