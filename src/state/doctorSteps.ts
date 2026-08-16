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
/**
 * 치유 칸. **②는 하나다.**
 *
 * 한때 `heal-adopt-server`(갈아타기)가 따로 있었다 — 남의 서버는 못 끄니 재시작이 아니라
 * 새로 띄우는 것이어야 한다고 봤다. **조치 층에서 이미 갈려 있었다**: `serverPool.stop` 의
 * 사정거리가 우리 자식뿐이라, 남의 서버면 `restart` 의 접는 절반이 저절로 no-op 이고
 * 이어지는 기동이 우리 것을 띄운다. 그것이 곧 「살려 둔 채 이 프로젝트만 옮긴다」다.
 *
 * 갈래를 세운 대가는 실측으로 드러났다: 갈아타기가 고른 `start` 는 세션이 살아 있으면
 * `activate` 의 이른 반환에 걸려 **아무것도 안 하고 성공**했다 (2026-08-16, contract-qa).
 * 지금 갈리는 것은 **문구뿐**이고, 그 갈림은 `ServerOwnership` 이 쥔다.
 *
 * ③(`heal-verify`)은 **재연결이 아니라 재확인이다.** 초판은 여기서 ①과 같은 재연결을
 * 다시 불렀는데, ②의 경로(`controlServer`)가 세션을 접었다 새로 만들고 **핸드셰이크
 * ready 까지 기다렸다가** 돌아온다는 것이 실측으로 나왔다 (802ms, 2026-08-16). 그 위에
 * 재연결을 또 부르면 **멀쩡한 세션을 접었다 붙이는 것**이고, 그 재조립이 실패하면
 * ②가 고쳐 놨는데도 사다리가 실패로 끝난다. 그래서 이 칸은 **검산만** 한다.
 */
export type HealStepId = 'heal-reconnect' | 'heal-restart-server' | 'heal-verify'
export type DoctorStepId = DiagStepId | HealStepId

export type StepStatus = 'pending' | 'running' | 'ok' | 'fail' | 'blocked'

export interface DoctorStep {
  id: DoctorStepId
  status: StepStatus
  /** 화면에 그대로 보여줄 한 줄 (결과가 나온 뒤에만) */
  detail?: string
}

/**
 * 이 프로젝트의 opencode 서버가 **우리가 띄운 것으로 지금 살아 있나.**
 *
 * 판정은 여기서 하지 않는다 — main 이 `pidStore` 로 내고(`ServerStatusPayload.ours`)
 * 렌더러는 결과만 받는다. 렌더러에는 프로세스를 들여다볼 수단이 없다.
 *
 * **조치를 가르지 않는다 — 문구만 가른다.** `ours` 면 "다시 띄웁니다", 아니면
 * "이 프로젝트용 서버를 띄웁니다". 사용자가 볼 말이 달라야 하는 이유는 두 경우가
 * 실제로 다른 일이기 때문이다: 앞은 있던 것을 접었다 띄우고, 뒤는 없던 것을 세운다.
 *
 * **모르면 `theirs` 다.** 실제로 `theirs` 가 나오는 지배적 경우는 「남이 띄운 서버」가 아니라
 * **「우리가 띄웠는데 죽었다」** 이다 (실측 2026-08-16) — 문구가 그 둘을 함께 덮어야 한다.
 */
export type ServerOwnership = 'ours' | 'theirs'

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
  // 주인에 따라 갈리지 않는 이름이다 — 단계 목록은 **무엇을 했나**만 적고,
  // 「다시 띄웁니다」/「띄웁니다」의 갈림은 예고 문구(`healNotice.ts`)가 맡는다
  'heal-restart-server': '서버 되살리기',
  'heal-verify': '연결 재확인',
}

/** 로그 문장용 — 단계 표시(STEP_LABEL)보다 행위에 가깝게 쓴다 */
export const LOG_LABEL: Record<DoctorStepId, string> = {
  server: 'opencode 서버 ping',
  model: '모델 조회',
  session: '연결 상태 확인',
  'heal-reconnect': '프로젝트 재연결',
  'heal-restart-server': 'opencode 서버 되살리기',
  'heal-verify': '연결 재확인',
}
