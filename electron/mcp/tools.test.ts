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

  const portsWith = (over: Partial<McpToolPorts> = {}): McpToolPorts => ({
    rootOf: (id) => (id === 'A' ? rootA : id === 'B' ? rootB : null),
    focusedProjectId: () => 'A',
    openInView: openInView as unknown as McpToolPorts['openInView'],
    ...over,
  })

  beforeEach(async () => {
    rootA = await mkdtemp(join(tmpdir(), 'mcp-a-'))
    rootB = await mkdtemp(join(tmpdir(), 'mcp-b-'))
    await mkdir(join(rootA, 'src'))
    await writeFile(join(rootA, 'src', 'a.ts'), 'a\n')
    await writeFile(join(rootB, 'secret.ts'), 'b\n')
    openInView = vi.fn().mockReturnValue(true)
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
