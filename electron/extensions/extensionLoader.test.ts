import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadExtensions, type ExtensionSource } from './extensionLoader'
import type { ExtensionApi } from './extensionApi'
import type { ExtensionManifest } from '../../shared/extensions/manifest'

// 진짜 임시 디렉토리를 쓴다 — `vi.mock('node:fs')` 를 쓰면 resolveInside 의 realpath 가
// 무력해져 정작 잠글 것(경로 탈출)을 못 잠근다 (resolveInside.test.ts 와 같은 이유).

const roots: string[] = []

let root: string
let extensionsDir: string

beforeEach(async () => {
  // macOS 의 /var → /private/var 때문에 루트를 미리 편다.
  // 안 하면 resolveInside 가 돌려주는 실경로와 기대값이 어긋난다 (resolveInside.test.ts:26 과 같은 처리).
  const created = await mkdtemp(join(tmpdir(), 'ext-loader-'))
  roots.push(created)
  root = await realpath(created)
  extensionsDir = join(root, 'extensions')
  await mkdir(extensionsDir, { recursive: true })
})

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop() as string, { recursive: true, force: true })
})

const code = {} as ExtensionApi

function manifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return { manifestVersion: 2, name: 'demo', displayName: '데모', version: '0.1.0', main: 'main.js', ...overrides }
}

async function makeExtension(name: string, main = 'main.js'): Promise<ExtensionSource> {
  const dir = join(extensionsDir, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'main.js'), '', 'utf8')
  return { dir, manifest: manifest({ name, main }) }
}

describe('loadExtensions — 정상 경로', () => {
  it('activate 를 부르고 명령표를 만든다', async () => {
    const source = await makeExtension('demo')
    const scan = vi.fn(() => 'scanned')
    const activate = vi.fn(() => ({ commands: { 'demo.scan': scan } }))

    const result = await loadExtensions([source], () => code, { requireModule: () => ({ activate }) })

    expect(result.loaded).toEqual(['demo'])
    expect(result.failed).toEqual([])
    expect(activate).toHaveBeenCalledWith(code)
    expect(result.commands.get('demo.scan')).toBe(scan)
  })

  it('async activate 를 기다린다', async () => {
    const source = await makeExtension('demo')
    const activate = async () => ({ commands: { 'demo.scan': () => 1 } })

    const result = await loadExtensions([source], () => code, { requireModule: () => ({ activate }) })

    expect(result.commands.has('demo.scan')).toBe(true)
  })

  it('onActiveFile 을 돌려주면 모은다 — 안 돌려준 확장은 안 부른다', async () => {
    // 이 배선을 빠뜨려도 **아무것도 안 터진다** — 확장이 알림을 못 받을 뿐이고, 그건
    // 「보고 있는 파일이 없다」와 화면상 구분되지 않는다. 그래서 시험으로 잠근다.
    const seeing = await makeExtension('알림받음')
    const blind = await makeExtension('알림없음')
    const onActiveFile = vi.fn()

    const result = await loadExtensions([seeing, blind], () => code, {
      requireModule: (path: string) =>
        path.includes('알림받음') ? { activate: () => ({ onActiveFile }) } : { activate: () => ({}) },
    })

    expect(result.activeFiles).toEqual([onActiveFile])
  })

  it('commands 를 안 돌려줘도 실린 것으로 본다 — 화면만 얹는 확장이 있을 수 있다', async () => {
    const source = await makeExtension('demo')

    const result = await loadExtensions([source], () => code, { requireModule: () => ({ activate: () => undefined }) })

    expect(result.loaded).toEqual(['demo'])
    expect(result.commands.size).toBe(0)
  })

  it.skipIf(process.platform === 'win32')('require 에 넘어가는 것은 **resolveInside 의 반환값**이다 — 매니페스트 문자열이 아니다', async () => {
    // `46` 강제사항 A. 원본 `manifest.main` 을 다시 경로로 쓰면 "루트 안" 보증이 그 자리에서 사라진다.
    // 심링크를 걸어 두 값이 **다르게** 만든다 — 그래야 어느 쪽을 썼는지 실제로 가려진다.
    const dir = join(extensionsDir, 'linked')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'real.js'), '', 'utf8')
    await symlink(join(dir, 'real.js'), join(dir, 'entry.js'), 'file')
    const requireModule = vi.fn(() => ({ activate: () => undefined }))

    await loadExtensions([{ dir, manifest: manifest({ main: 'entry.js' }) }], () => code, { requireModule })

    expect(requireModule).toHaveBeenCalledWith(join(dir, 'real.js'))
    expect(requireModule).not.toHaveBeenCalledWith(join(dir, 'entry.js'))
  })
})

describe('loadExtensions — 경로 경계', () => {
  it('확장 밖을 가리키는 main 은 require 조차 하지 않는다', async () => {
    await writeFile(join(root, 'evil.js'), 'module.exports = {}', 'utf8')
    const dir = join(extensionsDir, 'evil-ext')
    await mkdir(dir, { recursive: true })
    const requireModule = vi.fn(() => ({ activate: () => undefined }))

    const result = await loadExtensions(
      [{ dir, manifest: manifest({ main: '../../evil.js' }) }],
      () => code,
      { requireModule },
    )

    // 실제로 존재하는 파일이다 — 막힌 이유가 "없어서" 가 아니라는 뜻이다
    expect(requireModule).not.toHaveBeenCalled()
    expect(result.loaded).toEqual([])
    expect(result.failed).toEqual([{ dir, reason: 'main_outside' }])
  })

  it('절대경로 main 도 밖으로 본다', async () => {
    const dir = join(extensionsDir, 'abs-ext')
    await mkdir(dir, { recursive: true })
    const requireModule = vi.fn(() => ({ activate: () => undefined }))

    const result = await loadExtensions(
      [{ dir, manifest: manifest({ main: '/etc/hosts' }) }],
      () => code,
      { requireModule },
    )

    expect(requireModule).not.toHaveBeenCalled()
    expect(result.failed[0]?.reason).toBe('main_outside')
  })

  it('main 파일이 없으면 밖과 구분해서 알려준다', async () => {
    const dir = join(extensionsDir, 'missing-ext')
    await mkdir(dir, { recursive: true })

    const result = await loadExtensions(
      [{ dir, manifest: manifest({ main: 'dist/main.js' }) }],
      () => code,
      { requireModule: () => ({ activate: () => undefined }) },
    )

    // main_outside 로 뭉뚱그리면 "빌드를 안 했다" 를 "경로가 나쁘다" 로 읽게 된다
    expect(result.failed).toEqual([{ dir, reason: 'main_missing' }])
  })

  it.skipIf(process.platform === 'win32')('심링크로 밖을 가리키는 main 은 오타가 아니라 탈출로 보고한다', async () => {
    await writeFile(join(root, 'evil.js'), 'module.exports = {}', 'utf8')
    const dir = join(extensionsDir, 'link-ext')
    await mkdir(dir, { recursive: true })
    await symlink(join(root, 'evil.js'), join(dir, 'main.js'), 'file')
    const requireModule = vi.fn(() => ({ activate: () => undefined }))

    const result = await loadExtensions([{ dir, manifest: manifest() }], () => code, { requireModule })

    // 문자열상으로는 안쪽이라 "없는 파일" 로 보이기 쉽다. lstat 이 그 착각을 걷어낸다.
    expect(requireModule).not.toHaveBeenCalled()
    expect(result.failed).toEqual([{ dir, reason: 'main_outside' }])
  })

  it('절대경로를 오타로 둔갑시키지 않는다 — stat 을 먼저 보면 그렇게 된다', async () => {
    const dir = join(extensionsDir, 'abs2-ext')
    await mkdir(dir, { recursive: true })

    const result = await loadExtensions(
      // `dir/tmp/절대.js` 는 존재하지 않는다. 존재 여부부터 보면 main_missing 이 나온다.
      [{ dir, manifest: manifest({ main: '/tmp/절대.js' }) }],
      () => code,
      { requireModule: () => ({ activate: () => undefined }) },
    )

    expect(result.failed).toEqual([{ dir, reason: 'main_outside' }])
  })
})

describe('loadExtensions — main 이 파일이 아닐 때', () => {
  // resolveInside 는 디렉토리를 통과시킨다 (`_workspace/46` 재생표 4행).
  // 디렉토리를 require 하면 그 안의 index.js 로 새어 간다.
  it('디렉토리를 가리키면 싣지 않는다', async () => {
    const dir = join(extensionsDir, 'dir-ext')
    await mkdir(join(dir, 'lib'), { recursive: true })
    const requireModule = vi.fn(() => ({ activate: () => undefined }))

    const result = await loadExtensions([{ dir, manifest: manifest({ main: 'lib' }) }], () => code, { requireModule })

    expect(requireModule).not.toHaveBeenCalled()
    expect(result.failed).toEqual([{ dir, reason: 'main_not_file' }])
  })

  it('빈 main 이 파서를 뚫고 와도 확장 디렉토리 자신을 require 하지 않는다', async () => {
    // 파서(`missing_main`)가 첫 겹이고 이건 둘째 겹이다 — `46` 강제사항 E.
    // resolveInside(dir, '') 는 **확장 디렉토리 자신**을 돌려준다.
    const dir = join(extensionsDir, 'empty-main')
    await mkdir(dir, { recursive: true })
    const requireModule = vi.fn(() => ({ activate: () => undefined }))

    const result = await loadExtensions([{ dir, manifest: manifest({ main: '' }) }], () => code, { requireModule })

    expect(requireModule).not.toHaveBeenCalled()
    expect(result.failed).toEqual([{ dir, reason: 'main_not_file' }])
  })
})

describe('loadExtensions — 하나가 죽어도 나머지는 산다', () => {
  it('require 가 던진 확장만 건너뛴다', async () => {
    const broken = await makeExtension('broken')
    const good = await makeExtension('good')

    const result = await loadExtensions([broken, good], () => code, {
      requireModule: (path) => {
        if (path.includes('broken')) throw new Error('Unexpected token')
        return { activate: () => ({ commands: { 'good.run': () => 1 } }) }
      },
    })

    expect(result.loaded).toEqual(['good'])
    expect(result.failed).toEqual([{ dir: broken.dir, reason: 'require_failed', detail: 'Unexpected token' }])
    expect(result.commands.has('good.run')).toBe(true)
  })

  it('activate 가 던진 확장만 건너뛴다', async () => {
    const broken = await makeExtension('broken')
    const good = await makeExtension('good')

    const result = await loadExtensions([broken, good], () => code, {
      requireModule: (path) =>
        path.includes('broken')
          ? {
              activate: () => {
                throw new Error('설정이 없습니다')
              },
            }
          : { activate: () => undefined },
    })

    expect(result.loaded).toEqual(['good'])
    expect(result.failed).toEqual([{ dir: broken.dir, reason: 'activate_failed', detail: '설정이 없습니다' }])
  })

  it('activate 를 export 하지 않으면 사유를 따로 준다', async () => {
    const source = await makeExtension('demo')

    const result = await loadExtensions([source], () => code, { requireModule: () => ({ run: () => 1 }) })

    expect(result.failed).toEqual([{ dir: source.dir, reason: 'no_activate' }])
  })
})

describe('loadExtensions — 명령 id 충돌', () => {
  it('먼저 실린 쪽이 남고, 조용히 덮지 않는다', async () => {
    const first = await makeExtension('first')
    const second = await makeExtension('second')
    const firstHandler = () => 'first'
    const log = vi.fn()

    const result = await loadExtensions([first, second], () => code, {
      log,
      requireModule: (path) => ({
        activate: () => ({
          commands: { 'shared.run': path.includes('first') ? firstHandler : () => 'second' },
        }),
      }),
    })

    expect(result.commands.get('shared.run')).toBe(firstHandler)
    // 둘 다 실린 것은 맞다 — 충돌한 명령 하나만 버린다
    expect(result.loaded).toEqual(['first', 'second'])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('shared.run'))
  })

  it('함수가 아닌 명령은 담지 않는다', async () => {
    const source = await makeExtension('demo')

    const result = await loadExtensions([source], () => code, {
      requireModule: () => ({ activate: () => ({ commands: { 'demo.bad': '실행되지 않는 값' } }) }),
    })

    expect(result.commands.size).toBe(0)
    expect(result.loaded).toEqual(['demo'])
  })
})
