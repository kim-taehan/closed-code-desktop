import type { DiagnosticsPayload } from '../../shared/ipc/channels'
import type { ProjectStatus } from './projectStatus'
import { sessionUp } from './connectionDoctor'
import type { CheckOutcome } from './doctorPipeline'

// 연결 프로브 — Doctor·온보딩 팝업·설정 화면이 같이 쓰는 축.
//
// IPC 는 이미 한 곳(main)이지만 renderer 쪽 "호출 + 결과 해석"이 세 화면에 흩어져
// 같은 판정(성공/실패/키 미입력)을 제각각 만들던 것을 여기로 모은다.
// 해석 결과는 doctorPipeline 의 CheckOutcome 그대로 — 머신에 바로 먹일 수 있다.

/** 런타임 ping. 진단 전체(diag)도 함께 준다 — Doctor 가 수동 이슈 판정에 쓴다. */
export async function probeRuntime(): Promise<{ outcome: CheckOutcome; diag: DiagnosticsPayload }> {
  const diag = await window.davis.diagnose()
  return { outcome: { ok: diag.runtime.ok, detail: diag.runtime.detail }, diag }
}

/**
 * desktop → **그 프로젝트의** opencode 서버 직접 ping.
 *
 * 주소를 인자로 받던 자리다. 서버를 우리가 프로젝트마다 띄우면서 화면이 고를 주소가
 * 없어졌다 — main 이 활성 프로젝트의 서버를 고른다 (`ipc/projectBridge.ts`).
 */
export function probeServer(): Promise<CheckOutcome> {
  return window.davis.pingServer()
}

/**
 * 쓸 모델이 붙어 있는지. 서버는 떴는데 프로바이더 설정이 비면
 * 증상이 "보내도 답이 없다" 로만 나타나서, 진단에서 미리 갈라 준다.
 */
export async function probeModels(): Promise<CheckOutcome> {
  const result = await window.davis.checkModels()
  return { ok: result.ok, detail: result.message }
}

export interface AwaitHealthyOptions {
  /** 몇 번 확인할지 (기본 15회 × 1초) */
  tries?: number
  intervalMs?: number
  /** ping 마다 진단 전체를 받아 본다 (Doctor 의 lastDiag 갱신) */
  onDiag?: (diag: DiagnosticsPayload) => void
  /** true 를 돌려주면 그만둔다 (화면이 닫힌 뒤의 유령 폴링 방지) */
  shouldStop?: () => boolean
}

/**
 * 치유/연결 액션 뒤 재확인 — 런타임 ping + 세션이 붙을 때까지 기다린다.
 * 살아나는 즉시 통과, 끝까지 안 붙으면 실패다.
 * Doctor 사다리의 재확인과 온보딩의 "연결 시도" 가 같은 흐름이라 한 곳에 둔다.
 */
export async function awaitHealthy(
  getStatus: () => ProjectStatus,
  options: AwaitHealthyOptions = {},
): Promise<CheckOutcome> {
  const { tries = 15, intervalMs = 1000, onDiag, shouldStop } = options
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (shouldStop?.()) break
    const { outcome, diag } = await probeRuntime()
    onDiag?.(diag)
    if (outcome.ok && sessionUp(getStatus())) {
      return { ok: true, detail: '서버·세션이 살아났습니다' }
    }
    await sleep(intervalMs)
  }
  return { ok: false, detail: '재확인 시간 안에 연결되지 않았습니다' }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
