import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readRunList, runListFile, writeRunList } from './runListStore'

// 저장소가 지켜야 하는 것 셋:
//   · **프로젝트마다 갈린다** — 남의 프로젝트 명령이 여기서 뜨면 안 된다
//   · **폴더가 없어도 적힌다** — 처음 적는 순간이 늘 그렇다
//   · **깨진 파일은 「없다」로 읽는다** — 빈 목록으로 읽으면 화면이 「못 찾았다」로 그린다

describe('runListStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'run-store-'))
    await rm(dir, { recursive: true, force: true }) // 아직 없는 폴더에서 시작한다
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('폴더가 없어도 적고, 적은 것을 읽는다', async () => {
    await writeRunList(dir, {
      entries: [{ name: 'dev', command: 'npm run dev' }],
      manifest: 'abc',
      project: '/work/repo',
    })

    expect(await readRunList(dir, '/work/repo')).toEqual({
      entries: [{ name: 'dev', command: 'npm run dev' }],
      manifest: 'abc',
      project: '/work/repo',
    })
    // 임시 파일이 남지 않는다 — rename 이 끝난 뒤의 자리다
    expect(await readdir(dir)).toEqual([runListFile(dir, '/work/repo').split('/').pop()])
  })

  it('프로젝트가 다르면 다른 파일이다 — 열쇠는 루트 경로다', async () => {
    await writeRunList(dir, { entries: [], manifest: null, project: '/work/a' })

    expect(runListFile(dir, '/work/a')).not.toBe(runListFile(dir, '/work/b'))
    expect(await readRunList(dir, '/work/b')).toBeNull()
  })

  it('아직 없으면 null — 프로젝트를 처음 여는 순간이 늘 그렇다', async () => {
    expect(await readRunList(dir, '/work/repo')).toBeNull()
  })

  it('깨진 파일은 null — 빈 목록으로 읽으면 「분석했는데 못 찾았다」로 보인다', async () => {
    await writeRunList(dir, { entries: [], manifest: null, project: '/work/repo' })
    await writeFile(runListFile(dir, '/work/repo'), '{ 반쯤 쓰다 만', 'utf8')

    expect(await readRunList(dir, '/work/repo')).toBeNull()
  })
})
