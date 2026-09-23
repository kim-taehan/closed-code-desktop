import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExtensionService } from './service'
import { ExtensionWorkspace } from './workspaceApi'
import { ExtensionUiRouter } from './uiRouter'
import { ExtensionUiServer } from './uiServer'
import type { ProjectExtensionsPort } from './projectExtensions'
import { LiveChild } from '../../tests/extensions/liveChild'

// 사이드바 웹뷰 ↔ 본문 웹뷰 (하이닉스 H2 결정 K-1·K-2) — 진짜 자식에 시험 확장(`tests/extensions/webview-sidebar`)을 싣는다.
//
// 두 화면은 **뒷단으로만** 이어진다: 사이드바 앞단 → `onMessage('list')` → 뒷단 → `ui.open('detail')`·`ui.post('detail')`.
// 사이드바 웹뷰도 본문 웹뷰와 **같은 런타임**이라(토큰이 (확장·뷰·프로젝트)를 묶는다) 여기서 보는 것은 행선지다.
// iframe 이 패널을 옮겨도 다시 안 뜨는지는 `src/components/ProjectSidebar.sidebarWebview.test.tsx` 가 본다.

const FIXTURE = join(__dirname, '../../tests/extensions/webview-sidebar')
const EXT = 'sidebar-fixture'

let extensionsDir = ''

beforeEach(async () => {
  extensionsDir = await mkdtemp(join(tmpdir(), 'sidebar-webview-'))
  await cp(FIXTURE, join(extensionsDir, 'webview-sidebar'), { recursive: true })
})

afterEach(async () => {
  await rm(extensionsDir, { recursive: true, force: true })
})

/** P·Q 에서 켜졌고 R 에서는 꺼졌다 */
function projectsPort(): ProjectExtensionsPort {
  const on = new Set(['P', 'Q'])
  return {
    enabledIn: async (projectId, installed) => new Set(projectId !== null && on.has(projectId) ? installed : []),
    enabledAnywhere: async (installed) => new Set(installed),
    active: () => ({ id: 'P', name: 'p' }),
    set: async () => {},
    forget: async () => {},
  }
}

async function bed() {
  let next = 0
  const router = new ExtensionUiRouter(new ExtensionUiServer(() => `t${(next += 1)}`))
  const toTab: { token: string; message: unknown }[] = []
  const opened: { projectId: string; viewId: string }[] = []
  const chat: { projectId: string; text: string }[] = []
  const service = new ExtensionService({
    entryPath: 'ignored',
    fork: () => new LiveChild(),
    extensionsDir,
    workspace: new ExtensionWorkspace(() => null),
    projects: projectsPort(),
    ui: router,
  })
  router.attach({
    toTab: (token, message) => toTab.push({ token, message }),
    openTab: async (projectId, extension, viewId) => {
      const found = await service.webview(extension, viewId, projectId)
      if (!found.ok) throw new Error(found.reason)
      opened.push({ projectId, viewId })
    },
    chatPost: (projectId, text) => chat.push({ projectId, text }),
    openFile: () => {},
  })
  service.start()

  /** 뷰 하나를 띄운다 — 창 쪽 배선(`extensionUiBridge.openView`)과 같은 두 걸음. 사이드바·본문이 같은 길이다 */
  const openView = async (viewId: string, projectId: string) => {
    const found = await service.webview(EXT, viewId, projectId)
    if (!found.ok) throw new Error(found.reason)
    const result = await router.server.open({ extension: EXT, viewId, projectId, extensionDir: found.dir, entry: found.entry })
    if (!result.ok) throw new Error(result.reason)
    return result.token
  }
  return { service, toTab, opened, chat, openView }
}

describe('사이드바 웹뷰가 실린다', () => {
  it('매니페스트의 location 을 읽는다 — 사이드바 하나, 본문은 적지 않은 채', async () => {
    const { service } = await bed()
    const listing = await service.listExtensions()
    expect(listing.extensions[0]!.manifest.contributes?.views).toEqual([
      { id: 'list', title: '결재함', kind: 'webview', entry: 'ui/list.html', location: 'sidebar' },
      { id: 'detail', title: '일감', kind: 'webview', entry: 'ui/detail.html' },
    ])
    service.dispose()
  })

  it('켜지지 않은 프로젝트에서는 사이드바 웹뷰도 띄울 재료를 주지 않고, 그 앞단 메시지도 거절한다', async () => {
    const { service } = await bed()
    expect((await service.webview(EXT, 'list', 'R')).ok).toBe(false)
    await expect(service.uiMessage(EXT, 'list', 'R', { pick: 'DC-1' })).rejects.toThrow('켜지 않은')
    service.dispose()
  })
})

describe('사이드바 → 뒷단 → 본문 (K-2)', () => {
  it('사이드바가 고른 것이 뒷단을 거쳐 **같은 프로젝트의** 본문 탭을 열고 그 탭에만 간다', async () => {
    const { service, toTab, opened, openView } = await bed()
    const sidebarP = await openView('list', 'P')
    const detailP = await openView('detail', 'P')
    const detailQ = await openView('detail', 'Q')

    await service.uiMessage(EXT, 'list', 'P', { pick: 'DC-1' })

    expect(opened).toEqual([{ projectId: 'P', viewId: 'detail' }])
    expect(toTab).toEqual([{ token: detailP, message: { picked: 'DC-1', from: 'P' } }])
    // 사이드바 자기 탭·Q 의 본문 탭에는 아무것도 안 간다
    expect(toTab.map((sent) => sent.token)).not.toContain(sidebarP)
    expect(toTab.map((sent) => sent.token)).not.toContain(detailQ)
    service.dispose()
  })

  it('**P 의 사이드바 메시지는 Q 로 안 간다** — 두 프로젝트에 같은 사이드바·본문이 열려 있어도', async () => {
    const { service, toTab, opened, openView } = await bed()
    await openView('list', 'P')
    await openView('list', 'Q')
    const detailP = await openView('detail', 'P')
    const detailQ = await openView('detail', 'Q')

    await service.uiMessage(EXT, 'list', 'Q', { pick: 'DC-2' })
    await service.uiMessage(EXT, 'list', 'P', { pick: 'DC-1' })

    expect(opened).toEqual([
      { projectId: 'Q', viewId: 'detail' },
      { projectId: 'P', viewId: 'detail' },
    ])
    expect(toTab).toEqual([
      { token: detailQ, message: { picked: 'DC-2', from: 'Q' } },
      { token: detailP, message: { picked: 'DC-1', from: 'P' } },
    ])
    service.dispose()
  })
})

describe('code.chat.post (K-3)', () => {
  it('명령에서 부르면 **명령을 건 프로젝트의** 입력칸으로 간다', async () => {
    const { service, chat } = await bed()
    await service.runCommand('sidebarFixture.chat', 'Q', '설계서를 보고 구현해 주세요')
    expect(chat).toEqual([{ projectId: 'Q', text: '설계서를 보고 구현해 주세요' }])
    service.dispose()
  })

  it('꺼진 프로젝트로는 명령이 거절돼 입력칸에 닿지 않는다', async () => {
    const { service, chat } = await bed()
    await expect(service.runCommand('sidebarFixture.chat', 'R', '글')).rejects.toThrow()
    expect(chat).toEqual([])
    service.dispose()
  })
})
