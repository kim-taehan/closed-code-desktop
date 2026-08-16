import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolRunner, type McpToolPorts } from './tools'

// 도구 둘이 **모델에게 무엇을 말하는가.** 실제로 pty 를 띄우는지는 아래 층이 잠근다
// (`electron/pty/runPane.test.ts`) — 여기서 겨누는 것은 돌려주는 문장이다.
//
// 문장이 이 도구들의 절반인 이유: 모델은 그것만 읽고 다음 행동을 정한다. "띄웠다" 와
// "이미 돌고 있었다" 를 안 가르면 모델은 방금 뜬 줄 알고 로그를 처음부터 찾는다.

describe('run_project', () => {
  let runProject: ReturnType<typeof vi.fn>

  const portsWith = (over: Partial<McpToolPorts> = {}): McpToolPorts => ({
    rootOf: (id) => (id === 'A' ? '/tmp/A' : null),
    focusedProjectId: () => 'A',
    openInView: () => true,
    openTerminal: () => true,
    runProject: runProject as unknown as McpToolPorts['runProject'],
    readLogs: () => null,
    ...over,
  })

  beforeEach(() => {
    runProject = vi.fn().mockResolvedValue({ ok: true, started: true })
  })

  it('띄우고, 기다리지 않는다는 것과 로그를 어떻게 보는지를 알려준다', async () => {
    const run = createToolRunner(portsWith())
    const answer = await run('A', 'run_project', { name: 'dev', command: 'npm run dev' })

    expect(runProject).toHaveBeenCalledWith('A', 'dev', 'npm run dev')
    expect(answer).toContain('시작했습니다')
    expect(answer).toContain('read_logs')
  })

  // 겹쳐 띄우면 개발 서버가 둘이 된다 — 뒤엣것은 포트를 못 잡고 죽거나 다른 포트를 잡는다
  it('이미 돌고 있으면 그 사실을 돌려준다', async () => {
    runProject.mockResolvedValue({ ok: true, started: false })
    const run = createToolRunner(portsWith())
    const answer = await run('A', 'run_project', { name: 'dev', command: 'npm run dev' })

    expect(answer).toContain('이미 돌고 있어')
    expect(answer).not.toContain('시작했습니다')
  })

  // 정지·재시작은 사람만 한다 (설계 §3) — 모델이 "다시 띄우겠다" 로 가지 않게 길을 알려준다
  it('다시 띄우려면 사용자가 닫아야 한다고 말한다', async () => {
    runProject.mockResolvedValue({ ok: true, started: false })
    const run = createToolRunner(portsWith())
    const answer = await run('A', 'run_project', { name: 'dev', command: 'npm run dev' })

    expect(answer).toContain('사용자')
  })

  // 뒤에 있는 프로젝트에서 띄우면 탭이 안 생기고, 탭이 없으면 멈출 문이 없다
  it('뒤에 있는 프로젝트에서는 띄우지 않는다', async () => {
    const run = createToolRunner(portsWith({ focusedProjectId: () => 'B' }))
    const answer = await run('A', 'run_project', { name: 'dev', command: 'npm run dev' })

    expect(runProject).not.toHaveBeenCalled()
    expect(answer).toContain('띄우지 못했습니다')
  })

  it('닫힌 프로젝트는 아무것도 건드리지 않는다', async () => {
    const run = createToolRunner(portsWith())
    await expect(run('닫힘', 'run_project', { name: 'dev', command: 'ls' })).rejects.toThrow(
      '닫힌 프로젝트',
    )
    expect(runProject).not.toHaveBeenCalled()
  })

  // 사용자가 손으로 쓰는 칸에 밀어 넣으면 치던 줄에 섞이고, 안 끝나는 것이면 칸이 잠긴다
  it('사용자의 셸 칸 이름으로는 못 돌린다', async () => {
    const run = createToolRunner(portsWith())
    await expect(run('A', 'run_project', { name: 'shell', command: 'ls' })).rejects.toThrow('셸 칸')
    await expect(run('A', 'run_project', { name: 'shell-2', command: 'ls' })).rejects.toThrow(
      '셸 칸',
    )
    expect(runProject).not.toHaveBeenCalled()
  })

  // 개행이 통과하면 명령이 여럿으로 쪼개져, 우리가 "이것을 띄웠다" 고 한 것과 실제가 달라진다
  it('여러 줄 명령은 거절한다', async () => {
    const run = createToolRunner(portsWith())
    await expect(
      run('A', 'run_project', { name: 'dev', command: 'npm i\nnpm run dev' }),
    ).rejects.toThrow('제어문자')
    expect(runProject).not.toHaveBeenCalled()
  })

  it('이름이나 명령이 없으면 거절한다', async () => {
    const run = createToolRunner(portsWith())
    await expect(run('A', 'run_project', { command: 'ls' })).rejects.toThrow('name')
    await expect(run('A', 'run_project', { name: 'dev' })).rejects.toThrow('command')
  })

  it('못 띄웠으면 성공이라고 하지 않는다', async () => {
    runProject.mockResolvedValue({ ok: false, error: 'opencode 서버가 아직 뜨지 않았습니다' })
    const run = createToolRunner(portsWith())
    await expect(run('A', 'run_project', { name: 'dev', command: 'ls' })).rejects.toThrow(
      '아직 뜨지 않았습니다',
    )
  })
})

describe('read_logs', () => {
  const snapshot = { lines: ['vite ready', 'Error: 못 찾음'], dropped: 0, total: 2 }

  const portsWith = (over: Partial<McpToolPorts> = {}): McpToolPorts => ({
    rootOf: (id) => (id === 'A' ? '/tmp/A' : null),
    focusedProjectId: () => 'A',
    openInView: () => true,
    openTerminal: () => true,
    runProject: () => Promise.resolve({ ok: true as const, started: true }),
    readLogs: () => snapshot,
    ...over,
  })

  it('그 칸의 로그를 잘라서 준다', async () => {
    const run = createToolRunner(portsWith())
    const answer = await run('A', 'read_logs', { name: 'dev', level: 'error' })

    expect(answer).toContain('Error: 못 찾음')
    expect(answer).not.toContain('vite ready')
    expect(answer).toContain('모두 2줄')
  })

  /**
   * **앞에 나와 있지 않아도 읽힌다.** 화면을 건드리는 도구들과 갈리는 지점이다 — 출력을
   * 붙들고 있는 것은 main 이라 어느 탭을 보고 있든 그대로 있다. 여기서 막으면 모델이
   * 고칠 수 없는 벽이 된다 (사용자가 탭을 옮겼다는 이유로 진단이 멈춘다).
   */
  it('사용자가 다른 프로젝트를 보고 있어도 읽는다', async () => {
    const run = createToolRunner(portsWith({ focusedProjectId: () => 'B' }))
    const answer = await run('A', 'read_logs', { name: 'dev' })

    expect(answer).toContain('vite ready')
  })

  // 빈 로그를 주면 모델은 "프로세스가 조용하다" 로 읽는다 — 없는 것과 조용한 것은 다르다
  it('그런 칸이 없으면 없다고 말한다 — 빈 로그를 주지 않는다', async () => {
    const run = createToolRunner(portsWith({ readLogs: () => null }))
    const answer = await run('A', 'read_logs', { name: '없는것' })

    expect(answer).toContain('도는 것이 없습니다')
  })

  it('닫힌 프로젝트는 아무것도 건드리지 않는다', async () => {
    const run = createToolRunner(portsWith())
    await expect(run('닫힘', 'read_logs', { name: 'dev' })).rejects.toThrow('닫힌 프로젝트')
  })
})
