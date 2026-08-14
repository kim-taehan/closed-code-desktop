import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeOpencodeServer } from '../../tests/fake-opencode/FakeOpencodeServer'
import { OpencodeServerPool } from '../opencode/serverPool'
import type { SpawnedServer } from '../opencode/serverProcess'
import type { ProjectRecord } from '../../shared/projects/projectRecord'

// **탭의 수명이 서버의 수명이다** — 3단계 관문.
//
// 서버를 우리가 띄우면서 생긴 계약이다: 탭을 열면 그 프로젝트의 서버가 뜨고, 닫으면
// **그것만** 죽고, 앱이 끝나면 전부 죽는다. 여기서 겨누는 것은 그 배선이지 프로세스
// 제어가 아니다 — 진짜 `opencode serve` 대신 가짜 서버 하나에 붙이고, 죽이는 손짓만 센다.
//
// ⚠️ **넓게 죽이는 것을 잡을 수 있어야 한다.** `pkill -f opencode` 같은 손짓은 사용자가
// 손으로 띄운 서버까지 죽인다. 아래 "한쪽을 닫아도 다른 쪽은 산다" 가 그 자리를 지킨다.

vi.mock('electron', () => ({
  ipcMain: { handle: () => {}, removeHandler: () => {} },
}))

function projectOf(id: string, root: string): ProjectRecord {
  return { id, root, name: id, favorite: false, lastOpenedAt: 0 }
}

/** 화면으로 나가는 것을 받아 두는 가짜 창 */
function windowOf(sent: { channel: string; payload: unknown }[]) {
  return {
    isDestroyed: () => false,
    webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) },
  } as never
}

let server: FakeOpencodeServer

describe('SessionBridge — 서버 수명', () => {
  let stops: Record<string, number> = {}
  let roots: string[] = []
  let sent: { channel: string; payload: unknown }[] = []

  beforeEach(async () => {
    server = new FakeOpencodeServer()
    await server.start()
    stops = {}
    roots = []
    sent = []
  })

  afterEach(async () => {
    await server.stop()
  })

  async function setup() {
    const { SessionBridge } = await import('./bridge')
    const pool = new OpencodeServerPool({
      // 프로젝트마다 새로 "띄운다". 주소는 가짜 서버 하나를 함께 쓴다 —
      // 여기서 재는 것은 **누가 언제 죽는가**이지 주소 격리가 아니다 (그쪽은 serverPool.test.ts).
      start: (root) => {
        roots.push(root)
        // 다시 띄워도 셈을 지우지 않는다 — 재시작은 "죽였다 살렸다" 둘 다 봐야 한다
        stops[root] ??= 0
        const started: SpawnedServer = {
          url: server.baseUrl,
          pid: 1000 + roots.length,
          stop: () => {
            stops[root] = (stops[root] ?? 0) + 1
            return Promise.resolve()
          },
        }
        return Promise.resolve(started)
      },
    })
    return { bridge: new SessionBridge(windowOf(sent), pool), pool }
  }

  it('탭을 열면 그 프로젝트의 서버를 띄운다 — 프로젝트마다 하나', async () => {
    const { bridge } = await setup()

    await bridge.activate(projectOf('A', '/tmp/alpha'))
    await bridge.activate(projectOf('B', '/tmp/beta'))

    expect(roots).toEqual(['/tmp/alpha', '/tmp/beta'])
    await bridge.dispose()
  })

  it('탭을 닫으면 그 서버만 죽는다 — 남의 프로세스를 건드리지 않는다', async () => {
    const { bridge } = await setup()
    await bridge.activate(projectOf('A', '/tmp/alpha'))
    await bridge.activate(projectOf('B', '/tmp/beta'))

    await bridge.closeProject('A')

    expect(stops['/tmp/alpha']).toBe(1)
    expect(stops['/tmp/beta']).toBe(0)
    await bridge.dispose()
  })

  // 재연결은 세션만 다시 붙인다. 서버까지 죽이면 수 초를 더 기다리는데다 MCP 등록이 날아간다.
  it('재연결은 서버를 살려 둔다', async () => {
    const { bridge } = await setup()
    const project = projectOf('A', '/tmp/alpha')
    await bridge.activate(project)

    await bridge.reconnect(project)

    expect(stops['/tmp/alpha']).toBe(0)
    expect(roots).toEqual(['/tmp/alpha']) // 다시 띄우지도 않았다
    await bridge.dispose()
  })

  // Doctor 사다리의 마지막 칸. 여기만 서버를 접었다 다시 띄운다.
  it('runtime 재시작은 접었다 다시 띄운다', async () => {
    const { bridge } = await setup()
    const project = projectOf('A', '/tmp/alpha')
    await bridge.activate(project)

    await bridge.restartRuntime([project])

    expect(stops['/tmp/alpha']).toBe(1)
    expect(roots).toEqual(['/tmp/alpha', '/tmp/alpha'])
    await bridge.dispose()
  })

  it('앱이 끝나면 우리가 띄운 것을 전부 거둔다', async () => {
    const { bridge } = await setup()
    await bridge.activate(projectOf('A', '/tmp/alpha'))
    await bridge.activate(projectOf('B', '/tmp/beta'))

    await bridge.dispose()

    expect(stops).toEqual({ '/tmp/alpha': 1, '/tmp/beta': 1 })
  })

  // 서버를 못 띄우면 세션도 없다. **사유를 화면에 올려야 한다** — 조용히 넘어가면
  // 화면은 영원히 "연결 중" 이고, 실패의 정체(실행 파일 못 찾음)는 로그에만 남는다.
  it('서버를 못 띄우면 그 사유를 화면에 올린다', async () => {
    const { SessionBridge } = await import('./bridge')
    const pool = new OpencodeServerPool({
      start: () => Promise.reject(new Error('opencode 실행 파일을 찾지 못했습니다')),
    })
    const bridge = new SessionBridge(windowOf(sent), pool)

    await bridge.activate(projectOf('A', '/tmp/alpha'))

    const states = sent.map(
      (message) =>
        (message.payload as { payload?: { handshake?: { stage?: string; failure?: { reason?: string } } } })
          .payload?.handshake,
    )
    expect(states.at(-1)?.stage).toBe('failed')
    expect(states.at(-1)?.failure?.reason).toContain('실행 파일을 찾지 못했습니다')
    await bridge.dispose()
  })
})
