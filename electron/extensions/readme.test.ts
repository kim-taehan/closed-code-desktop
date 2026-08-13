import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readExtensionReadme } from './readme'

// 설정 창 「상세」가 읽는 것.
//
// 여기 핵심 둘:
//  1. **화면이 준 이름으로 확장 폴더 밖을 못 나간다** — renderer 는 신뢰 경계 밖이다
//  2. **없는 것은 실패가 아니라 상태다** — README 없는 확장이 대부분이라,
//     오류로 만들면 멀쩡한 확장이 고장난 것처럼 보인다

describe('확장 README 읽기', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ext-readme-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function makeExtension(name: string, readme?: string): Promise<void> {
    const root = join(dir, name)
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'manifest.json'), '{}', 'utf8')
    if (readme !== undefined) await writeFile(join(root, 'README.md'), readme, 'utf8')
  }

  it('README.md 를 그대로 돌려준다', async () => {
    await makeExtension('sample-ext', '# 샘플 확장\n\n무언가를 모읍니다.\n')

    const result = await readExtensionReadme(dir, 'sample-ext')

    expect(result).toEqual({ ok: true, text: '# 샘플 확장\n\n무언가를 모읍니다.\n' })
  })

  // README 없는 확장이 대부분이다. 오류가 아니라 "설명이 없다" 로 그려야 한다
  it('README 가 없으면 missing — 실패가 아니라 상태다', async () => {
    await makeExtension('sample-ext')

    expect(await readExtensionReadme(dir, 'sample-ext')).toEqual({
      ok: false,
      reason: 'missing',
    })
  })

  it('없는 확장도 missing', async () => {
    expect(await readExtensionReadme(dir, '없는것')).toEqual({ ok: false, reason: 'missing' })
  })

  it('README.md 가 디렉토리면 not_file — 읽으려다 엉뚱한 오류를 내지 않는다', async () => {
    await makeExtension('sample-ext')
    await mkdir(join(dir, 'sample-ext', 'README.md'))

    expect(await readExtensionReadme(dir, 'sample-ext')).toEqual({
      ok: false,
      reason: 'not_file',
    })
  })

  // 상한이 없으면 수 MB 짜리 문서가 IPC 를 타고 설정 창까지 그대로 간다
  it('너무 크면 too_large', async () => {
    await makeExtension('sample-ext', 'x'.repeat(256 * 1024 + 1))

    expect(await readExtensionReadme(dir, 'sample-ext')).toEqual({
      ok: false,
      reason: 'too_large',
    })
  })
})

describe('확장 폴더 밖으로 못 나간다 — 화면이 준 이름을 믿지 않는다', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ext-readme-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('이름에 상위 경로가 섞이면 outside', async () => {
    await writeFile(join(dir, 'README.md'), '밖의 것', 'utf8')

    expect(await readExtensionReadme(join(dir, 'inner'), '..')).toMatchObject({
      ok: false,
      reason: 'outside',
    })
  })

  // registry.ts 가 심링크를 따라가는 것은 개발용 확장을 걸어두라고 만든 길이다.
  // 확장 폴더 자체를 realpath 로 가두면 그 확장은 상세를 영영 못 본다
  it('심링크로 걸어둔 개발용 확장은 그대로 읽힌다', async () => {
    const source = await mkdtemp(join(tmpdir(), 'ext-dev-'))
    await writeFile(join(source, 'README.md'), '# 개발 중\n', 'utf8')
    await symlink(source, join(dir, 'my-ext'))

    expect(await readExtensionReadme(dir, 'my-ext')).toEqual({ ok: true, text: '# 개발 중\n' })
    await rm(source, { recursive: true, force: true })
  })

  it('절대경로를 넣어도 못 빠져나간다', async () => {
    expect(await readExtensionReadme(dir, '/etc')).toMatchObject({ ok: false })
  })

  // resolveInside 는 realpath 로 판정한다 — 링크를 따라간 **최종 위치**가 기준이다
  it('심링크로 밖을 가리켜도 막힌다', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'ext-outside-'))
    await writeFile(join(outside, 'README.md'), '남의 것', 'utf8')
    await mkdir(join(dir, 'sneaky'), { recursive: true })
    await symlink(join(outside, 'README.md'), join(dir, 'sneaky', 'README.md'))

    const result = await readExtensionReadme(dir, 'sneaky')

    expect(result).toEqual({ ok: false, reason: 'missing' })
    await rm(outside, { recursive: true, force: true })
  })
})
