import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionService } from '../../electron/extensions/service'
import { ExtensionWorkspace } from '../../electron/extensions/workspaceApi'
import { LiveChild } from '../../tests/extensions/liveChild'
import type { AskResult } from '../../electron/extensions/chatAsk'

// 화면 찾기 (설계 §3.1) — **에이전트가 어떻게 답하든 확장이 견디는가.**
//
// 잡으려는 것이 "LLM 이 잘 답하나" 가 아니라서 답을 고정한다. 진짜 모델로 한 번 도는 것은
// 따로 잰다 (계획 4단계 검증 5 — `_workspace` 밖 실측).
//
// 확장은 여기서도 **원본 그대로** 태운다 (`screenScenario.test.ts` 와 같은 이유).

const EXTENSIONS_DIR = join(__dirname, '..')
const BOARD = 'screenScenario.board'

const created: string[] = []
let projectRoot: string

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'screen-find-'))
  created.push(base)
  projectRoot = await realpath(base)
})

afterEach(async () => {
  while (created.length > 0) await rm(created.pop() as string, { recursive: true, force: true })
})

function memoryStorage() {
  const bag = new Map<string, unknown>()
  const at = (extension: string, project: string | null, key: string) =>
    `${extension} ${project ?? ''} ${key}`
  return {
    bag,
    get: (extension: string, project: string | null, key: string) =>
      Promise.resolve(bag.get(at(extension, project, key))),
    set: (extension: string, project: string | null, key: string, value: unknown) => {
      bag.set(at(extension, project, key), value)
      return Promise.resolve()
    },
  }
}

/** `ask` 가 돌려줄 답을 고정한다. 확장이 보는 계약은 `AskResult` 다 (던지지 않는다). */
function startService(answer: AskResult, seed?: unknown[]) {
  const html = new Map<string, string>()
  const notes: string[] = []
  const storage = memoryStorage()
  if (seed !== undefined) storage.bag.set('screen-scenario p1 screens', seed)

  const ask = vi.fn((_prompt: string, _projectId: string | null) => Promise.resolve(answer))
  const project = { id: 'p1', root: projectRoot }

  const service = new ExtensionService({
    entryPath: 'ignored',
    fork: () => new LiveChild(),
    extensionsDir: EXTENSIONS_DIR,
    workspace: new ExtensionWorkspace(() => ({ active: project, openProjects: [project] })),
    storage,
    ask,
  })
  service.onViewHtml((viewId, body) => html.set(viewId, body))
  service.onProgress((payload) => {
    if (payload.text !== null && payload.text !== undefined) notes.push(payload.text)
  })
  service.start()
  return { service, html, storage, ask, notes }
}

const done = (text: string) => ({ status: 'done' as const, text })

/** 저장된 화면들 (없으면 빈 배열) */
const saved = (storage: ReturnType<typeof memoryStorage>) =>
  (storage.bag.get('screen-scenario p1 screens') as unknown[] | undefined) ?? []

describe('화면 찾기 — 답을 읽는다', () => {
  it('JSON 한 덩이를 그대로 주면 목록이 된다', async () => {
    const { service, storage, html } = startService(
      done('{"screens":[{"name":"주문 목록 조회","file":"src/pages/order/OrderList.tsx"}]}'),
    )

    await service.runCommand('screenScenario.find', 'p1')

    expect(saved(storage)).toEqual([
      {
        id: 'src/pages/order/OrderList.tsx',
        name: '주문 목록 조회',
        state: 'none',
        source: 'agent',
        cases: [],
      },
    ])
    expect(html.get(BOARD)).toContain('주문 목록 조회')
    service.dispose()
  })

  it('마크다운 울타리와 앞뒤 말이 섞여도 읽는다 — 실제 모델이 그렇게 답한다', async () => {
    const { service, storage } = startService(
      done('찾았습니다!\n```json\n{"screens":[{"name":"로그인","file":"src/Login.tsx"}]}\n```\n필요하면 더 볼게요.'),
    )

    await service.runCommand('screenScenario.find', 'p1')

    expect(saved(storage)).toHaveLength(1)
    service.dispose()
  })

  it('JSON 이 아니면 **빈 목록이 아니라 오류**다', async () => {
    const { service, storage, notes } = startService(done('화면은 주문 목록과 로그인이 있습니다.'))

    await service.runCommand('screenScenario.find', 'p1')

    // 빈 목록으로 삼키면 「훑었는데 없다」와 구분이 안 된다
    expect(storage.bag.size).toBe(0)
    expect(notes.join(' ')).toContain('못 읽었습니다')
    expect(notes.join(' ')).toContain('대화창')
    service.dispose()
  })

  it('JSON 이지만 `screens` 가 없으면 오류다', async () => {
    // **위 시험과 다른 겹이다.** 저건 `{` 를 못 찾아 먼저 끊기므로 이 관문에 닿지 않는다
    // (하네스 원칙: 통과했다고 다 같은 이유로 통과한 것이 아니다).
    const { service, storage, notes } = startService(done('{"pages":[{"file":"src/A.tsx"}]}'))

    await service.runCommand('screenScenario.find', 'p1')

    expect(storage.bag.size).toBe(0)
    expect(notes.join(' ')).toContain('못 읽었습니다')
    service.dispose()
  })

  it('항목에 `file` 이 하나도 없으면 오류다 — 경로가 식별자다', async () => {
    const { service, storage, notes } = startService(done('{"screens":[{"name":"주문"},{"name":"로그인"}]}'))

    await service.runCommand('screenScenario.find', 'p1')

    expect(storage.bag.size).toBe(0)
    expect(notes.join(' ')).toContain('못 읽었습니다')
    service.dispose()
  })

  it('빈 배열은 **정상 답**이다 — 화면이 없는 프로젝트가 있다', async () => {
    const { service, storage, notes } = startService(done('{"screens":[]}'))

    await service.runCommand('screenScenario.find', 'p1')

    expect(saved(storage)).toEqual([])
    expect(notes.join(' ')).not.toContain('못 읽었습니다')
    service.dispose()
  })

  it('사용자가 끊으면 있던 목록이 그대로다', async () => {
    const seed = [{ id: 'src/A.tsx', name: 'A', state: 'draft', source: 'agent', cases: [] }]
    const { service, storage, notes } = startService({ status: 'cancelled' }, seed)

    await service.runCommand('screenScenario.find', 'p1')

    expect(saved(storage)).toEqual(seed)
    expect(notes.join(' ')).toContain('멈췄습니다')
    service.dispose()
  })
})

describe('다시 찾기 — 있던 것을 함부로 지우지 않는다', () => {
  const agent = (id: string) => ({ id, name: id, state: 'draft', source: 'agent', cases: [] })

  it('사람이 넣은 화면은 답에 없어도 남는다', async () => {
    const seed = [
      { id: 'src/손.tsx', name: '손', state: 'none', source: 'manual', cases: [] },
      agent('src/A.tsx'),
    ]
    const { service, storage } = startService(
      done('{"screens":[{"name":"A","file":"src/A.tsx"}]}'),
      seed,
    )

    await service.runCommand('screenScenario.find', 'p1')

    expect((saved(storage) as { id: string }[]).map((one) => one.id)).toEqual([
      'src/손.tsx',
      'src/A.tsx',
    ])
    service.dispose()
  })

  it('**20% 넘게 사라졌다고 하면 지우지 않는다**', async () => {
    // 다섯 중 둘(40%)이 빠진 답. 에이전트가 한 묶음을 놓친 것과 진짜 삭제를 구분할
    // 다른 방법이 없다 — 그래서 안 믿는 쪽으로 기운다.
    const seed = ['A', 'B', 'C', 'D', 'E'].map((one) => agent(`src/${one}.tsx`))
    const { service, storage, notes } = startService(
      done('{"screens":[{"file":"src/A.tsx"},{"file":"src/B.tsx"},{"file":"src/C.tsx"}]}'),
      seed,
    )

    await service.runCommand('screenScenario.find', 'p1')

    expect(saved(storage)).toHaveLength(5)
    expect(notes.join(' ')).toContain('지우지 않았습니다')
    service.dispose()
  })

  it('조금(20% 이내) 사라진 것은 지운다 — 방어가 갱신을 통째로 막지 않는다', async () => {
    // 다섯 중 하나(20%)는 한계 안이다. 여기까지 막으면 목록이 영영 안 줄어든다.
    const seed = ['A', 'B', 'C', 'D', 'E'].map((one) => agent(`src/${one}.tsx`))
    const { service, storage } = startService(
      done(
        '{"screens":[{"file":"src/A.tsx"},{"file":"src/B.tsx"},{"file":"src/C.tsx"},{"file":"src/D.tsx"}]}',
      ),
      seed,
    )

    await service.runCommand('screenScenario.find', 'p1')

    expect((saved(storage) as { id: string }[]).map((one) => one.id)).toEqual([
      'src/A.tsx',
      'src/B.tsx',
      'src/C.tsx',
      'src/D.tsx',
    ])
    service.dispose()
  })

  it('이름이 바뀌어도 **상태와 시나리오는 그대로**다', async () => {
    const seed = [
      {
        id: 'src/A.tsx',
        name: '옛 이름',
        state: 'fixed',
        source: 'agent',
        cases: [{ step: 1, action: '조회', input: '', expect: '목록' }],
      },
    ]
    const { service, storage } = startService(
      done('{"screens":[{"name":"새 이름","file":"src/A.tsx"}]}'),
      seed,
    )

    await service.runCommand('screenScenario.find', 'p1')

    expect(saved(storage)[0]).toEqual({
      id: 'src/A.tsx',
      name: '새 이름',
      state: 'fixed',
      source: 'agent',
      cases: [{ step: 1, action: '조회', input: '', expect: '목록' }],
    })
    service.dispose()
  })

  it('두 번째부터는 **있는 목록을 먼저 준다** — 그냥 다시 물으면 답이 매번 흔들린다', async () => {
    const seed = [agent('src/A.tsx')]
    const { service, ask } = startService(done('{"screens":[{"file":"src/A.tsx"}]}'), seed)

    await service.runCommand('screenScenario.find', 'p1')

    expect(ask.mock.calls[0]?.[0] ?? '').toContain('src/A.tsx')
    expect(ask.mock.calls[0]?.[0] ?? '').toContain('사라진 것')
    service.dispose()
  })
})
