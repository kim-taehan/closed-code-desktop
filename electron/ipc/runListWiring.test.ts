import { describe, expect, it, vi } from 'vitest'

// **모델이 적는 폴더와 화면이 읽는 폴더가 같은가.**
//
// 실행 목록은 배선이 둘이다: 도구가 적는 길(`mcp/appWiring.ts` → `McpToolPorts.runListDir`)과
// 사이드바가 읽는 길(`ipc/projectBridge.ts` → `RunListHandlerDeps.dir`). 지금은 둘 다
// `run/runListDir.ts` 를 부르지만 **그것을 잠근 시험이 없었다.**
//
// 한쪽만 갈리면 타입도 기존 시험도 전부 초록이다 — 다른 시험들은 포트를
// `() => '/tmp/run-lists'` 로 스텁해서 진짜 경로에 닿지 않는다. 증상은 조용하고 비싸다:
// 모델은 "적었습니다" 라고 답하고, 사이드바는 영원히 「실행 목록이 없습니다」이고,
// 사용자는 20초짜리 탐색을 몇 번이고 다시 태운다.
//
// 그래서 여기서는 **스텁하지 않고 두 배선을 실제로 돌려** 나온 경로를 맞대 본다.

const USER_DATA = '/fixture/userData'

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? USER_DATA : '/fixture/other') },
  ipcMain: {
    handle: () => {},
    removeHandler: () => {},
    on: () => {},
    removeListener: () => {},
  },
  dialog: {},
}))

/** IPC 쪽이 넘긴 폴더를 가로챈다 — 핸들러를 실제로 등록할 필요는 없다 */
let ipcDir: string | null = null
vi.mock('./runListHandlers', () => ({
  registerRunListHandlers: (deps: { dir: string }) => {
    ipcDir = deps.dir
  },
}))

async function mcpRunListDir(): Promise<string> {
  const { desktopMcpPorts } = await import('../mcp/appWiring')
  const ports = desktopMcpPorts({
    registry: () => null,
    window: () => null,
    settings: () => Promise.resolve({ desktopMcp: false }),
    ptyDrawer: () => null,
    serverUrl: () => null,
  } as never)
  return ports.runListDir()
}

async function ipcRunListDir(): Promise<string> {
  const { ProjectBridge } = await import('./projectBridge')
  const project = { id: 'p1', name: 'p', root: '/p' }
  const bridge = new ProjectBridge(
    { webContents: { send: () => {} } } as never,
    { active: project, all: [project], openProjects: [project] } as never,
    {} as never,
    { load: async () => ({}) } as never,
  )
  bridge.register()
  if (ipcDir === null) throw new Error('registerRunListHandlers 가 안 불렸다')
  return ipcDir
}

describe('실행 목록 폴더 — 적는 길과 읽는 길', () => {
  it('두 배선이 같은 폴더를 본다', async () => {
    expect(await mcpRunListDir()).toBe(await ipcRunListDir())
  })

  // 위 단언만 있으면 **둘 다 같은 값으로 빗나가도** 초록이다 (흉내가 안 먹어 둘 다
  // undefined 인 경우가 그렇다). 이 기준선이 흉내가 실제로 걸렸다는 것을 보증한다.
  it('그 폴더는 userData 아래의 run-lists 다', async () => {
    expect(await mcpRunListDir()).toBe(`${USER_DATA}/run-lists`)
  })
})
