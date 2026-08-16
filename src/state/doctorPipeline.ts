// 진단·복구 파이프라인의 상태 머신.
//
// 진단은 3단계다: **opencode 서버 → 모델 → 연결 상태**.
// 아래(서버)부터 본다 — 위 단계는 아래가 살아 있어야 의미가 있고, 실패 원인도 아래가 먼저다.
//
//   server  — `opencode serve` 가 떠 있나 (GET /global/health — 버전 하한선도 함께 본다)
//   model   — 쓸 모델이 붙어 있나 (GET /config/providers + 그 프로바이더 주소 ping).
//             서버는 떴는데 프로바이더 설정이 비거나 **설정만 되고 주소가 죽으면**
//             증상이 "보내도 답이 없다" 로만 나온다.
//   session — 지금 이 프로젝트 세션이 붙어 있나
//
// davis 시절엔 **Admin 서버 ping → 라이선스 검증 → 런타임 ping** 이었다. opencode 에는
// 중앙 서버도 라이선스도 없고, 키·사용량·모델 접근 제어는 LLM 프록시가 맡는다.
//
// 치유는 **세 칸 사다리다** (설계 2026-08-16):
//
//   ① heal-reconnect        세션만 다시 붙인다
//   ② heal-restart-server   서버를 되살린다 (**조치는 하나**, 문구만 주인에 따라 갈린다)
//   ③ heal-verify           **재확인만** 한다 — ②가 세션까지 붙여 놓는다 (실측)
//
// **이 자리에 "치유는 재연결 하나뿐이다" 가 적혀 있었다.** 근거는 *"opencode 서버는
// 사용자가 직접 띄운 남의 프로세스라 우리가 죽였다 살릴 수 없다"* 였고, 그것은
// **커밋 `c09cac8`("프로젝트마다 opencode 서버를 우리가 띄운다") 이전까지만 참이었다.**
// 지금은 `serverPool` 이 띄우고 `pidStore` 가 우리 PID 를 안다 — 그래서 사다리가 돌아왔다.
// **남의 서버는 여전히 못 죽인다.** 다만 그것을 여기서 갈라 줄 필요가 없다:
// `serverPool.stop` 의 사정거리가 우리 자식뿐이라 조치 층이 이미 안전하다 (설계 §1 정정).
//
// 머신은 순수하다: 부작용(ping·재연결·서버 조작)은 next 로 시키기만 하고,
// 드라이버(`doctorDriver.ts`)가 실행해 결과를 advance 로 돌려준다. 화면 없이 단언한다.

import {
  DIAG_ORDER,
  LOG_LABEL,
  blockedAfter,
  setStep,
  stepStatus,
  type DiagStepId,
  type DoctorStep,
  type DoctorStepId,
  type ServerOwnership,
} from './doctorSteps'

// 단계의 **어휘**(있는 칸·이름표·배열 도구)는 `doctorSteps.ts` 로 갈랐다 (300줄 상한).
// 부르는 쪽이 두 파일을 알 이유는 없어 여기서 그대로 다시 내보낸다.
export {
  DIAG_ORDER,
  STEP_LABEL,
  blockedAfter,
  isHealStep,
  type DiagStepId,
  type DoctorStep,
  type DoctorStepId,
  type HealStepId,
  type ServerOwnership,
  type StepStatus,
} from './doctorSteps'

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
  return DIAG_ORDER.map((id, index) => ({ id, status: index === 0 ? 'running' : 'pending' }))
}

/** 실패한 단계 뒤를 전부 blocked 로 칠한다 */
function blockRest(steps: DoctorStep[], failedId: DiagStepId): DoctorStep[] {
  return blockedAfter(DIAG_ORDER, failedId).reduce(
    (acc, id) => setStep(acc, id, 'blocked', BLOCKED_DETAIL),
    steps,
  )
}

export function initPipeline(sessionOk: boolean): PipelineState {
  return {
    steps: freshDiagSteps(),
    next: DIAG_ORDER[0],
    verdict: null,
    sessionOk,
    log: ['진단을 시작합니다'],
  }
}

/**
 * state.next 의 실행 결과를 먹여 다음 상태를 얻는다. sessionOk 는 호출 시점의 세션 상태.
 *
 * `ownership` 은 ②로 내려갈 때만 읽는다 — **기본값이 `theirs`** 인 것이 안전 장치다.
 * 안 넘기면 「남의 서버」로 보고 갈아타기를 고르므로, 배선을 빠뜨려도 남의 프로세스를
 * 끄는 쪽으로는 틀리지 않는다.
 */
export function advance(
  state: PipelineState,
  outcome: CheckOutcome,
  sessionOk: boolean,
  ownership: ServerOwnership = 'theirs',
): PipelineState {
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
        // 서버에 못 닿으면 모델도 세션도 볼 것이 없다 — **진단은** 여기서 멈춘다.
        // 그리고 곧장 사다리 ②로 간다: ①(재연결)은 건너뛴다. 서버가 죽은 채로 재연결하면
        // 같은 자리에서 또 실패하기 때문이고, 그 근거는 `connectionDoctor.ts` 에도 있다.
        //
        // **예전에는 여기서 `manual` 로 끝나며 "`opencode serve` 를 치세요" 라고 안내했다.**
        // 서버가 남의 프로세스이던 시절의 유일한 답이었다 — 지금은 우리가 되살릴 수 있다.
        return startServerHeal(
          withLog(
            { ...base, steps: blockRest(done, 'server') },
            '서버 실패 → 이후 단계는 진행하지 않습니다',
          ),
          ownership,
        )
      }
      return { ...base, steps: setStep(done, 'model', 'running'), next: 'model' }

    case 'model':
      if (!outcome.ok) {
        // 모델이 없으면 붙어도 대화가 안 된다. 재연결로 풀리지 않으니 설정 안내로 끝낸다.
        return finishDiagnosis(
          withLog(
            { ...base, steps: blockRest(done, 'model') },
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
      // ①이 실패했다 → ②로 내려간다.
      //
      // **여기 「②를 이미 밟았으면 멈춘다」 검사가 있었다.** ③이 재연결이던 시절, ③의
      // 실패가 이 case 로 들어와 ②를 또 부를 수 있었기 때문이다 — 그것이 재시작 루프였다.
      // ③이 `heal-verify` 로 갈리면서 **이 case 는 ①에서만 들어온다**: 사다리에 순환이
      // 남지 않았고, 상한은 검사가 아니라 **모양**이 보장한다.
      //
      // 예전에는 ①의 실패가 곧 사다리의 끝이었다 — *"서버는 우리가 띄운 것이 아니라
      // 재시작할 수단이 없다"* 가 근거였고, `serverPool` 이 생기며 거짓이 됐다.
      return startServerHeal(base, ownership)

    // ② — 서버를 되살렸다. **성공해도 끝이 아니다** — 다만 남은 일은 「붙이기」가 아니라
    // 「확인」이다.
    //
    // *"세션은 저절로 안 붙는다"* 고 적었는데 **틀렸다** (실측 2026-08-16): ②가 타는 경로
    // (`controlServer` → `closeProject` → `activate`)는 세션을 새로 만들고 핸드셰이크
    // ready 까지 기다렸다가 돌아온다. 그 위에 재연결을 또 부르면 멀쩡한 세션을 접었다
    // 붙이는 것이고, 그 재조립이 실패하면 **②가 고쳐 놨는데도 사다리가 실패로 끝난다.**
    //
    // 그래도 칸을 없애지 않는다: 사다리가 「고쳤다」고 **스스로 단정하지 않고 검산한다.**
    case 'heal-restart-server':
      if (!outcome.ok) {
        return withLog(
          { ...base, next: null, verdict: 'manual' },
          '서버를 되살리지 못했습니다 — 아래 사유를 확인하세요',
        )
      }
      return withLog(
        {
          ...base,
          steps: [...base.steps, { id: 'heal-verify', status: 'running' }],
          next: 'heal-verify',
        },
        '서버가 떴습니다 → 연결을 확인합니다',
      )

    // ③ — 검산. **여기서 조치를 하지 않는다.** 실패하면 그대로 멈춘다.
    case 'heal-verify':
      if (outcome.ok) {
        return withLog({ ...base, next: null, verdict: 'healed' }, '자동 복구 완료 — 연결이 살아났습니다')
      }
      return withLog(
        { ...base, next: null, verdict: 'manual' },
        '서버를 되살린 뒤에도 연결되지 않았습니다 — 아래 진단을 확인하세요',
      )
  }
}

/**
 * ②를 붙인다. **칸은 하나이고 `ownership` 은 로그 문장만 가른다.**
 *
 * 갈래가 둘이던 자리다. 조치를 가르는 대신 조치 층에 맡긴다 — `serverPool.stop` 은
 * 우리 표의 자식만 접으므로, 남의 서버(또는 이미 죽은 우리 서버)면 접는 절반이 no-op 이고
 * 이어지는 기동이 이 프로젝트용을 세운다.
 */
function startServerHeal(state: PipelineState, ownership: ServerOwnership): PipelineState {
  return withLog(
    {
      ...state,
      steps: [...state.steps, { id: 'heal-restart-server', status: 'running' }],
      next: 'heal-restart-server',
    },
    ownership === 'ours'
      ? '우리가 띄운 서버가 살아 있습니다 → 접었다 다시 띄웁니다'
      : // 남의 것이거나, **죽었거나, 모르는** 경우다. 남의 프로세스에는 손대지 않는다.
        '우리가 띄운 서버가 아닙니다 → 이 프로젝트용 서버를 띄웁니다',
  )
}

/**
 * 진단이 끝났다. 전부 정상이면 판정을 내고,
 * 세션만 문제면 사다리 ①(재연결)로 가고, 모델이 막혔으면 수동 안내로 끝낸다.
 *
 * **여기 「서버가 막혔으면 수동 안내」 갈래가 있었다.** 서버 실패가 이제 `advance` 에서
 * 곧장 사다리 ②로 빠지므로 이 함수까지 내려오지 않는다 — 도달할 수 없는 갈래라 지웠다.
 * 그 갈래가 하던 말(*"주소와 `opencode serve` 를 확인하세요"*)은 지금은 틀린 안내이기도 하다.
 */
function finishDiagnosis(state: PipelineState): PipelineState {
  const serverOk = stepStatus(state.steps, 'server') === 'ok'
  const modelOk = stepStatus(state.steps, 'model') === 'ok'
  const sessionStepOk = stepStatus(state.steps, 'session') === 'ok'

  if (serverOk && modelOk && sessionStepOk && state.sessionOk) {
    return withLog({ ...state, next: null, verdict: 'healthy' }, '진단 완료 — 모든 계층 정상')
  }

  // 모델이 막힌 상태의 재연결은 절대 안 통한다 — 값을 고치라는 안내로 직행한다.
  // **모델은 사다리를 안 탄다**: 우리가 못 고치는 층이고, 모델을 몰래 바꾸는 것은
  // 조용히 다른 답을 내놓는 일이라 더 위험하다 (설계 §1·§6).
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
