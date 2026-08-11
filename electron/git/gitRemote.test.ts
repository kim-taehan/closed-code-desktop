import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runGit } from './gitRunner'
import { readGitState } from './gitStatus'
import { commit } from './gitActions'
import { push, pull, refreshWithFetch } from './gitRemote'

// 원격은 임시 폴더에 `git init --bare` 로 만든다. 진짜 push/pull 이 오간다.
//
// ⚠ **clone 까지 도는 케이스에는 타임아웃을 따로 준다** (`REMOTE_TIMEOUT`). `vitest.config.ts`
//   에 `testTimeout` 이 없어 기본 5000ms 인데, 이 케이스 하나가 git 하위 프로세스를 10개
//   안팎 띄운다 — 단독으로는 0.4초지만 전수 실행처럼 워커에 부하가 걸리면 넘어가 산발
//   실패한다 (QA 실측: 전수 6회 중 5회). 잡던 것은 그대로 두고 시간만 준다.
//   같은 사유·같은 값이 `gitBranch.test.ts` 의 원격 케이스에도 있다.
const REMOTE_TIMEOUT = 30_000

describe('git 원격 행동', () => {
  let origin = ''
  let root = ''

  beforeEach(async () => {
    origin = await realpath(await mkdtemp(join(tmpdir(), 'davis-origin-')))
    await runGit(['init', '--bare', '-b', 'main'], origin)

    root = await realpath(await mkdtemp(join(tmpdir(), 'davis-clone-')))
    await runGit(['init', '-b', 'main'], root)
    await runGit(['config', 'user.email', 'test@example.com'], root)
    await runGit(['config', 'user.name', '테스트'], root)
    await runGit(['remote', 'add', 'origin', origin], root)
  })

  afterEach(async () => {
    await rm(origin, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  })

  async function commitFile(name: string, text: string, message: string): Promise<void> {
    await writeFile(join(root, name), text)
    await runGit(['add', '-A'], root)
    await runGit(['commit', '-m', message], root)
  }

  it('업스트림이 없으면 setUpstream 으로 만들며 올린다', async () => {
    await commitFile('a.txt', 'one\n', '첫 커밋')

    const before = await readGitState(root)
    expect(before.upstream).toBeNull()

    const result = await push(root, true)
    expect(result.ok).toBe(true)

    const after = await readGitState(root)
    expect(after.upstream).toBe('origin/main')
    expect(after.ahead).toBe(0)
  })

  it('업스트림이 없는데 setUpstream 을 안 주면 git 이 거절한다', async () => {
    await commitFile('a.txt', 'one\n', '첫 커밋')

    const result = await push(root, false)
    expect(result.ok).toBe(false)
    expect(result.message).toBeTruthy()
  })

  // 브랜치 이름은 **지금 상태에서 읽는다** — 분리된 HEAD 면 올릴 이름 자체가 없다.
  // git 에 `-u origin null` 같은 것을 만들어 보내지 않고 여기서 멈춘다.
  it('분리된 HEAD 에서는 올릴 브랜치가 없다고 알린다', async () => {
    await commitFile('a.txt', 'one\n', '첫 커밋')
    await runGit(['checkout', '--detach', 'HEAD'], root)

    const result = await push(root, true)

    expect(result.ok).toBe(false)
    expect(result.message).toBe('올릴 브랜치를 찾을 수 없습니다 (분리된 HEAD)')
  })

  it('커밋하고 올리면 원격에 반영된다', async () => {
    await commitFile('a.txt', 'one\n', '첫 커밋')
    await push(root, true)

    await writeFile(join(root, 'b.txt'), 'two\n')
    await runGit(['add', 'b.txt'], root)
    expect((await commit(root, '두 번째')).ok).toBe(true)

    const before = await readGitState(root)
    expect(before.ahead).toBe(1)

    expect((await push(root, false)).ok).toBe(true)
    expect((await readGitState(root)).ahead).toBe(0)
  })

  it('원격이 앞서면 당겨와 behind 가 0이 된다', async () => {
    await commitFile('a.txt', 'one\n', '첫 커밋')
    await push(root, true)

    // 다른 클론에서 원격을 앞서게 만든다
    const other = await realpath(await mkdtemp(join(tmpdir(), 'davis-other-')))
    try {
      await runGit(['clone', origin, other], root)
      await runGit(['config', 'user.email', 'x@example.com'], other)
      await runGit(['config', 'user.name', 'x'], other)
      await writeFile(join(other, 'c.txt'), 'three\n')
      await runGit(['add', '-A'], other)
      await runGit(['commit', '-m', '남이 올림'], other)
      await runGit(['push'], other)

      await refreshWithFetch(root)
      expect((await readGitState(root)).behind).toBe(1)

      expect((await pull(root)).ok).toBe(true)
      expect((await readGitState(root)).behind).toBe(0)
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  }, REMOTE_TIMEOUT)

  // 망 밖이어도 앱이 죽지 않고 나머지 상태는 정상이어야 한다
  it('도달 못 하는 원격으로 fetch 해도 상태의 나머지는 정상이다', async () => {
    await commitFile('a.txt', 'one\n', '첫 커밋')
    await runGit(['remote', 'set-url', 'origin', '/그런/경로/없음.git'], root)

    const state = await refreshWithFetch(root)
    expect(state.isRepo).toBe(true)
    expect(state.branch).toBe('main')
    expect(state.fetchFailed).toBe(true)
  })
})
