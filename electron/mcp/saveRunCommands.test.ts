import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readRunList } from '../run/runListStore'
import { runCommandsInput, saveRunCommands } from './saveRunCommands'

// 이 도구가 지켜야 하는 것은 셋이다 (설계 §2):
//   · 적은 것을 **우리 파서가 읽는다** (형식이 하나다)
//   · **프로젝트 안에는 아무것도 안 남는다** (남의 레포도, 남의 프롬프트도 안 건드린다)
//   · 지문은 **디스크의 매니페스트**로 잰다 (모델이 무엇을 읽었는지가 아니라)

describe('runCommandsInput', () => {
  it('셸 칸 이름은 거절한다 — run_project 와 같은 규칙을 쓴다', () => {
    expect(() => runCommandsInput({ commands: [{ name: 'shell', command: 'npm run dev' }] })).toThrow(
      /셸 칸 이름/,
    )
  })

  it('개행이 든 명령은 거절한다 — 목록에서는 받아 놓고 ▶ 에서 거절하면 안 된다', () => {
    expect(() =>
      runCommandsInput({ commands: [{ name: 'dev', command: 'docker up\nnpm run dev' }] }),
    ).toThrow(/개행/)
  })

  it('이름이 겹치면 거절한다 — 칸 하나를 두 줄이 가리킨다', () => {
    expect(() =>
      runCommandsInput({
        commands: [
          { name: 'dev', command: 'a' },
          { name: 'dev', command: 'b' },
        ],
      }),
    ).toThrow(/겹칩니다/)
  })

  it('빈 목록은 거절한다', () => {
    expect(() => runCommandsInput({ commands: [] })).toThrow(/commands 가 없습니다/)
  })

  it('note 는 있어도 되고 없어도 된다', () => {
    expect(
      runCommandsInput({
        commands: [
          { name: 'dev', command: 'npm run dev', note: '개발 서버' },
          { name: 'test', command: 'npm test', note: '   ' },
        ],
      }),
    ).toEqual([
      { name: 'dev', command: 'npm run dev', note: '개발 서버' },
      { name: 'test', command: 'npm test' },
    ])
  })
})

describe('saveRunCommands', () => {
  let root: string
  let dir: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'run-project-'))
    dir = await mkdtemp(join(tmpdir(), 'run-store-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(dir, { recursive: true, force: true })
  })

  it('적은 것을 그대로 읽는다 — 쓰기와 읽기가 한 형식이다', async () => {
    const saved = await saveRunCommands(dir, root, [{ name: 'dev', command: 'npm run dev' }])

    expect((await readRunList(dir, root))?.entries).toEqual([{ name: 'dev', command: 'npm run dev' }])
    expect(saved.replaced).toBe(false)
  })

  // 목록을 앱 저장소로 옮긴 이유의 절반이 이것이다 (`shared/run/runList.ts` 머리말):
  // AGENTS.md 는 opencode 가 시스템 프롬프트로 싣는 파일이라 우리가 건드리면 안 된다.
  it('프로젝트 안에는 아무것도 안 남긴다 — AGENTS.md 도 만들지 않는다', async () => {
    await writeFile(join(root, 'AGENTS.md'), '# 프로젝트\n\n한국어로 답한다.\n', 'utf8')
    await saveRunCommands(dir, root, [{ name: 'dev', command: 'npm run dev' }])

    expect(await readdir(root)).toEqual(['AGENTS.md'])
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('# 프로젝트\n\n한국어로 답한다.\n')
  })

  it('두 번째부터는 고쳐 적은 것이다 — 사용자에게 다른 말이다', async () => {
    await saveRunCommands(dir, root, [{ name: 'dev', command: 'npm run dev' }])
    const again = await saveRunCommands(dir, root, [{ name: 'test', command: 'npm test' }])

    expect(again.replaced).toBe(true)
    expect((await readRunList(dir, root))?.entries).toEqual([{ name: 'test', command: 'npm test' }])
  })

  it('프로젝트마다 따로 든다 — 남의 프로젝트 명령이 여기서 뜨면 안 된다', async () => {
    const other = await mkdtemp(join(tmpdir(), 'run-other-'))
    try {
      await saveRunCommands(dir, root, [{ name: 'dev', command: 'npm run dev' }])
      await saveRunCommands(dir, other, [{ name: 'dev', command: 'gradlew bootRun' }])

      expect((await readRunList(dir, root))?.entries[0]?.command).toBe('npm run dev')
      expect((await readRunList(dir, other))?.entries[0]?.command).toBe('gradlew bootRun')
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  it('상한을 넘는 매니페스트는 지문에서 빠진다', async () => {
    const empty = await saveRunCommands(dir, root, [{ name: 'dev', command: 'npm run dev' }])

    await writeFile(join(root, 'package.json'), 'x'.repeat(600 * 1024), 'utf8')
    const huge = await saveRunCommands(dir, root, [{ name: 'dev', command: 'npm run dev' }])

    expect(huge.manifest).toBe(empty.manifest)
  })

  it('지문은 디스크의 매니페스트로 잰다 — package.json 이 바뀌면 갈린다', async () => {
    await writeFile(join(root, 'package.json'), '{"scripts":{"dev":"vite"}}', 'utf8')
    const first = await saveRunCommands(dir, root, [{ name: 'dev', command: 'npm run dev' }])

    await writeFile(join(root, 'package.json'), '{"scripts":{"dev":"next dev"}}', 'utf8')
    const second = await saveRunCommands(dir, root, [{ name: 'dev', command: 'npm run dev' }])

    expect(second.manifest).not.toBe(first.manifest)
    // 저장소에도 그 값이 남아야 한다 — 다음 판이 그걸로 「다시 확인할까요?」를 정한다
    expect((await readRunList(dir, root))?.manifest).toBe(second.manifest)
  })
})
