import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runGit } from './gitRunner'
import { readGitState } from './gitStatus'
import { countConflicts } from './gitConflict'

// 충돌을 진짜로 낸다. 손으로 쓴 마커는 git 이 실제로 남기는 모양과 다를 수 있다.

describe('충돌 지점 개수', () => {
  let root = ''

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'davis-conf-')))
    await runGit(['init', '-b', 'main'], root)
    await runGit(['config', 'user.email', 'test@example.com'], root)
    await runGit(['config', 'user.name', '테스트'], root)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function commit(message: string): Promise<void> {
    await runGit(['add', '-A'], root)
    await runGit(['commit', '-m', message], root)
  }

  /** 떨어진 두 자리를 양쪽에서 다르게 고쳐 충돌 **두 군데**를 만든다 */
  async function conflictOnTwoSpots(): Promise<void> {
    const base = Array.from({ length: 20 }, (_, at) => `line${at}`).join('\n').concat('\n')
    await writeFile(join(root, 'a.txt'), base)
    await commit('첫 커밋')

    await runGit(['switch', '-c', 'other'], root)
    await writeFile(join(root, 'a.txt'), base.replace('line1\n', 'other1\n').replace('line15\n', 'other15\n'))
    await commit('other 쪽')

    await runGit(['switch', 'main'], root)
    await writeFile(join(root, 'a.txt'), base.replace('line1\n', 'main1\n').replace('line15\n', 'main15\n'))
    await commit('main 쪽')

    await runGit(['merge', '--no-edit', 'other'], root)
  }

  it('충돌 두 군데면 2 다', async () => {
    await conflictOnTwoSpots()

    // 전제 확인 — 상태가 충돌로 보여야 이 수치가 의미를 갖는다
    const state = await readGitState(root)
    expect(state.unstaged).toContainEqual({ path: 'a.txt', status: 'conflicted' })

    expect(await countConflicts(root, 'a.txt')).toBe(2)
  })

  it('충돌이 없는 파일은 0 이다', async () => {
    await writeFile(join(root, 'a.txt'), 'one\ntwo\n')
    await commit('첫 커밋')

    expect(await countConflicts(root, 'a.txt')).toBe(0)
  })

  // `git diff --check` 로 세면 이런 파일에서 공백 오류까지 섞여 개수가 부풀려진다.
  it('줄 끝 공백은 충돌로 세지 않는다', async () => {
    await writeFile(join(root, 'ws.txt'), 'one   \ntwo\t\nthree  \n')
    await commit('첫 커밋')

    expect(await countConflicts(root, 'ws.txt')).toBe(0)
  })

  // 마커는 일곱 글자 다음에 **공백**이 온다. 그걸 안 보면 본문 줄을 마커로 오인한다.
  it('마커를 닮은 본문 줄은 세지 않는다', async () => {
    await writeFile(join(root, 'doc.md'), '<<<<<<<<\n<<<<<<<끝\n>>>>>>> x\n')
    await commit('첫 커밋')

    expect(await countConflicts(root, 'doc.md')).toBe(0)
  })

  it('없는 경로는 0 으로 넘어간다 — 예외를 던지지 않는다', async () => {
    await expect(countConflicts(root, '없는파일.txt')).resolves.toBe(0)
  })
})
