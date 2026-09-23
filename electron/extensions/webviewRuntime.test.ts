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

// 웹뷰 런타임을 **끝에서 끝까지** — 진짜 자식(LiveChild)에 3판 시험 확장(`tests/extensions/webview-v3`)을
// 싣고, 앞단 → 뒷단 → 앞단 왕복이 **그 프로젝트의 탭으로만** 돌아오는지 본다 (E3).
//
// 창·iframe 은 없다. 창 쪽 배선(`extensionUiBridge.ts`)이 거는 두 길(`UiSinks`)을 여기서 받아 적는다 —
// 이 시험이 보는 것은 **어느 토큰으로 가나**이고, 토큰에서 iframe 까지는 `ExtensionWebview.test.tsx` 가 본다.

const FIXTURE = join(__dirname, '../../tests/extensions/webview-v3')
const EXT = 'webview-fixture'

let extensionsDir = ''

beforeEach(async () => {
  extensionsDir = await mkdtemp(join(tmpdir(), 'webview-runtime-'))
  await cp(FIXTURE, join(extensionsDir, 'webview-v3'), { recursive: true })
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
  const opened: { projectId: string; extension: string; viewId: string }[] = []
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
      opened.push({ projectId, extension, viewId })
    },
    chatPost: () => {},
    openFile: () => {},
  })
  service.start()

  /** 탭 하나를 띄운다 — 창 쪽 배선(`extensionUiBridge.openView`)과 같은 두 걸음 */
  const openTab = async (projectId: string) => {
    const found = await service.webview(EXT, 'board', projectId)
    if (!found.ok) throw new Error(found.reason)
    const result = await router.server.open({ extension: EXT, viewId: 'board', projectId, extensionDir: found.dir, entry: found.entry })
    if (!result.ok) throw new Error(result.reason)
    return result.token
  }
  return { service, router, toTab, opened, openTab }
}

describe('3판 확장이 실린다', () => {
  it('매니페스트 3판을 건너뛰지 않고 싣는다 — 웹뷰 뷰가 목록에 실린다', async () => {
    const { service } = await bed()
    const listing = await service.listExtensions()
    expect(listing.skipped).toEqual([])
    expect(listing.extensions[0]!.manifest.contributes?.views).toEqual([
      { id: 'board', title: '보드', kind: 'webview', entry: 'ui/index.html' },
    ])
    service.dispose()
  })

  it('켜지지 않은 프로젝트에서는 탭을 띄울 재료를 주지 않는다', async () => {
    const { service } = await bed()
    const found = await service.webview(EXT, 'board', 'R')
    expect(found.ok).toBe(false)
    service.dispose()
  })
})

describe('앞단 → 뒷단 → 앞단 왕복', () => {
  it('앞단이 보낸 것이 onMessage 에 **그 탭의 프로젝트와 함께** 닿고, 답이 그 탭으로 돌아온다', async () => {
    const { service, toTab, openTab } = await bed()
    const tokenP = await openTab('P')

    await service.uiMessage(EXT, 'board', 'P', { n: 1 })

    expect(toTab).toEqual([{ token: tokenP, message: { echo: { n: 1 }, from: 'P' } }])
    service.dispose()
  })

  it('**P 의 메시지는 Q 의 탭에 안 간다** — 같은 확장·같은 뷰가 둘 다 열려 있어도', async () => {
    const { service, toTab, openTab } = await bed()
    const tokenP = await openTab('P')
    const tokenQ = await openTab('Q')

    await service.uiMessage(EXT, 'board', 'P', { n: 1 })
    await service.uiMessage(EXT, 'board', 'Q', { n: 2 })

    expect(toTab).toEqual([
      { token: tokenP, message: { echo: { n: 1 }, from: 'P' } },
      { token: tokenQ, message: { echo: { n: 2 }, from: 'Q' } },
    ])
    service.dispose()
  })

  it('명령 안에서 민 것은 **명령을 건 프로젝트**의 탭으로 간다 (겉봉)', async () => {
    const { service, toTab, openTab } = await bed()
    await openTab('P')
    const tokenQ = await openTab('Q')

    await service.runCommand('webviewFixture.push', 'Q', 'x')

    expect(toTab).toEqual([{ token: tokenQ, message: { pushed: 'x' } }])
    service.dispose()
  })

  it('다시 실어도 처리기는 한 벌이다 — 메시지 하나에 답이 하나', async () => {
    const { service, toTab, openTab } = await bed()
    await openTab('P')
    await service.reload()

    await service.uiMessage(EXT, 'board', 'P', { n: 1 })

    expect(toTab).toHaveLength(1)
    service.dispose()
  })

  it('켜지지 않은 프로젝트의 앞단 메시지는 거절한다', async () => {
    const { service } = await bed()
    await expect(service.uiMessage(EXT, 'board', 'R', { n: 1 })).rejects.toThrow('켜지 않은')
    service.dispose()
  })
})

describe('code.ui.open', () => {
  it('명령에서 부르면 명령을 건 프로젝트에 그 뷰의 탭을 연다', async () => {
    const { service, opened } = await bed()
    await service.runCommand('webviewFixture.open', 'Q')
    expect(opened).toEqual([{ projectId: 'Q', extension: EXT, viewId: 'board' }])
    service.dispose()
  })
})
