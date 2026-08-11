import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runGit } from './gitRunner'
import { readGitState } from './gitStatus'
import { applyStash, dropStash, parseStashList, readStashes, showStash, stashPush } from './gitStash'

// 진짜 저장소를 바꾼다. 스태시는 "작업트리가 실제로 되돌아갔나" 가 관건이라
// 흉내 낸 출력으로는 아무것도 확인되지 않는다.

describe('임시저장', () => {
  let root = ''

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'davis-stash-')))
    await runGit(['init', '-b', 'main'], root)
    await runGit(['config', 'user.email', 'test@example.com'], root)
    await runGit(['config', 'user.name', '테스트'], root)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function commit(file: string, body: string, message: string): Promise<void> {
    await writeFile(join(root, file), body)
    await runGit(['add', '-A'], root)
    await runGit(['commit', '-m', message], root)
  }

  it('저장 → 목록 → 복원 왕복', async () => {
    await commit('a.txt', 'base\n', '첫 커밋')
    await writeFile(join(root, 'a.txt'), 'working\n')

    expect((await stashPush(root, '하던 작업')).ok).toBe(true)

    // 저장하면 작업트리가 깨끗해진다
    expect((await readGitState(root)).unstaged).toEqual([])
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('base\n')

    const list = await readStashes(root)
    expect(list.ok).toBe(true)
    expect(list.stashes).toHaveLength(1)
    expect(list.stashes[0]?.ref).toBe('stash@{0}')
    expect(list.stashes[0]?.label).toContain('하던 작업')
    expect(list.stashes[0]?.date).not.toBe('')

    expect((await applyStash(root, 'stash@{0}')).ok).toBe(true)
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('working\n')

    // 복원은 목록을 지우지 않는다 (`pop` 을 만들지 않은 이유 — 버리기는 따로 부른다)
    expect((await readStashes(root)).stashes).toHaveLength(1)
  })

  it('버리면 목록에서 사라진다', async () => {
    await commit('a.txt', 'base\n', '첫 커밋')
    await writeFile(join(root, 'a.txt'), 'working\n')
    await stashPush(root, '하던 작업')

    expect((await dropStash(root, 'stash@{0}')).ok).toBe(true)
    expect((await readStashes(root)).stashes).toEqual([])
  })

  // ⚠ 담을 게 없으면 git 은 `No local changes to save` 를 내고 **exit 0** 이다.
  // 실패가 아니다 — 다만 아무것도 안 만든다.
  it('담을 게 없으면 성공으로 오되 목록이 안 늘어난다', async () => {
    await commit('a.txt', 'base\n', '첫 커밋')

    const result = await stashPush(root, '빈 저장')

    expect(result.ok).toBe(true)
    expect((await readStashes(root)).stashes).toEqual([])
  })

  // 스태시는 커밋 위에 얹는 것이라 첫 커밋 전에는 만들 수 없다 (exit 1, 실측).
  it('커밋이 없는 저장소의 저장은 ok:false 로 온다', async () => {
    await writeFile(join(root, 'a.txt'), 'x\n')

    const result = await stashPush(root, '첫 커밋 전')

    expect(result.ok).toBe(false)
    expect(result.message).toBeTruthy()
  })

  it('없는 스태시를 복원·삭제하면 ok:false 에 git 메시지가 실린다', async () => {
    await commit('a.txt', 'base\n', '첫 커밋')

    const applied = await applyStash(root, 'stash@{7}')
    expect(applied.ok).toBe(false)
    expect(applied.message).toBeTruthy()

    const dropped = await dropStash(root, 'stash@{7}')
    expect(dropped.ok).toBe(false)
    expect(dropped.message).toBeTruthy()
  })

  // ⚠ `stash apply` 도 병합을 돌리므로 충돌 설명이 **stdout 으로만** 온다
  // (stderr 0바이트, exit 1, 실측). stderr 만 보면 무엇이 충돌했는지가 사라진다.
  it('복원 충돌 메시지가 git 원문 그대로 온다 (stdout 으로 오는 자리)', async () => {
    await commit('a.txt', 'base\n', '첫 커밋')
    await writeFile(join(root, 'a.txt'), '치워 둔 쪽\n')
    await stashPush(root, '하던 작업')
    // 같은 줄을 다르게 고쳐 커밋해 두면 복원이 충돌한다
    await commit('a.txt', '커밋된 쪽\n', '둘째 커밋')

    const result = await applyStash(root, 'stash@{0}')

    expect(result.ok).toBe(false)
    expect(result.message).toContain('CONFLICT')
    expect(result.message).toContain('a.txt')
    expect(result.message).not.toBe('git 명령이 실패했습니다')
  })

  it('내용 보기는 diff 원문을 준다', async () => {
    await commit('a.txt', 'one\n', '첫 커밋')
    await writeFile(join(root, 'a.txt'), 'one\ntwo\n')
    await stashPush(root, '하던 작업')

    const result = await showStash(root, 'stash@{0}')

    expect(result.ok).toBe(true)
    expect(result.diff).toContain('+two')
    expect(result.truncated).toBe(false)
  })

  // 실패해도 **화면이 기대하는 모양 그대로** 와야 한다. `diff`/`truncated` 가 빠지면
  // 목록에서 고른 것을 그리려던 화면이 undefined 를 읽는다.
  it('없는 스태시의 내용 보기는 빈 diff 와 사유로 온다', async () => {
    await commit('a.txt', 'base\n', '첫 커밋')

    const result = await showStash(root, 'stash@{7}')

    expect(result.ok).toBe(false)
    expect(result.diff).toBe('')
    expect(result.truncated).toBe(false)
    expect(result.message).toBeTruthy()
  })

  // 폴더 자체가 사라지면 git 은 **실행조차 안 된다** (spawn ENOENT, `GitResult.failed`).
  // 외장 드라이브를 빼거나 폴더를 지운 프로젝트 탭이 그대로 열려 있는 자리다 —
  // 던지면 패널이 통째로 죽는다.
  it('폴더가 사라진 저장소는 예외가 아니라 ok:false 로 온다', async () => {
    const gone = join(root, '사라진-폴더')

    const applied = await applyStash(gone, 'stash@{0}')
    expect(applied.ok).toBe(false)
    expect(applied.message).toBeTruthy()

    const list = await readStashes(gone)
    expect(list.ok).toBe(false)
    expect(list.stashes).toEqual([])
  })

  it('여러 줄 메시지로 저장해도 목록 레코드가 안 깨진다', async () => {
    await commit('a.txt', 'base\n', '첫 커밋')
    await writeFile(join(root, 'a.txt'), 'working\n')

    // git 이 reflog 제목을 한 줄로 이어 준다 (실측) — 줄 단위 레코드가 유지된다
    await stashPush(root, '따옴표 "x" 와\n둘째 줄')

    const list = await readStashes(root)
    expect(list.stashes).toHaveLength(1)
    expect(list.stashes[0]?.label).toContain('따옴표 "x" 와 둘째 줄')
  })
})

describe('stash list 파싱', () => {
  it('세 필드를 갈라 담는다', () => {
    const first = ['stash@{0}', '2026-07-31 10:00:00 +0900', 'On main: 하던 작업'].join('\0')
    const second = ['stash@{1}', '2026-07-30 09:00:00 +0900', 'WIP on main: 첫 커밋'].join('\0')
    expect(parseStashList(`${first}\n${second}`)).toEqual([
      { ref: 'stash@{0}', date: '2026-07-31 10:00:00 +0900', label: 'On main: 하던 작업' },
      { ref: 'stash@{1}', date: '2026-07-30 09:00:00 +0900', label: 'WIP on main: 첫 커밋' },
    ])
  })

  it('빈 출력은 빈 배열이다', () => {
    expect(parseStashList('')).toEqual([])
  })
})
