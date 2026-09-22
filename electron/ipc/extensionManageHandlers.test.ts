import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setExtensionEnabled, uninstallInstalled, type ManageDeps } from './extensionManageHandlers'
import { createProjectExtensions } from '../extensions/projectExtensions'
import { ProjectRegistry } from '../projects/projectRegistry'
import { ProjectStore } from '../projects/projectStore'

// 켜고 끄기·지우기 핸들러. 켜기는 **프로젝트마다**, 지우기는 **앱 전체**다 (확장 재설계 §3).
// 레지스트리는 진짜를 쓴다 — 무엇이 `projects.json` 에 남는지가 이 핸들러의 결과다.

let workDir = ''
let extensionsDir = ''

beforeEach(async () => {
  workDir = await realpath(await mkdtemp(join(tmpdir(), 'ext-manage-')))
  extensionsDir = join(workDir, 'extensions')
  await mkdir(join(extensionsDir, 'todo'), { recursive: true })
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

/** 이 기능 전의 기록 둘 — `extensions` 가 없다. 옛 설정으로는 전부 켜져 있었다 */
async function oldProjects(): Promise<ProjectRegistry> {
  const projects = []
  for (const id of ['p1', 'p2']) {
    const root = join(workDir, id)
    await mkdir(root)
    projects.push({ id, root, name: id, favorite: false, lastOpenedAt: 1 })
  }
  await writeFile(join(workDir, 'projects.json'), JSON.stringify({ projects, openIds: ['p1', 'p2'], activeId: 'p1' }))
  const registry = new ProjectRegistry({ store: new ProjectStore(join(workDir, 'projects.json'), () => {}) })
  await registry.restore()
  return registry
}

function deps(registry: ProjectRegistry): ManageDeps & { service: { reload: ReturnType<typeof vi.fn> } } {
  return {
    projects: createProjectExtensions({ registry: () => registry, legacyDisabled: async () => [] }),
    extensionsDir,
    service: {
      listExtensions: async () => ({
        extensions: [
          { dir: join(extensionsDir, 'code-map'), manifest: { name: 'code-map' } },
          { dir: join(extensionsDir, 'todo'), manifest: { name: 'todo' } },
        ],
      }),
      reload: vi.fn(async () => {}),
      restart: async () => {},
    },
  }
}

async function stored(): Promise<Record<string, string[] | undefined>> {
  const parsed = JSON.parse(await readFile(join(workDir, 'projects.json'), 'utf8')) as {
    projects: { id: string; extensions?: string[] }[]
  }
  return Object.fromEntries(parsed.projects.map((project) => [project.id, project.extensions]))
}

describe('켜고 끄기', () => {
  // 아직 이전 안 된 프로젝트에서 처음 누른 것이면, 옛 기준으로 켜져 있던 나머지를 먼저 채워야 한다 —
  // 안 그러면 하나를 끄는 순간 나머지까지 전부 꺼진다
  it('그 프로젝트에서만 끄고, 나머지 켜짐은 이전된 채 남는다', async () => {
    const registry = await oldProjects()
    const manage = deps(registry)

    await setExtensionEnabled(manage, { name: 'code-map', enabled: false, projectId: 'p1' })

    expect(await stored()).toEqual({ p1: ['todo'], p2: ['code-map', 'todo'] })
    expect(manage.service.reload).toHaveBeenCalledTimes(1)
  })
})

describe('지우기', () => {
  it('모든 프로젝트의 켠 기록에서 뺀다 — 같은 이름을 다시 깔면 조용히 켜져 들어오지 않게', async () => {
    const registry = await oldProjects()
    const manage = deps(registry)
    await manage.projects.enabledAnywhere(['code-map', 'todo'])

    const result = await uninstallInstalled(manage, { dir: join(extensionsDir, 'todo') })

    expect(result).toEqual({ ok: true })
    expect(await stored()).toEqual({ p1: ['code-map'], p2: ['code-map'] })
    expect(manage.service.reload).toHaveBeenCalledTimes(1)
  })
})
