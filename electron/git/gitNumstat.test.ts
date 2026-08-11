import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runGit } from './gitRunner'
import { readNumstat } from './gitNumstat'

// 진짜 저장소로 잰다. 흉내 낸 numstat 출력은 -z 의 이름바뀜 3필드 모양이나
// 바이너리 `-\t-` 를 실제로 검증하지 못한다.

describe('git 줄 수(numstat)', () => {
  let root = ''

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'davis-num-')))
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

  it('수정한 파일의 추가·삭제 줄 수가 온다', async () => {
    await writeFile(join(root, 'a.txt'), 'one\ntwo\nthree\n')
    await commit('첫 커밋')
    // two 를 지우고 넷을 더한다 → +4 −1
    await writeFile(join(root, 'a.txt'), 'one\nthree\nfour\nfive\nsix\nseven\n')

    const { unstaged } = await readNumstat(root)

    expect(unstaged.get('a.txt')).toEqual({ insertions: 4, deletions: 1 })
  })

  it('담은 것과 안 담은 것이 갈린다 — 같은 파일이라도 수치가 다르다', async () => {
    await writeFile(join(root, 'a.txt'), 'base\n')
    await commit('첫 커밋')
    await writeFile(join(root, 'a.txt'), 'base\nstaged\n')
    await runGit(['add', '--', 'a.txt'], root)
    await writeFile(join(root, 'a.txt'), 'base\nstaged\nworking\n')

    const { staged, unstaged } = await readNumstat(root)

    expect(staged.get('a.txt')).toEqual({ insertions: 1, deletions: 0 })
    expect(unstaged.get('a.txt')).toEqual({ insertions: 1, deletions: 0 })
  })

  it('삭제한 파일은 삭제 줄만 온다', async () => {
    await writeFile(join(root, 'a.txt'), 'one\ntwo\n')
    await commit('첫 커밋')
    await unlink(join(root, 'a.txt'))

    const { unstaged } = await readNumstat(root)

    expect(unstaged.get('a.txt')).toEqual({ insertions: 0, deletions: 2 })
  })

  // -z 에서 이름바뀜은 세 번째 칸이 비고 옛 이름·새 이름이 조각 둘로 뒤따른다.
  // 이 모양을 못 읽으면 뒤따르는 파일까지 통째로 밀린다.
  it('이름 바뀜은 새 이름을 키로 잡고, 뒤 항목이 밀리지 않는다', async () => {
    await writeFile(join(root, 'old.txt'), 'one\ntwo\nthree\n')
    await writeFile(join(root, 'z.txt'), 'keep\n')
    await commit('첫 커밋')
    await runGit(['mv', 'old.txt', 'new.txt'], root)
    await writeFile(join(root, 'new.txt'), 'one\ntwo\nthree\nfour\n')
    await writeFile(join(root, 'z.txt'), 'keep\nmore\n')
    await runGit(['add', '-A'], root)

    const { staged } = await readNumstat(root)

    expect(staged.get('new.txt')).toEqual({ insertions: 1, deletions: 0 })
    expect(staged.has('old.txt')).toBe(false)
    // 이름바뀜 레코드를 한 조각으로 읽으면 여기가 어긋난다
    expect(staged.get('z.txt')).toEqual({ insertions: 1, deletions: 0 })
  })

  it('바이너리는 항목이 아예 없다 — +0 −0 으로 넣지 않는다', async () => {
    await writeFile(join(root, 'bin.dat'), Buffer.from([1, 2, 3]))
    await commit('첫 커밋')
    await writeFile(join(root, 'bin.dat'), Buffer.from([0, 1, 2, 3, 4, 5]))

    const { unstaged } = await readNumstat(root)

    expect(unstaged.has('bin.dat')).toBe(false)
  })

  it('공백·한글 파일명도 그대로 온다', async () => {
    await writeFile(join(root, '이름 with 공백.txt'), 'one\n')
    await commit('첫 커밋')
    await writeFile(join(root, '이름 with 공백.txt'), 'one\ntwo\n')

    const { unstaged } = await readNumstat(root)

    expect(unstaged.get('이름 with 공백.txt')).toEqual({ insertions: 1, deletions: 0 })
  })
})

// numstat 은 추적 안 되는 파일을 아예 내지 않는다. 사이드바의 `+402` 자리라
// 여기서 채워 넣는다. 수치가 `--no-index /dev/null <파일>` 과 같은지가 관건이다.
describe('git 줄 수 — 추적 안 되는 파일', () => {
  let root = ''

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'davis-numu-')))
    await runGit(['init', '-b', 'main'], root)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  /** git 이 세는 값. 직접 센 값이 이것과 어긋나면 화면 수치가 거짓말이 된다. */
  async function gitCounts(path: string): Promise<string> {
    const result = await runGit(['diff', '--numstat', '--no-index', '/dev/null', path], root)
    return (result.stdout.split('\t').slice(0, 2).join('\t') || '').trim()
  }

  it('새 파일은 전부 추가 줄이다', async () => {
    await writeFile(join(root, 'new.txt'), 'a\nb\nc\n')

    const { unstaged } = await readNumstat(root, ['new.txt'])

    expect(unstaged.get('new.txt')).toEqual({ insertions: 3, deletions: 0 })
    expect(await gitCounts('new.txt')).toBe('3\t0')
  })

  it('끝 개행이 없어도 마지막 줄을 센다', async () => {
    await writeFile(join(root, 'tail.txt'), 'a\nb')

    const { unstaged } = await readNumstat(root, ['tail.txt'])

    expect(unstaged.get('tail.txt')).toEqual({ insertions: 2, deletions: 0 })
    expect(await gitCounts('tail.txt')).toBe('2\t0')
  })

  it('빈 파일은 0 줄이다', async () => {
    await writeFile(join(root, 'empty.txt'), '')

    const { unstaged } = await readNumstat(root, ['empty.txt'])

    expect(unstaged.get('empty.txt')).toEqual({ insertions: 0, deletions: 0 })
    expect(await gitCounts('empty.txt')).toBe('0\t0')
  })

  it('CRLF 도 개행 기준으로 센다', async () => {
    await writeFile(join(root, 'crlf.txt'), 'a\r\nb\r\n')

    const { unstaged } = await readNumstat(root, ['crlf.txt'])

    expect(unstaged.get('crlf.txt')).toEqual({ insertions: 2, deletions: 0 })
    expect(await gitCounts('crlf.txt')).toBe('2\t0')
  })

  it('바이너리는 항목이 없다', async () => {
    await writeFile(join(root, 'bin.dat'), Buffer.from([120, 0, 121]))

    const { unstaged } = await readNumstat(root, ['bin.dat'])

    expect(unstaged.has('bin.dat')).toBe(false)
    expect(await gitCounts('bin.dat')).toBe('-\t-')
  })

  // git 은 앞 8000바이트만 훑는다. 그 뒤의 NUL 은 텍스트로 센다 — 우리도 같아야 한다.
  it('8000바이트 뒤의 NUL 은 바이너리로 보지 않는다 — git 과 같은 기준', async () => {
    const buffer = Buffer.concat([
      Buffer.alloc(9_000, 120),
      Buffer.from([0]),
      Buffer.from('\ntail\n'),
    ])
    await writeFile(join(root, 'late.bin'), buffer)

    const { unstaged } = await readNumstat(root, ['late.bin'])

    expect(unstaged.get('late.bin')?.insertions).toBe(2)
    expect(await gitCounts('late.bin')).toBe('2\t0')
  })

  it('없는 경로를 넘겨도 터지지 않고 항목만 빠진다', async () => {
    const { unstaged } = await readNumstat(root, ['없는파일.txt'])

    expect(unstaged.has('없는파일.txt')).toBe(false)
  })
})
