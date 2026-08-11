import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openTargetOf } from './openFile'

// 공여(develop-desktop/electron/mcp/openFile.test.ts) 이식. 폴더를 거부하는 케이스만 더했다 —
// 수용의 `resolveInside` 는 realpath 를 타서 「없는 경로」를 이미 걸러 주지만 폴더는 통과한다.

describe('openTargetOf', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'opencode-desk-mcp-'))
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'hello.ts'), 'const a = 1\n')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('상대경로를 그대로 돌려준다', async () => {
    expect(await openTargetOf(root, { path: 'src/hello.ts' })).toEqual({
      path: 'src/hello.ts',
      line: undefined,
    })
  })

  it('절대경로도 루트 안이면 상대경로로 바꿔 준다', async () => {
    const target = await openTargetOf(root, { path: join(root, 'src/hello.ts') })
    expect(target.path).toBe('src/hello.ts')
  })

  it('줄 번호를 함께 준다', async () => {
    expect((await openTargetOf(root, { path: 'src/hello.ts', line: 12 })).line).toBe(12)
  })

  // 0 이나 음수는 갈 곳이 없다
  it('갈 수 없는 줄 번호는 없는 것으로 본다', async () => {
    expect((await openTargetOf(root, { path: 'src/hello.ts', line: 0 })).line).toBeUndefined()
    expect((await openTargetOf(root, { path: 'src/hello.ts', line: -3 })).line).toBeUndefined()
  })

  // 이것 때문에 경계 판정을 `electron/fs/resolveInside.ts` 에 맡겼다
  it('루트 밖은 거부한다', async () => {
    await expect(openTargetOf(root, { path: '../../etc/passwd' })).rejects.toThrow('밖')
  })

  // 절대경로를 루트 기준으로 접어 넘기므로, 접은 값이 `../…` 가 되어 거절되어야 한다.
  // 여기가 새면 A 프로젝트의 도구로 B 프로젝트 파일을 열 수 있다.
  it('루트 밖의 절대경로도 거부한다', async () => {
    await expect(openTargetOf(root, { path: '/etc/hosts' })).rejects.toThrow('밖')
  })

  it('없는 파일은 거부한다', async () => {
    await expect(openTargetOf(root, { path: 'src/nope.ts' })).rejects.toThrow()
  })

  // 폴더를 탭으로 열면 화면에 빈 오류만 남는다 — 여기서 말이 되게 거절한다
  it('폴더는 거부한다', async () => {
    await expect(openTargetOf(root, { path: 'src' })).rejects.toThrow('파일이 없습니다')
  })

  it('path 가 없으면 무엇을 열지 알 수 없다', async () => {
    await expect(openTargetOf(root, {})).rejects.toThrow('path')
  })
})
