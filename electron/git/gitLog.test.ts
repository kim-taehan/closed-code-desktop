import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runGit } from './gitRunner'
import { readCommitDetail, readCommitPage, parseShowNumstat } from './gitLog'

// 진짜 저장소로 돈다. 흉내 낸 출력으로는 "커밋이 없는 저장소에서 log 가 실패한다"
// 같은 자리를 못 잡는다 — 그게 이 파일에서 가장 조심할 분기다.

describe('커밋 히스토리', () => {
  let root = ''

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'davis-log-')))
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

  it('커밋 3개가 최신순으로 오고 필드가 맞는다', async () => {
    await commit('a.txt', 'one\n', '첫 커밋')
    await commit('b.txt', 'two\n', '둘째 커밋')
    await commit('c.txt', 'three\n', '셋째 커밋')

    const page = await readCommitPage(root)

    expect(page.ok).toBe(true)
    expect(page.hasMore).toBe(false)
    expect(page.commits.map((entry) => entry.subject)).toEqual([
      '셋째 커밋',
      '둘째 커밋',
      '첫 커밋',
    ])

    const head = page.commits[0]
    expect(head?.hash).toMatch(/^[0-9a-f]{40}$/)
    expect(head?.shortHash).toBe(head?.hash.slice(0, head.shortHash.length))
    expect(head?.author).toBe('테스트')
    // %aI 는 ISO 8601. UTC 커밋이면 오프셋 자리에 'Z' 가 오므로 둘 다 받는다
    // (KST 개발기에서는 +09:00, UTC 인 CI 러너에서는 Z 가 나온다).
    expect(head?.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/)
    // %D 라벨 — 화면의 HEAD 배지가 여기서 나온다
    expect(head?.refs).toContain('HEAD -> main')
    // 라벨이 없는 커밋은 빈 배열이어야 한다 (빈 %D 를 걸러내면 필드가 밀린다)
    expect(page.commits[1]?.refs).toEqual([])
  })

  // 구분자를 깨뜨릴 만한 것을 한 메시지에 몰아 넣는다.
  it('따옴표·줄바꿈·탭·한글이 든 메시지도 레코드를 안 깬다', async () => {
    await commit('a.txt', 'x\n', '첫 커밋')
    await commit('b.txt', 'y\n', '따옴표 "x" 와\t탭\n둘째 줄')

    const page = await readCommitPage(root)

    expect(page.ok).toBe(true)
    expect(page.commits).toHaveLength(2)
    // %s 는 여러 줄을 공백으로 이어 한 줄로 준다 (git 실측)
    expect(page.commits[0]?.subject).toBe('따옴표 "x" 와\t탭 둘째 줄')
    expect(page.commits[1]?.subject).toBe('첫 커밋')
  })

  // 첫 커밋 전에는 log 가 exit 128 로 실패한다. 오류가 아니라 정상 상태다.
  it('커밋이 하나도 없으면 빈 목록이고 실패가 아니다', async () => {
    const page = await readCommitPage(root)

    expect(page.ok).toBe(true)
    expect(page.commits).toEqual([])
    expect(page.hasMore).toBe(false)
    expect(page.message).toBeUndefined()
  })

  it('저장소가 아니면 ok:false 에 git 메시지가 실린다', async () => {
    const plain = await realpath(await mkdtemp(join(tmpdir(), 'davis-nogit-')))
    try {
      const page = await readCommitPage(plain)
      expect(page.ok).toBe(false)
      expect(page.message).toBeTruthy()
    } finally {
      await rm(plain, { recursive: true, force: true })
    }
  })

  // 폴더가 사라지면 git 은 **실행조차 안 된다** (spawn ENOENT) — 저장소가 아닌 폴더와
  // 다른 앞단 경로다. 여기서 던지면 히스토리 탭이 통째로 죽고, 빈 목록으로 삼키면
  // "커밋이 없는 저장소" 와 구분이 사라진다.
  it('폴더가 사라지면 예외 대신 ok:false 로 오고 목록 모양은 지킨다', async () => {
    const page = await readCommitPage(join(root, '사라진-폴더'))

    expect(page.ok).toBe(false)
    expect(page.commits).toEqual([])
    expect(page.hasMore).toBe(false)
    expect(page.message).toBeTruthy()
  })

  it('페이징 — skip 으로 밀리고 더 있으면 hasMore 가 선다', async () => {
    await commit('a.txt', '1\n', 'c1')
    await commit('b.txt', '2\n', 'c2')
    await commit('c.txt', '3\n', 'c3')

    const first = await readCommitPage(root, 0, 2)
    expect(first.commits.map((entry) => entry.subject)).toEqual(['c3', 'c2'])
    // 한 개를 더 물어보고 버리는 방식이라, 넘겨받은 목록은 정확히 maxCount 다
    expect(first.commits).toHaveLength(2)
    expect(first.hasMore).toBe(true)

    const second = await readCommitPage(root, 2, 2)
    expect(second.commits.map((entry) => entry.subject)).toEqual(['c1'])
    expect(second.hasMore).toBe(false)
  })

  it('커밋 상세에 파일 목록과 diff 가 온다', async () => {
    await commit('a.txt', 'one\ntwo\n', '첫 커밋')
    await writeFile(join(root, 'a.txt'), 'one\ntwo\nthree\n')
    await writeFile(join(root, 'b.txt'), 'new\n')
    await runGit(['add', '-A'], root)
    await runGit(['commit', '-m', '둘째 커밋'], root)

    const result = await readCommitDetail(root, 'HEAD')

    expect(result.ok).toBe(true)
    expect(result.detail?.commit.subject).toBe('둘째 커밋')
    expect(result.detail?.files).toEqual([
      { path: 'a.txt', insertions: 1, deletions: 0 },
      { path: 'b.txt', insertions: 1, deletions: 0 },
    ])
    expect(result.detail?.diff).toContain('+three')
    expect(result.detail?.truncated).toBe(false)
  })

  it('첫 커밋(부모 없음)의 상세도 파일이 다 온다', async () => {
    await commit('a.txt', 'one\ntwo\n', '첫 커밋')

    const result = await readCommitDetail(root, 'HEAD')

    expect(result.ok).toBe(true)
    expect(result.detail?.files).toEqual([{ path: 'a.txt', insertions: 2, deletions: 0 }])
  })

  // ⚠ 병합 커밋의 패치를 git 은 기본으로 `--cc`(합친 diff)로 내는데, 충돌 없이
  // 합쳐진 병합은 그 결과가 **0바이트**다. 파일 목록만 있고 diff 창이 비면
  // 화면은 "바뀐 게 없다" 로 읽는다 — 잘린 것도 아니라 안내할 근거도 없다.
  it('병합 커밋 상세의 diff 가 파일 목록과 어긋나지 않는다', async () => {
    await commit('a.txt', 'base\n', '첫 커밋')
    await runGit(['switch', '--create', 'side'], root)
    await commit('side.txt', 'side\n', 'side 커밋')
    await runGit(['switch', 'main'], root)
    await commit('m.txt', 'main\n', 'main 커밋')
    await runGit(['merge', '--no-edit', 'side'], root)

    const result = await readCommitDetail(root, 'HEAD')

    expect(result.ok).toBe(true)
    expect(result.detail?.files).toEqual([{ path: 'side.txt', insertions: 1, deletions: 0 }])
    // 파일이 있다고 했으면 diff 도 있어야 한다
    expect(result.detail?.diff).not.toBe('')
    expect(result.detail?.diff).toContain('side.txt')
    expect(result.detail?.diff).toContain('+side')
    expect(result.detail?.truncated).toBe(false)
  })

  // 첫 부모 기준 diff 는 그 병합이 데려온 변경 **전부**라 커진다 (이 레포 PR 병합
  // 실측 6.6~59.9KB). 100KB 상한에 닿는 병합이 나오면 조용히 자르면 안 된다 —
  // 잘린 diff 를 "이 병합은 여기까지" 로 읽으면 안 보고 넘어가는 파일이 생긴다.
  it('상한을 넘는 병합은 잘린 것을 숨기지 않는다', async () => {
    await commit('a.txt', 'base\n', '첫 커밋')
    await runGit(['switch', '--create', 'side'], root)
    const big = Array.from({ length: 12_000 }, (_, index) => `side line ${index}`).join('\n')
    await commit('big.txt', `${big}\n`, 'side 큰 커밋')
    await runGit(['switch', 'main'], root)
    await commit('m.txt', 'main\n', 'main 커밋')
    await runGit(['merge', '--no-edit', 'side'], root)

    const result = await readCommitDetail(root, 'HEAD')

    expect(result.ok).toBe(true)
    expect(result.detail?.diff).not.toBe('')
    expect(result.detail?.truncated).toBe(true)
  })

  it('없는 커밋은 ok:false 에 git 메시지가 실린다', async () => {
    await commit('a.txt', 'x\n', '첫 커밋')

    const result = await readCommitDetail(root, 'deadbee')
    expect(result.ok).toBe(false)
    expect(result.message).toBeTruthy()
    expect(result.detail).toBeUndefined()
  })

  it('이름 바뀜은 옛 경로를 달고, 바이너리는 줄 수 없이 남는다', async () => {
    await writeFile(join(root, 'a.txt'), 'one\ntwo\nthree\n')
    await writeFile(join(root, 'bin.dat'), Buffer.from([0, 1, 2, 3]))
    await runGit(['add', '-A'], root)
    await runGit(['commit', '-m', '첫 커밋'], root)

    await runGit(['mv', 'a.txt', 'b.txt'], root)
    await writeFile(join(root, 'b.txt'), 'one\ntwo\nthree\nfour\n')
    await writeFile(join(root, 'bin.dat'), Buffer.from([0, 9, 9, 9, 9]))
    await runGit(['add', '-A'], root)
    await runGit(['commit', '-m', '이름 바꾸고 수정'], root)

    const result = await readCommitDetail(root, 'HEAD')

    expect(result.ok).toBe(true)
    const files = result.detail?.files ?? []
    expect(files).toContainEqual({
      path: 'b.txt',
      oldPath: 'a.txt',
      insertions: 1,
      deletions: 0,
    })
    // 바이너리를 통째로 빼면 "PNG 하나만 바꾼 커밋" 이 파일 0개로 보인다.
    // 항목은 남기되 줄 수는 없다 (0 이 아니다 — 0 은 "안 바뀜" 으로 읽힌다).
    expect(files).toContainEqual({ path: 'bin.dat' })
  })
})

describe('show --numstat -z 파싱', () => {
  it('이름 바뀜 뒤 레코드가 밀리지 않는다', () => {
    // `1\t0\t\0old\0new\0` 다음에 평범한 레코드가 이어지는 실제 모양
    const stdout = '1\t0\t\0a.txt\0b.txt\0' + '3\t2\tc.txt\0'
    expect(parseShowNumstat(stdout)).toEqual([
      { path: 'b.txt', oldPath: 'a.txt', insertions: 1, deletions: 0 },
      { path: 'c.txt', insertions: 3, deletions: 2 },
    ])
  })

  it('빈 출력은 빈 배열이다', () => {
    expect(parseShowNumstat('')).toEqual([])
  })
})
