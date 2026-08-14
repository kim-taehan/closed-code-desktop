import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionService } from '../../electron/extensions/service'
import { ExtensionWorkspace } from '../../electron/extensions/workspaceApi'
import { LiveChild } from '../../tests/extensions/liveChild'
import type { AskResult } from '../../electron/extensions/chatAsk'

// 시나리오 만들기 (설계 §3.3·§3.4).
//
// 겨누는 것은 **에이전트가 어떻게 답하든 확장이 견디는가**와 **끊겼을 때 무엇이 남는가**다.

const EXTENSIONS_DIR = join(__dirname, '..')

const created: string[] = []
let projectRoot: string

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'screen-write-'))
  created.push(base)
  projectRoot = await realpath(base)
})

afterEach(async () => {
  while (created.length > 0) await rm(created.pop() as string, { recursive: true, force: true })
})

function memoryStorage(seed?: unknown[]) {
  const bag = new Map<string, unknown>()
  if (seed !== undefined) bag.set('screen-scenario p1 screens', seed)
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

/** 답을 **순서대로** 돌려준다. 모자라면 마지막 것을 되쓴다. */
function startService(
  answers: AskResult[],
  seed?: unknown[],
  saveFile?: (name: string, text: string) => Promise<string | null>,
) {
  const storage = memoryStorage(seed)
  const notes: string[] = []
  let at = 0
  const ask = vi.fn((_prompt: string, _projectId: string | null) =>
    Promise.resolve(answers[Math.min(at++, answers.length - 1)] as AskResult),
  )
  const project = { id: 'p1', root: projectRoot }

  const service = new ExtensionService({
    entryPath: 'ignored',
    fork: () => new LiveChild(),
    extensionsDir: EXTENSIONS_DIR,
    workspace: new ExtensionWorkspace(() => ({ active: project, openProjects: [project] })),
    storage,
    ask,
    ...(saveFile ? { exportFile: saveFile } : {}),
  })
  service.onProgress((payload) => {
    if (payload.text !== null && payload.text !== undefined) notes.push(payload.text)
  })
  service.start()
  return { service, storage, ask, notes }
}

const done = (text: string): AskResult => ({ status: 'done', text })
const CASES = '{"cases":[{"action":"조건 없이 조회","input":"","expect":"최근 30일"}]}'

const screen = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  state: 'none',
  source: 'agent',
  cases: [],
  ...extra,
})

const saved = (storage: ReturnType<typeof memoryStorage>) =>
  (storage.bag.get('screen-scenario p1 screens') as Record<string, unknown>[] | undefined) ?? []

describe('시나리오 만들기', () => {
  it('케이스가 저장되고 상태가 초안이 된다', async () => {
    const { service, storage } = startService([done(CASES)], [screen('src/A.tsx')])

    await service.runCommand('screenScenario.write', 'p1', ['src/A.tsx'])

    expect(saved(storage)[0]).toMatchObject({
      state: 'draft',
      cases: [{ step: 1, action: '조건 없이 조회', input: '', expect: '최근 30일' }],
    })
    service.dispose()
  })

  it('**단계 번호는 우리가 매긴다** — 모델이 준 번호는 건너뛰거나 겹친다', async () => {
    const { service, storage } = startService(
      [done('{"cases":[{"action":"가","step":7},{"action":"나","step":7}]}')],
      [screen('src/A.tsx')],
    )

    await service.runCommand('screenScenario.write', 'p1', ['src/A.tsx'])

    expect((saved(storage)[0]?.['cases'] as { step: number }[]).map((one) => one.step)).toEqual([1, 2])
    service.dispose()
  })

  it('못 읽으면 **빈 시나리오로 덮지 않는다**', async () => {
    const before = [screen('src/A.tsx', { cases: [{ step: 1, action: '옛것', input: '', expect: '' }] })]
    const { service, storage, notes } = startService([done('그냥 말로 설명합니다')], before)

    await service.runCommand('screenScenario.write', 'p1', ['src/A.tsx'])

    expect(saved(storage)[0]?.['cases']).toEqual(before[0]?.cases)
    expect(notes.join(' ')).toContain('못 읽었습니다')
    service.dispose()
  })
})

describe('없는 것 만들기 — 한 번에 한 턴', () => {
  it('시나리오가 없는 화면만 돈다 — 있는 것은 안 건드린다', async () => {
    const seed = [
      screen('src/있음.tsx', { cases: [{ step: 1, action: '옛것', input: '', expect: '' }], state: 'fixed' }),
      screen('src/없음.tsx'),
    ]
    const { service, storage, ask } = startService([done(CASES)], seed)

    await service.runCommand('screenScenario.writeMissing', 'p1')

    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0]?.[0] ?? '').toContain('src/없음.tsx')
    // 확정해 둔 것이 「전체」 한 번에 갈아치워지면 안 된다
    expect(saved(storage)[0]).toMatchObject({ state: 'fixed', cases: seed[0]?.cases })
    service.dispose()
  })

  it('**사용자가 끊으면 멈추고, 거기까지 만든 것은 남는다**', async () => {
    const seed = [screen('src/A.tsx'), screen('src/B.tsx'), screen('src/C.tsx')]
    const { service, storage, ask, notes } = startService(
      [done(CASES), { status: 'cancelled' }],
      seed,
    )

    await service.runCommand('screenScenario.writeMissing', 'p1')

    // A 는 만들었고, B 에서 끊겼고, C 는 **보내지 않았다** — 끊은 사람이 같은 질문을
    // 또 받으면 안 된다
    expect(ask).toHaveBeenCalledTimes(2)
    expect(saved(storage)[0]).toMatchObject({ state: 'draft' })
    expect(saved(storage)[1]).toMatchObject({ state: 'none', cases: [] })
    expect(notes.join(' ')).toContain('여기까지 만든 것은 남아 있습니다')
    service.dispose()
  })

  it('한 화면이 실패해도 다음으로 간다 — 하나 때문에 전부 멈추지 않는다', async () => {
    const seed = [screen('src/A.tsx'), screen('src/B.tsx')]
    const { service, storage, ask } = startService([done('말로 설명'), done(CASES)], seed)

    await service.runCommand('screenScenario.writeMissing', 'p1')

    expect(ask).toHaveBeenCalledTimes(2)
    expect(saved(storage)[1]).toMatchObject({ state: 'draft' })
    service.dispose()
  })
})

describe('상태는 사람이 올리고 내린다', () => {
  it('확정으로 · 초안으로', async () => {
    const { service, storage } = startService([done(CASES)], [screen('src/A.tsx', { state: 'draft' })])

    await service.runCommand('screenScenario.fix', 'p1', ['src/A.tsx'])
    expect(saved(storage)[0]).toMatchObject({ state: 'fixed' })

    await service.runCommand('screenScenario.unfix', 'p1', ['src/A.tsx'])
    expect(saved(storage)[0]).toMatchObject({ state: 'draft' })
    service.dispose()
  })

  it('**다시 만들면 확정이 초안으로 내려간다**', async () => {
    const { service, storage } = startService(
      [done(CASES)],
      [screen('src/A.tsx', { state: 'fixed', cases: [{ step: 1, action: '옛것', input: '', expect: '' }] })],
    )

    await service.runCommand('screenScenario.write', 'p1', ['src/A.tsx'])

    expect(saved(storage)[0]).toMatchObject({ state: 'draft' })
    service.dispose()
  })
})

describe('MD 내보내기', () => {
  it('저장한 문서에 화면과 케이스가 그대로 담긴다', async () => {
    const seed = [
      screen('src/A.tsx', {
        name: '주문 목록',
        state: 'fixed',
        cases: [{ step: 1, action: '조회', input: 'role=viewer', expect: '목록' }],
      }),
      screen('src/B.tsx', { name: '빈 화면' }),
    ]
    const saveFile = vi.fn((_name: string, _text: string) => Promise.resolve('/어딘가/화면-시나리오.md'))
    const { service } = startService([done(CASES)], seed, saveFile)

    await service.runCommand('screenScenario.export', 'p1')

    const [name, text] = saveFile.mock.calls[0] ?? []
    expect(name).toBe('화면-시나리오.md')
    expect(text).toContain('## 주문 목록')
    expect(text).toContain('| 1 | 조회 | role=viewer | 목록 |')
    // **빈 화면도 적는다** — 빼면 문서만 보는 사람은 그 화면이 없는 줄 안다
    expect(text).toContain('## 빈 화면')
    expect(text).toContain('시나리오가 아직 없습니다')
    service.dispose()
  })

  it('창을 닫으면 조용히 끝난다 — 취소는 실패가 아니다', async () => {
    const saveFile = vi.fn((_name: string, _text: string) => Promise.resolve(null))
    const { service, notes } = startService([done(CASES)], [screen('src/A.tsx')], saveFile)

    await service.runCommand('screenScenario.export', 'p1')

    expect(saveFile).toHaveBeenCalledTimes(1)
    expect(notes.join(' ')).not.toContain('저장했습니다')
    service.dispose()
  })

  it('표를 깨뜨리는 글자를 막는다 — 세로줄과 줄바꿈', async () => {
    // 에이전트가 실제로 쓰는 문장이다: "A | B 중 하나", 여러 줄 기대결과
    const seed = [
      screen('src/A.tsx', { cases: [{ step: 1, action: 'A | B', input: '', expect: '첫 줄\n둘째 줄' }] }),
    ]
    const saveFile = vi.fn((_name: string, _text: string) => Promise.resolve('/어딘가.md'))
    const { service } = startService([done(CASES)], seed, saveFile)

    await service.runCommand('screenScenario.export', 'p1')

    const text = String(saveFile.mock.calls[0]?.[1] ?? '')
    expect(text).toContain('A \\| B')
    expect(text).toContain('첫 줄<br>둘째 줄')
    service.dispose()
  })
})
