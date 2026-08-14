import { describe, expect, it, vi } from 'vitest'
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
/** 여기서 겨누는 것은 포트 넷의 세대다 — 서버 주소는 쓰이지 않는다 */
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
      activeFile: () => null,
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

  // **이것이 누출의 형태였다.** 낡은 겹이 관문(`focused`)을 통과시키고 신선한 겹
  // (`activeFile`)이 값을 실어 나른다. 두 겹이 같은 세대를 보면 관문에서 끊긴다 —
  // `tools.ts` 는 `focused` 가 거짓이면 `activeFile()` 을 아예 안 읽는다.
  it('활성 판정과 파일 값이 같은 세대를 본다', () => {
    let registry = registryOf([{ id: 'A', root: '/old/A' }], 'A')
    const ports = desktopMcpPorts({
      settings,
      serverUrl,
      registry: () => registry,
      window: () => null,
      // 새 창의 렌더러가 알려 준 값 — 언제나 "지금" 것이다
      activeFile: () => ({ path: 'B/secret.ts' }),
    })

    registry = registryOf([{ id: 'B', root: '/new/B' }], 'B')

    expect(ports.focusedProjectId()).not.toBe('A')
    // 값 자체는 신선한 것이 맞다 — 문제는 관문이었지 이쪽이 아니었다
    expect(ports.activeFile()).toEqual({ path: 'B/secret.ts' })
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
      activeFile: () => null,
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

  // 렌더러가 보낸 모양이 아니면 null 이다 — 「경로 없는 파일」과 「안 보고 있다」를
  // 구분하지 못하게 만들지 않는다 (`extensionActiveFile.ts` 의 판단을 그대로 탄다).
  it('활성 파일은 모양을 확인해서 넘긴다', () => {
    const ports = desktopMcpPorts({
      settings,
      serverUrl,
      registry: () => null,
      window: () => null,
      activeFile: () => ({ nope: 1 }),
    })
    expect(ports.activeFile()).toBeNull()
  })
})
