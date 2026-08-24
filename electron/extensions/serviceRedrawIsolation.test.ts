import { rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { METHOD_LOAD_EXTENSIONS, METHOD_REDRAW, METHOD_RUN_COMMAND, okResponse } from './rpc'
import { METHOD_SET_HTML } from './extensionApi'
import { makeExtensionsDir, makeExtensionService, type FakeChild } from '../../tests/extensions/serviceKit'

// 다시그리기(redraw)는 **남의 프로젝트 화면을 나르지 않는다** (`viewOwnership.ts`).
//
// A 에서 그린 테스트 시나리오 화면이 B 로 전환하는 순간 B 에도 떴다 (2026-08-24 사용자 보고,
// `_workspace/18`). 화면 쪽이 전환마다 redraw 를 청하고, 그때 올라온 emit 의 겉봉이
// 지금 활성 프로젝트로 찍히기 때문이다. 겉봉 규칙 자체는 `serviceRowEnvelope.test.ts` 가
// 잡는다 — 여기는 그 규칙 위에서 **redraw 만** 골라 막는 층을 겨눈다.

const created: string[] = []
let extensionsDir: string

beforeEach(async () => {
  extensionsDir = await makeExtensionsDir()
  created.push(extensionsDir)
})

afterEach(async () => {
  while (created.length > 0) await rm(created.pop() as string, { recursive: true, force: true })
})

/** 싣기까지 끝난 서비스 + 올라온 화면의 (뷰, 겉봉) 기록 */
async function boot() {
  const { service, child } = makeExtensionService(extensionsDir)
  const seen: { viewId: string; projectId: string | null }[] = []
  service.onViewHtml((viewId, _html, projectId) => seen.push({ viewId, projectId }))
  service.start()
  child.ready()
  await vi.waitFor(() => expect(child.find(METHOD_LOAD_EXTENSIONS)).toBeDefined())
  const load = child.find(METHOD_LOAD_EXTENSIONS) as { id: string }
  child.emit(okResponse(load.id, { loaded: ['good'], failed: [] }))
  return { service, child, seen }
}

/** 확장이 `code.view.setHtml` 을 부른 것처럼 자식 쪽에서 요청을 올린다 */
function setHtml(child: FakeChild, id: string, viewId = 'v'): void {
  child.emit({ kind: 'request', id, method: METHOD_SET_HTML, params: { viewId, html: '<p>화면</p>' } })
}

/** 프로젝트 A 에서 명령을 한 번 돌려 뷰 `v` 의 주인을 A 로 기록해 둔다 */
async function drawnBy(service: Awaited<ReturnType<typeof boot>>['service'], child: FakeChild, seen: unknown[]) {
  const running = service.runCommand('good.run', '프로젝트-A')
  await vi.waitFor(() => expect(child.findAll(METHOD_RUN_COMMAND)).toHaveLength(1))
  setHtml(child, 'html-실제')
  await vi.waitFor(() => expect(seen).toHaveLength(1))
  child.emit(okResponse(child.findAll(METHOD_RUN_COMMAND)[0]?.id as string))
  await running
}

/** redraw 한 번: 자식이 요청을 받으면 `emitDuring` 을 돌리고 ok 로 닫는다 */
async function redraw(service: Awaited<ReturnType<typeof boot>>['service'], child: FakeChild, projectId: string, emitDuring: () => void) {
  const before = child.findAll(METHOD_REDRAW).length
  const running = service.redraw(projectId)
  await vi.waitFor(() => expect(child.findAll(METHOD_REDRAW).length).toBe(before + 1))
  emitDuring()
  child.emit(okResponse(child.findAll(METHOD_REDRAW)[before]?.id as string))
  await running
}

describe('redraw 는 남의 프로젝트 화면을 나르지 않는다', () => {
  it('A 에서 그린 화면은 B 전환 redraw 에 실려 오지 않는다', async () => {
    const { service, child, seen } = await boot()
    await drawnBy(service, child, seen)

    await redraw(service, child, '프로젝트-B', () => setHtml(child, 'html-redraw-b'))

    // 버려졌는지는 다음 정상 emit 이 그 자리를 차지하는 것으로 잰다 — 부재는 기다릴 수 없다
    setHtml(child, 'html-이후')
    await vi.waitFor(() => expect(seen).toHaveLength(2))
    expect(seen.map((one) => one.projectId)).toEqual(['프로젝트-A', null])
    service.dispose()
  })

  it('같은 프로젝트로 돌아온 redraw 는 그대로 흘러온다', async () => {
    const { service, child, seen } = await boot()
    await drawnBy(service, child, seen)

    await redraw(service, child, '프로젝트-A', () => setHtml(child, 'html-redraw-a'))

    await vi.waitFor(() => expect(seen).toHaveLength(2))
    expect(seen[1]).toEqual({ viewId: 'v', projectId: '프로젝트-A' })
    service.dispose()
  })

  it('주인이 기록된 적 없는 뷰는 redraw 중에도 흘러온다 — 활성화 시점 초기 화면', async () => {
    const { service, child, seen } = await boot()

    await redraw(service, child, '프로젝트-B', () => setHtml(child, 'html-초기', 'v-처음'))

    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toEqual({ viewId: 'v-처음', projectId: '프로젝트-B' })
    service.dispose()
  })
})
