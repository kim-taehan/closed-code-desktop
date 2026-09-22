import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  METHOD_GET_PROJECT_PATH,
  METHOD_LIST_FILES,
  METHOD_READ_FILE,
  METHOD_STORAGE_GET,
  METHOD_STORAGE_SET,
} from './extensionApi'
import { dispatchExtensionApi, portsOf } from './serviceDispatch'
import { createRequest } from './rpc'
import { ExtensionWorkspace } from './workspaceApi'
import { ProjectEnvelope } from './projectEnvelope'
import type { ExtensionStorage } from './storageStore'

// G-1·G-2 (확장 재설계 「가이드 작성 중 드러난 호스트 결함」, 2026-09-22) — **어느 프로젝트를 읽고 쓰나.**
//
// G-1: `workspace.*` 가 화면에 떠 있는 프로젝트를 읽었다 — P 의 핸들러가 도는 중에 Q 로 옮기면 Q 를 읽었다.
// G-2: `storage.*` 가 명시 `projectId` 를 못 받았고, 겉봉이 없으면 공용 칸에 조용히 썼다 (3판만 고친다).
//
// 폴더는 진짜다 — P 와 Q 에 **같은 이름, 다른 내용**의 파일을 둬 어느 쪽을 읽었는지가 답에 드러난다.

let base = ''
let screen: { id: string; root: string } | null = null
let opened: { id: string; root: string }[] = []

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'ext-g1-')))
  opened = []
  for (const id of ['P', 'Q']) {
    const root = join(base, id)
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'a.ts'), `// ${id} 의 파일`, 'utf8')
    await writeFile(join(root, `${id}-only.ts`), '', 'utf8')
    opened.push({ id, root })
  }
  screen = opened[0] ?? null
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

function bed(options: { version?: number; allowed?: (projectId: string) => string[] | undefined } = {}) {
  const envelope = new ProjectEnvelope()
  const stored: { project: string | null; key: string }[] = []
  const storage: ExtensionStorage = {
    get: async (_extension, project, key) => (stored.push({ project, key }), undefined),
    set: async (_extension, project, key) => void stored.push({ project, key }),
  }
  // 옛 구현이 보던 `active` 를 **그대로 둔다** — 화면을 보면 이 시험이 빨개진다
  const source = {
    get active() {
      return screen
    },
    get openProjects() {
      return opened
    },
  }
  const deps = portsOf(
    { workspace: new ExtensionWorkspace(() => source), storage },
    {
      projectId: () => envelope.current(),
      allowedIn: async (projectId) => options.allowed?.(projectId),
      manifestOf: async () => ({ manifestVersion: options.version ?? 3 }),
      emitRows: () => {},
      emitHtml: () => {},
      emitTree: () => {},
      emitProgress: () => {},
      notifyChild: () => {},
    },
  )
  const call = (method: string, params: Record<string, unknown> = {}) =>
    dispatchExtensionApi(deps, createRequest(method, { extension: 'req', ...params }))
  return { envelope, call, stored }
}

describe('G-1 — workspace 는 핸들러가 도는 프로젝트를 읽는다', () => {
  it('P 의 핸들러가 도는 중에 화면을 Q 로 옮겨도 P 를 읽는다', async () => {
    const { envelope, call } = bed()

    const seen = await envelope.during('P', async () => {
      screen = opened[1] ?? null // 사용자가 Q 로 옮겼다
      return [
        await call(METHOD_READ_FILE, { path: 'src/a.ts' }),
        await call(METHOD_GET_PROJECT_PATH),
        await call(METHOD_LIST_FILES, { glob: '*.ts' }),
      ]
    })

    expect(seen).toEqual(['// P 의 파일', join(base, 'P'), { files: ['P-only.ts'], truncated: false }])
  })

  it('겉봉 밖(타이머·activate)이면 적은 projectId 를 읽는다', async () => {
    const { call } = bed()
    expect(await call(METHOD_READ_FILE, { path: 'src/a.ts', projectId: 'Q' })).toBe('// Q 의 파일')
  })

  it('겉봉도 projectId 도 없으면 거절한다 — 화면의 프로젝트로 되돌아가지 않는다', async () => {
    const { call } = bed()
    for (const method of [METHOD_READ_FILE, METHOD_GET_PROJECT_PATH, METHOD_LIST_FILES]) {
      await expect(call(method, { path: 'src/a.ts', glob: '*.ts' })).rejects.toThrow(/어느 프로젝트/)
    }
  })

  it('그 프로젝트에서 켜지 않은 확장이면 거절한다', async () => {
    const { envelope, call } = bed({ allowed: (projectId) => (projectId === 'Q' ? ['req'] : []) })

    await envelope.during('P', async () => {
      await expect(call(METHOD_READ_FILE, { path: 'src/a.ts' })).rejects.toThrow(/켜지 않은 확장/)
    })
    expect(await call(METHOD_READ_FILE, { path: 'src/a.ts', projectId: 'Q' })).toBe('// Q 의 파일')
  })
})

describe('G-2 — storage 의 칸 (3판만)', () => {
  it('3판: 겉봉도 projectId 도 없으면 거절하고 저장소에 닿지 않는다', async () => {
    const { call, stored } = bed()

    await expect(call(METHOD_STORAGE_SET, { key: 'k', value: 1 })).rejects.toThrow(/어느 프로젝트/)
    await expect(call(METHOD_STORAGE_GET, { key: 'k' })).rejects.toThrow(/어느 프로젝트/)
    expect(stored).toEqual([])
  })

  it('3판: 적은 projectId 가 겉봉보다 먼저다 — 둘 다 그 칸으로 간다', async () => {
    const { envelope, call, stored } = bed()

    await call(METHOD_STORAGE_SET, { key: 'k', value: 1, projectId: 'Q' })
    await envelope.during('P', async () => {
      await call(METHOD_STORAGE_GET, { key: 'k' })
      await call(METHOD_STORAGE_GET, { key: 'k', projectId: 'Q' })
    })

    expect(stored).toEqual([
      { project: 'Q', key: 'k' },
      { project: 'P', key: 'k' },
      { project: 'Q', key: 'k' },
    ])
  })

  it('2판은 그대로다 — 겉봉이 없으면 null(=활성·공용 칸)로, 적은 projectId 는 안 본다', async () => {
    const { call, stored } = bed({ version: 2 })

    await call(METHOD_STORAGE_SET, { key: 'k', value: 1 })
    await call(METHOD_STORAGE_GET, { key: 'k', projectId: 'Q' })

    expect(stored).toEqual([
      { project: null, key: 'k' },
      { project: null, key: 'k' },
    ])
  })
})
