import { cp, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExtensionService } from './service'
import { ExtensionWorkspace } from './workspaceApi'
import { createProjectExtensions } from './projectExtensions'
import { ProjectRegistry } from '../projects/projectRegistry'
import { ProjectStore } from '../projects/projectStore'
import { LiveChild } from '../../tests/extensions/liveChild'

// 꺼 둔 확장. 실제 자식(LiveChild)에 실어 보고 **명령이 정말 사라지는지·거절되는지**까지 본다 —
// 목록에서만 꺼진 것처럼 보이고 명령은 그대로 도는 것이 여기서 잡으려는 어긋남이다.
//
// 켜기는 **프로젝트마다**다 (확장 재설계 §3). 호스트는 하나라 **합집합**을 싣고, 켜지 않은
// 프로젝트로 거는 명령은 자식이 거절한다. 레지스트리는 진짜를 쓴다 — 켜진 이름이 거기 산다.
//
// 픽스처 확장으로만 돌린다 (`serviceReload.test.ts` 와 같은 이유 — 호스트는 특정 확장을
// 알면 안 된다).

const FIXTURES_DIR = join(__dirname, '../../tests/fixtures/extensions')

const created: string[] = []
let base: string
let extensionsDir: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'ext-off-')))
  created.push(base)
  extensionsDir = await mkdtemp(join(tmpdir(), 'ext-off-dir-'))
  created.push(extensionsDir)
  await cp(join(FIXTURES_DIR, 'echo-rows'), join(extensionsDir, 'echo-rows'), { recursive: true })
})

afterEach(async () => {
  while (created.length > 0) await rm(created.pop() as string, { recursive: true, force: true })
})

/** 프로젝트 둘(a·b). 새 프로젝트라 둘 다 아무것도 안 켜진 채 시작한다 */
async function twoProjects() {
  const registry = new ProjectRegistry({ store: new ProjectStore(join(base, 'projects.json')) })
  await registry.restore()
  const ids: string[] = []
  for (const name of ['a', 'b']) {
    const root = await mkdtemp(join(base, `${name}-`))
    const opened = await registry.open(root)
    if (!opened.ok) throw new Error(opened.message)
    ids.push(opened.project.id)
  }
  return { registry, a: ids[0]!, b: ids[1]! }
}

function startService(registry: ProjectRegistry | null) {
  const project = { id: 'p1', root: base }
  return new ExtensionService({
    entryPath: 'ignored',
    fork: () => new LiveChild(),
    extensionsDir,
    workspace: new ExtensionWorkspace(() => ({ active: project, openProjects: [project] })),
    ...(registry
      ? { projects: createProjectExtensions({ registry: () => registry, legacyDisabled: async () => [] }) }
      : {}),
  })
}

describe('꺼 둔 확장 — 프로젝트마다', () => {
  it('목록은 활성 프로젝트 기준이고 그 이름이 실린다 — 꺼진 것도 목록에는 남는다', async () => {
    const { registry, a, b } = await twoProjects()
    await registry.setExtension(a, 'echo-rows', true)
    const service = startService(registry)
    service.start()

    // 마지막에 연 b 가 활성이다
    const onB = await service.listExtensions()
    expect(onB.extensions.map((item) => [item.manifest.name, item.enabled])).toEqual([['echo-rows', false]])
    expect(onB.activeProject?.id).toBe(b)

    await registry.activate(a)
    const onA = await service.listExtensions()
    expect(onA.extensions[0]!.enabled).toBe(true)
    expect(onA.activeProject).toEqual({ id: a, name: registry.active!.name })
    service.dispose()
  })

  it('어느 프로젝트에도 안 켜졌으면 싣지 않는다 — 명령이 실제로 없다', async () => {
    const { registry, a } = await twoProjects()
    const service = startService(registry)
    service.start()

    await expect(service.runCommand('echoRows.run', a)).rejects.toThrow(/등록되지 않은 명령/)
    service.dispose()
  })

  it('한 프로젝트에서라도 켜면 싣는다(합집합) — 켜고 reload 하면 명령이 돌아온다', async () => {
    const { registry, b } = await twoProjects()
    const service = startService(registry)
    const rows = new Map<string, unknown[]>()
    service.onViewRows((viewId, viewRows) => rows.set(viewId, viewRows))
    service.start()
    await expect(service.runCommand('echoRows.run', b)).rejects.toThrow(/등록되지 않은 명령/)

    await registry.setExtension(b, 'echo-rows', true)
    await service.reload()

    await service.runCommand('echoRows.run', b)
    expect(rows.get('echoRows.results')).toEqual([{ file: 'echo.ts', lines: 1 }])
    service.dispose()
  })

  // 호스트에는 a 덕분에 실려 있다. 명령표에 있다는 것만으로 b 에서 돌면 켜기가 반쪽이다.
  // 파일 우클릭도 같은 통로(`runCommand` + 고른 경로)라 selection 을 실어 본다.
  it('켜지 않은 프로젝트로 부르면 거절한다 — 파일 우클릭도 같다', async () => {
    const { registry, a, b } = await twoProjects()
    await registry.setExtension(a, 'echo-rows', true)
    const service = startService(registry)
    const rows: (string | null)[] = []
    service.onViewRows((_viewId, _rows, projectId) => rows.push(projectId))
    service.start()

    await expect(service.runCommand('echoRows.run', b, ['src/x.ts'])).rejects.toThrow(/켜지 않은 확장입니다: echo-rows/)
    await expect(service.runCommand('echoRows.run', null)).rejects.toThrow(/켜지 않은 확장/)
    expect(rows).toEqual([])

    await service.runCommand('echoRows.run', a, ['src/x.ts'])
    expect(rows).toEqual([a])
    service.dispose()
  })

  // 덮어쓴 확장의 새 코드는 새 자식에서만 실린다 (require 캐시). 앱을 껐다 켜는 대신
  // 자식만 갈아 끼우는 길인데, **같은 호스트 객체를 다시 쓰는 것**이라 배선이 살아 있어야 한다.
  it('자식을 갈아 끼워도 목록·명령이 그대로 돈다', async () => {
    const service = startService(null)
    const rows = new Map<string, unknown[]>()
    service.onViewRows((viewId, viewRows) => rows.set(viewId, viewRows))
    service.start()
    await service.runCommand('echoRows.run', null)
    expect(rows.get('echoRows.results')).toBeTruthy()
    rows.clear()

    await service.restart()

    // 새 자식에도 실려 있어야 한다 — 안 실리면 "등록되지 않은 명령" 으로 거부된다
    await service.runCommand('echoRows.run', null)
    expect(rows.get('echoRows.results')).toEqual([{ file: 'echo.ts', lines: 1 }])
    expect((await service.listExtensions()).extensions).toHaveLength(1)
    service.dispose()
  })
})
