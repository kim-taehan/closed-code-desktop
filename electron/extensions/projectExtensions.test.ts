import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProjectExtensions } from './projectExtensions'
import { ProjectRegistry } from '../projects/projectRegistry'
import { ProjectStore } from '../projects/projectStore'

// 프로젝트마다 켠 확장 — **이전**과 **새 프로젝트**가 여기서 갈린다 (확장 재설계 §3).
// 레지스트리·저장소는 진짜를 쓴다. 이전이 지키는 것은 결국 `projects.json` 에 무엇이 남나다.

let workDir = ''
let storePath = ''

beforeEach(async () => {
  workDir = await realpath(await mkdtemp(join(tmpdir(), 'ext-projects-')))
  storePath = join(workDir, 'projects.json')
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

async function dir(name: string): Promise<string> {
  const path = join(workDir, name)
  await mkdir(path, { recursive: true })
  return path
}

/** 이 기능 전의 `projects.json` — 기록에 `extensions` 가 없다 */
async function writeOldStore(...ids: string[]): Promise<void> {
  const projects = []
  for (const id of ids) projects.push({ id, root: await dir(id), name: id, favorite: false, lastOpenedAt: 1 })
  await writeFile(storePath, JSON.stringify({ projects, openIds: ids, activeId: ids[0] ?? null }))
}

async function stored(): Promise<Record<string, string[] | undefined>> {
  const parsed = JSON.parse(await readFile(storePath, 'utf8')) as { projects: { id: string; extensions?: string[] }[] }
  return Object.fromEntries(parsed.projects.map((project) => [project.id, project.extensions]))
}

function setup(legacy: () => Promise<readonly string[]> = async () => []) {
  const registry = new ProjectRegistry({ store: new ProjectStore(storePath, () => {}) })
  const legacyDisabled = vi.fn(legacy)
  const projects = createProjectExtensions({ registry: () => registry, legacyDisabled, log: () => {} })
  return { registry, projects, legacyDisabled }
}

const INSTALLED = ['code-map', 'screen-scenario', 'todo']

describe('이전 — 올라가도 쓰던 확장이 안 사라진다', () => {
  it('옛 프로젝트는 설치 − 꺼 둔 것으로 채워 저장한다', async () => {
    await writeOldStore('old-1', 'old-2')
    const { registry, projects } = setup(async () => ['todo'])
    await registry.restore()

    expect([...(await projects.enabledIn('old-1', INSTALLED))]).toEqual(['code-map', 'screen-scenario'])
    expect(await stored()).toEqual({ 'old-1': ['code-map', 'screen-scenario'], 'old-2': ['code-map', 'screen-scenario'] })
  })

  it('한 번 옮긴 뒤로는 옛 설정을 다시 읽지 않는다 — 꺼 둔 이름을 바꿔도 결과가 그대로다', async () => {
    await writeOldStore('old-1')
    let off = ['todo']
    const { registry, projects, legacyDisabled } = setup(async () => off)
    await registry.restore()
    await projects.enabledIn('old-1', INSTALLED)

    off = []
    await registry.setExtension('old-1', 'code-map', false)

    expect([...(await projects.enabledIn('old-1', INSTALLED))]).toEqual(['screen-scenario'])
    expect(legacyDisabled).toHaveBeenCalledTimes(1)
  })

  it('옛 설정을 못 읽으면 전부 켜진 것으로 옮긴다 — 설정 하나 때문에 확장이 다 사라지면 원인을 모른다', async () => {
    await writeOldStore('old-1')
    const { registry, projects } = setup(() => Promise.reject(new Error('설정 파일이 깨졌다')))
    await registry.restore()

    expect([...(await projects.enabledIn('old-1', INSTALLED))]).toEqual(INSTALLED)
  })

  // 확장 호스트는 창보다 먼저 뜬다. 복원 전에 물어 빈 답을 받으면 아무것도 안 실린다
  it('복원 전에 물으면 복원을 기다렸다 답한다 — 빈 목록을 저장해 기록을 지우지 않는다', async () => {
    await writeOldStore('old-1')
    const { registry, projects } = setup()

    const early = projects.enabledAnywhere(INSTALLED)
    await registry.restore()

    expect([...(await early)]).toEqual(INSTALLED)
    expect(Object.keys(await stored())).toEqual(['old-1'])
  })
})

describe('새 프로젝트', () => {
  it('아무것도 안 켜진 채 시작한다 — 이전 대상이 아니다', async () => {
    const { registry, projects } = setup()
    await registry.restore()
    const opened = await registry.open(await dir('fresh'))
    if (!opened.ok) throw new Error(opened.message)

    expect(opened.project.extensions).toEqual([])
    expect([...(await projects.enabledIn(opened.project.id, INSTALLED))]).toEqual([])
    expect(await stored()).toEqual({ [opened.project.id]: [] })
  })
})

describe('켜기·지우기', () => {
  it('켜기는 그 프로젝트만 바꾸고, 싣기는 합집합이다', async () => {
    const { registry, projects } = setup()
    await registry.restore()
    const a = await registry.open(await dir('a'))
    const b = await registry.open(await dir('b'))
    if (!a.ok || !b.ok) throw new Error('열기 실패')

    await projects.set(a.project.id, 'code-map', true, INSTALLED)
    await projects.set(b.project.id, 'todo', true, INSTALLED)

    expect([...(await projects.enabledIn(a.project.id, INSTALLED))]).toEqual(['code-map'])
    expect([...(await projects.enabledIn(b.project.id, INSTALLED))]).toEqual(['todo'])
    expect([...(await projects.enabledAnywhere(INSTALLED))].sort()).toEqual(['code-map', 'todo'])
    expect([...(await projects.enabledIn(null, INSTALLED))]).toEqual([])
  })

  it('모르는 프로젝트를 켜면 던진다 — 조용히 무시하면 토글이 아무 일도 안 한다', async () => {
    const { registry, projects } = setup()
    await registry.restore()

    await expect(projects.set('없음', 'todo', true, INSTALLED)).rejects.toThrow(/프로젝트를 찾지 못했습니다/)
  })

  it('지우면 모든 프로젝트에서 뺀다', async () => {
    await writeOldStore('old-1', 'old-2')
    const { registry, projects } = setup()
    await registry.restore()
    await projects.enabledAnywhere(INSTALLED)

    await projects.forget('todo')

    expect(await stored()).toEqual({ 'old-1': ['code-map', 'screen-scenario'], 'old-2': ['code-map', 'screen-scenario'] })
  })
})
