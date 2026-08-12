import { describe, expect, it } from 'vitest'
import { diagnoseIssues, sessionUp, stepIssues } from './connectionDoctor'
import { initPipeline, advance, type PipelineState } from './doctorPipeline'
import type { DiagnosticsPayload } from '../../shared/ipc/channels'
import type { ProjectStatus } from './projectStatus'

// **원인 문장과 다음 행동**을 잠근다.
//
// 이 판정의 값은 "어디가 끊겼는지에 따라 고치는 법이 다르다" 이고, 그중 가장 중요한 것은
// **고칠 수 없는 버튼을 주지 않는 것**이다 — 서버가 죽은 동안 재연결 버튼을 주면
// 눌러도 같은 자리에서 또 실패한다 (`connectionDoctor.ts:77` 이 근거를 적어 뒀다).

const diag = (ok: boolean, detail = ''): DiagnosticsPayload =>
  ({ runtime: { ok, detail } }) as DiagnosticsPayload

describe('sessionUp — 대화 가능한 상태', () => {
  it('ready·busy 만 살아 있는 것으로 본다', () => {
    expect(sessionUp('ready')).toBe(true)
    expect(sessionUp('busy')).toBe(true)
  })

  // connecting 을 살아 있다고 보면 아직 못 보내는 상태를 "정상" 이라 하게 된다
  it('나머지는 전부 아니다', () => {
    for (const status of ['idle', 'connecting', 'error', 'disconnected'] as ProjectStatus[]) {
      expect(sessionUp(status)).toBe(false)
    }
  })
})

describe('diagnoseIssues — 세션의 시각', () => {
  it('전부 정상이면 이슈가 없다', () => {
    expect(diagnoseIssues('ready', diag(true))).toEqual([])
  })

  // 우리가 띄운 프로세스가 아니라 재시작 버튼을 줄 수 없다 — 안내만 준다
  it('서버가 죽으면 원인과 안내를 주되 조치 버튼은 안 준다', () => {
    const [issue] = diagnoseIssues('ready', diag(false, '연결 거부'))
    expect(issue?.layer).toBe('opencode 서버')
    expect(issue?.cause).toBe('연결 거부')
    expect(issue?.fix).toBeUndefined()
    expect(issue?.advice).toContain('opencode serve')
  })

  it('서버 detail 이 비면 기본 문장을 쓴다', () => {
    const [issue] = diagnoseIssues('ready', diag(false, ''))
    expect(issue?.cause).toBe('opencode 서버에 닿지 못했습니다')
  })

  it('끊긴 세션에는 재연결 버튼을 준다', () => {
    const issues = diagnoseIssues('disconnected', diag(true))
    expect(issues.map((issue) => issue.layer)).toEqual(['세션'])
    expect(issues[0]?.fix).toBe('reconnect')
  })

  it('아직 안 붙은 세션(idle)도 이슈로 세운다 — 화면엔 ✗ 인데 정상이라 하면 모순이다', () => {
    const issues = diagnoseIssues('idle', diag(true))
    expect(issues[0]?.cause).toBe('세션이 아직 연결되지 않았습니다')
    expect(issues[0]?.fix).toBe('reconnect')
  })

  // **여기가 이 파일에서 가장 중요한 판정이다** — 고칠 수 없는 버튼은 없느니만 못하다
  describe('서버가 죽어 있으면 재연결 버튼을 주지 않는다', () => {
    it('error 세션', () => {
      const issues = diagnoseIssues('error', diag(false, '연결 거부'))
      const session = issues.find((issue) => issue.layer === '세션')
      expect(session?.fix).toBeUndefined()
      expect(session?.cause).toBe('opencode 서버에 닿지 못해 세션을 열지 못했습니다')
    })

    it('idle 세션', () => {
      const issues = diagnoseIssues('idle', diag(false, '연결 거부'))
      expect(issues.find((issue) => issue.layer === '세션')?.fix).toBeUndefined()
    })

    // 대조 — 서버가 살아 있으면 같은 상태에서 버튼이 나온다
    it('서버가 살아 있으면 같은 error 세션에 버튼이 나온다', () => {
      const issues = diagnoseIssues('error', diag(true), '핸드셰이크 실패')
      const session = issues.find((issue) => issue.layer === '세션')
      expect(session?.fix).toBe('reconnect')
      expect(session?.cause).toBe('핸드셰이크 실패')
    })
  })

  // 순서가 곧 권장 순서다 — 아래 계층을 먼저 고쳐야 위가 따라 산다
  it('서버와 세션이 함께 깨지면 서버를 먼저 놓는다', () => {
    const issues = diagnoseIssues('error', diag(false, '연결 거부'))
    expect(issues.map((issue) => issue.layer)).toEqual(['opencode 서버', '세션'])
  })

  // 진행 중일 뿐이라 이슈가 아니다
  it('connecting 은 이슈로 세우지 않는다', () => {
    expect(diagnoseIssues('connecting', diag(true))).toEqual([])
  })
})

describe('stepIssues — 파이프라인이 직접 본 것', () => {
  const fail = (detail: string) => ({ ok: false, detail })
  const pass = (detail: string) => ({ ok: true, detail })

  function afterServerFail(detail: string): PipelineState {
    return advance(initPipeline(true), fail(detail), true)
  }
  function afterModelFail(detail: string): PipelineState {
    return advance(advance(initPipeline(true), pass('4096 응답'), true), fail(detail), true)
  }

  it('통과한 진단에는 이슈가 없다', () => {
    let state = initPipeline(true)
    for (const outcome of [pass('a'), pass('b'), pass('c')]) state = advance(state, outcome, true)
    expect(stepIssues(state)).toEqual([])
  })

  it('server 실패는 원인과 `opencode serve` 안내를 준다', () => {
    const [issue] = stepIssues(afterServerFail('응답이 없습니다 (5000ms 초과)'))
    expect(issue?.layer).toBe('opencode 서버')
    expect(issue?.cause).toBe('응답이 없습니다 (5000ms 초과)')
    expect(issue?.advice).toContain('opencode serve')
  })

  // 모델 문제의 다음 행동은 재연결이 아니라 **설정 파일**이다
  it('model 실패는 설정 파일 경로를 안내한다', () => {
    const issues = stepIssues(afterModelFail('설정된 모델이 없습니다'))
    const model = issues.find((issue) => issue.layer === '모델')
    expect(model?.advice).toContain('~/.config/opencode/opencode.json')
    expect(model?.fix).toBeUndefined()
  })

  // blocked 는 "확인 못 함" 이지 "실패" 가 아니다 — 이슈로 세우면 원인이 둘로 보인다
  it('blocked 단계는 이슈로 세우지 않는다', () => {
    const issues = stepIssues(afterServerFail('연결 거부'))
    expect(issues.map((issue) => issue.layer)).toEqual(['opencode 서버'])
  })
})
