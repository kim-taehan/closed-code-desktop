import { cp, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExtensionService } from './service'
import { ExtensionWorkspace } from './workspaceApi'
import { LiveChild } from '../../tests/extensions/liveChild'

// 설치 직후의 **재훑기**(`ExtensionService.reload`).
//
// 이것이 없으면 새로 설치한 확장은 앱을 껐다 켜야 보인다 — `scan()` 이 한 번만 훑기
// 때문이다. 사용자에게는 "설치했는데 목록에 없다" 로만 보이고 어디에도 사유가 안 남는다.
//
// 훑기만 다시 하는 것으로는 부족하다. **자식에 다시 실어야** 명령이 돈다 — 목록에는
// 뜨는데 눌러도 "등록되지 않은 명령" 이 되는 것이 그 경계다. 그래서 여기서 명령까지 건다.
//
// **배포되는 확장(`extensions/`)을 쓰지 않는다.** 호스트 시험이 특정 확장을 알면 그 확장을
// 고치거나 다른 레포로 빼는 순간 앱 테스트가 깨진다 — 호스트는 범용 API 만 제공한다.
// 픽스처 확장으로만 돌린다.

const FIXTURES_DIR = join(__dirname, '../../tests/fixtures/extensions')

const created: string[] = []
let projectRoot: string
let extensionsDir: string

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'ext-reload-'))
  created.push(base)
  // macOS 의 /var → /private/var. 안 펴면 경계 판정이 전부 "밖" 이 된다.
  projectRoot = await realpath(base)
  extensionsDir = await mkdtemp(join(tmpdir(), 'ext-reload-dir-'))
  created.push(extensionsDir)
})

afterEach(async () => {
  while (created.length > 0) await rm(created.pop() as string, { recursive: true, force: true })
})

/** 픽스처 확장을 설치 폴더로 복사한다 — 앱에서 패키지를 푸는 것과 같은 자리다. */
async function install(name: string): Promise<void> {
  await cp(join(FIXTURES_DIR, name), join(extensionsDir, name), { recursive: true })
}

function startService(): { service: ExtensionService; rows: Map<string, unknown[]> } {
  const rows = new Map<string, unknown[]>()
  const project = { id: 'p1', root: projectRoot }
  const service = new ExtensionService({
    entryPath: 'ignored',
    fork: () => new LiveChild(),
    extensionsDir,
    workspace: new ExtensionWorkspace(() => ({ active: project, openProjects: [project] })),
  })
  service.onViewRows((viewId, viewRows) => rows.set(viewId, viewRows))
  service.start()
  return { service, rows }
}

function names(listing: { extensions: { manifest: { name: string } }[] }): string[] {
  return listing.extensions.map((extension) => extension.manifest.name)
}

describe('설치 뒤 재훑기', () => {
  it('reload 전에는 안 보이고, reload 하면 목록에 뜬다', async () => {
    const { service } = startService()
    expect(names(await service.listExtensions())).toEqual([])

    await install('echo-rows')
    // 여기서 다시 물어봐도 그대로다 — 훑기가 캐시돼 있다. 이것이 재시작이 필요했던 이유다.
    expect(names(await service.listExtensions())).toEqual([])

    await service.reload()

    expect(names(await service.listExtensions())).toEqual(['echo-rows'])
    service.dispose()
  })

  it('reload 뒤에는 새 확장의 명령이 실제로 돈다 — 목록에만 뜨는 것으로는 부족하다', async () => {
    const { service, rows } = startService()
    await install('echo-rows')

    // 싣기 전에는 명령이 없다 — 이 거부가 사라져야 재싣기가 성립한 것이다
    await expect(service.runCommand('echoRows.run', null)).rejects.toThrow(/등록되지 않은 명령/)

    await service.reload()
    await service.runCommand('echoRows.run', null)

    expect(rows.get('echoRows.results')).toEqual([{ file: 'echo.ts', lines: 1 }])
    service.dispose()
  })

  it('먼저 실려 있던 확장은 재훑기 뒤에도 그대로 돈다', async () => {
    // 자식은 `load` 를 받으면 명령표를 **통째로 갈아끼운다**(`childHandlers.ts`).
    // 새 목록에 기존 확장이 빠지면 멀쩡하던 명령이 조용히 죽는다 — 그 자리를 잠근다.
    await writeFile(join(projectRoot, 'a.ts'), '// TODO: 정리하기\n', 'utf8')
    await install('todo-collector')
    const { service, rows } = startService()
    await install('echo-rows')

    await service.reload()

    await service.runCommand('todoCollector.scan', null)
    expect(rows.get('todoCollector.results')).toEqual([
      { kind: 'TODO', file: 'a.ts', line: 1, text: '정리하기' },
    ])
    service.dispose()
  })

  it('싣기에 실패한 확장의 사유가 재훑기 뒤에도 목록에 남는다', async () => {
    const { service } = startService()
    await mkdir(join(extensionsDir, 'broken'), { recursive: true })
    await writeFile(
      join(extensionsDir, 'broken', 'manifest.json'),
      JSON.stringify({ manifestVersion: 2, name: 'broken', version: '1.0.0', main: 'main.js' }),
      'utf8',
    )
    await writeFile(join(extensionsDir, 'broken', 'main.js'), 'function (((\n', 'utf8')

    await service.reload()

    const listing = await service.listExtensions()
    // 사유가 사라지면 "설치했는데 안 뜬다" 로만 끝난다 — 재훑기가 사유까지 다시 만들어야 한다
    expect(listing.skipped).toEqual([
      expect.objectContaining({ dir: join(extensionsDir, 'broken'), reason: 'require_failed' }),
    ])
    service.dispose()
  })
})
