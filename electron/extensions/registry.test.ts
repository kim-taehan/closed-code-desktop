import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultExtensionsDir, scanExtensions } from './registry'

// P1-ext — 확장 레지스트리.
// 이 레포 관례대로 fs 를 모킹하지 않고 **진짜 임시 디렉토리**를 쓴다
// (`electron/runtime/runtimeLifecycle.test.ts:14-36` 정본 패턴).

const dirs: string[] = []

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function makeExtensionsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'code-ext-'))
  dirs.push(dir)
  return dir
}

/** 확장 폴더 하나를 만든다. body 가 문자열이면 그대로 쓴다 (깨진 JSON 용). */
async function writeExtension(root: string, name: string, body: unknown): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  if (body !== undefined) {
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    await writeFile(join(dir, 'manifest.json'), text, 'utf8')
  }
  return dir
}

const VALID = {
  // 표준 v1 필수. 없으면 파서가 missing_manifest_version 으로 버린다
  manifestVersion: 2,
  name: 'code-analysis',
  displayName: '코드 분석',
  version: '0.1.0',
  main: 'main.js',
  contributes: { commands: [{ id: 'codeAnalysis.run', title: '코드 분석 실행' }] },
}

describe('설치 경로', () => {
  it('환경변수가 있으면 그쪽이 우선한다', () => {
    expect(defaultExtensionsDir({ OPEN_CODE_EXTENSIONS_DIR: '/tmp/ext' })).toBe('/tmp/ext')
  })

  it('없으면 ~/.open-code/desktop-extensions 다', () => {
    expect(defaultExtensionsDir({})).toMatch(/\.open-code[\\/]desktop-extensions$/)
  })
})

describe('훑기', () => {
  it('정상 확장을 담고 사유 목록은 비어 있다', async () => {
    const root = await makeExtensionsDir()
    const dir = await writeExtension(root, 'code-analysis', VALID)

    const scan = await scanExtensions(root)
    expect(scan.skipped).toEqual([])
    expect(scan.extensions).toHaveLength(1)
    expect(scan.extensions[0]?.dir).toBe(dir)
    expect(scan.extensions[0]?.manifest.name).toBe('code-analysis')
    expect(scan.extensions[0]?.manifest.contributes?.commands).toHaveLength(1)
  })

  it('디렉토리가 아예 없으면 빈 결과다', async () => {
    const scan = await scanExtensions(join(tmpdir(), 'code-ext-does-not-exist-12345'))
    expect(scan).toEqual({ extensions: [], skipped: [] })
  })

  // 확장 폴더를 버전 관리하는 것은 흔한 일이다. 그때마다 `.git` 이 「싣지 못한 확장」으로
  // 잡히면, 사용자가 고칠 수 없는 사유가 설정 창에 남는다.
  it('점으로 시작하는 디렉토리는 사유에도 넣지 않는다', async () => {
    const root = await makeExtensionsDir()
    await mkdir(join(root, '.git'), { recursive: true })
    await writeExtension(root, 'code-analysis', VALID)

    const scan = await scanExtensions(root)

    expect(scan.skipped).toEqual([])
    expect(scan.extensions).toHaveLength(1)
  })

  it('디렉토리가 아닌 항목은 사유에도 넣지 않는다', async () => {
    const root = await makeExtensionsDir()
    await writeFile(join(root, '.DS_Store'), 'x', 'utf8')

    const scan = await scanExtensions(root)
    expect(scan).toEqual({ extensions: [], skipped: [] })
  })
})

// 개발 트리에 확장을 걸어두는 흔한 워크플로.
// readdir(withFileTypes) 는 심링크에 isDirectory()===false 를 주므로 따로 잠근다.
describe('심링크로 설치한 확장', () => {
  it('디렉토리를 가리키면 그대로 싣는다', async () => {
    const root = await makeExtensionsDir()
    const source = await makeExtensionsDir()
    await writeExtension(source, 'my-ext', VALID)
    const link = join(root, 'my-ext')
    await symlink(join(source, 'my-ext'), link)

    const scan = await scanExtensions(root)
    expect(scan.skipped).toEqual([])
    expect(scan.extensions).toHaveLength(1)
    expect(scan.extensions[0]?.dir).toBe(link)
    expect(scan.extensions[0]?.manifest.name).toBe('code-analysis')
  })

  it('끊긴 링크는 사유와 함께 건너뛴다 — 무음이 아니다', async () => {
    const root = await makeExtensionsDir()
    const link = join(root, 'gone')
    await symlink(join(root, 'nowhere'), link)

    const scan = await scanExtensions(root)
    expect(scan.extensions).toEqual([])
    expect(scan.skipped).toEqual([{ dir: link, reason: 'broken_link' }])
  })

  it('파일을 가리키는 링크는 확장 후보가 아니다', async () => {
    const root = await makeExtensionsDir()
    const file = join(root, 'note.txt')
    await writeFile(file, 'x', 'utf8')
    await symlink(file, join(root, 'linked-file'))

    const scan = await scanExtensions(root)
    expect(scan).toEqual({ extensions: [], skipped: [] })
  })
})

describe('건너뛴 것은 사유와 함께 돌려준다', () => {
  it('manifest.json 이 없으면 no_manifest', async () => {
    const root = await makeExtensionsDir()
    const dir = await writeExtension(root, 'empty', undefined)

    const scan = await scanExtensions(root)
    expect(scan.extensions).toEqual([])
    expect(scan.skipped).toEqual([{ dir, reason: 'no_manifest' }])
  })

  it('JSON 이 깨졌으면 invalid_json', async () => {
    const root = await makeExtensionsDir()
    const dir = await writeExtension(root, 'broken', '{ "name": ')

    const scan = await scanExtensions(root)
    expect(scan.skipped).toEqual([{ dir, reason: 'invalid_json' }])
  })

  it('필수 필드가 없으면 파서 사유가 그대로 온다', async () => {
    const root = await makeExtensionsDir()
    const dir = await writeExtension(root, 'no-main', { ...VALID, main: undefined })

    const scan = await scanExtensions(root)
    expect(scan.skipped).toEqual([{ dir, reason: 'missing_main' }])
  })

  it('읽을 수 없으면 unreadable — 없는 것과 구분한다', async () => {
    // 권한으로 막는 방법이 안 통하는 환경이 둘 있다:
    // root 로 돌리면 권한이 무시되고, Windows 는 chmod 가 사실상 무력하다.
    if (process.getuid?.() === 0 || process.platform === 'win32') return

    const root = await makeExtensionsDir()
    const dir = await writeExtension(root, 'locked', VALID)
    const manifest = join(dir, 'manifest.json')
    await chmod(manifest, 0o000)

    const scan = await scanExtensions(root)
    await chmod(manifest, 0o644)
    expect(scan.skipped).toEqual([{ dir, reason: 'unreadable' }])
  })

  it('깨진 확장이 정상 확장을 막지 않는다', async () => {
    const root = await makeExtensionsDir()
    await writeExtension(root, 'aaa-broken', '깨짐')
    await writeExtension(root, 'zzz-good', VALID)

    const scan = await scanExtensions(root)
    expect(scan.extensions).toHaveLength(1)
    expect(scan.extensions[0]?.manifest.name).toBe('code-analysis')
    expect(scan.skipped).toHaveLength(1)
    expect(scan.skipped[0]?.reason).toBe('invalid_json')
  })
})
