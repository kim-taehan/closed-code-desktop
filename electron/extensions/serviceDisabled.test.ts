import { cp, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExtensionService } from './service'
import { ExtensionWorkspace } from './workspaceApi'
import { LiveChild } from '../../tests/extensions/liveChild'

// 꺼 둔 확장. 실제 자식(LiveChild)에 실어 보고 **명령이 정말 사라지는지**까지 본다 —
// 목록에서만 꺼진 것처럼 보이고 명령은 그대로 도는 것이 여기서 잡으려는 어긋남이다.
//
// 픽스처 확장으로만 돌린다 (`serviceReload.test.ts` 와 같은 이유 — 호스트는 특정 확장을
// 알면 안 된다).

const FIXTURES_DIR = join(__dirname, '../../tests/fixtures/extensions')

const created: string[] = []
let projectRoot: string
let extensionsDir: string

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'ext-off-'))
  created.push(base)
  projectRoot = await realpath(base)
  extensionsDir = await mkdtemp(join(tmpdir(), 'ext-off-dir-'))
  created.push(extensionsDir)
  await cp(join(FIXTURES_DIR, 'echo-rows'), join(extensionsDir, 'echo-rows'), { recursive: true })
})

afterEach(async () => {
  while (created.length > 0) await rm(created.pop() as string, { recursive: true, force: true })
})

/** `off` 는 부를 때마다 읽힌다 — 배열을 바꾸면 다음 reload 부터 반영된다 */
function startService(off: string[]) {
  const project = { id: 'p1', root: projectRoot }
  return new ExtensionService({
    entryPath: 'ignored',
    fork: () => new LiveChild(),
    extensionsDir,
    workspace: new ExtensionWorkspace(() => ({ active: project, openProjects: [project] })),
    disabledNames: async () => off,
  })
}

describe('꺼 둔 확장', () => {
  it('목록에는 남되 꺼진 것으로 온다 — 사라지면 다시 켤 자리가 없다', async () => {
    const service = startService(['echo-rows'])
    service.start()

    const listing = await service.listExtensions()

    expect(listing.extensions.map((item) => item.manifest.name)).toEqual(['echo-rows'])
    expect(listing.extensions[0]!.enabled).toBe(false)
    service.dispose()
  })

  it('명령이 실제로 사라진다 — 목록에서만 꺼지면 반쪽이다', async () => {
    const service = startService(['echo-rows'])
    service.start()

    await expect(service.runCommand('echoRows.run', null)).rejects.toThrow(/등록되지 않은 명령/)
    service.dispose()
  })

  it('다시 켜고 reload 하면 명령이 돌아온다', async () => {
    const off = ['echo-rows']
    const service = startService(off)
    const rows = new Map<string, unknown[]>()
    service.onViewRows((viewId, viewRows) => rows.set(viewId, viewRows))
    service.start()
    await expect(service.runCommand('echoRows.run', null)).rejects.toThrow(/등록되지 않은 명령/)

    off.length = 0
    await service.reload()

    await service.runCommand('echoRows.run', null)
    expect(rows.get('echoRows.results')).toEqual([{ file: 'echo.ts', lines: 1 }])
    expect((await service.listExtensions()).extensions[0]!.enabled).toBe(true)
    service.dispose()
  })

  // 덮어쓴 확장의 새 코드는 새 자식에서만 실린다 (require 캐시). 앱을 껐다 켜는 대신
  // 자식만 갈아 끼우는 길인데, **같은 호스트 객체를 다시 쓰는 것**이라 배선이 살아 있어야 한다.
  it('자식을 갈아 끼워도 목록·명령이 그대로 돈다', async () => {
    const service = startService([])
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

  // 설정 파일 하나 때문에 확장이 전부 안 보이면 원인을 짐작할 수 없다
  it('꺼둔 목록을 못 읽으면 전부 켜진 것으로 친다', async () => {
    const project = { id: 'p1', root: projectRoot }
    const service = new ExtensionService({
      entryPath: 'ignored',
      fork: () => new LiveChild(),
      extensionsDir,
      workspace: new ExtensionWorkspace(() => ({ active: project, openProjects: [project] })),
      disabledNames: () => Promise.reject(new Error('설정 파일이 깨졌다')),
    })
    service.start()

    const listing = await service.listExtensions()

    expect(listing.extensions[0]!.enabled).toBe(true)
    service.dispose()
  })
})
