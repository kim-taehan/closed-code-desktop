import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ExtensionService } from '../../electron/extensions/service'
import { ExtensionWorkspace } from '../../electron/extensions/workspaceApi'
import { LiveChild } from '../extensions/liveChild'
import { askAgent, laneConfigOf } from '../../electron/agentLane/askAgent'
import { ChainLocator, FixedPortLocator, InstanceFileLocator } from '../../electron/runtime/locator'

// **실제 runtime + 실제 LLM** 으로 확장을 굴린다 (`realRuntime.test.ts` 와 같은 관문).
//
// 가짜인 것은 utilityProcess 경계 하나뿐이다. 확장 코드·RPC·질의 레인·핸드셰이크·
// 권한 모드·프롬프트·답 파싱이 전부 진짜다. 사이드바 버튼을 누르는 것과 같은 자리에서
// `runCommand` 를 부른다.
//
// 환경변수가 없으면 건너뛴다 — CI 와 일상 개발에서는 돌지 않는다.
//
// 실행:
//   DAVIS_LICENSE_KEY=agent DAVIS_SMOKE_PROJECT=<분석할 레포> npx vitest run tests/smoke/extensionAgent
//
// ⚠️ 진짜 LLM 이라 **답이 매번 다르다.** 그래서 내용이 아니라 **모양**만 단언한다 —
// 시나리오가 하나라도 나오는가, 근거 파일이 붙는가, 표 계약을 지키는가.

const licenseKey = process.env['DAVIS_LICENSE_KEY']
const fixedPort = Number(process.env['DAVIS_RUNTIME_PORT'])
const projectRoot = process.env['DAVIS_SMOKE_PROJECT'] ?? process.cwd()
const enabled = Boolean(licenseKey)

type Row = Record<string, unknown>

describe.skipIf(!enabled)('테스트 시나리오 확장 — 실제 어시스턴트', () => {
  it('분석을 맡기고 시나리오 표를 받는다', async () => {
    const located = await new ChainLocator([
      ...(Number.isFinite(fixedPort) && fixedPort > 0 ? [new FixedPortLocator(fixedPort)] : []),
      new InstanceFileLocator(),
    ]).locate()
    expect(located.found, '떠 있는 runtime 을 못 찾았습니다').toBe(true)
    if (!located.found) return

    const lane = laneConfigOf(located.endpoint, {
      licenseKey: licenseKey as string,
      workspacePath: projectRoot,
      projectName: projectRoot.split('/').pop() ?? 'smoke',
    })

    const rows = new Map<string, unknown[]>()
    const project = { id: projectRoot, root: projectRoot }
    const service = new ExtensionService({
      entryPath: 'ignored',
      fork: () => new LiveChild(),
      // **설치본을 쓴다** — 레포 사본이 아니라 사용자가 실제로 설치한 그것이다
      extensionsDir: join(homedir(), '.davis-code', 'desktop-extensions'),
      workspace: new ExtensionWorkspace(() => ({ active: project, openProjects: [project] })),
      ask: (prompt) => askAgent(lane, prompt),
    })
    service.onViewRows((viewId, viewRows) => rows.set(viewId, viewRows))
    service.onLog((line) => console.log('[호스트]', line.trim()))
    service.start()

    try {
      await service.runCommand('testScenario.scan', null)
      const result = (rows.get('testScenario.results') ?? []) as Row[]

      console.log(`시나리오 ${result.length}건`)
      console.log(JSON.stringify(result.slice(0, 3), null, 2))

      expect(result.length).toBeGreaterThan(0)
      // 근거 없는 항목은 확장이 버리므로, 남은 것에는 반드시 파일이 붙어 있다
      expect(result.every((row) => typeof row['file'] === 'string' && row['file'] !== '')).toBe(true)
      expect(Object.keys(result[0] as Row)).toEqual([
        'id',
        '구분',
        '대상',
        '유형',
        '사전조건',
        '수행절차',
        '기대결과',
        'file',
      ])
    } finally {
      service.dispose()
    }
  }, 600_000)
})
