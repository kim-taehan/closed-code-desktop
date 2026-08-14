import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionService } from '../../electron/extensions/service'
import { ExtensionWorkspace } from '../../electron/extensions/workspaceApi'
import { LiveChild } from '../../tests/extensions/liveChild'

// 확장 4호 「화면 시나리오」를 **레포 원본 그대로** 태운다 (`todoCollector.test.ts` 선례).
//
// 프로세스 경계(utilityProcess)만 가짜다. 그 안쪽은 전부 진짜다 — registry 훑기 ·
// 매니페스트 파싱 · require · activate · `code.*` 왕복 · 저장소.
// 확장 내부 모듈을 직접 import 하지 않는 이유도 선례와 같다: 그렇게 하면
// **매니페스트가 틀려도 시험이 초록**이라, 정작 앱에 안 뜨는 것을 못 잡는다.

const EXTENSIONS_DIR = join(__dirname, '..')

const created: string[] = []
let projectRoot: string

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'screen-scenario-'))
  created.push(base)
  // macOS 의 /var → /private/var. 안 펴면 경계 판정이 전부 "밖" 이 된다.
  projectRoot = await realpath(base)
})

afterEach(async () => {
  while (created.length > 0) await rm(created.pop() as string, { recursive: true, force: true })
})

async function write(relativePath: string): Promise<void> {
  const target = join(projectRoot, relativePath)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, 'export default function A() { return null }\n', 'utf8')
}

/** 메모리 저장소. 진짜 디스크 저장소와 계약이 같다 (`storageStore.ts`). */
function memoryStorage() {
  const bag = new Map<string, unknown>()
  const at = (extension: string, project: string | null, key: string) =>
    `${extension} ${project ?? ''} ${key}`
  return {
    bag,
    get: (extension: string, project: string | null, key: string) =>
      Promise.resolve(bag.get(at(extension, project, key))),
    set: (extension: string, project: string | null, key: string, value: unknown) => {
      bag.set(at(extension, project, key), value)
      return Promise.resolve()
    },
  }
}

function startService(answer?: string | null) {
  const html = new Map<string, string>()
  const storage = memoryStorage()
  const askText = vi.fn(() => Promise.resolve(answer ?? null))
  const project = { id: 'p1', root: projectRoot }

  const service = new ExtensionService({
    entryPath: 'ignored',
    fork: () => new LiveChild(),
    extensionsDir: EXTENSIONS_DIR,
    workspace: new ExtensionWorkspace(() => ({ active: project, openProjects: [project] })),
    storage,
    askText,
  })
  service.onViewHtml((viewId, body) => html.set(viewId, body))
  service.start()
  return { service, html, storage, askText }
}

const BOARD = 'screenScenario.board'

describe('화면 시나리오 확장 — 무수정으로 도는가', () => {
  it('목록에 뜨고 싣기 실패가 없다', async () => {
    const { service } = startService()

    const listing = await service.listExtensions()

    expect(listing.extensions.map((one) => one.manifest.name)).toContain('screen-scenario')
    expect(listing.skipped).toEqual([])
    service.dispose()
  })

  it('아무것도 저장돼 있지 않으면 비었다고 말한다 — 빈 화면으로 두지 않는다', async () => {
    const { service, html } = startService()

    await service.runCommand('screenScenario.open', 'p1')

    expect(html.get(BOARD)).toContain('아직 화면이 없습니다')
    service.dispose()
  })

  it('저장된 화면이 **이름과 파일 경로 두 줄**로 뜬다', async () => {
    const { service, html, storage } = startService()
    // 저장소의 열쇠는 **프로젝트 id** 다 (`serviceDispatch.ts` 의 `deps.projectId()`) —
    // 루트 경로가 아니다. 여기를 틀리면 씨앗을 심어도 확장이 못 읽는다.
    await storage.set('screen-scenario', 'p1', 'screens', [
      { id: 'src/pages/order/OrderList.tsx', name: '주문 목록 조회', state: 'draft', cases: [] },
    ])

    await service.runCommand('screenScenario.open', 'p1')

    const body = html.get(BOARD) ?? ''
    expect(body).toContain('주문 목록 조회')
    expect(body).toContain('src/pages/order/OrderList.tsx')
    expect(body).toContain('초안')
    service.dispose()
  })

  it('고른 파일이 목록에 들어가고 저장된다', async () => {
    await write('src/pages/A.tsx')
    const { service, html, storage } = startService('src/pages/A.tsx')

    await service.runCommand('screenScenario.add', 'p1')

    expect(html.get(BOARD)).toContain('src/pages/A.tsx')
    // 이름은 파일명에서 뽑되 확장자를 뗀다
    expect(html.get(BOARD)).toContain('>A<')
    expect(storage.bag.get('screen-scenario p1 screens')).toEqual([
      { id: 'src/pages/A.tsx', name: 'A', state: 'none', source: 'manual', cases: [] },
    ])
    service.dispose()
  })

  it('**후보에 없는 경로**는 넣지 않는다 — 목록에 열리지 않는 줄을 남기지 않는다', async () => {
    // 후보가 있는데도 거절되는지를 본다. 빈 프로젝트로 재면 후보가 없어 먼저 끝나므로
    // 이 관문이 돌지도 않고 초록이 된다 (하네스 원칙: 같은 초록이 같은 이유가 아니다).
    await write('src/pages/A.tsx')
    const { service, storage, askText } = startService('src/pages/없다.tsx')

    await service.runCommand('screenScenario.add', 'p1')

    expect(askText).toHaveBeenCalledTimes(1)
    expect(storage.bag.size).toBe(0)
    service.dispose()
  })

  it('물음창을 닫으면 아무 일도 일어나지 않는다 — 취소는 실패가 아니다', async () => {
    await write('src/pages/A.tsx')
    const { service, storage, askText } = startService(null)

    await service.runCommand('screenScenario.add', 'p1')

    expect(askText).toHaveBeenCalledTimes(1)
    expect(storage.bag.size).toBe(0)
    service.dispose()
  })

  it('후보가 하나도 없으면 묻지도 않는다', async () => {
    const { service, storage, askText } = startService('src/pages/A.tsx')

    await service.runCommand('screenScenario.add', 'p1')

    expect(askText).toHaveBeenCalledTimes(0)
    expect(storage.bag.size).toBe(0)
    service.dispose()
  })
})
