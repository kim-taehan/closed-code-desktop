import { describe, expect, it } from 'vitest'
import { createToolRunner, type McpToolPorts } from './tools'
import { TOOLS } from './toolSchemas'

// **설명서(`TOOLS`)와 실물(`createToolRunner` 의 이름 분기)이 같은 도구를 말하는가.**
//
// ⚠️ 감사 판정은 *"어느 시험도 `TOOLS` 라는 이름을 안 불러서 스키마와 파서가 갈려도 안
// 빨개진다"* 였는데, **재 보니 그 부분은 사실이 아니다** (2026-08-16 되돌리기 실측).
// `TOOLS` 에 도구를 하나 더하면 `rpc.test.ts` 의 「도구 목록」과 `opencode/mcpConfig.test.ts`
// 의 「도구 목록이 그 표식이 된다」가 **둘 다 빨개진다** — 양쪽이 이름 목록을 손으로 적어
// 두고 있다.
//
// 그래서 여기서 겨누는 것은 **목록의 내용이 아니라 두 층 사이다** (원칙 8). 저 둘은
// `TOOLS` 를 잠그고 `runAndLogs.test.ts` 는 실행기를 잠그는데, **그 둘이 같은 집합인지는
// 아무도 안 본다.** 새 도구를 더하며 설명서와 저 목록만 고치고 분기를 안 만들면 전부 초록이다.
//
// 갈렸을 때 증상은 두 방향 다 조용하다:
// - 설명서에만 있는 도구 → 모델이 부르고 「모르는 도구입니다」를 받는다. 인자를 잘못 준
//   줄 알고 같은 것을 몇 번이고 다시 부른다.
// - 실물에만 있는 도구 → 모델은 그런 것이 있는 줄도 모른다. 영영 안 불린다.

/** 아무것도 안 하는 포트. 여기서 재는 것은 **분기가 있는가**이지 그 결과가 아니다 */
const ports = {
  rootOf: () => '/proj',
  focusedProjectId: () => 'p1',
  openInView: () => true,
  openTerminal: () => true,
  runProject: async () => ({ ok: true as const, started: true }),
  readLogs: () => null,
  runListDir: () => '/tmp/run-lists',
  runListChanged: () => {},
} as unknown as McpToolPorts

/** 그 이름을 실물이 아는가 — 인자가 틀려 나는 오류와 「모르는 도구」를 가른다 */
async function isKnown(name: string): Promise<boolean> {
  try {
    await createToolRunner(ports)('p1', name, {})
    return true
  } catch (error) {
    return !String(error instanceof Error ? error.message : error).includes('모르는 도구')
  }
}

describe('TOOLS — 설명서와 실물', () => {
  it('설명서에 적힌 도구는 전부 실제로 돈다', async () => {
    const unknown: string[] = []
    for (const tool of TOOLS) if (!(await isKnown(tool.name))) unknown.push(tool.name)

    expect(unknown).toEqual([])
  })

  // 기준선 — 위 단언은 `isKnown` 이 늘 true 를 주면 빈 목록으로 초록이다.
  // 없는 이름이 실제로 걸리는지 여기서 확인한다.
  it('없는 이름은 「모르는 도구」로 걸린다 — 위 시험이 헛초록이 아니라는 근거', async () => {
    expect(await isKnown('그런_도구_없음')).toBe(false)
  })

  // 반대 방향. 실물에만 있는 도구는 모델이 존재조차 모른다.
  it('실물이 아는 이름은 전부 설명서에 있다', () => {
    const documented = new Set<string>(TOOLS.map((tool) => tool.name))
    // `tools.ts` 의 분기 목록. **여기를 늘릴 때 `TOOLS` 도 늘렸는지가 이 시험의 전부다.**
    const dispatched = [
      'open_file',
      'open_terminal',
      'run_project',
      'read_logs',
      'save_run_commands',
    ]

    expect(dispatched.filter((name) => !documented.has(name))).toEqual([])
    expect(documented.size).toBe(dispatched.length)
  })

  // 설명이 짧으면 모델이 안 부르거나 엉뚱하게 부른다 (`toolSchemas.ts` 머리말).
  it('도구마다 설명과 입력 스키마가 있다', () => {
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(50)
      expect(tool.inputSchema.type).toBe('object')
    }
  })
})
