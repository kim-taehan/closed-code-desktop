import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseRunSection } from '../../shared/run/runSection'
import { runCommandsInput, saveRunCommands } from './saveRunCommands'

// 이 도구가 지켜야 하는 것은 셋이다 (설계 §2):
//   · 적은 것을 **우리 파서가 읽는다** (형식이 하나다)
//   · **절 밖은 안 건드린다** (AGENTS.md 는 남의 글이 있는 파일이다)
//   · 지문은 **디스크의 매니페스트**로 잰다 (모델이 무엇을 읽었는지가 아니라)

describe('runCommandsInput', () => {
  it('셸 칸 이름은 거절한다 — run_project 와 같은 규칙을 쓴다', () => {
    expect(() => runCommandsInput({ commands: [{ name: 'shell', command: 'npm run dev' }] })).toThrow(
      /셸 칸 이름/,
    )
  })

  it('개행이 든 명령은 거절한다 — 표 한 칸에 안 들어간다', () => {
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

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'run-agents-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('AGENTS.md 가 없으면 만들고, 적은 것을 그대로 읽는다', async () => {
    const saved = await saveRunCommands(root, [{ name: 'dev', command: 'npm run dev' }])

    const text = await readFile(join(root, 'AGENTS.md'), 'utf8')
    expect(parseRunSection(text)?.entries).toEqual([{ name: 'dev', command: 'npm run dev' }])
    expect(saved.replaced).toBe(false)
  })

  it('사람이 쓴 글은 그대로 두고 절만 갈아 끼운다', async () => {
    await writeFile(
      join(root, 'AGENTS.md'),
      '# 프로젝트\n\n한국어로 답한다.\n\n## 실행\n\n| 낡음 | `old` |\n',
      'utf8',
    )
    const saved = await saveRunCommands(root, [{ name: 'dev', command: 'npm run dev' }])

    const text = await readFile(join(root, 'AGENTS.md'), 'utf8')
    expect(text).toContain('한국어로 답한다.')
    expect(text).not.toContain('`old`')
    expect(saved.replaced).toBe(true)
  })

  // 읽기 실패를 「빈 파일」로 삼키면 뒤의 쓰기가 남의 글을 통째로 덮어쓴다
  it('AGENTS.md 를 못 읽으면 아무것도 안 적는다 — 없는 것과 못 읽는 것은 다르다', async () => {
    await mkdir(join(root, 'AGENTS.md'))

    await expect(saveRunCommands(root, [{ name: 'dev', command: 'npm run dev' }])).rejects.toThrow(
      /읽지 못해/,
    )
  })

  it('상한을 넘는 매니페스트는 지문에서 빠진다 — 화면 쪽 읽기가 그렇게 한다', async () => {
    const empty = await saveRunCommands(root, [{ name: 'dev', command: 'npm run dev' }])

    await writeFile(join(root, 'package.json'), 'x'.repeat(600 * 1024), 'utf8')
    const huge = await saveRunCommands(root, [{ name: 'dev', command: 'npm run dev' }])

    expect(huge.manifest).toBe(empty.manifest)
  })

  it('지문은 디스크의 매니페스트로 잰다 — package.json 이 바뀌면 갈린다', async () => {
    await writeFile(join(root, 'package.json'), '{"scripts":{"dev":"vite"}}', 'utf8')
    const first = await saveRunCommands(root, [{ name: 'dev', command: 'npm run dev' }])

    await writeFile(join(root, 'package.json'), '{"scripts":{"dev":"next dev"}}', 'utf8')
    const second = await saveRunCommands(root, [{ name: 'dev', command: 'npm run dev' }])

    expect(second.manifest).not.toBe(first.manifest)
    // 파일에도 그 값이 남아야 한다 — 다음 판이 그걸로 「다시 확인할까요?」를 정한다
    const text = await readFile(join(root, 'AGENTS.md'), 'utf8')
    expect(parseRunSection(text)?.manifest).toBe(second.manifest)
  })
})
