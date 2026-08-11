import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runGit } from './gitRunner'
import { splitHunks, joinHunk } from '../../shared/git/hunkSplit'
import { stageHunk, revertHunk } from './gitHunk'

// 진짜 저장소를 바꾼다. 흉내 내지 않는다 (`gitActions.test.ts` 와 같은 관행) —
// 인덱스와 워킹트리가 **실제로** 어떻게 갈라지는지가 이 기능의 전부다.
//
// 화면이 보내는 값은 `splitHunks`+`joinHunk` 로 만든다 — **화면이 부르는 바로 그
// 함수다** (`src/state/diffHunks.ts`). 이 파일이 초록이면 "화면이 그린 그대로 보낸
// 것을 main 이 받아들인다"가 실제 git 출력(끝 개행 없음·CRLF 포함)에서 성립한다.

describe('git 덩어리 담기·되돌리기', () => {
  let root = ''

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'davis-hunk-')))
    await runGit(['init', '-b', 'main'], root)
    await runGit(['config', 'user.email', 'test@example.com'], root)
    await runGit(['config', 'user.name', '테스트'], root)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function commitAll(message: string): Promise<void> {
    await runGit(['add', '-A'], root)
    await runGit(['commit', '-m', message], root)
  }

  /** 화면이 하는 일 — 지금 diff 를 **화면과 같은 규칙**으로 갈라 덩어리 원문을 집는다 */
  async function headers(path: string): Promise<string[]> {
    const diff = await runGit(['diff', '--no-color', '--', path], root)
    return splitHunks(diff.stdout).hunks.map(joinHunk)
  }

  /** 없으면 그 자리에서 터뜨린다 — 헤더가 없으면 그 케이스의 전제가 이미 깨진 것이다 */
  function at(list: string[], index: number): string {
    const value = list[index]
    if (value === undefined) throw new Error(`${index}번째 줄이 없다: ${JSON.stringify(list)}`)
    return value
  }

  async function stagedDiff(): Promise<string> {
    return (await runGit(['diff', '--staged', '--no-color'], root)).stdout
  }

  async function porcelain(): Promise<string> {
    return (await runGit(['status', '--porcelain'], root)).stdout
  }

  /** 30줄짜리 파일. 2·15·28 을 고치면 문맥 3줄 기준 덩어리가 정확히 3개 나온다 */
  async function writeThreeHunkFile(): Promise<string[]> {
    const base = Array.from({ length: 30 }, (_, n) => String(n + 1))
    await writeFile(join(root, 'a.txt'), `${base.join('\n')}\n`)
    await commitAll('첫 커밋')

    const changed = base.map((line) => (['2', '15', '28'].includes(line) ? `${line}-바뀜` : line))
    await writeFile(join(root, 'a.txt'), `${changed.join('\n')}\n`)
    return headers('a.txt')
  }

  // ── 1. 고른 덩어리만 인덱스로 간다 ────────────────────────────────────────

  it('덩어리 3개 중 두 번째만 담으면 그것만 인덱스에 들어간다', async () => {
    const heads = await writeThreeHunkFile()
    expect(heads).toHaveLength(3)

    expect(await stageHunk(root, 'a.txt', 1, at(heads, 1))).toEqual({ ok: true })

    const staged = await stagedDiff()
    expect(staged).toContain('-15\n+15-바뀜')
    // 나머지 둘은 인덱스에 없다 — 워킹트리에 남아 있어야 한다
    expect(staged).not.toContain('+2-바뀜')
    expect(staged).not.toContain('+28-바뀜')

    const rest = await headers('a.txt')
    expect(rest).toHaveLength(2)
    // 담긴 뒤에도 파일은 담기지 않은 변경을 그대로 들고 있다
    expect(await porcelain()).toBe('MM a.txt\n')
  })

  // ── 2. 안전선 — 헤더가 다르면 거절하고 저장소를 건드리지 않는다 ──────────

  it('헤더가 다르면 거절하고 저장소는 부르기 전과 똑같다', async () => {
    const heads = await writeThreeHunkFile()
    const before = { status: await porcelain(), staged: await stagedDiff() }

    // 화면이 diff 를 받은 뒤 파일이 바뀐 상황 — 헤더의 줄 번호가 어긋난다
    const result = await stageHunk(root, 'a.txt', 1, '@@ -999,7 +999,7 @@')

    expect(result.ok).toBe(false)
    expect(result.message).toContain('새로 고친')
    expect(await porcelain()).toBe(before.status)
    expect(await stagedDiff()).toBe(before.staged)
    // 헤더 대조 전에 이미 3개였고, 거절 뒤에도 3개다
    expect(await headers('a.txt')).toEqual(heads)
  })

  it('인덱스가 범위를 벗어나도 거절하고 저장소는 그대로다', async () => {
    const heads = await writeThreeHunkFile()
    const before = await porcelain()

    const result = await stageHunk(root, 'a.txt', 7, at(heads, 0))

    expect(result.ok).toBe(false)
    expect(result.message).toContain('새로 고친')
    expect(await porcelain()).toBe(before)
    expect(await stagedDiff()).toBe('')
  })

  it('되돌리기도 헤더가 다르면 파일을 건드리지 않는다', async () => {
    await writeThreeHunkFile()
    const before = await porcelain()

    const result = await revertHunk(root, 'a.txt', 0, '@@ -1,5 +1,5 @@ 다른 문맥')

    expect(result.ok).toBe(false)
    expect(await porcelain()).toBe(before)
    expect(await headers('a.txt')).toHaveLength(3)
  })

  // 머리는 같고 **그 덩어리 내용만** 바뀐 경우(QA 결함 D4)는 `gitHunkStale.test.ts` 에 있다.

  // ── 3. 되돌리기 ──────────────────────────────────────────────────────────

  it('되돌리면 그 덩어리만 워킹트리에서 사라진다', async () => {
    const heads = await writeThreeHunkFile()

    expect(await revertHunk(root, 'a.txt', 0, at(heads, 0))).toEqual({ ok: true })

    const rest = await headers('a.txt')
    expect(rest).toHaveLength(2)
    const diff = (await runGit(['diff', '--no-color', '--', 'a.txt'], root)).stdout
    expect(diff).not.toContain('+2-바뀜')
    expect(diff).toContain('+15-바뀜')
    expect(diff).toContain('+28-바뀜')
  })

  // 되돌리기 대상은 **워킹트리**다. 이미 담은 것은 인덱스에 그대로 남아야 한다.
  it('담은 뒤 나머지를 되돌려도 담은 것은 인덱스에 남는다', async () => {
    const heads = await writeThreeHunkFile()
    await stageHunk(root, 'a.txt', 1, at(heads, 1))

    // 담은 뒤 다시 읽으면 덩어리는 2개다 — 화면이 새로 받는 상태와 같다
    const after = await headers('a.txt')
    expect(await revertHunk(root, 'a.txt', 0, at(after, 0))).toEqual({ ok: true })
    expect(await revertHunk(root, 'a.txt', 0, at(await headers('a.txt'), 0))).toEqual({ ok: true })

    // 워킹트리는 인덱스와 같아졌고, 인덱스에는 담은 덩어리가 남아 있다
    expect(await headers('a.txt')).toEqual([])
    expect(await stagedDiff()).toContain('+15-바뀜')
    expect(await porcelain()).toBe('M  a.txt\n')
  })

  // ── 4. 잘린 diff 는 apply 를 시도조차 하지 않는다 ────────────────────────

  // `runGit` 은 stdout 100KB 에서 자르면서도 code 0 을 준다. 잘린 패치를 apply 하면
  // 뒷부분이 통째로 없어 파일이 망가진다 — 그래서 만들기 전에 멈춘다 (설계 결정 #3).
  it('잘린 diff 는 거절하고 인덱스를 건드리지 않는다', async () => {
    const base = Array.from({ length: 3000 }, (_, n) => `${'x'.repeat(40)}-${n}`)
    await writeFile(join(root, 'big.txt'), `${base.join('\n')}\n`)
    await commitAll('큰 파일')
    await writeFile(join(root, 'big.txt'), `${base.map((l) => `${l}-바뀜`).join('\n')}\n`)

    const raw = await runGit(['diff', '--no-color', '--', 'big.txt'], root)
    expect(raw.stdoutTruncated).toBe(true)

    const result = await stageHunk(root, 'big.txt', 0, at(raw.stdout.split('\n'), 4))

    expect(result.ok).toBe(false)
    expect(result.message).toContain('100KB')
    expect(await stagedDiff()).toBe('')
    expect(await porcelain()).toBe(' M big.txt\n')
  })

  // ── 5. 끝 개행 없음 ─────────────────────────────────────────────────────

  // `\ No newline at end of file` 을 흘리면 파일 끝에 개행이 하나 생겨 붙는다.
  // 눈에 안 보이는데 파일이 바뀌는 자리라 명시로 잠근다.
  it('끝 개행이 없는 파일은 없는 채로 담긴다', async () => {
    await writeFile(join(root, 'n.txt'), 'a\nb\nc')
    await commitAll('끝 개행 없음')
    await writeFile(join(root, 'n.txt'), 'a\nB\nc')

    const heads = await headers('n.txt')
    // 🔴 양쪽 규칙이 어긋나기 가장 쉬운 자리. 화면이 나르는 원문은 `\ No newline …` 로
    //    끝나고 **개행이 붙지 않는다** — 한쪽만 개행을 남기면 정상 담기가 매번 거절된다.
    expect(at(heads, 0).endsWith('\\ No newline at end of file')).toBe(true)
    expect(await stageHunk(root, 'n.txt', 0, at(heads, 0))).toEqual({ ok: true })

    // 인덱스에 담긴 blob 원문을 그대로 본다 — 끝 개행이 생겼으면 여기서 드러난다
    const blob = await runGit(['show', ':n.txt'], root)
    expect(blob.stdout).toBe('a\nB\nc')
  })

  // ── 6. CRLF · 새 파일 · 삭제된 파일 ──────────────────────────────────────

  // 본문 줄 끝의 `\r` 은 `split('\n')` 이 각 조각에 그대로 남긴다. 조립에서 흘리면
  // 파일 전체의 줄끝이 바뀌어 diff 가 통째로 빨개진다.
  it('CRLF 줄끝을 보존한 채로 담는다', async () => {
    const base = Array.from({ length: 30 }, (_, n) => String(n + 1))
    const crlf = (lines: string[]): string => `${lines.join('\r\n')}\r\n`
    await writeFile(join(root, 'w.txt'), crlf(base))
    await commitAll('CRLF 첫 커밋')

    const changed = base.map((line) => (['2', '15', '28'].includes(line) ? `${line}-바뀜` : line))
    await writeFile(join(root, 'w.txt'), crlf(changed))

    const heads = await headers('w.txt')
    expect(heads).toHaveLength(3)
    // 본문 줄 끝의 `\r` 이 원문에 남아 있다 — 흘리면 대조가 어긋나 전부 거절된다
    expect(at(heads, 1)).toContain('\r')
    expect(await stageHunk(root, 'w.txt', 1, at(heads, 1))).toEqual({ ok: true })

    // 인덱스에는 15줄만 바뀐 CRLF 원문이 그대로 들어가야 한다
    const expected = base.map((line) => (line === '15' ? '15-바뀜' : line))
    const blob = await runGit(['show', ':w.txt'], root)
    expect(blob.stdout).toBe(crlf(expected))
  })

  // 추적 안 되는 파일은 `git diff` 가 아무것도 내놓지 않는다 (비교 대상이 없다).
  // 화면도 이때는 덩어리가 아니라 파일 내용을 그리므로, 여기 오면 상태가 어긋난 것이다.
  it('추적 안 되는 새 파일은 덩어리로 담지 않는다', async () => {
    await writeFile(join(root, 'a.txt'), 'x\n')
    await commitAll('첫 커밋')
    await writeFile(join(root, '새파일.txt'), 'new\n')

    const result = await stageHunk(root, '새파일.txt', 0, '@@ -0,0 +1 @@')

    expect(result.ok).toBe(false)
    expect(result.message).toContain('담을 변경이 없습니다')
    expect(await stagedDiff()).toBe('')
  })

  it('삭제된 파일은 덩어리 하나로 삭제가 담긴다', async () => {
    await writeFile(join(root, 'keep.txt'), 'x\n')
    await writeFile(join(root, 'gone.txt'), 'one\ntwo\n')
    await commitAll('첫 커밋')
    await rm(join(root, 'gone.txt'))

    const heads = await headers('gone.txt')
    expect(heads).toHaveLength(1)
    expect(await stageHunk(root, 'gone.txt', 0, at(heads, 0))).toEqual({ ok: true })

    expect(await porcelain()).toBe('D  gone.txt\n')
    expect(await stagedDiff()).toContain('+++ /dev/null')
  })
})
