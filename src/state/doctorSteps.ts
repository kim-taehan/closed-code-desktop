// 진단·치유 **단계의 어휘** — 어떤 칸이 있고, 뭐라고 부르고, 배열에서 어떻게 찾나.
//
// `doctorPipeline.ts` 가 300줄을 넘어 갈라냈다. 가른 자리는 **전이(언제 다음 칸으로 가나)와
// 어휘(칸이 무엇인가)** 사이다 — 전이는 설계가 바뀔 때 움직이고 어휘는 단계가 늘 때 움직인다.
// 화면 쪽 짝은 `components/DoctorSteps.tsx` 다 (여기가 정의하는 것을 그린다).
//
// `doctorPipeline.ts` 가 전부 다시 내보내므로 부르는 쪽은 이 파일을 몰라도 된다.

/**
 * 진단 단계의 순서. **단계를 더할 때 고치는 자리는 여기 하나다.**
 *
 * 원래는 순서가 세 곳에 손으로 나열돼 있었다 — 초기 목록·`server` 실패 시 막을 대상·
 * `model` 실패 시 막을 대상. **타입이 그 셋을 맞춰 주지 않는다.** 4번째 단계를 더하고
 * 막을 목록만 안 고쳐도 타입체크와 기존 테스트가 **전부 초록**이고, 증상은 조용하다:
 * *"실패했는데 뒤 단계가 `·` 로 영원히 남는다."*
 *
 * `drawerKeys.ts` 에서 밟은 것과 같은 결이다 — 거기서도 예외를 손으로 세다가 목록이
 * **태어날 때 이미 낡아 있었고**, 고친 방향은 나열이 아니라 유도였다.
 *
 * 패킹(`06_pack_opencode.md`)이 들어오면 단계가 는다 (포트 선택·기동 대기·프로세스 생사).
 * 그때 이 배열 한 줄이 된다.
 *
 * ⚠️ **그 일이 실제로 일어났고, 여기는 안 늘었다** (설계 2026-08-16). 자가 복구가 더한 것은
 * **치유** 칸(`HealStepId`)이지 진단 칸이 아니다 — 서버를 우리가 띄우게 됐다고 *확인할* 것이
 * 는 것은 아니기 때문이다. 진단 단계를 더할 때 고칠 자리가 여기 하나라는 사실은 그대로다.
 */
export const DIAG_ORDER = ['server', 'model', 'session'] as const

/** 배열에서 유도한다 — 배열과 union 이 갈리는 자리를 없앤다 */
export type DiagStepId = (typeof DIAG_ORDER)[number]
/** 치유 칸. ②의 두 갈래는 **서버가 우리 것이냐**로만 갈린다 (`ServerOwnership`) */
export type HealStepId = 'heal-reconnect' | 'heal-restart-server' | 'heal-adopt-server'
export type DoctorStepId = DiagStepId | HealStepId

export type StepStatus = 'pending' | 'running' | 'ok' | 'fail' | 'blocked'

export interface DoctorStep {
  id: DoctorStepId
  status: StepStatus
  /** 화면에 그대로 보여줄 한 줄 (결과가 나온 뒤에만) */
  detail?: string
}

/**
 * 이 프로젝트의 opencode 서버가 **우리가 띄운 것인가.**
 *
 * 판정은 여기서 하지 않는다 — main 이 `pidStore` 로 내고(`ServerStatusPayload.ours`)
 * 렌더러는 결과만 받는다. 렌더러에는 프로세스를 들여다볼 수단이 없다.
 *
 * **모르면 `theirs` 다.** 안전한 쪽으로 틀린다: 남의 프로세스는 절대 안 끈다
 * (하네스의 「내가 안 띄운 프로세스는 끄지 않는다」와 같은 규칙).
 */
export type ServerOwnership = 'ours' | 'theirs'

/** ②의 갈래. **이 함수가 갈림의 전부다** — 다른 근거를 섞지 않는다 */
export function serverHealFor(ownership: ServerOwnership): HealStepId {
  return ownership === 'ours' ? 'heal-restart-server' : 'heal-adopt-server'
}

/** 치유 칸인가 (진단만 돌리는 주기 재측정이 여기서 멈춘다 — 설계 §2) */
export function isHealStep(id: DoctorStepId): id is HealStepId {
  return id.startsWith('heal-')
}

/**
 * 어떤 단계가 실패했을 때 「앞 단계가 실패해 확인할 수 없습니다」로 칠할 단계들 —
 * **그 뒤에 오는 것 전부.**
 *
 * `order` 를 인자로 받는 이유는 시험하기 위해서다. 단계가 늘어도 유도가 도는지는
 * **가짜 4번째 단계를 넣어 봐야** 알 수 있는데, 상수를 직접 읽으면 그 시험을 못 한다.
 * (`doctorPipeline.ts` 머리주석의 *"화면 없이 단언한다"* 와 같은 결이다.)
 */
export function blockedAfter(order: readonly DiagStepId[], failedId: DiagStepId): DiagStepId[] {
  const index = order.indexOf(failedId)
  return index < 0 ? [] : order.slice(index + 1)
}

/** 재진단으로 같은 id 가 두 벌일 수 있다 — 항상 마지막(현재 회전) 것만 고친다 */
export function setStep(
  steps: DoctorStep[],
  id: DoctorStepId,
  status: StepStatus,
  detail?: string,
): DoctorStep[] {
  const last = steps.map((step) => step.id).lastIndexOf(id)
  return steps.map((step, index) =>
    index === last ? { ...step, status, ...(detail === undefined ? {} : { detail }) } : step,
  )
}

/** 마지막(현재 회전) 것의 상태. 같은 이유로 lastIndexOf 다. */
export function stepStatus(steps: DoctorStep[], id: DoctorStepId): StepStatus | undefined {
  const last = steps.map((step) => step.id).lastIndexOf(id)
  return steps[last]?.status
}

export const STEP_LABEL: Record<DoctorStepId, string> = {
  server: 'opencode 서버 확인',
  model: '모델 확인',
  session: '연결 상태 확인',
  'heal-reconnect': '재연결',
  'heal-restart-server': '서버 다시 시작',
  // 「갈아타기」다 — 남의 서버를 끄고 그 자리를 뺏는 것이 아니라, 이 프로젝트용을 새로 띄운다
  'heal-adopt-server': '우리 서버로 갈아타기',
}

/** 로그 문장용 — 단계 표시(STEP_LABEL)보다 행위에 가깝게 쓴다 */
export const LOG_LABEL: Record<DoctorStepId, string> = {
  server: 'opencode 서버 ping',
  model: '모델 조회',
  session: '연결 상태 확인',
  'heal-reconnect': '프로젝트 재연결',
  'heal-restart-server': 'opencode 서버 다시 시작',
  'heal-adopt-server': '이 프로젝트용 opencode 서버 시작',
}
