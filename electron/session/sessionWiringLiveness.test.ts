import { describe, expect, it, vi } from 'vitest'
import { FakeOpencodeServer } from '../../tests/fake-opencode/FakeOpencodeServer'
import { wireSession, type LivenessSink } from './sessionWiring'
import type { ProjectSessionListener } from './projectSessionListener'

// 생사 신호 배선 — 연결 close/open 이 실제로 LivenessSink 까지 닿는가.
// 여기서 잡고 싶은 것은 "구독을 거는 줄이 빠졌다" 뿐이다 — 타입체크가 못 잡는다.
//
// opencode 전환 후 이 신호는 **SSE 스트림의 생사**다 (davis 시절엔 WebSocket 이었다).
// ProjectSession 은 더 이상 liveness 를 주지 않지만(런타임 관리자를 안 쓴다) wireSession 의
// 옵셔널 배선은 남아 있어, 나중에 opencode 프로세스 감시를 붙일 때 이 자리를 그대로 쓴다.

const noopListener: ProjectSessionListener = {
  onState: () => {},
  onTurnEvent: () => {},
  onSnapshot: () => {},
  onPermissionMode: () => {},
  onWorkingDir: () => {},
  onHistoryState: () => {},
  onReviewState: () => {},
  onMcpState: () => {},
  onModelState: () => {},
  onNotification: () => {},
}

async function wireAgainstFake(liveness?: LivenessSink) {
  const server = new FakeOpencodeServer()
  const port = await server.start()
  const wired = wireSession({
    endpoint: { host: '127.0.0.1', port, source: 'test' },
    config: { workspacePath: '/tmp/project' },
    listener: noopListener,
    onHandshakeState: () => {},
    onConnectionState: () => {},
    ...(liveness ? { liveness } : {}),
  })
  await wired.connection.connect()
  return { server, wired }
}

describe('sessionWiring — 연결 생사 신호', () => {
  it('소켓이 열리면 reportConnectionRestored 가 불린다', async () => {
    const liveness = { reportConnectionLost: vi.fn(), reportConnectionRestored: vi.fn() }
    const { server, wired } = await wireAgainstFake(liveness)

    expect(liveness.reportConnectionRestored).toHaveBeenCalled()

    wired.connection.dispose()
    await server.stop()
  })

  it('소켓이 끊기면 reportConnectionLost 가 불린다', async () => {
    const liveness = { reportConnectionLost: vi.fn(), reportConnectionRestored: vi.fn() }
    const { server, wired } = await wireAgainstFake(liveness)

    // 서버가 사라진 상황 — 실제 사망이든 일시 끊김이든 여기까지는 똑같이 온다
    await server.stop()
    await vi.waitFor(() => expect(liveness.reportConnectionLost).toHaveBeenCalled())

    wired.connection.dispose()
  })

  it('liveness 를 안 주면 아무 데도 안 붙는다 (기존 동작)', async () => {
    const { server, wired } = await wireAgainstFake()
    await server.stop()
    // 예외 없이 지나가면 된다 — 옵셔널 배선이 undefined 를 부르지 않는다
    wired.connection.dispose()
  })
})
