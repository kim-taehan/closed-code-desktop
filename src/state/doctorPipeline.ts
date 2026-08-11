// 진단·복구 파이프라인의 상태 머신.
//
// 진단은 3단계다: **opencode 서버 → 모델 → 연결 상태**.
// 아래(서버)부터 본다 — 위 단계는 아래가 살아 있어야 의미가 있고, 실패 원인도 아래가 먼저다.
//
//   server  — `opencode serve` 가 떠 있나 (GET /api/health)
//   model   — 쓸 모델이 붙어 있나 (GET /config/providers).
//             서버는 떴는데 프로바이더 설정이 비면 증상이 "보내도 답이 없다" 로만 나온다.
//   session — 지금 이 프로젝트 세션이 붙어 있나
//
// davis 시절엔 **Admin 서버 ping → 라이선스 검증 → 런타임 ping** 이었다. opencode 에는
// 중앙 서버도 라이선스도 없고, 키·사용량·모델 접근 제어는 LLM 프록시가 맡는다.
//
// 치유는 **재연결 하나뿐이다.** davis 때는 런타임을 우리가 띄웠으니 재시작·재설치까지
// 사다리를 태울 수 있었지만, opencode 서버는 사용자가 직접 띄운 남의 프로세스다 —
// 우리가 죽였다 살릴 수 없다. 그래서 재연결로 안 되면 곧장 수동 안내로 간다.
//
// 머신은 순수하다: 부작용(ping·재연결)은 next 로 시키기만 하고,
// 드라이버(ConnectionDoctor)가 실행해 결과를 advance 로 돌려준다. 화면 없이 단언한다.

export type DiagStepId = 'server' | 'model' | 'session'
export type HealStepId = 'heal-reconnect'
export type DoctorStepId = DiagStepId | HealStepId

export type StepStatus = 'pending' | 'running' | 'ok' | 'fail' | 'blocked'

export interface DoctorStep {
  id: DoctorStepId
  status: StepStatus
  /** 화면에 그대로 보여줄 한 줄 (결과가 나온 뒤에만) */
  detail?: string
}

/** 드라이버가 실행할 부작용. heal-* 은 액션 후 재확인(서버 ping + 세션)까지 포함한다. */
export type DoctorCommand = DoctorStepId

export interface CheckOutcome {
  ok: boolean
  detail: string
}

export type Verdict = 'healthy' | 'healed' | 'manual'

export interface PipelineState {
  steps: DoctorStep[]
  /** 다음에 실행할 것. null 이면 끝났다. */
  next: DoctorCommand | null
  /** next 가 null 일 때만 채워진다 */
  verdict: Verdict | null
  sessionOk: boolean
  /** 진행 로그. 전이마다 한 줄씩 쌓여 화면 아래에 그대로 흐른다. */
  log: string[]
}

const BLOCKED_DETAIL = '앞 단계가 실패해 확인할 수 없습니다'

function freshDiagSteps(): DoctorStep[] {
  return [
    { id: 'server', status: 'running' },
    { id: 'model', status: 'pending' },
    { id: 'session', status: 'pending' },
  ]
}

export function initPipeline(sessionOk: boolean): PipelineState {
  return {
    steps: freshDiagSteps(),
    next: 'server',
    verdict: null,
    sessionOk,
    log: ['진단을 시작합니다'],
  }
}

/** state.next 의 실행 결과를 먹여 다음 상태를 얻는다. sessionOk 는 호출 시점의 세션 상태. */
export function advance(state: PipelineState, outcome: CheckOutcome, sessionOk: boolean): PipelineState {
  if (state.next === null) return state
  const command = state.next
  const done = setStep(state.steps, command, outcome.ok ? 'ok' : 'fail', outcome.detail)
  const base: PipelineState = {
    ...state,
    steps: done,
    sessionOk,
    log: [...state.log, resultLine(command, outcome)],
  }

  switch (command) {
    case 'server':
      if (!outcome.ok) {
        // 서버에 못 닿으면 모델도 세션도 볼 것이 없다 — 여기서 멈춘다
        const blocked = setStep(
          setStep(done, 'model', 'blocked', BLOCKED_DETAIL),
          'session',
          'blocked',
          BLOCKED_DETAIL,
        )
        return finishDiagnosis(
          withLog({ ...base, steps: blocked }, '서버 실패 → 이후 단계는 진행하지 않습니다'),
        )
      }
      return { ...base, steps: setStep(done, 'model', 'running'), next: 'model' }

    case 'model':
      if (!outcome.ok) {
        // 모델이 없으면 붙어도 대화가 안 된다. 재연결로 풀리지 않으니 설정 안내로 끝낸다.
        return finishDiagnosis(
          withLog(
            { ...base, steps: setStep(done, 'session', 'blocked', BLOCKED_DETAIL) },
            '모델 설정 없음 → 이후 단계는 진행하지 않습니다',
          ),
        )
      }
      return { ...base, steps: setStep(done, 'session', 'running'), next: 'session' }

    case 'session':
      return finishDiagnosis(base)

    case 'heal-reconnect':
      if (outcome.ok) {
        return withLog({ ...base, next: null, verdict: 'healed' }, '자동 복구 완료 — 연결이 살아났습니다')
      }
      // 사다리가 없다 — opencode 서버는 우리가 띄운 것이 아니라 재시작할 수단이 없다
      return withLog(
        { ...base, next: null, verdict: 'manual' },
        '재연결 실패 — `opencode serve` 상태를 확인하세요',
      )
  }
}

/**
 * 진단이 끝났다. 전부 정상이면 판정을 내고,
 * 세션만 문제면 재연결을 한 번 시도하고, 서버·모델이 막혔으면 수동 안내로 끝낸다.
 */
function finishDiagnosis(state: PipelineState): PipelineState {
  const serverOk = stepStatus(state.steps, 'server') === 'ok'
  const modelOk = stepStatus(state.steps, 'model') === 'ok'
  const sessionStepOk = stepStatus(state.steps, 'session') === 'ok'

  if (serverOk && modelOk && sessionStepOk && state.sessionOk) {
    return withLog({ ...state, next: null, verdict: 'healthy' }, '진단 완료 — 모든 계층 정상')
  }

  // 서버·모델이 막힌 상태의 재연결은 절대 안 통한다 — 값을 고치라는 안내로 직행한다.
  if (!serverOk) {
    return withLog(
      { ...state, next: null, verdict: 'manual' },
      'opencode 서버에 닿지 못했습니다 — 주소와 `opencode serve` 를 확인하세요',
    )
  }
  if (!modelOk) {
    return withLog(
      { ...state, next: null, verdict: 'manual' },
      '쓸 모델이 없습니다 — ~/.config/opencode/opencode.json 을 확인하세요',
    )
  }

  return withLog(
    {
      ...state,
      steps: [...state.steps, { id: 'heal-reconnect', status: 'running' }],
      next: 'heal-reconnect',
    },
    '문제 발견 → 자동 복구를 시작합니다: 프로젝트 재연결',
  )
}

/** 완료된 커맨드 한 줄 — 예: "opencode 서버 ping… 응답 (…)" */
function resultLine(command: DoctorCommand, outcome: CheckOutcome): string {
  return `${LOG_LABEL[command]}… ${outcome.ok ? '성공' : '실패'} (${outcome.detail})`
}

function withLog(state: PipelineState, ...lines: string[]): PipelineState {
  return { ...state, log: [...state.log, ...lines] }
}

function setStep(steps: DoctorStep[], id: DoctorStepId, status: StepStatus, detail?: string): DoctorStep[] {
  // 재진단으로 같은 id 가 두 벌일 수 있다 — 항상 마지막(현재 회전) 것만 고친다
  const last = steps.map((step) => step.id).lastIndexOf(id)
  return steps.map((step, index) =>
    index === last ? { ...step, status, ...(detail === undefined ? {} : { detail }) } : step,
  )
}

function stepStatus(steps: DoctorStep[], id: DoctorStepId): StepStatus | undefined {
  const last = steps.map((step) => step.id).lastIndexOf(id)
  return steps[last]?.status
}

export const STEP_LABEL: Record<DoctorStepId, string> = {
  server: 'opencode 서버 확인',
  model: '모델 확인',
  session: '연결 상태 확인',
  'heal-reconnect': '재연결',
}

/** 로그 문장용 — 단계 표시(STEP_LABEL)보다 행위에 가깝게 쓴다 */
const LOG_LABEL: Record<DoctorCommand, string> = {
  server: 'opencode 서버 ping',
  model: '모델 조회',
  session: '연결 상태 확인',
  'heal-reconnect': '프로젝트 재연결',
}
