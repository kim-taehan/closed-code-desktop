import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installPackage, isSafeEntry } from './install'
import { buildZip } from './testZip'

// 확장 패키지 설치.
//
// 이 파일의 **핵심은 zip slip** 이다. 폴더 복사 설치에는 없던 위험이고,
// 사용자가 아무 파일이나 고를 수 있어 우리가 막아야 한다.
//
// `zip` CLI 는 `../` 를 스스로 지워서 악성 패키지를 못 만든다. 그래서 zip 바이트를
// 직접 써서(`testZip.ts`) **실제로 밖을 가리키는 압축**을 만들어 시험한다.
// 가짜 목록으로 시험하면 배선이 빠져도 초록이 된다.

const MANIFEST = {
  manifestVersion: 1,
  name: 'sample-ext',
  displayName: '샘플 확장',
  version: '0.1.0',
  main: 'main.js',
}

let base = ''
let extensionsDir = ''

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'ext-install-'))
  extensionsDir = join(base, 'desktop-extensions')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

async function packageWith(files: { name: string; body: string }[]): Promise<string> {
  const path = join(base, 'pkg.axcx')
  await writeFile(path, buildZip(files))
  return path
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

describe('isSafeEntry — 이 파일에서 유일한 보안 판정', () => {
  it.each([
    ['manifest.json'],
    ['main.js'],
    ['lib/util.js'],
    ['a/b/c/d.js'],
    ['dot.name/x.js'],
    ['..hidden/x.js'],
  ])('평범한 경로는 통과한다: %s', (entry) => {
    expect(isSafeEntry(entry)).toBe(true)
  })

  it.each([
    ['../evil.js'],
    ['a/../../evil.js'],
    ['a/b/../../../evil.js'],
    ['..'],
    ['..\\evil.js'],
    ['/etc/passwd'],
    ['\\windows\\system32'],
    ['C:\\evil.txt'],
    ['c:/evil.txt'],
    ['~/.ssh/id_rsa'],
    [''],
    ['   '],
  ])('밖을 가리키면 막는다: %s', (entry) => {
    expect(isSafeEntry(entry)).toBe(false)
  })
})

describe('정상 패키지', () => {
  it('풀어서 확장 이름의 폴더로 옮긴다', async () => {
    const pkg = await packageWith([
      { name: 'manifest.json', body: JSON.stringify(MANIFEST) },
      { name: 'main.js', body: 'exports.activate = () => {}' },
    ])

    const result = await installPackage({ packagePath: pkg, extensionsDir })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.name).toBe('sample-ext')
    expect(result.dir).toBe(join(extensionsDir, 'sample-ext'))
    expect(await readFile(join(result.dir, 'main.js'), 'utf8')).toContain('activate')
  })

  it('설치 폴더가 없으면 만든다', async () => {
    const pkg = await packageWith([{ name: 'manifest.json', body: JSON.stringify(MANIFEST) }])
    expect(await exists(extensionsDir)).toBe(false)

    expect((await installPackage({ packagePath: pkg, extensionsDir })).ok).toBe(true)
    expect(await exists(extensionsDir)).toBe(true)
  })

  it('폴더 한 겹을 감싸고 있어도 받아준다 — 압축할 때 흔한 실수다', async () => {
    const pkg = await packageWith([
      { name: 'sample-ext/manifest.json', body: JSON.stringify(MANIFEST) },
      { name: 'sample-ext/main.js', body: '// x' },
    ])

    const result = await installPackage({ packagePath: pkg, extensionsDir })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await exists(join(result.dir, 'manifest.json'))).toBe(true)
  })

  it('같은 이름을 다시 설치하면 덮어쓴다 — 이것이 업데이트다', async () => {
    const first = await packageWith([
      { name: 'manifest.json', body: JSON.stringify(MANIFEST) },
      { name: 'old.js', body: '// 옛것' },
    ])
    await installPackage({ packagePath: first, extensionsDir })

    const second = await packageWith([
      { name: 'manifest.json', body: JSON.stringify({ ...MANIFEST, version: '0.2.0' }) },
      { name: 'new.js', body: '// 새것' },
    ])
    const result = await installPackage({ packagePath: second, extensionsDir })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.version).toBe('0.2.0')
    expect(await exists(join(result.dir, 'new.js'))).toBe(true)
    // 남아 있으면 옛 파일이 새 버전에서 계속 실린다
    expect(await exists(join(result.dir, 'old.js'))).toBe(false)
  })
})

// `testZip.ts` 는 압축하지 않는(stored) zip 만 만든다. 실제 배포 패키지는 `zip` CLI 가
// deflate 로 압축한 것이라, **압축된 패키지도 풀리는지**는 따로 확인해야 한다.
// 이걸 안 보면 "시험은 초록인데 진짜 패키지는 설치가 안 된다" 가 된다.
describe('실제 zip 도구가 만든 패키지 (deflate)', () => {
  it('압축된 패키지도 설치된다', async () => {
    const source = join(base, 'src')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'manifest.json'), JSON.stringify(MANIFEST))
    // 압축이 실제로 걸리도록 반복이 많은 본문을 넣는다
    await writeFile(join(source, 'main.js'), `// ${'같은 말 '.repeat(500)}\n`)

    const pkg = join(base, 'real.axcx')
    await new Promise<void>((done, fail) => {
      const child = spawn('zip', ['-r', '-q', pkg, '.'], { cwd: source, stdio: 'ignore' })
      child.on('error', fail)
      child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`zip ${code}`))))
    })

    const result = await installPackage({ packagePath: pkg, extensionsDir })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.name).toBe('sample-ext')
    expect(await readFile(join(result.dir, 'main.js'), 'utf8')).toContain('같은 말')
  })
})

describe('zip slip — 밖을 가리키는 패키지는 풀지도 않는다', () => {
  it('설치 폴더 밖으로 새려는 항목이 있으면 거부한다', async () => {
    const pkg = await packageWith([
      { name: 'manifest.json', body: JSON.stringify(MANIFEST) },
      { name: '../../evil.js', body: '탈출' },
    ])

    const result = await installPackage({ packagePath: pkg, extensionsDir })

    expect(result).toEqual({ ok: false, reason: 'unsafe_entry', detail: '../../evil.js' })
  })

  it('거부한 패키지는 **아무 파일도 남기지 않는다**', async () => {
    const pkg = await packageWith([
      { name: 'manifest.json', body: JSON.stringify(MANIFEST) },
      { name: '../escaped.js', body: '탈출' },
    ])

    await installPackage({ packagePath: pkg, extensionsDir })

    // 밖으로 샌 파일도, 설치 폴더 안의 흔적도 없어야 한다
    expect(await exists(join(base, 'escaped.js'))).toBe(false)
    expect(await exists(join(extensionsDir, 'sample-ext'))).toBe(false)
  })

  it('절대경로 항목도 거부한다', async () => {
    const pkg = await packageWith([
      { name: 'manifest.json', body: JSON.stringify(MANIFEST) },
      { name: '/tmp/evil.js', body: '탈출' },
    ])

    const result = await installPackage({ packagePath: pkg, extensionsDir })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unsafe_entry')
  })
})

describe('못 쓰는 패키지는 사유와 함께 거절한다', () => {
  it('아카이브가 아니면 unreadable_package', async () => {
    const path = join(base, 'not-a-zip.axcx')
    await writeFile(path, '이건 그냥 글자입니다')

    const result = await installPackage({ packagePath: path, extensionsDir })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unreadable_package')
  })

  it('manifest.json 이 없으면 no_manifest', async () => {
    const pkg = await packageWith([{ name: 'main.js', body: '// 매니페스트 없음' }])

    const result = await installPackage({ packagePath: pkg, extensionsDir })
    expect(result).toEqual({ ok: false, reason: 'no_manifest' })
  })

  it('manifest.json 이 JSON 이 아니면 invalid_json', async () => {
    const pkg = await packageWith([{ name: 'manifest.json', body: '{ 깨진' }])

    const result = await installPackage({ packagePath: pkg, extensionsDir })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('invalid_json')
  })

  it('매니페스트가 표준에 안 맞으면 파서 사유를 그대로 올린다', async () => {
    const pkg = await packageWith([
      { name: 'manifest.json', body: JSON.stringify({ name: 'x', version: '1', main: 'm.js' }) },
    ])

    const result = await installPackage({ packagePath: pkg, extensionsDir })
    // manifestVersion 을 빠뜨렸다 — 무엇을 빠뜨렸는지가 detail 로 와야 고친다
    expect(result).toEqual({
      ok: false,
      reason: 'invalid_manifest',
      detail: 'missing_manifest_version',
    })
  })

  it('실패하면 임시 폴더를 남기지 않는다', async () => {
    const pkg = await packageWith([{ name: 'main.js', body: '// 매니페스트 없음' }])
    await installPackage({ packagePath: pkg, extensionsDir })

    const { readdir } = await import('node:fs/promises')
    expect((await readdir(extensionsDir)).filter((n) => n.startsWith('.install-'))).toEqual([])
  })
})
