import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeRuntimeServer } from '../../tests/fake-runtime/FakeRuntimeServer'
import { WsConnection } from './connection'
import { Heartbeat } from './heartbeat'

let server: FakeRuntimeServer | null = null
let connection: WsConnection | null = null

afterEach(async () => {
  connection?.dispose()
  connection = null
  await server?.stop()
  server = null
})

describe('WsConnection 연결', () => {
  it('연결하면 connected 프레임을 받는다', async () => {
    server = new FakeRuntimeServer()
    const port = await server.start()
    connection = new WsConnection({ url: `ws://127.0.0.1:${port}/ws?csid=c1` })

    const received: string[] = []
    connection.onMessage((raw) => received.push(raw))
    await connection.connect()

    await vi.waitFor(() => expect(received.length).toBeGreaterThan(0))
    expect(JSON.parse(received[0]!)).toMatchObject({ kind: 'system', action: 'connected' })
    expect(connection.isOpen).toBe(true)
    expect(connection.currentState).toBe('open')
  })

  it('열려 있지 않으면 send 가 false 를 주고 던지지 않는다', () => {
    connection = new WsConnection({ url: 'ws://127.0.0.1:1/ws', autoReconnect: false })
    expect(connection.send('{}')).toBe(false)
  })

  it('연결 실패는 던진다', async () => {
    connection = new WsConnection({
      url: 'ws://127.0.0.1:1/ws',
      autoReconnect: false,
      connectTimeoutMs: 300,
    })
    await expect(connection.connect()).rejects.toThrow()
  })

  it('수동 close 후에는 재연결하지 않는다', async () => {
    server = new FakeRuntimeServer()
    const port = await server.start()
    connection = new WsConnection({ url: `ws://127.0.0.1:${port}/ws`, initialReconnectDelayMs: 10 })
    await connection.connect()

    connection.close()
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(connection.currentState).toBe('closed')
    expect(connection.attempts).toBe(0)
  })
})

describe('WsConnection 지수 백오프', () => {
  it('시도할수록 지연이 2배로 늘고 상한에서 멈춘다', () => {
    connection = new WsConnection({
      url: 'ws://127.0.0.1:1/ws',
      initialReconnectDelayMs: 100,
      maxReconnectDelayMs: 800,
    })

    const delays: number[] = []
    for (let attempt = 0; attempt < 6; attempt++) {
      delays.push(connection.nextDelay())
      // nextDelay 는 attempts 를 읽으므로 시도 횟수를 흉내낸다
      ;(connection as unknown as { reconnectAttempts: number }).reconnectAttempts = attempt + 1
    }

    expect(delays).toEqual([100, 200, 400, 800, 800, 800])
  })

  it('예기치 않은 끊김 후 자동으로 다시 붙는다', async () => {
    server = new FakeRuntimeServer()
    const port = await server.start()
    connection = new WsConnection({
      url: `ws://127.0.0.1:${port}/ws`,
      initialReconnectDelayMs: 20,
      maxReconnectDelayMs: 50,
    })

    let openCount = 0
    connection.onOpen(() => (openCount += 1))
    await connection.connect()
    expect(openCount).toBe(1)

    // 서버가 소켓을 끊는다 (수동 close 가 아니므로 재연결 대상)
    server.push([])
    await server.stop()
    server = new FakeRuntimeServer()
    // 같은 포트로 다시 띄울 수 없으므로, 재시도가 실제로 일어나는지만 본다
    await vi.waitFor(() => expect(connection!.attempts).toBeGreaterThan(0), { timeout: 2000 })
    expect(connection.currentState).toBe('reconnecting')
  })
})

describe('Heartbeat', () => {
  it('ping 에 같은 ping_id 로 pong 을 회신한다', async () => {
    server = new FakeRuntimeServer()
    const port = await server.start()
    connection = new WsConnection({ url: `ws://127.0.0.1:${port}/ws` })
    const heartbeat = new Heartbeat(connection, { watchdogMs: 0 })
    heartbeat.start()
    await connection.connect()

    server.sendPing('p-42')

    await vi.waitFor(() => expect(server!.pongIds).toEqual(['p-42']))
    expect(heartbeat.pongsSent).toBe(1)
    expect(heartbeat.lastPingId).toBe('p-42')
  })

  it('ping 이 아닌 프레임에는 반응하지 않는다', async () => {
    server = new FakeRuntimeServer()
    const port = await server.start()
    connection = new WsConnection({ url: `ws://127.0.0.1:${port}/ws` })
    const heartbeat = new Heartbeat(connection, { watchdogMs: 0 })
    heartbeat.start()
    await connection.connect()

    // connected 프레임이 이미 왔지만 pong 은 없어야 한다
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(heartbeat.pongsSent).toBe(0)
    expect(server.pongIds).toEqual([])
  })

  it('ping 이 오지 않으면 와치독이 발화한다', async () => {
    server = new FakeRuntimeServer()
    const port = await server.start()
    connection = new WsConnection({ url: `ws://127.0.0.1:${port}/ws` })

    let fired = false
    const heartbeat = new Heartbeat(connection, { watchdogMs: 60, onWatchdogTimeout: () => (fired = true) })
    heartbeat.start()
    await connection.connect()

    await vi.waitFor(() => expect(fired).toBe(true), { timeout: 1000 })
    heartbeat.stop()
  })

  it('ping 을 받으면 와치독이 다시 무장된다', async () => {
    server = new FakeRuntimeServer()
    const port = await server.start()
    connection = new WsConnection({ url: `ws://127.0.0.1:${port}/ws` })

    let fired = false
    const heartbeat = new Heartbeat(connection, { watchdogMs: 150, onWatchdogTimeout: () => (fired = true) })
    heartbeat.start()
    await connection.connect()

    // 100ms 마다 ping 을 보내 와치독이 발화하지 못하게 한다
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      server.sendPing(`p-${i}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(fired).toBe(false)
    expect(heartbeat.pongsSent).toBe(3)
    heartbeat.stop()
  })
})
