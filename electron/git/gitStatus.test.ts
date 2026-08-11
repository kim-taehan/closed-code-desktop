import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runGit } from './gitRunner'
import { readGitState } from './gitStatus'

// **진짜 저장소를 상대로 돈다.** porcelain 출력 형식은 우리가 정한 것이 아니라서,
// 흉내 낸 문자열에 맞춰 파싱하면 진짜 git 앞에서 깨진다.
// `electron/projects/projectFs.test.ts` 의 mkdtemp + realpath 패턴을 그대로 쓴다.

describe('git 상태 읽기', () => {
  let root = ''

  beforeEach(async () => {
    // macOS 의 /var → /private/var 때문에 realpath 를 거쳐야 경로가 어긋나지 않는다
    root = await realpath(await mkdtemp(join(tmpdir(), 'davis-git-')))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function init(): Promise<void> {
    await runGit(['init', '-b', 'main'], root)
    await runGit(['config', 'user.email', 'test@example.com'], root)
    await runGit(['config', 'user.name', '테스트'], root)
  }

  async function commitAll(message: string): Promise<void> {
    await runGit(['add', '-A'], root)
    await runGit(['commit', '-m', message], root)
  }

  it('.git 이 없으면 저장소가 아니다', async () => {
    const state = await readGitState(root)

    expect(state.isRepo).toBe(false)
    expect(state.branch).toBeNull()
  })

  it('커밋이 하나도 없어도 브랜치를 읽는다', async () => {
    await init()
    const state = await readGitState(root)

    expect(state.isRepo).toBe(true)
    expect(state.branch).toBe('main')
    expect(state.upstream).toBeNull()
  })

  it('고친 파일은 변경사항에, 담은 파일은 스테이지됨에 들어간다', async () => {
    await init()
    await writeFile(join(root, 'a.txt'), '처음')
    await commitAll('첫 커밋')

    await writeFile(join(root, 'a.txt'), '고침')
    const before = await readGitState(root)
    expect(before.unstaged).toEqual([{ path: 'a.txt', status: 'modified' }])
    expect(before.staged).toEqual([])

    await runGit(['add', 'a.txt'], root)
    const after = await readGitState(root)
    expect(after.staged).toEqual([{ path: 'a.txt', status: 'modified' }])
    expect(after.unstaged).toEqual([])
  })

  // 억지로 한쪽에 몰면 사실과 어긋난다 — git 이 실제로 양쪽에 두는 상태다
  it('담은 뒤 또 고치면 양쪽에 모두 나온다', async () => {
    await init()
    await writeFile(join(root, 'a.txt'), '처음')
    await commitAll('첫 커밋')

    await writeFile(join(root, 'a.txt'), '한 번')
    await runGit(['add', 'a.txt'], root)
    await writeFile(join(root, 'a.txt'), '두 번')

    const state = await readGitState(root)
    expect(state.staged).toEqual([{ path: 'a.txt', status: 'modified' }])
    expect(state.unstaged).toEqual([{ path: 'a.txt', status: 'modified' }])
  })

  it('추적 안 되는 파일은 변경사항에 ? 로 들어간다', async () => {
    await init()
    await writeFile(join(root, '새파일.txt'), '내용')

    const state = await readGitState(root)
    expect(state.unstaged).toEqual([{ path: '새파일.txt', status: 'untracked' }])
    expect(state.staged).toEqual([])
  })

  it('이름이 바뀌면 옛 경로도 함께 온다', async () => {
    await init()
    await writeFile(join(root, 'old.txt'), '내용')
    await commitAll('첫 커밋')
    await runGit(['mv', 'old.txt', 'new.txt'], root)

    const state = await readGitState(root)
    expect(state.staged).toEqual([{ path: 'new.txt', status: 'renamed', oldPath: 'old.txt' }])
  })

  it('삭제도 잡는다', async () => {
    await init()
    await writeFile(join(root, 'a.txt'), '내용')
    await commitAll('첫 커밋')
    await rm(join(root, 'a.txt'))

    const state = await readGitState(root)
    expect(state.unstaged).toEqual([{ path: 'a.txt', status: 'deleted' }])
  })

  // -z 를 쓰는 이유가 여기 있다. 없으면 git 이 이름을 따옴표로 감싸고 이스케이프한다.
  it('공백·따옴표·한글이 든 파일명도 그대로 읽는다', async () => {
    await init()
    const names = ['이름 with 공백.txt', '"따옴표".txt', '한글파일.txt', '백슬래시\\.txt']
    for (const name of names) await writeFile(join(root, name), '내용')

    const state = await readGitState(root)
    expect(state.unstaged.map((entry) => entry.path).sort()).toEqual([...names].sort())
  })

  it('하위 폴더 경로는 루트 상대로 온다 — 파일 트리와 같은 형태여야 맞물린다', async () => {
    await init()
    await mkdir(join(root, 'src', 'deep'), { recursive: true })
    await writeFile(join(root, 'src', 'deep', 'a.ts'), '내용')

    const state = await readGitState(root)
    expect(state.unstaged).toEqual([{ path: 'src/deep/a.ts', status: 'untracked' }])
  })

  it('충돌은 담을 수 없으므로 변경사항에만 둔다', async () => {
    await init()
    await writeFile(join(root, 'a.txt'), '바탕')
    await commitAll('바탕')

    await runGit(['switch', '-c', '옆가지'], root)
    await writeFile(join(root, 'a.txt'), '옆가지 쪽')
    await commitAll('옆가지')

    await runGit(['switch', 'main'], root)
    await writeFile(join(root, 'a.txt'), '본가지 쪽')
    await commitAll('본가지')

    await runGit(['merge', '옆가지'], root)

    const state = await readGitState(root)
    expect(state.unstaged).toEqual([{ path: 'a.txt', status: 'conflicted' }])
    expect(state.staged).toEqual([])
  })

  it('업스트림이 있으면 이름과 ahead 를 읽는다', async () => {
    const origin = await realpath(await mkdtemp(join(tmpdir(), 'davis-git-origin-')))
    try {
      await runGit(['init', '--bare', '-b', 'main'], origin)
      await init()
      await writeFile(join(root, 'a.txt'), '내용')
      await commitAll('첫 커밋')
      await runGit(['remote', 'add', 'origin', origin], root)
      await runGit(['push', '-u', 'origin', 'main'], root)

      const pushed = await readGitState(root)
      expect(pushed.upstream).toBe('origin/main')
      expect(pushed.ahead).toBe(0)
      expect(pushed.behind).toBe(0)

      await writeFile(join(root, 'b.txt'), '내용')
      await commitAll('두 번째')

      const ahead = await readGitState(root)
      expect(ahead.ahead).toBe(1)
      expect(ahead.behind).toBe(0)
    } finally {
      await rm(origin, { recursive: true, force: true })
    }
  })
})
