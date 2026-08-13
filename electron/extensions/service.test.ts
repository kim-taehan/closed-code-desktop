import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionService } from './service'
import type { ExtensionWorkspace } from './workspaceApi'
import { METHOD_LOAD_EXTENSIONS, METHOD_RUN_COMMAND, okResponse } from './rpc'
import { METHOD_READ_FILE, METHOD_SET_ROWS } from './extensionApi'
import { makeExtensionsDir, makeExtensionService, type FakeChild } from '../../tests/extensions/serviceKit'

// 부모 쪽 계약만 본다. 확장을 실제로 싣는 왕복은 todoCollector.test.ts 가 잡는다.
// 결과 행의 겉봉(명령을 건 프로젝트)은 serviceRowEnvelope.test.ts 가 잡는다.

const created: string[] = []
let extensionsDir: string

beforeEach(async () => {
  extensionsDir = await makeExtensionsDir()
  created.push(extensionsDir)
})

afterEach(async () => {
  while (created.length > 0) await rm(created.pop() as string, { recursive: true, force: true })
})

function makeService(workspace: Partial<ExtensionWorkspace> = {}): { service: ExtensionService; child: FakeChild } {
  return makeExtensionService(extensionsDir, workspace)
}

describe('싣기 순서', () => {
  it('ready 를 받기 전에는 싣기 요청을 보내지 않는다', async () => {
    const { service, child } = makeService()
    service.start()
    await Promise.resolve()

    // 자식이 리스너를 걸기 전에 보내면 메시지가 그냥 사라진다
    expect(child.find(METHOD_LOAD_EXTENSIONS)).toBeUndefined()
    service.dispose()
  })

  it('ready 를 받으면 훑기 결과를 실어 보낸다', async () => {
    const { service, child } = makeService()
    service.start()
    child.ready()
    await vi.waitFor(() => expect(child.find(METHOD_LOAD_EXTENSIONS)).toBeDefined())

    const request = child.find(METHOD_LOAD_EXTENSIONS)
    const params = (request as { params: { extensions: { manifest: { name: string } }[] } }).params
    expect(params.extensions.map((extension) => extension.manifest.name)).toEqual(['good'])
    service.dispose()
  })
})

describe('listExtensions', () => {
  it('훑기 사유와 싣기 사유를 합쳐 준다', async () => {
    const { service, child } = makeService()
    service.start()
    child.ready()
    await vi.waitFor(() => expect(child.find(METHOD_LOAD_EXTENSIONS)).toBeDefined())

    const request = child.find(METHOD_LOAD_EXTENSIONS) as { id: string }
    child.emit(
      okResponse(request.id, {
        loaded: [],
        failed: [{ dir: join(extensionsDir, 'good'), reason: 'require_failed', detail: '문법 오류' }],
      }),
    )

    const listing = await service.listExtensions()
    expect(listing.skipped).toEqual([
      { dir: join(extensionsDir, 'broken'), reason: 'invalid_json' },
      { dir: join(extensionsDir, 'good'), reason: 'require_failed', detail: '문법 오류' },
    ])
    service.dispose()
  })

  it('사유를 로그로 흘린다 — 반환값까지만 살면 "복사했는데 안 뜬다" 로 끝난다', async () => {
    // `_workspace/46` 결함 #3 = 강제사항 F. 화면 노출은 다음 단계지만 로그는 지금 나와야 한다.
    const { service, child } = makeService()
    const lines: string[] = []
    service.onLog((line) => lines.push(line))
    service.start()
    child.ready()
    await vi.waitFor(() => expect(child.find(METHOD_LOAD_EXTENSIONS)).toBeDefined())

    const request = child.find(METHOD_LOAD_EXTENSIONS) as { id: string }
    child.emit(
      okResponse(request.id, {
        loaded: [],
        failed: [{ dir: join(extensionsDir, 'good'), reason: 'main_outside' }],
      }),
    )
    await service.listExtensions()

    // 훑기 단계(invalid_json)와 싣기 단계(main_outside)가 **둘 다** 나와야 한다
    expect(lines.some((line) => line.includes('invalid_json'))).toBe(true)
    expect(lines.some((line) => line.includes('main_outside'))).toBe(true)
    service.dispose()
  })

  it('호스트가 죽어도 영원히 기다리지 않는다', async () => {
    const { service, child } = makeService()
    service.start()
    child.emitExit(1)

    const listing = await service.listExtensions()
    // 훑기까지는 됐으므로 목록은 남는다. 싣기 사유가 없을 뿐이다.
    expect(listing.extensions).toHaveLength(1)
    service.dispose()
  })
})

describe('runCommand', () => {
  it('싣기가 끝난 뒤에 나간다 — 기동 직후 호출이 빈손으로 돌아오지 않게', async () => {
    const { service, child } = makeService()
    service.start()
    const running = service.runCommand('good.run', null)
    await Promise.resolve()

    // 아직 ready 가 안 왔으니 명령도 안 나갔어야 한다
    expect(child.find(METHOD_RUN_COMMAND)).toBeUndefined()

    child.ready()
    await vi.waitFor(() => expect(child.find(METHOD_LOAD_EXTENSIONS)).toBeDefined())
    const load = child.find(METHOD_LOAD_EXTENSIONS) as { id: string }
    child.emit(okResponse(load.id, { loaded: ['good'], failed: [] }))

    await vi.waitFor(() => expect(child.find(METHOD_RUN_COMMAND)).toBeDefined())
    const run = child.find(METHOD_RUN_COMMAND) as { id: string }
    child.emit(okResponse(run.id))
    await expect(running).resolves.toBeUndefined()
    service.dispose()
  })
})

describe('자식이 부른 code.* 에 답한다', () => {
  it('view.setRows 를 구독자에게 올리고 ok 로 답한다', async () => {
    const { service, child } = makeService()
    const seen: [string, unknown[]][] = []
    service.onViewRows((viewId, rows) => seen.push([viewId, rows]))
    service.start()

    child.emit({ kind: 'request', id: 'r1', method: METHOD_SET_ROWS, params: { viewId: 'v1', rows: [{ a: 1 }] } })
    await vi.waitFor(() => expect(child.sent.some((message) => message.kind === 'response')).toBe(true))

    expect(seen).toEqual([['v1', [{ a: 1 }]]])
    expect(child.sent.at(-1)).toMatchObject({ kind: 'response', id: 'r1', ok: true })
    service.dispose()
  })

  it('모르는 메서드는 오류로 답한다 — 삼키면 확장의 await 가 영원히 걸린다', async () => {
    const { service, child } = makeService()
    service.start()

    child.emit({ kind: 'request', id: 'r2', method: 'workspace.deleteEverything' })
    await vi.waitFor(() => expect(child.sent.some((message) => message.kind === 'response')).toBe(true))

    expect(child.sent.at(-1)).toMatchObject({ kind: 'response', id: 'r2', ok: false })
    service.dispose()
  })

  it('workspace 가 던지면 그 문구가 오류 응답으로 간다', async () => {
    const { service, child } = makeService({
      readFile: () => Promise.reject(new Error('파일을 읽을 수 없습니다 (not_allowed): ../밖.ts')),
    })
    service.start()

    child.emit({ kind: 'request', id: 'r3', method: METHOD_READ_FILE, params: { path: '../밖.ts' } })
    await vi.waitFor(() => expect(child.sent.some((message) => message.kind === 'response')).toBe(true))

    expect(child.sent.at(-1)).toMatchObject({ kind: 'response', id: 'r3', ok: false, error: /not_allowed/ })
    service.dispose()
  })

  it('인자 모양이 아니면 workspace 를 부르지도 않는다', async () => {
    const readFile = vi.fn()
    const { service, child } = makeService({ readFile })
    service.start()

    child.emit({ kind: 'request', id: 'r4', method: METHOD_READ_FILE, params: { path: 42 } })
    await vi.waitFor(() => expect(child.sent.some((message) => message.kind === 'response')).toBe(true))

    expect(readFile).not.toHaveBeenCalled()
    expect(child.sent.at(-1)).toMatchObject({ kind: 'response', id: 'r4', ok: false })
    service.dispose()
  })
})
