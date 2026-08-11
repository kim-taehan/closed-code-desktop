import { rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { METHOD_LOAD_EXTENSIONS, METHOD_RUN_COMMAND, okResponse } from './rpc'
import { METHOD_SET_ROWS } from './davisApi'
import { makeExtensionsDir, makeExtensionService, type FakeChild } from '../../tests/extensions/serviceKit'

// 결과 행의 겉봉 = **명령을 건 프로젝트**.
//
// 오래 걸리는 명령이 도는 중에 사용자가 탭을 옮기면 결과가 엉뚱한 탭에 그려지던 결함
// (`_workspace/53` M2). 겉봉은 밀 때가 아니라 **거는 순간** 굳어야 한다.
// 굳힌 값을 실제로 겉봉에 씌우는 쪽은 `electron/ipc/extensionBridge.test.ts` 가 잡는다.

const created: string[] = []
let extensionsDir: string

beforeEach(async () => {
  extensionsDir = await makeExtensionsDir()
  created.push(extensionsDir)
})

afterEach(async () => {
  while (created.length > 0) await rm(created.pop() as string, { recursive: true, force: true })
})

/** 싣기까지 끝난 서비스 + 올라온 행의 겉봉 기록 */
async function boot() {
  const { service, child } = makeExtensionService(extensionsDir)
  const seen: (string | null)[] = []
  service.onViewRows((_viewId, _rows, projectId) => seen.push(projectId))
  service.start()
  child.ready()
  await vi.waitFor(() => expect(child.find(METHOD_LOAD_EXTENSIONS)).toBeDefined())
  const load = child.find(METHOD_LOAD_EXTENSIONS) as { id: string }
  child.emit(okResponse(load.id, { loaded: ['good'], failed: [] }))
  return { service, child, seen }
}

/** 확장이 `davis.view.setRows` 를 부른 것처럼 자식 쪽에서 요청을 올린다 */
function setRows(child: FakeChild, id: string): void {
  child.emit({ kind: 'request', id, method: METHOD_SET_ROWS, params: { viewId: 'v', rows: [{ a: 1 }] } })
}

function runs(child: FakeChild): { id: string }[] {
  return child.findAll(METHOD_RUN_COMMAND)
}

describe('결과 행의 겉봉 — 명령을 건 프로젝트', () => {
  it('명령이 도는 중에 올라온 행은 그 명령의 프로젝트를 단다', async () => {
    const { service, child, seen } = await boot()
    const running = service.runCommand('good.run', '프로젝트-1')
    await vi.waitFor(() => expect(runs(child)).toHaveLength(1))

    setRows(child, 'rows-1')
    await vi.waitFor(() => expect(seen).toHaveLength(1))

    expect(seen).toEqual(['프로젝트-1'])
    child.emit(okResponse(runs(child)[0]?.id as string))
    await running
    service.dispose()
  })

  it('명령이 끝난 뒤에 올라온 행은 겉봉이 없다 — 부르는 쪽이 활성 프로젝트로 되돌아간다', async () => {
    const { service, child, seen } = await boot()
    const running = service.runCommand('good.run', '프로젝트-1')
    await vi.waitFor(() => expect(runs(child)).toHaveLength(1))
    child.emit(okResponse(runs(child)[0]?.id as string))
    await running

    setRows(child, 'rows-1')
    await vi.waitFor(() => expect(seen).toHaveLength(1))

    expect(seen).toEqual([null])
    service.dispose()
  })

  it('같은 프로젝트의 명령이 둘 겹쳤다가 하나 끝나도 겉봉이 남는다', async () => {
    // 자리를 값으로 지우면(둘 다 제거) 남은 명령의 결과가 겉봉을 잃는다
    const { service, child, seen } = await boot()
    const first = service.runCommand('good.run', '프로젝트-1')
    const second = service.runCommand('good.run', '프로젝트-1')
    await vi.waitFor(() => expect(runs(child)).toHaveLength(2))
    child.emit(okResponse(runs(child)[0]?.id as string))
    await first

    setRows(child, 'rows-1')
    await vi.waitFor(() => expect(seen).toHaveLength(1))

    expect(seen).toEqual(['프로젝트-1'])
    child.emit(okResponse(runs(child)[1]?.id as string))
    await second
    service.dispose()
  })

  it('서로 다른 프로젝트의 명령이 겹쳐 돌면 모른다(null), 하나가 끝나면 다시 좁혀진다', async () => {
    // `commandProjectId` 의 ponytail 한계 그대로다 — 어느 명령이 이 행을 냈는지 부모는 알 수 없다
    const { service, child, seen } = await boot()
    const first = service.runCommand('good.run', '프로젝트-1')
    const second = service.runCommand('good.run', '프로젝트-2')
    await vi.waitFor(() => expect(runs(child)).toHaveLength(2))

    setRows(child, 'rows-1')
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen).toEqual([null])

    child.emit(okResponse(runs(child)[0]?.id as string))
    await first
    setRows(child, 'rows-2')
    await vi.waitFor(() => expect(seen).toHaveLength(2))

    expect(seen[1]).toBe('프로젝트-2')
    child.emit(okResponse(runs(child)[1]?.id as string))
    await second
    service.dispose()
  })
})
