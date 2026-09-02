import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExtensionWorkspace, MAX_LIST_FILES, MAX_WALK_DIRS, type ActiveProjectSource } from './workspaceApi'

// 진짜 임시 디렉토리를 쓴다 (registry.test.ts·resolveInside.test.ts 와 같은 관례).
// 확장이 프로젝트 밖을 못 읽는 것이 이 API 의 존재 이유라, 가짜 fs 로는 그걸 못 잠근다.

const created: string[] = []

let root: string
let outside: string

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'ext-ws-'))
  created.push(base)
  // macOS 의 /var → /private/var. 안 펴면 모든 경로가 "밖" 으로 잡혀 테스트가 거짓 초록이 된다.
  const resolved = await realpath(base)
  root = join(resolved, 'project')
  outside = join(resolved, 'outside')
  await mkdir(root, { recursive: true })
  await mkdir(outside, { recursive: true })
})

afterEach(async () => {
  while (created.length > 0) await rm(created.pop() as string, { recursive: true, force: true })
})

function workspace(active: { id: string; root: string } | null = { id: 'p1', root: '' }): ExtensionWorkspace {
  const project = active === null ? null : { id: active.id, root: active.root === '' ? root : active.root }
  const source: ActiveProjectSource = {
    active: project,
    openProjects: project === null ? [] : [project],
  }
  return new ExtensionWorkspace(() => source)
}

async function write(relativePath: string, text: string): Promise<void> {
  const target = join(root, relativePath)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, text, 'utf8')
}

describe('getProjectPath', () => {
  it('활성 프로젝트의 루트를 준다', () => {
    expect(workspace().getProjectPath()).toBe(root)
  })

  it('열린 프로젝트가 없으면 던진다 — 빈 문자열을 주면 확장이 루트로 오해한다', () => {
    expect(() => workspace(null).getProjectPath()).toThrow(/열린 프로젝트가 없습니다/)
  })

  it('프로젝트를 바꾸면 다음 호출이 바뀐 값을 본다 (조회 함수라 사본이 없다)', () => {
    let active: { id: string; root: string } | null = { id: 'p1', root }
    const api = new ExtensionWorkspace(() => ({
      get active() {
        return active
      },
      get openProjects() {
        return active === null ? [] : [active]
      },
    }))

    expect(api.getProjectPath()).toBe(root)
    active = { id: 'p2', root: outside }
    expect(api.getProjectPath()).toBe(outside)
  })
})

describe('listFiles', () => {
  it('재귀로 훑어 프로젝트 상대경로를 준다', async () => {
    await write('a.ts', '')
    await write('src/b.ts', '')
    await write('src/deep/c.ts', '')
    await write('src/d.md', '')

    expect(await workspace().listFiles('**/*.ts')).toEqual({ files: ['a.ts', 'src/b.ts', 'src/deep/c.ts'], truncated: false })
  })

  it('`**/` 가 없으면 한 겹만 본다', async () => {
    await write('a.ts', '')
    await write('src/b.ts', '')

    expect(await workspace().listFiles('*.ts')).toEqual({ files: ['a.ts'], truncated: false })
  })

  it('.git·node_modules 를 훑지 않는다 (ProjectFs 의 숨김 목록을 그대로 쓴다)', async () => {
    await write('a.ts', '')
    await write('node_modules/pkg/index.ts', '')
    await write('.git/hooks/x.ts', '')

    expect(await workspace().listFiles('**/*.ts')).toEqual({ files: ['a.ts'], truncated: false })
  })

  it.skipIf(process.platform === 'win32')('밖을 가리키는 심링크를 따라가지 않는다', async () => {
    await write('a.ts', '')
    await writeFile(join(outside, 'secret.ts'), 'password', 'utf8')
    await symlink(outside, join(root, 'link'), 'dir')

    // 링크는 디렉토리로 보이지만 그 안을 읽으려면 경계를 넘어야 하고, ProjectFs 가 거기서 막는다
    expect(await workspace().listFiles('**/*.ts')).toEqual({ files: ['a.ts'], truncated: false })
  })

  it('모르는 glob 은 던진다', async () => {
    await expect(workspace().listFiles('src/**/*.ts')).rejects.toThrow(/지원하지 않는 glob/)
  })

  it('열린 프로젝트가 없으면 던진다', async () => {
    await expect(workspace(null).listFiles('**/*.ts')).rejects.toThrow(/열린 프로젝트가 없습니다/)
  })

  it('상한이 실제로 걸린다 — 목록 길이가 그대로 RPC 왕복 수다', async () => {
    // 완화 방향 회귀 방지: 상한을 없애거나 늘리면 이 단언이 깨진다
    expect(MAX_LIST_FILES).toBeLessThanOrEqual(5_000)
  })

  /**
   * **상한에 걸린 것을 말한다.**
   *
   * 예전에는 그냥 멈추고 목록만 돌려줘서, 받는 쪽이 「이 프로젝트에 N개가 있다」와
   * 「N개에서 끊겼다」를 **구분할 수 없었다.** 실측 사례: 디렉토리 5,895개짜리 Java
   * 프로젝트에서 3,723개 중 1,671개(55%)만 걸렸는데 확장 화면에는 그것이 전부인 것처럼
   * 떴다. 절반을 보여주면서 전부라고 주장하는 것이 이 구멍이었다.
   */
  it('디렉토리 상한에 걸리면 잘렸다고 말한다', async () => {
    // 상한보다 한 겹 더 만든다 — 훑기는 루트부터 세므로 이만큼이면 큐가 남는다
    await Promise.all(
      Array.from({ length: MAX_WALK_DIRS + 1 }, (_, i) => mkdir(join(root, `d${i}`), { recursive: true })),
    )
    await write('a.ts', '')

    const result = await workspace().listFiles('**/*.ts')

    expect(result.truncated, '큐가 남았는데 조용히 끝내면 화면이 절반을 전부라고 말한다').toBe(true)
  })

  it('다 훑었으면 안 잘렸다고 말한다', async () => {
    await write('src/a.ts', '')

    expect((await workspace().listFiles('**/*.ts')).truncated).toBe(false)
  })
})

describe('readFile', () => {
  it('내용을 준다', async () => {
    await write('src/a.ts', '// TODO: 정리')

    expect(await workspace().readFile('src/a.ts')).toBe('// TODO: 정리')
  })

  it.each([
    ['../outside/secret.ts', '상위로 나가기'],
    ['src/../../outside/secret.ts', '겹겹의 ..'],
  ])('%s (%s) 는 거부한다', async (relativePath) => {
    await writeFile(join(outside, 'secret.ts'), 'password', 'utf8')

    await expect(workspace().readFile(relativePath)).rejects.toThrow(/not_allowed/)
  })

  it('절대경로도 거부한다', async () => {
    await writeFile(join(outside, 'secret.ts'), 'password', 'utf8')

    await expect(workspace().readFile(join(outside, 'secret.ts'))).rejects.toThrow(/not_allowed/)
  })

  it.skipIf(process.platform === 'win32')('심링크로 밖을 가리켜도 거부한다', async () => {
    await writeFile(join(outside, 'secret.ts'), 'password', 'utf8')
    await symlink(join(outside, 'secret.ts'), join(root, 'link.ts'), 'file')

    await expect(workspace().readFile('link.ts')).rejects.toThrow(/not_allowed/)
  })

  it('없는 파일도 던진다 — 확장이 건너뛸 수 있어야 한다', async () => {
    // 사유가 not_allowed 다. resolveInside 의 null 이 "밖" 과 "없음" 을 합치기 때문이고
    // (`_workspace/45` §QA-3), ProjectFs 가 예전부터 그렇게 읽는다. 확장 API 도 같은 값을 그대로 전한다.
    await expect(workspace().readFile('없다.ts')).rejects.toThrow(/not_allowed/)
  })

  it('바이너리는 거부한다', async () => {
    await writeFile(join(root, 'bin.ts'), Buffer.from([0x00, 0x01, 0x02]))

    await expect(workspace().readFile('bin.ts')).rejects.toThrow(/binary/)
  })
})
