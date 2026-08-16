import { beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopMcpPorts, type DesktopMcpDeps } from './appWiring'

// **창을 되살렸을 때 낡은 세대를 보지 않는가** (design-audit A7 「수명이 섞인 클로저」).
//
// `DesktopMcp` 는 앱 수명이고 창·레지스트리는 창 수명이다. macOS 는 창을 다 닫아도 앱이
// 살아 있고, 독에서 되살리면 `createWindow()` 가 **새 window·새 registry** 를 만든다.
//
// 예전에는 포트 넷 중 셋이 지역 `const` 를 잡고 `activeFile` 하나만 모듈 변수를 호출
// 시점에 읽었다. **일부만 신선한 것이 전부 낡은 것보다 나쁘다** — 낡은 레지스트리의 활성
// 프로젝트가 `focused=true` 를 통과시키고 거기에 **새 창의** 파일 경로가 실려 나간다.
// 전부 낡았다면 옛 파일을 말할 뿐이라 틀린 답이지 누출이 아니다.

vi.mock('electron', () => ({ ipcMain: { on: () => {}, removeListener: () => {} } }))

const settings: DesktopMcpDeps['settings'] = () => Promise.resolve({ desktopMcp: false } as never)
/** 여기서 겨누는 것은 포트들의 세대다 — 서버 주소는 쓰이지 않는다 */
const serverUrl: DesktopMcpDeps['serverUrl'] = () => null

function registryOf(projects: { id: string; root: string }[], activeId: string | null) {
  return {
    openProjects: projects,
    active: projects.find((p) => p.id === activeId) ?? null,
  } as never
}

describe('desktopMcpPorts — 창보다 오래 사는 배선', () => {
  it('레지스트리가 갈리면 새 것을 본다', () => {
    let registry = registryOf([{ id: 'A', root: '/old/A' }], 'A')
    const ports = desktopMcpPorts({
      settings,
      serverUrl,
      registry: () => registry,
      window: () => null,
      ptyDrawer: () => null,
    })

    expect(ports.rootOf('A')).toBe('/old/A')
    expect(ports.focusedProjectId()).toBe('A')

    // 창을 되살렸다 — 레지스트리가 통째로 새로 났다
    registry = registryOf([{ id: 'B', root: '/new/B' }], 'B')

    // 낡은 것을 잡고 있으면 여기서 '/old/A' 와 'A' 가 그대로 나온다
    expect(ports.rootOf('A')).toBeNull()
    expect(ports.rootOf('B')).toBe('/new/B')
    expect(ports.focusedProjectId()).toBe('B')
  })

  it('창이 갈리면 새 창으로 보낸다', () => {
    const sent: string[] = []
    const make = (name: string, destroyed: boolean) =>
      ({
        isDestroyed: () => destroyed,
        webContents: { send: () => sent.push(name) },
      }) as never

    let window = make('old', false)
    const ports = desktopMcpPorts({
      settings,
      serverUrl,
      registry: () => null,
      window: () => window,
      ptyDrawer: () => null,
    })

    expect(ports.openInView('A', { path: 'a.ts' })).toBe(true)

    // 창을 닫았다. 여기서 잡아 두면 영영 false 를 돌려주고, 에이전트에게는
    // "화면이 없어 파일을 열지 못했습니다" 만 간다 — 되살려도 회복이 안 된다.
    window = make('old-destroyed', true)
    expect(ports.openInView('A', { path: 'a.ts' })).toBe(false)

    window = make('new', false)
    expect(ports.openInView('A', { path: 'a.ts' })).toBe(true)
    expect(sent).toEqual(['old', 'new'])
  })

})

// **일이 두 군데로 갈리는 자리다.** 칸을 펴는 것은 화면이, 글자를 넣는 것은 main 이 한다.
// 한쪽만 하면 증상이 조용하다: 프레임만 보내면 빈 칸이 열리고, 맡기기만 하면 아무 일도 안 난다.
describe('desktopMcpPorts — open_terminal', () => {
  const frames: { channel: string; scoped: unknown }[] = []
  const window = {
    isDestroyed: () => false,
    webContents: { send: (channel: string, scoped: unknown) => frames.push({ channel, scoped }) },
  } as never

  beforeEach(() => {
    frames.length = 0
  })

  function portsWith(drawer: { fill: ReturnType<typeof vi.fn> } | null) {
    return desktopMcpPorts({
      settings,
      serverUrl,
      registry: () => null,
      window: () => window,
      ptyDrawer: () => drawer as never,
    })
  }

  it('칸을 펴라고 화면에 알리고, 채울 명령은 드로어에 맡긴다', () => {
    const fill = vi.fn()
    expect(portsWith({ fill }).openTerminal('A', 'npm test')).toBe(true)

    expect(fill).toHaveBeenCalledWith('A', 'npm test')
    expect(frames).toEqual([
      {
        channel: 'desktopMcp:openTerminal',
        scoped: { projectId: 'A', payload: { command: 'npm test' } },
      },
    ])
  })

  it('명령이 없으면 맡길 것도 없다 — 칸만 편다', () => {
    const fill = vi.fn()
    expect(portsWith({ fill }).openTerminal('A', null)).toBe(true)
    expect(fill).not.toHaveBeenCalled()
    expect(frames).toHaveLength(1)
  })

  // 맡길 곳이 없는데 성공이라고 하면, 모델이 "확인해 달라" 고 말하고 사용자는 빈 칸을 본다
  it('셸 배선이 없으면 채울 명령을 삼키지 않고 실패로 답한다', () => {
    expect(portsWith(null).openTerminal('A', 'npm test')).toBe(false)
    expect(frames).toEqual([])
  })
})
