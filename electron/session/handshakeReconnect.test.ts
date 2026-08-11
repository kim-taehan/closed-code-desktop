import { describe, expect, it } from 'vitest'
import { Handshake } from './handshake'

// 재연결 축만 따로 둔다 — handshake.test.ts 가 300줄 상한에 닿았고,
// 이쪽은 "소켓이 두 번 열린다" 는 별개의 관심사다.

describe('Handshake 재연결', () => {

  it('재연결로 소켓이 다시 열리면 핸드셰이크를 처음부터 다시 한다', async () => {
    // 회귀 방지: 실제 runtime 에서만 드러났던 버그다 (2026-07-29).
    // backend 502 로 license heartbeat 이 막히자 runtime 이 `code=4000
    // reason='ping watchdog timeout'` 으로 소켓을 끊었다. 데스크톱은 conn=open 까지
    // 정상 복구했지만 stage 가 'ready' 로 굳어 있어 **새 소켓에 아무것도 보내지 않았고**,
    // 이후 모든 채팅이 무응답이 됐다 (runtime 로그에 프레임 도착 흔적 자체가 없었다).
    //
    // 조건을 완화하지 말 것: "이미 ready 니까 다시 할 필요 없다" 가 정확히 그 버그다.
    // 재연결된 소켓은 runtime 입장에서 인증도 workspace_sync 도 받지 않은 새 세션이다.
    let fireOpen = () => {}
    const sent: string[] = []
    const transport = {
      isOpen: false,
      send: (raw: string) => {
        sent.push(raw)
        return true
      },
      onOpen: (handler: () => void) => {
        fireOpen = handler
        return () => {}
      },
      onMessage: (handler: (raw: string) => void) => {
        deliver = handler
        return () => {}
      },
      onClose: () => () => {},
      onError: () => () => {},
      close: () => {},
    }
    let deliver: (raw: string) => void = () => {}

    const handshake = new Handshake(transport, { workspacePath: '/tmp' })
    const ready = handshake.run()

    const walkToReady = () => {
      deliver(JSON.stringify({ kind: 'system', action: 'connected', data: {} }))
      deliver(JSON.stringify({ kind: 'auth', action: 'auth_request', data: { state: 'valid' } }))
      deliver(JSON.stringify({ kind: 'workspace', action: 'workspace_state', data: { state: 'ready' } }))
    }

    fireOpen()
    walkToReady()
    await ready
    expect(handshake.state.stage).toBe('ready')

    const beforeReconnect = sent.length
    expect(beforeReconnect).toBeGreaterThan(0)

    // 소켓이 끊겼다 다시 열린다
    fireOpen()
    expect(handshake.state.stage, '재연결 후 처음 단계로 돌아가야 한다').toBe('awaiting_connected')

    // 그리고 인증·workspace_sync 를 실제로 다시 보낸다
    walkToReady()
    expect(handshake.state.stage).toBe('ready')
    expect(sent.length, '재연결 후 프레임을 다시 보내지 않았다').toBeGreaterThan(beforeReconnect)

    const resent = sent.slice(beforeReconnect).join(' ')
    expect(resent, '재연결 후 auth_request 를 보내지 않았다').toContain('auth_request')
    expect(resent, '재연결 후 workspace_sync 를 보내지 않았다').toContain('workspace_sync')

    handshake.dispose()
  })
})
