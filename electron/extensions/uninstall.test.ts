import { mkdir, mkdtemp, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { uninstallExtension } from './uninstall'

// 확장 지우기. 지우는 일이라 **가두는 것**이 본론이다 —
// 화면이 준 경로를 그대로 믿으면 설치 폴더 밖의 무엇이든 지워진다.

let extensionsDir: string

async function makeExtension(name: string): Promise<string> {
  const dir = join(extensionsDir, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'manifest.json'), '{}')
  return dir
}

beforeEach(async () => {
  extensionsDir = await mkdtemp(join(tmpdir(), 'ext-uninstall-'))
})

describe('설치 폴더 바로 아래만 지운다', () => {
  it('폴더째 지운다', async () => {
    const dir = await makeExtension('line-checker')

    expect(await uninstallExtension(extensionsDir, dir)).toEqual({ ok: true })
    expect(await readdir(extensionsDir)).toEqual([])
  })

  it('경로가 섞인 것은 거부한다 — 설치 폴더 밖은 건드리지 않는다', async () => {
    await makeExtension('keep-me')

    const result = await uninstallExtension(extensionsDir, join(extensionsDir, '..', 'elsewhere'))

    expect(result).toEqual({ ok: false, reason: 'outside' })
    expect(await readdir(extensionsDir)).toEqual(['keep-me'])
  })

  // 한 겹 아래만 확장이다. 더 깊은 곳을 지우라는 요청은 확장을 가리키는 것이 아니다
  it('더 깊은 경로도 거부한다', async () => {
    const dir = await makeExtension('deep')
    const result = await uninstallExtension(extensionsDir, join(dir, 'inner'))
    expect(result).toEqual({ ok: false, reason: 'outside' })
  })

  it('없는 폴더는 사유를 알린다 — 조용히 성공하면 지운 줄 안다', async () => {
    const result = await uninstallExtension(extensionsDir, join(extensionsDir, 'ghost'))
    expect(result).toEqual({ ok: false, reason: 'missing' })
  })
})

describe('심링크로 깔린 확장', () => {
  it('링크만 지우고 원본은 남긴다 — 개발 중인 소스가 사라지면 안 된다', async () => {
    const source = await mkdtemp(join(tmpdir(), 'ext-source-'))
    await writeFile(join(source, 'manifest.json'), '{}')
    const link = join(extensionsDir, 'linked')
    await symlink(source, link)

    expect(await uninstallExtension(extensionsDir, link)).toEqual({ ok: true })
    expect(await readdir(extensionsDir)).toEqual([])
    expect(await readdir(source)).toEqual(['manifest.json'])
  })

  it('끊어진 링크도 지운다 — 목록에는 뜨는데 못 지우면 갇힌다', async () => {
    const link = join(extensionsDir, 'broken')
    await symlink(join(tmpdir(), 'nowhere-at-all'), link)

    expect(await uninstallExtension(extensionsDir, link)).toEqual({ ok: true })
    expect(await readdir(extensionsDir)).toEqual([])
  })
})
