import { describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { Channel } from '../../shared/ipc/channels'

// 회귀 방지: SESSION_RECONNECT 가 재연결을 **기다리지 않고** 즉시 응답했다.
//
// 재연결은 세션 종료 → 재생성 → 탐색 → 연결 → 핸드셰이크(인증 최대 15초)까지다.
// 안 기다리면 renderer 의 `await reconnectProject()` 가 곧바로 풀리고, 자가 진단은
// 그게 끝난 줄 알고 3초만 재확인한다(RECONNECT_TRIES). 당연히 실패하고 사다리가
// 다음 칸인 **런타임 재시작**으로 올라간다 — 멀쩡히 살아 있는 런타임을 죽였다.
//
// 조건을 완화하지 말 것: "재연결은 금방 끝나니 안 기다려도 된다" 가 정확히 그 버그다.

vi.mock('electron', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    ipcMain: {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
      removeHandler: (channel: string) => handlers.delete(channel),
      __invoke: (channel: string, ...args: unknown[]) => handlers.get(channel)?.(...args),
      __has: (channel: string) => handlers.has(channel),
    },
    // 등록 중에 실행 목록 저장소 자리를 묻는다 (`run/runListDir.ts`). 이 시험은 그 채널에
    // 닿지 않지만, 없으면 `register()` 자체가 터진다 (`wiring.test.ts` 와 같은 이유).
    app: { getPath: () => '/tmp' },
  }
})

describe('SESSION_RECONNECT 는 재연결이 끝날 때까지 응답하지 않는다', () => {
  it('핸들러가 onReconnect 의 Promise 를 기다린다', async () => {
    const { ProjectBridge } = await import('./projectBridge')
    let release: (() => void) | null = null
    const slow = new Promise<void>((resolve) => {
      release = resolve
    })

    const project = { id: 'p1', name: 'p', root: '/p' }
    const bridge = new ProjectBridge(
      { webContents: { send: () => {} } } as never,
      {
        active: project,
        all: [project],
        openProjects: [project],
        setLicenseKey: async () => {},
      } as never,
      {
        onActivate: () => {},
        onClose: () => {},
        onReconnect: () => slow,
        onRestartRuntime: () => Promise.resolve(),
        onRuntimeConfigChange: () => Promise.resolve(),
        onCheckRuntimeUpdate: () => Promise.resolve({}),
        onUpdateRuntime: () => Promise.resolve({}),
      } as never,
      { load: async () => ({}) } as never,
    )
    bridge.register()

    let settled = false
    const invoked = Promise.resolve(
      (ipcMain as unknown as { __invoke: (c: string, ...a: unknown[]) => unknown }).__invoke(
        Channel.SESSION_RECONNECT,
      ),
    ).then(() => {
      settled = true
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(settled, '재연결이 끝나기 전에 응답했다 — 진단이 3초 뒤 런타임을 재시작한다').toBe(false)

    release!()
    await invoked
    expect(settled).toBe(true)
  })
})
