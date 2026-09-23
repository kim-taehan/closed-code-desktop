import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createExtensionApi, METHOD_OPEN_FILE } from './extensionApi'
import { createRequest } from './rpc'
import { dispatchExtensionApi, portsOf } from './serviceDispatch'
import { ExtensionWorkspace } from './workspaceApi'
import type { UiPorts } from './uiRouter'

// `code.workspace.openFile` — 확장이 준 경로를 **그 프로젝트의 편집기 탭**으로 보낸다 (재설계 §2-4).
//
// 여기가 재는 것은 셋이다: **어느 프로젝트로 가나**(`ui.post` 와 같은 규칙), **열어도 되는 경로인가**
// (루트 안의 있는 파일), **줄 번호가 그대로 가나**. 「그 프로젝트가 화면에 없으면 거부」는 창 배선
// (`electron/ipc/extensionUiBridge.test.ts`)이 보고, 탭이 실제로 열리고 그 줄로 가는 것은
// 화면 쪽(`src/state/useExtensionOpenFile.test.tsx`)이 본다.
//
// **진짜 임시 디렉토리를 쓴다** (`workspaceApi.test.ts` 와 같은 관례). 경로 탈출을 막는 것이
// 이 API 의 절반이라 가짜 fs 로는 못 잠근다 — 심링크가 밖을 가리키는 것은 문자열로 안 보인다.

const created: string[] = []
let root = ''
let outside = ''

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'ext-open-'))
  created.push(base)
  // macOS 의 /var → /private/var. 안 펴면 전부 "밖" 으로 잡혀 거짓 초록이 된다
  const resolved = await realpath(base)
  root = join(resolved, 'project')
  outside = join(resolved, 'outside')
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(root, 'src/app.ts'), '한\n두\n세\n', 'utf8')
  await writeFile(join(outside, 'secret.txt'), '남의 것', 'utf8')
  // 루트 안에 있지만 밖을 가리킨다 — 문자열 비교만으로는 안쪽으로 보인다
  await symlink(join(outside, 'secret.txt'), join(root, 'src/link.txt'))
})

afterEach(async () => {
  while (created.length > 0) await rm(created.pop() as string, { recursive: true, force: true })
})

/**
 * @param envelope 부를 때마다 읽히는 겉봉 (`chatPost.test.ts` 의 그것과 같은 모양)
 * @param allowedIn 켜짐 판정. 판정 도중 겉봉을 바꾸는 시험이 여기에 끼어든다
 */
function dispatcher(
  envelope: () => string | null,
  allowedIn: (projectId: string) => Promise<readonly string[] | undefined> = async () => ['mine'],
) {
  const reached: unknown[][] = []
  const ui: UiPorts = {
    post: () => true,
    open: async () => {},
    chatPost: () => {},
    openFile: (...args) => void reached.push(['openFile', ...args]),
  }
  const deps = portsOf(
    { workspace: new ExtensionWorkspace(() => ({ openProjects: [{ id: 'P', root }] })), ui },
    {
      projectId: envelope,
      allowedIn,
      emitRows: () => {},
      emitHtml: () => {},
      emitTree: () => {},
      emitProgress: () => {},
      notifyChild: () => {},
    },
  )
  const call = (params: unknown) => dispatchExtensionApi(deps, createRequest(METHOD_OPEN_FILE, params))
  return { call, reached }
}

describe('자식 — code.workspace.openFile', () => {
  it('확장 이름은 호스트가 채우고, options 에서는 line·projectId 만 꺼낸다', async () => {
    const calls: unknown[] = []
    const api = createExtensionApi(async (method, params) => void calls.push({ method, params }), 'mine')
    // 확장이 남의 이름으로 부르려 해도 `extension` 은 위에서 덮인다 (`projectOf` 머리말의 그 실측)
    const forged = { line: 7, projectId: 'P', extension: 'extB', path: '바꿔치기' } as { line: number }

    await api.workspace.openFile('src/app.ts')
    await api.workspace.openFile('src/app.ts', forged)

    expect(calls).toEqual([
      { method: METHOD_OPEN_FILE, params: { extension: 'mine', path: 'src/app.ts' } },
      { method: METHOD_OPEN_FILE, params: { projectId: 'P', extension: 'mine', path: 'src/app.ts', line: 7 } },
    ])
  })
})

describe('main — openFile 의 프로젝트 (ui.post 와 같은 규칙)', () => {
  it('겉봉의 프로젝트로 간다. 적은 projectId 가 있으면 그것이 이긴다', async () => {
    const { call, reached } = dispatcher(() => 'P')
    await call({ extension: 'mine', path: 'src/app.ts' })
    expect(reached).toEqual([['openFile', 'P', 'src/app.ts', undefined]])
  })

  it('겉봉도 projectId 도 없으면 거부한다 — 화면의 프로젝트로 되돌아가지 않는다', async () => {
    const { call, reached } = dispatcher(() => null)
    await expect(call({ extension: 'mine', path: 'src/app.ts' })).rejects.toThrow('어느 프로젝트')
    expect(reached).toEqual([])
  })

  it('그 프로젝트에서 꺼진 확장은 열지 못한다', async () => {
    const { call, reached } = dispatcher(() => 'P', async () => ['other'])
    await expect(call({ extension: 'mine', path: 'src/app.ts' })).rejects.toThrow('켜지 않은 확장')
    expect(reached).toEqual([])
  })

  it('남의 프로젝트로는 못 연다 — 열린 프로젝트가 아니면 거부한다', async () => {
    const { call, reached } = dispatcher(() => 'P')
    await expect(call({ extension: 'mine', path: 'src/app.ts', projectId: 'Q' })).rejects.toThrow('열린 프로젝트가 아닙니다')
    expect(reached).toEqual([])
  })
})

describe('main — openFile 의 경로', () => {
  it('루트 밖은 거부한다 — `..` 도, 절대경로도, **밖을 가리키는 심링크도**', async () => {
    const { call, reached } = dispatcher(() => 'P')
    for (const path of ['../outside/secret.txt', join(outside, 'secret.txt'), 'src/link.txt']) {
      await expect(call({ extension: 'mine', path })).rejects.toThrow('프로젝트 안의 경로가 아니거나 없습니다')
    }
    expect(reached).toEqual([])
  })

  it('없는 파일은 거부한다 — 통과시키면 화면에 빈 탭만 남고 확장은 성공으로 안다', async () => {
    const { call, reached } = dispatcher(() => 'P')
    await expect(call({ extension: 'mine', path: 'src/없다.ts' })).rejects.toThrow(
      '프로젝트 안의 경로가 아니거나 없습니다',
    )
    expect(reached).toEqual([])
  })

  it('디렉토리는 거부한다 — 뷰어가 열 수 있는 것이 아니다', async () => {
    const { call, reached } = dispatcher(() => 'P')
    await expect(call({ extension: 'mine', path: 'src' })).rejects.toThrow('파일이 아닙니다')
    expect(reached).toEqual([])
  })

  it('경로가 문자열이 아니면 거부한다', async () => {
    const { call, reached } = dispatcher(() => 'P')
    await expect(call({ extension: 'mine' })).rejects.toThrow('path 가 문자열이 아닙니다')
    expect(reached).toEqual([])
  })
})

describe('main — openFile 의 줄 번호', () => {
  it('1-based 정수는 그대로 간다', async () => {
    const { call, reached } = dispatcher(() => 'P')
    await call({ extension: 'mine', path: 'src/app.ts', line: 1 })
    await call({ extension: 'mine', path: 'src/app.ts', line: 42 })
    expect(reached).toEqual([
      ['openFile', 'P', 'src/app.ts', 1],
      ['openFile', 'P', 'src/app.ts', 42],
    ])
  })

  it('0·음수·소수·문자열은 **거부한다** — 조용히 무시하면 확장은 「줄 번호가 안 먹는다」로 읽는다', async () => {
    const { call, reached } = dispatcher(() => 'P')
    for (const line of [0, -1, 1.5, '3', null]) {
      await expect(call({ extension: 'mine', path: 'src/app.ts', line })).rejects.toThrow('1 이상의 정수')
    }
    expect(reached).toEqual([])
  })
})

// H1 보고 #3 · H2 결정 K-4 — 켜짐 판정에 한 번, await 뒤 행선지에 또 한 번 겉봉을 읽던 자리
describe('K-4 — 겉봉은 한 번만 읽는다', () => {
  it('켜짐을 보는 동안 겉봉이 Q 로 바뀌어도 판정한 P 로 간다', async () => {
    let current: string | null = 'P'
    const { call, reached } = dispatcher(
      () => current,
      async (projectId) => {
        current = 'Q'
        return projectId === 'P' ? ['mine'] : []
      },
    )

    await call({ extension: 'mine', path: 'src/app.ts', line: 3 })

    expect(reached).toEqual([['openFile', 'P', 'src/app.ts', 3]])
  })
})
