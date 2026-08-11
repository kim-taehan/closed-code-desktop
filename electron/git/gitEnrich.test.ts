import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runGit } from './gitRunner'
import { readEnrichedGitState } from './gitEnrich'
import type { GitFileEntry } from '../../shared/git/gitState'

// 진짜 저장소를 만들어 돌린다. 조립이 맞았는지는 status·numstat·충돌 셋의 **키가
// 서로 맞물리는지**의 문제라, 하나라도 가짜로 바꾸면 확인하려던 것이 사라진다.

describe('git 상태 + 줄 수 + 충돌 개수 조립', () => {
  let root = ''

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'davis-enrich-')))
    await runGit(['init', '-b', 'main'], root)
    await runGit(['config', 'user.email', 'test@example.com'], root)
    await runGit(['config', 'user.name', '시험'], root)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function commitAll(message: string): Promise<void> {
    await runGit(['add', '-A'], root)
    await runGit(['commit', '-m', message], root)
  }

  function find(entries: GitFileEntry[], path: string): GitFileEntry | undefined {
    return entries.find((entry) => entry.path === path)
  }

  it('수정·추가·삭제·추적안됨에 수치를 채운다', async () => {
    await writeFile(join(root, 'edit.txt'), 'a\nb\nc\n')
    await writeFile(join(root, 'gone.txt'), 'x\ny\n')
    await commitAll('첫 커밋')

    await writeFile(join(root, 'edit.txt'), 'a\nB\nc\nd\n') // −1 +2
    await unlink(join(root, 'gone.txt')) // −2
    await writeFile(join(root, 'new.txt'), '1\n2\n3\n') // 추적 안 됨 +3
    await writeFile(join(root, 'staged.txt'), 'p\nq\n')
    await runGit(['add', 'staged.txt'], root) // 담김 +2

    const state = await readEnrichedGitState(root)

    expect(find(state.unstaged, 'edit.txt')).toMatchObject({ insertions: 2, deletions: 1 })
    expect(find(state.unstaged, 'gone.txt')).toMatchObject({ insertions: 0, deletions: 2 })
    // numstat 이 안 내는 자리 — 넘겨주지 않으면 조용히 비는 곳이다
    expect(find(state.unstaged, 'new.txt')).toMatchObject({ insertions: 3, deletions: 0 })
    expect(find(state.staged, 'staged.txt')).toMatchObject({ insertions: 2, deletions: 0 })
  })

  it('담긴 것과 안 담긴 것을 각각 제 묶음의 수치로 채운다 — 같은 파일이라도 다르다', async () => {
    await writeFile(join(root, 'both.txt'), 'a\n')
    await commitAll('첫 커밋')

    await writeFile(join(root, 'both.txt'), 'a\nb\n') // +1 담고
    await runGit(['add', 'both.txt'], root)
    await writeFile(join(root, 'both.txt'), 'a\nb\nc\nd\n') // 또 +2 안 담음

    const state = await readEnrichedGitState(root)

    expect(find(state.staged, 'both.txt')).toMatchObject({ insertions: 1, deletions: 0 })
    expect(find(state.unstaged, 'both.txt')).toMatchObject({ insertions: 2, deletions: 0 })
  })

  // status 는 `-z` 에서 새 이름 다음 조각에 옛 이름을, numstat 은 빈 칸 뒤에 조각 둘을 낸다.
  // **두 파서가 같은 키(새 이름)로 맞물려야** 이름 바뀐 행에 수치가 실린다.
  it('이름 바뀐 파일도 새 이름 쪽에 수치가 실린다', async () => {
    await writeFile(join(root, 'old.txt'), 'a\nb\nc\n')
    await commitAll('첫 커밋')

    await runGit(['mv', 'old.txt', 'new.txt'], root)
    await writeFile(join(root, 'new.txt'), 'a\nb\nc\nd\n')
    await runGit(['add', 'new.txt'], root)

    const state = await readEnrichedGitState(root)
    const entry = find(state.staged, 'new.txt')

    expect(entry?.status).toBe('renamed')
    expect(entry?.oldPath).toBe('old.txt')
    expect(entry).toMatchObject({ insertions: 1, deletions: 0 })
  })

  it('바이너리는 수치 필드를 아예 안 단다 — 0 은 "안 바뀜" 이라 뜻이 다르다', async () => {
    await writeFile(join(root, 'seed.txt'), 'a\n')
    await commitAll('첫 커밋')
    await writeFile(join(root, 'bin.dat'), Buffer.from([120, 0, 121]))

    const state = await readEnrichedGitState(root)
    const entry = find(state.unstaged, 'bin.dat')

    expect(entry?.status).toBe('untracked')
    expect(entry).not.toHaveProperty('insertions')
    expect(entry).not.toHaveProperty('deletions')
  })

  it('충돌 파일에 충돌 지점 개수를 단다', async () => {
    // 양 끝만 서로 다르게 고친다. 가운데 여백이 좁으면 git 이 두 자리를 한 덩어리로
    // 합쳐 버려 개수가 1 이 된다 (실측) — 실제 화면에서 세는 것은 합쳐진 뒤의 개수다.
    const lines = (head: string, tail: string): string =>
      [head, ...Array.from({ length: 20 }, (_, at) => `가운데${at}`), tail].join('\n').concat('\n')

    await writeFile(join(root, 'c.txt'), lines('처음', '끝'))
    await commitAll('첫 커밋')

    await runGit(['switch', '-c', 'other'], root)
    await writeFile(join(root, 'c.txt'), lines('저쪽처음', '저쪽끝'))
    await commitAll('저쪽')

    await runGit(['switch', 'main'], root)
    await writeFile(join(root, 'c.txt'), lines('이쪽처음', '이쪽끝'))
    await commitAll('이쪽')
    await runGit(['merge', 'other'], root)

    const state = await readEnrichedGitState(root)
    const entry = find(state.unstaged, 'c.txt')

    expect(entry?.status).toBe('conflicted')
    expect(entry?.conflictCount).toBe(2)
  })

  it('충돌이 없으면 conflictCount 를 아무 행에도 안 단다', async () => {
    await writeFile(join(root, 'plain.txt'), 'a\n')

    const state = await readEnrichedGitState(root)

    for (const entry of [...state.staged, ...state.unstaged]) {
      expect(entry).not.toHaveProperty('conflictCount')
    }
  })

  it('저장소가 아니면 원래 상태를 그대로 돌려준다', async () => {
    const plain = await realpath(await mkdtemp(join(tmpdir(), 'davis-enrich-no-')))
    try {
      const state = await readEnrichedGitState(plain)

      expect(state.isRepo).toBe(false)
      expect(state.unstaged).toEqual([])
    } finally {
      await rm(plain, { recursive: true, force: true })
    }
  })
})
