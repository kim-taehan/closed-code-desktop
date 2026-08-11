import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runGit } from './gitRunner'
import { splitHunks, joinHunk } from '../../shared/git/hunkSplit'
import { stageHunk, revertHunk } from './gitHunk'

// **화면이 그린 뒤 클릭 전에 그 덩어리가 같은 줄 수로 바뀐 경우** — QA 결함 D4.
//
// `gitHunk.test.ts` 에서 갈라 둔 것은 여기가 다른 질문이기 때문이다. 그쪽은 "고른
// 덩어리만 담기는가", 여기는 "**화면이 본 것과 다른 것을 담지 않는가**".
//
// 머리(`@@ …`)가 막는 것은 "덩어리가 밀린 것"이지 "제자리 내용이 바뀐 것"이 아니다.
// 줄 수가 그대로면 머리는 한 글자도 안 바뀌므로, 머리만 대조하던 옛 안전장치는
// ① 사용자가 못 본 내용을 담고 ② 못 본 변경을 지웠다(되돌릴 수 없다). 둘 다 `ok:true`.
//
// 그래서 대조 대상을 **덩어리 원문 전체**로 올렸다. 아래는 그 재현이다.

describe('덩어리 제자리 내용 변경 (D4)', () => {
  let root = ''

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'davis-hunk-stale-')))
    await runGit(['init', '-b', 'main'], root)
    await runGit(['config', 'user.email', 'test@example.com'], root)
    await runGit(['config', 'user.name', '테스트'], root)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  /** 화면이 하는 일 — 지금 diff 를 **화면과 같은 규칙**으로 갈라 덩어리 원문을 집는다 */
  async function hunks(): Promise<string[]> {
    const diff = await runGit(['diff', '--no-color', '--', 'a.txt'], root)
    return splitHunks(diff.stdout).hunks.map(joinHunk)
  }

  function at(list: string[], index: number): string {
    const value = list[index]
    if (value === undefined) throw new Error(`${index}번째가 없다: ${JSON.stringify(list)}`)
    return value
  }

  /** 덩어리 원문의 첫 줄 = `@@ …` 머리 */
  function head(text: string): string {
    return text.split('\n')[0] ?? ''
  }

  async function porcelain(): Promise<string> {
    return (await runGit(['status', '--porcelain'], root)).stdout
  }

  async function stagedDiff(): Promise<string> {
    return (await runGit(['diff', '--staged', '--no-color'], root)).stdout
  }

  const BASE = Array.from({ length: 20 }, (_, n) => String(n + 1))

  /** 3·15 를 고친다 → 문맥 3줄 기준 덩어리 2개. `mark` 로 15줄의 내용만 갈아 끼운다 */
  async function write(mark: string): Promise<void> {
    const changed = BASE.map((line) => {
      if (line === '15') return `15-${mark}`
      return line === '3' ? '3-바뀜' : line
    })
    await writeFile(join(root, 'a.txt'), `${changed.join('\n')}\n`)
  }

  /** 화면이 diff 를 받은 뒤, 클릭 전에 두 번째 덩어리가 **같은 줄 수로** 바뀐다 */
  async function drawThenEdit(): Promise<string[]> {
    await writeFile(join(root, 'a.txt'), `${BASE.join('\n')}\n`)
    await runGit(['add', '-A'], root)
    await runGit(['commit', '-m', '첫 커밋'], root)

    await write('바뀜')
    const drawn = await hunks() // 화면이 그린 것
    await write('딴것') // 포매터·에디터 저장·에이전트 편집
    return drawn
  }

  it('전제 — 내용만 바뀌면 머리는 그대로다 (옛 안전장치가 통과시키던 자리)', async () => {
    const drawn = await drawThenEdit()
    const fresh = await hunks()

    expect(head(at(fresh, 1))).toBe(head(at(drawn, 1)))
    expect(at(fresh, 1)).not.toBe(at(drawn, 1))
  })

  it('담기를 거절하고 저장소는 부르기 전과 똑같다', async () => {
    const drawn = await drawThenEdit()
    const before = { status: await porcelain(), staged: await stagedDiff() }

    const result = await stageHunk(root, 'a.txt', 1, at(drawn, 1))

    expect(result.ok).toBe(false)
    expect(result.message).toContain('새로 고친')
    // 사용자가 못 본 `15-딴것` 이 담기지 않았다
    expect(await porcelain()).toBe(before.status)
    expect(await stagedDiff()).toBe(before.staged)
  })

  // 이쪽이 더 나쁘다 — 못 본 변경을 지우면 되돌릴 수 없다.
  it('되돌리기를 거절하고 워킹트리 파일을 한 바이트도 안 건드린다', async () => {
    const drawn = await drawThenEdit()
    const before = { file: await readFile(join(root, 'a.txt'), 'utf8'), status: await porcelain() }

    const result = await revertHunk(root, 'a.txt', 1, at(drawn, 1))

    expect(result.ok).toBe(false)
    expect(result.message).toContain('새로 고친')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe(before.file)
    expect(await porcelain()).toBe(before.status)
  })

  // 거절이 과하지 않은가 — 화면을 새로 고치면(= 지금 원문으로 보내면) 그대로 담긴다.
  it('새로 고친 원문으로 보내면 바뀐 내용이 담긴다', async () => {
    await drawThenEdit()

    const fresh = await hunks()
    expect(await stageHunk(root, 'a.txt', 1, at(fresh, 1))).toEqual({ ok: true })
    expect(await stagedDiff()).toContain('+15-딴것')
    // 첫 덩어리는 워킹트리에 그대로 남는다 — 고른 것만 담긴다
    expect(await stagedDiff()).not.toContain('+3-바뀜')
  })
})
