import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolRunner, type McpToolPorts } from './tools'

// **프로젝트 격리가 여기서 한 번 더 걸린다.** URL 로 온 신원이 곧 루트 조회 키다 —
// 모르는(닫힌) 프로젝트면 파일 시스템에 닿지도 않는다.

describe('createToolRunner', () => {
  let rootA: string
  let rootB: string
  let openInView: ReturnType<typeof vi.fn>
  let openTerminal: ReturnType<typeof vi.fn>

  const portsWith = (over: Partial<McpToolPorts> = {}): McpToolPorts => ({
    rootOf: (id) => (id === 'A' ? rootA : id === 'B' ? rootB : null),
    focusedProjectId: () => 'A',
    openInView: openInView as unknown as McpToolPorts['openInView'],
    openTerminal: openTerminal as unknown as McpToolPorts['openTerminal'],
    // 이 파일은 open_file·open_terminal 만 겨눈다 — 실행·로그는 runAndLogs.test.ts.
    runProject: () => Promise.resolve({ ok: false as const, error: '여기서는 안 부른다' }),
    readLogs: () => null,
    runListDir: () => '/tmp/run-lists',
  runListChanged: () => {},
    ...over,
  })

  beforeEach(async () => {
    rootA = await mkdtemp(join(tmpdir(), 'mcp-a-'))
    rootB = await mkdtemp(join(tmpdir(), 'mcp-b-'))
    await mkdir(join(rootA, 'src'))
    await writeFile(join(rootA, 'src', 'a.ts'), 'a\n')
    await writeFile(join(rootB, 'secret.ts'), 'b\n')
    openInView = vi.fn().mockReturnValue(true)
    openTerminal = vi.fn().mockReturnValue(true)
  })

  afterEach(async () => {
    await rm(rootA, { recursive: true, force: true })
    await rm(rootB, { recursive: true, force: true })
  })

  it('앞에 나와 있는 프로젝트의 파일을 화면에 연다', async () => {
    const run = createToolRunner(portsWith())
    const answer = await run('A', 'open_file', { path: 'src/a.ts', line: 3 })

    expect(openInView).toHaveBeenCalledWith('A', { path: 'src/a.ts', line: 3 })
    expect(answer).toContain('열었습니다')
  })

  // **A 의 주소로 B 의 파일을 못 연다.** 루트가 A 로 굳어 있어 경계 판정이 A 기준이다.
  it('A 신원으로 B 의 파일을 열 수 없다', async () => {
    const run = createToolRunner(portsWith())
    await expect(run('A', 'open_file', { path: join(rootB, 'secret.ts') })).rejects.toThrow('밖')
    expect(openInView).not.toHaveBeenCalled()
  })

  it('닫힌 프로젝트는 아무것도 건드리지 않는다', async () => {
    const run = createToolRunner(portsWith())
    await expect(run('닫힘', 'open_file', { path: 'src/a.ts' })).rejects.toThrow('닫힌 프로젝트')
    expect(openInView).not.toHaveBeenCalled()
  })

  // 이 앱은 프로젝트를 옮기면 파일 탭을 비운다 — 뒤에서 열어 봐야 사라진다.
  // 조용히 성공했다고 하지 않고 무슨 일이 있었는지 그대로 돌려준다.
  it('뒤에 있는 프로젝트에는 열지 않고 그 사실을 알린다', async () => {
    const run = createToolRunner(portsWith({ focusedProjectId: () => 'B' }))
    const answer = await run('A', 'open_file', { path: 'src/a.ts' })

    expect(openInView).not.toHaveBeenCalled()
    expect(answer).toContain('열지 못했습니다')
  })

  it('모르는 도구는 거절한다', async () => {
    const run = createToolRunner(portsWith())
    await expect(run('A', 'delete_everything', {})).rejects.toThrow('모르는 도구')
  })

  it('창이 없어 못 보내면 성공이라고 하지 않는다', async () => {
    openInView.mockReturnValue(false)
    const run = createToolRunner(portsWith())
    await expect(run('A', 'open_file', { path: 'src/a.ts' })).rejects.toThrow('화면이 없어')
  })
})

// **이 도구의 값은 "실행하지 않는다" 하나다.** 개행이 통과하면 셸이 그 자리에서 돌려 버리고
// (실측 — `openTerminal.ts` 머리말), 그 순간 이 도구는 그냥 명령 실행기가 된다.
describe('createToolRunner — open_terminal', () => {
  let openTerminal: ReturnType<typeof vi.fn>

  const portsWith = (over: Partial<McpToolPorts> = {}): McpToolPorts => ({
    rootOf: (id) => (id === 'A' ? '/tmp/A' : null),
    focusedProjectId: () => 'A',
    openInView: () => true,
    openTerminal: openTerminal as unknown as McpToolPorts['openTerminal'],
    // 이 파일은 open_file·open_terminal 만 겨눈다 — 실행·로그는 runAndLogs.test.ts.
    runProject: () => Promise.resolve({ ok: false as const, error: '여기서는 안 부른다' }),
    readLogs: () => null,
    runListDir: () => '/tmp/run-lists',
  runListChanged: () => {},
    ...over,
  })

  beforeEach(() => {
    openTerminal = vi.fn().mockReturnValue(true)
  })

  it('명령을 채워만 뒀다고 답한다 — 실행했다고 하지 않는다', async () => {
    const run = createToolRunner(portsWith())
    const answer = await run('A', 'open_terminal', { command: 'rm -rf build' })

    expect(openTerminal).toHaveBeenCalledWith('A', 'rm -rf build')
    expect(answer).toContain('채워만 뒀습니다')
    expect(answer).toContain('실행하지 않았습니다')
    // 모델이 읽고 사용자에게 확인을 청해야 이 도구가 완성된다
    expect(answer).toContain('확인')
  })

  it('개행이 섞이면 거절한다 — 채우는 순간 실행되어 버린다', async () => {
    const run = createToolRunner(portsWith())
    await expect(run('A', 'open_terminal', { command: 'echo 하나\necho 둘' })).rejects.toThrow(
      '실행되어',
    )
    expect(openTerminal).not.toHaveBeenCalled()
  })

  // `\r` 도 셸에서는 개행이고(엔터가 보내는 것이 그것이다), ESC 는 키 바인딩을 건드린다.
  // **양끝이 아니라 가운데** 것이다 — 끝에 붙은 것은 "돌려라" 라는 뜻일 뿐이라 떼어 낸다.
  it('가운데의 캐리지리턴·제어문자도 거절한다', async () => {
    const run = createToolRunner(portsWith())
    await expect(run('A', 'open_terminal', { command: 'echo 하나\recho 둘' })).rejects.toThrow(
      '제어문자',
    )
    await expect(run('A', 'open_terminal', { command: 'ls\u001b[A' })).rejects.toThrow('제어문자')
    expect(openTerminal).not.toHaveBeenCalled()
  })

  // 모델은 실행할 셈으로 끝에 개행을 붙여 보낸다. 그건 명령의 일부가 아니다.
  it('양끝의 개행·공백은 떼고 채운다', async () => {
    const run = createToolRunner(portsWith())
    await run('A', 'open_terminal', { command: '  npm test\n' })
    expect(openTerminal).toHaveBeenCalledWith('A', 'npm test')
  })

  it('명령이 없으면 칸만 편다', async () => {
    const run = createToolRunner(portsWith())
    const answer = await run('A', 'open_terminal', {})

    expect(openTerminal).toHaveBeenCalledWith('A', null)
    expect(answer).toContain('명령은 넣지 않았습니다')
  })

  it('뒤에 있는 프로젝트에는 열지 않고 그 사실을 알린다', async () => {
    const run = createToolRunner(portsWith({ focusedProjectId: () => 'B' }))
    const answer = await run('A', 'open_terminal', { command: 'ls' })

    expect(openTerminal).not.toHaveBeenCalled()
    expect(answer).toContain('열지 못했습니다')
  })

  it('닫힌 프로젝트는 아무것도 건드리지 않는다', async () => {
    const run = createToolRunner(portsWith())
    await expect(run('닫힘', 'open_terminal', { command: 'ls' })).rejects.toThrow('닫힌 프로젝트')
    expect(openTerminal).not.toHaveBeenCalled()
  })

  // 채운 줄 알고 사용자에게 확인을 청하면 사용자는 빈 칸을 본다
  it('못 보냈으면 성공이라고 하지 않는다', async () => {
    openTerminal.mockReturnValue(false)
    const run = createToolRunner(portsWith())
    await expect(run('A', 'open_terminal', { command: 'ls' })).rejects.toThrow('화면이 없어')
  })
})
