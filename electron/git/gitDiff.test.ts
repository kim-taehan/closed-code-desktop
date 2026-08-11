import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runGit } from './gitRunner'
import { readGitDiff } from './gitDiff'
import { parseUnifiedDiff } from '../../src/state/unifiedDiff'

// diff 텍스트를 손으로 쓰지 않는다. **진짜 git 이 뱉은 것**을 파서에 먹인다 —
// unified 형식은 우리가 정한 게 아니라서, 흉내 낸 것에 맞추면 진짜 앞에서 깨진다.

describe('git diff', () => {
  let root = ''

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'davis-diff-')))
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

  it('고친 줄이 add·del·context 로 펴진다', async () => {
    await writeFile(join(root, 'a.txt'), 'one\ntwo\nthree\n')
    await commit('첫 커밋')
    await writeFile(join(root, 'a.txt'), 'one\nTWO\nthree\n')

    const result = await readGitDiff(root, 'a.txt', false)
    expect(result.ok).toBe(true)

    const rows = parseUnifiedDiff(result.diff)
    expect(rows.filter((row) => row.kind === 'del').map((row) => row.text)).toEqual(['two'])
    expect(rows.filter((row) => row.kind === 'add').map((row) => row.text)).toEqual(['TWO'])
    expect(rows.filter((row) => row.kind === 'context').map((row) => row.text)).toEqual([
      'one',
      'three',
    ])
  })

  // hunk 헤더가 줄 번호의 유일한 근거다. 세어서 맞추면 어긋난다.
  it('줄 번호가 hunk 헤더를 따른다', async () => {
    const lines = Array.from({ length: 40 }, (_, index) => `line${index + 1}`)
    await writeFile(join(root, 'a.txt'), `${lines.join('\n')}\n`)
    await commit('첫 커밋')

    lines[29] = 'CHANGED'
    await writeFile(join(root, 'a.txt'), `${lines.join('\n')}\n`)

    const rows = parseUnifiedDiff((await readGitDiff(root, 'a.txt', false)).diff)
    const added = rows.find((row) => row.kind === 'add')
    const deleted = rows.find((row) => row.kind === 'del')

    expect(added?.newLine).toBe(30)
    expect(deleted?.oldLine).toBe(30)
  })

  it('떨어진 hunk 사이에는 gap 이 들어간다', async () => {
    const lines = Array.from({ length: 60 }, (_, index) => `line${index + 1}`)
    await writeFile(join(root, 'a.txt'), `${lines.join('\n')}\n`)
    await commit('첫 커밋')

    lines[4] = '앞쪽 변경'
    lines[54] = '뒤쪽 변경'
    await writeFile(join(root, 'a.txt'), `${lines.join('\n')}\n`)

    const rows = parseUnifiedDiff((await readGitDiff(root, 'a.txt', false)).diff)
    expect(rows.filter((row) => row.kind === 'gap')).toHaveLength(1)
  })

  it('스테이지됨과 변경사항은 서로 다른 것을 보여준다', async () => {
    await writeFile(join(root, 'a.txt'), 'base\n')
    await commit('첫 커밋')

    await writeFile(join(root, 'a.txt'), 'staged\n')
    await runGit(['add', 'a.txt'], root)
    await writeFile(join(root, 'a.txt'), 'working\n')

    const staged = parseUnifiedDiff((await readGitDiff(root, 'a.txt', true)).diff)
    const unstaged = parseUnifiedDiff((await readGitDiff(root, 'a.txt', false)).diff)

    // 담긴 것: base → staged
    expect(staged.filter((row) => row.kind === 'add').map((row) => row.text)).toEqual(['staged'])
    // 아직 안 담은 것: staged → working
    expect(unstaged.filter((row) => row.kind === 'del').map((row) => row.text)).toEqual(['staged'])
    expect(unstaged.filter((row) => row.kind === 'add').map((row) => row.text)).toEqual(['working'])
  })

  it('새로 담은 파일은 전부 추가로 나온다', async () => {
    await writeFile(join(root, 'a.txt'), 'x\n')
    await commit('첫 커밋')
    await writeFile(join(root, 'new.txt'), 'hello\nworld\n')
    await runGit(['add', 'new.txt'], root)

    const rows = parseUnifiedDiff((await readGitDiff(root, 'new.txt', true)).diff)
    expect(rows.map((row) => row.text)).toEqual(['hello', 'world'])
    expect(rows.every((row) => row.kind === 'add')).toBe(true)
  })

  // 빈 화면을 주면 "변경이 없다" 로 오해한다
  it('추적 안 되는 파일은 내용을 그대로 보여준다', async () => {
    await writeFile(join(root, 'a.txt'), 'x\n')
    await commit('첫 커밋')
    await writeFile(join(root, '새파일.txt'), '한 줄\n두 줄\n')

    const result = await readGitDiff(root, '새파일.txt', false)
    expect(result.ok).toBe(true)
    expect(result.untracked).toBe(true)
    expect(result.diff).toBe('한 줄\n두 줄\n')
  })

  // "diff 가 비었다" 를 추적 안 됨의 근거로 쓰면, 변경 없는 추적 파일이 통째로
  // "새 파일" 로 그려진다. 빈 것과 없는 것을 갈라야 한다.
  it('변경 없는 추적 파일은 빈 diff 다 — 내용을 보내지 않는다', async () => {
    await writeFile(join(root, 'a.txt'), 'one\ntwo\n')
    await commit('첫 커밋')

    const result = await readGitDiff(root, 'a.txt', false)

    expect(result.ok).toBe(true)
    expect(result.diff).toBe('')
    expect(result.untracked).toBeUndefined()
  })

  // hunk 흐름이 새로 여는 자리 — 마지막 덩어리까지 담으면 unstaged diff 가 빈다
  it('마지막 덩어리까지 담은 직후 다시 읽어도 파일 전체가 오지 않는다', async () => {
    await writeFile(join(root, 'a.txt'), 'one\ntwo\n')
    await commit('첫 커밋')
    await writeFile(join(root, 'a.txt'), 'one\nTWO\n')
    await runGit(['add', 'a.txt'], root)

    const result = await readGitDiff(root, 'a.txt', false)

    expect(result.ok).toBe(true)
    expect(result.diff).toBe('')
    expect(result.untracked).toBeUndefined()
  })

  // 실패는 **빈 diff 로 삼키지 않는다.** 빈 diff 는 "변경이 없다" 로 그려져,
  // 못 읽었다는 사실이 화면에서 사라진다.
  it('저장소가 아니거나 폴더가 사라지면 사유를 달고 거절한다', async () => {
    const plain = await realpath(await mkdtemp(join(tmpdir(), 'davis-nodiff-')))
    try {
      const notRepo = await readGitDiff(plain, 'a.txt', false)
      expect(notRepo.ok).toBe(false)
      expect(notRepo.diff).toBe('')
      expect(notRepo.reason).toBeTruthy()
    } finally {
      await rm(plain, { recursive: true, force: true })
    }

    // 폴더 자체가 사라지면 git 은 실행조차 안 된다 (spawn ENOENT) — 앞단 경로가 다르다
    const gone = await readGitDiff(join(root, '사라진-폴더'), 'a.txt', false)
    expect(gone.ok).toBe(false)
    expect(gone.reason).toBeTruthy()
  })

  // 상태를 읽은 뒤 클릭 전에 파일이 지워질 수 있다. 추적 안 되는 파일은 내용을 읽어
  // 보여 주는데, 그 읽기가 실패하면 **사유를 그대로** 넘긴다 (빈 화면이 아니라).
  it('추적 안 되던 파일이 그 사이 사라지면 사유를 달고 거절한다', async () => {
    await writeFile(join(root, 'a.txt'), 'base\n')
    await commit('첫 커밋')
    // 인덱스에도 HEAD 에도 없는 경로 — diff 는 비고 ls-files 도 비어 내용 읽기로 간다
    const result = await readGitDiff(root, '방금-지워진.txt', false)

    expect(result.ok).toBe(false)
    expect(result.diff).toBe('')
    expect(result.reason).toBeTruthy()
  })

  // 메타 줄이라 줄 번호를 올리면 안 된다
  it('끝에 개행이 없어도 줄 번호가 밀리지 않는다', async () => {
    await writeFile(join(root, 'a.txt'), 'one\ntwo')
    await commit('첫 커밋')
    await writeFile(join(root, 'a.txt'), 'one\nTWO')

    const rows = parseUnifiedDiff((await readGitDiff(root, 'a.txt', false)).diff)
    expect(rows.find((row) => row.kind === 'add')?.newLine).toBe(2)
    expect(rows.some((row) => row.text.startsWith('\\'))).toBe(false)
  })
})
