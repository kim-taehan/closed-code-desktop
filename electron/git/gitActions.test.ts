import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runGit } from './gitRunner'
import { readGitState } from './gitStatus'
import { stage, unstage, revert, stageAll, unstageAll, amend, undoCommit } from './gitActions'

// 진짜 저장소를 바꾼다. 흉내 내지 않는다 — 인덱스가 실제로 바뀌는지가 관건이다.

describe('git 변경 행동', () => {
  let root = ''

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'davis-act-')))
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

  it('체크하면 인덱스가 실제로 바뀐다', async () => {
    await writeFile(join(root, 'a.txt'), 'one\n')
    await commit('첫 커밋')
    await writeFile(join(root, 'a.txt'), 'two\n')

    expect((await stage(root, 'a.txt')).ok).toBe(true)

    const state = await readGitState(root)
    expect(state.staged).toEqual([{ path: 'a.txt', status: 'modified' }])
    expect(state.unstaged).toEqual([])
  })

  it('해제하면 되돌아온다', async () => {
    await writeFile(join(root, 'a.txt'), 'one\n')
    await commit('첫 커밋')
    await writeFile(join(root, 'a.txt'), 'two\n')
    await stage(root, 'a.txt')

    expect((await unstage(root, 'a.txt')).ok).toBe(true)

    const state = await readGitState(root)
    expect(state.staged).toEqual([])
    expect(state.unstaged).toEqual([{ path: 'a.txt', status: 'modified' }])
  })

  // 담은 뒤 또 고친 파일을 해제해도 작업트리 수정은 남아야 한다
  it('MM 파일을 해제해도 작업트리 수정은 남는다', async () => {
    await writeFile(join(root, 'a.txt'), 'base\n')
    await commit('첫 커밋')
    await writeFile(join(root, 'a.txt'), 'staged\n')
    await stage(root, 'a.txt')
    await writeFile(join(root, 'a.txt'), 'working\n')

    await unstage(root, 'a.txt')

    const state = await readGitState(root)
    // 인덱스에서는 빠졌지만 파일은 여전히 바뀌어 있다
    expect(state.staged).toEqual([])
    expect(state.unstaged).toEqual([{ path: 'a.txt', status: 'modified' }])
  })

  it('되돌리면 작업트리가 마지막 커밋으로 돌아간다', async () => {
    await writeFile(join(root, 'a.txt'), 'original\n')
    await commit('첫 커밋')
    await writeFile(join(root, 'a.txt'), 'changed\n')

    expect((await revert(root, 'a.txt')).ok).toBe(true)

    const state = await readGitState(root)
    expect(state.unstaged).toEqual([])
    expect(state.staged).toEqual([])
  })

  it('공백 든 파일명도 다룬다', async () => {
    await writeFile(join(root, 'a.txt'), 'x\n')
    await commit('첫 커밋')
    await writeFile(join(root, '이름 with 공백.txt'), '내용\n')

    expect((await stage(root, '이름 with 공백.txt')).ok).toBe(true)

    const state = await readGitState(root)
    expect(state.staged).toEqual([{ path: '이름 with 공백.txt', status: 'added' }])
  })

  it('없는 경로는 ok:false 에 git 메시지가 실린다', async () => {
    await writeFile(join(root, 'a.txt'), 'x\n')
    await commit('첫 커밋')

    const result = await revert(root, '없는파일.txt')
    expect(result.ok).toBe(false)
    expect(result.message).toBeTruthy()
  })

  // `add -A` 라 추적 안 되는 파일과 삭제까지 들어간다.
  // 파일별 add 를 도는 것과 결과가 다른 자리라 셋을 한 케이스에서 같이 본다.
  it('모두 담기는 추적 안 되는 파일과 삭제까지 담는다', async () => {
    await writeFile(join(root, 'keep.txt'), 'x\n')
    await writeFile(join(root, 'gone.txt'), 'y\n')
    await commit('첫 커밋')
    await writeFile(join(root, 'keep.txt'), 'changed\n')
    await writeFile(join(root, '새파일.txt'), 'new\n')
    await rm(join(root, 'gone.txt'))

    expect((await stageAll(root)).ok).toBe(true)

    const state = await readGitState(root)
    expect(state.unstaged).toEqual([])
    expect(state.staged).toEqual([
      { path: 'gone.txt', status: 'deleted' },
      { path: 'keep.txt', status: 'modified' },
      { path: '새파일.txt', status: 'added' },
    ])
  })

  it('모두 취소하면 인덱스만 비고 작업트리 수정은 남는다', async () => {
    await writeFile(join(root, 'a.txt'), 'base\n')
    await writeFile(join(root, 'b.txt'), 'base\n')
    await commit('첫 커밋')
    await writeFile(join(root, 'a.txt'), 'changed\n')
    await writeFile(join(root, 'b.txt'), 'changed\n')
    await stageAll(root)

    expect((await unstageAll(root)).ok).toBe(true)

    const state = await readGitState(root)
    expect(state.staged).toEqual([])
    expect(state.unstaged).toEqual([
      { path: 'a.txt', status: 'modified' },
      { path: 'b.txt', status: 'modified' },
    ])
  })

  // 첫 커밋 전에는 되돌릴 인덱스가 없다. git 이 거절하는 것을 그대로 알린다.
  it('커밋이 없는 저장소의 모두 취소는 ok:false 로 온다', async () => {
    await writeFile(join(root, 'a.txt'), 'x\n')
    await runGit(['add', '-A'], root)

    const result = await unstageAll(root)
    expect(result.ok).toBe(false)
    expect(result.message).toBeTruthy()
  })

  it('amend 는 커밋을 늘리지 않고 메시지를 바꾼다', async () => {
    await writeFile(join(root, 'a.txt'), 'x\n')
    await commit('오타가 있는 메시지')

    expect((await amend(root, '고친 메시지')).ok).toBe(true)

    const log = await runGit(['log', '--pretty=%s'], root)
    expect(log.stdout.trim().split('\n')).toEqual(['고친 메시지'])
  })

  it('amend 는 인덱스에 담긴 변경을 직전 커밋에 넣는다', async () => {
    await writeFile(join(root, 'a.txt'), 'x\n')
    await commit('첫 커밋')
    await writeFile(join(root, 'b.txt'), 'y\n')
    await stageAll(root)

    await amend(root, '첫 커밋 + b')

    const files = await runGit(['show', '--name-only', '--pretty=format:'], root)
    expect(files.stdout.trim().split('\n').sort()).toEqual(['a.txt', 'b.txt'])
    expect((await readGitState(root)).staged).toEqual([])
  })

  // `--soft` 라 변경이 사라지지 않는다. 되돌리기와 헷갈리면 안 되는 자리다.
  it('커밋 취소는 커밋만 무르고 변경은 인덱스에 남긴다', async () => {
    await writeFile(join(root, 'a.txt'), 'x\n')
    await commit('첫 커밋')
    await writeFile(join(root, 'b.txt'), 'y\n')
    await commit('둘째 커밋')

    expect((await undoCommit(root)).ok).toBe(true)

    const log = await runGit(['log', '--pretty=%s'], root)
    expect(log.stdout.trim().split('\n')).toEqual(['첫 커밋'])
    // 파일도 인덱스 항목도 그대로다
    expect((await readGitState(root)).staged).toEqual([{ path: 'b.txt', status: 'added' }])
  })

  it('되돌릴 커밋이 없으면 ok:false 로 온다', async () => {
    await writeFile(join(root, 'a.txt'), 'x\n')
    await commit('첫 커밋')

    const result = await undoCommit(root)
    expect(result.ok).toBe(false)
    expect(result.message).toBeTruthy()
  })
})
