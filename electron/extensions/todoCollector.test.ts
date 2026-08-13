import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExtensionService } from './service'
import { ExtensionWorkspace } from './workspaceApi'
import { LiveChild } from '../../tests/extensions/liveChild'

// 확장 체계가 **끝까지 뚫렸는지**를 실제 확장 하나로 증명한다.
//
// 대상은 `tests/fixtures/extensions/todo-collector` — 스크래치패드 원본의 **바이트 동일 복사본**이다.
// 확장을 고쳐서 통과시키면 검증이 아니라 조작이므로, 이 파일은 확장을 손대지 않는다.
//
// 프로세스 경계(utilityProcess)만 가짜다(`LiveChild`). 그 안쪽은 전부 진짜다 —
// registry 훑기 · resolveInside · require · activate · code.* 왕복 · ProjectFs · glob.

const FIXTURES = join(__dirname, '../../tests/fixtures/extensions')

const created: string[] = []
let projectRoot: string

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'todo-collector-'))
  created.push(base)
  // macOS 의 /var → /private/var. 안 펴면 경계 판정이 전부 "밖" 이 된다.
  projectRoot = await realpath(base)
})

afterEach(async () => {
  while (created.length > 0) await rm(created.pop() as string, { recursive: true, force: true })
})

async function write(relativePath: string, text: string): Promise<void> {
  const target = join(projectRoot, relativePath)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, text, 'utf8')
}

function startService(): {
  service: ExtensionService
  rows: Map<string, unknown[]>
  /** 뷰별로 마지막에 올라온 행의 겉봉 — 명령을 건 프로젝트 */
  envelopes: Map<string, string | null>
} {
  const rows = new Map<string, unknown[]>()
  const envelopes = new Map<string, string | null>()
  const project = { id: 'p1', root: projectRoot }
  const service = new ExtensionService({
    entryPath: 'ignored',
    fork: () => new LiveChild(),
    extensionsDir: FIXTURES,
    workspace: new ExtensionWorkspace(() => ({ active: project, openProjects: [project] })),
  })
  service.onViewRows((viewId, viewRows, projectId) => {
    rows.set(viewId, viewRows)
    envelopes.set(viewId, projectId)
  })
  service.start()
  return { service, rows, envelopes }
}

describe('TODO 수집기 확장 — 무수정으로 도는가', () => {
  it('목록에 뜨고 싣기 실패가 없다', async () => {
    const { service } = startService()

    const listing = await service.listExtensions()

    expect(listing.extensions.map((extension) => extension.manifest.name)).toContain('todo-collector')
    expect(listing.skipped).toEqual([])
    service.dispose()
  })

  it('명령을 실행하면 표시자 줄이 뷰 행으로 올라온다', async () => {
    await write('src/a.ts', 'const x = 1\n// TODO: 정리하기\n')
    await write('src/b.py', '# FIXME: 여기 깨짐\n')
    const { service, rows } = startService()

    await service.runCommand('todoCollector.scan', null)

    expect(rows.get('todoCollector.results')).toEqual([
      // FIXME 가 TODO 보다 먼저다 — 확장이 급한 순으로 정렬한다
      { kind: 'FIXME', file: 'src/b.py', line: 1, text: '여기 깨짐' },
      { kind: 'TODO', file: 'src/a.ts', line: 2, text: '정리하기' },
    ])
    service.dispose()
  })

  it('명령 중에 민 행이 명령을 건 프로젝트 겉봉을 단다', async () => {
    // 겉봉 고정(`_workspace/53` M2)이 **실제 확장**에서도 성립하는지 본다.
    // 성립 조건은 확장이 명령 안에서 `setRows` 를 부르는 것이다 — 명령이 끝난 뒤에
    // 밀면(타이머 등) 겉봉이 없어 활성 프로젝트로 되돌아간다. 가짜 자식으로 보는
    // 부모 쪽 규칙은 serviceRowEnvelope.test.ts 가 잡는다.
    await write('src/a.ts', '// TODO: 정리하기\n')
    const { service, envelopes } = startService()

    await service.runCommand('todoCollector.scan', '프로젝트-1')

    expect(envelopes.get('todoCollector.results')).toBe('프로젝트-1')
    service.dispose()
  })

  it('훑는 범위가 glob 그대로다 — 대상 밖 확장자는 안 걸린다', async () => {
    await write('a.ts', '// TODO: 걸린다\n')
    await write('a.txt', '// TODO: 안 걸린다\n')
    await write('node_modules/pkg/index.ts', '// TODO: 안 걸린다\n')
    const { service, rows } = startService()

    await service.runCommand('todoCollector.scan', null)

    expect(rows.get('todoCollector.results')).toEqual([
      { kind: 'TODO', file: 'a.ts', line: 1, text: '걸린다' },
    ])
    service.dispose()
  })

  it('표시자가 없으면 빈 표를 넘긴다 — 아무 일도 안 하는 것과 다르다', async () => {
    await write('a.ts', 'const x = 1\n')
    const { service, rows } = startService()

    await service.runCommand('todoCollector.scan', null)

    expect(rows.get('todoCollector.results')).toEqual([])
    service.dispose()
  })

  it('없는 명령은 거부한다', async () => {
    const { service } = startService()

    await expect(service.runCommand('todoCollector.없음', null)).rejects.toThrow(/등록되지 않은 명령/)
    service.dispose()
  })

  it('열린 프로젝트가 없으면 확장 쪽으로 오류가 전달된다 — 조용히 빈 표가 되지 않는다', async () => {
    const service = new ExtensionService({
      entryPath: 'ignored',
      fork: () => new LiveChild(),
      extensionsDir: FIXTURES,
      workspace: new ExtensionWorkspace(() => null),
    })
    service.start()

    await expect(service.runCommand('todoCollector.scan', null)).rejects.toThrow(/열린 프로젝트가 없습니다/)
    service.dispose()
  })
})
