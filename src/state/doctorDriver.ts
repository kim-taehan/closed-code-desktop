import type { DiagnosticsPayload } from '../../shared/ipc/channels'
import type { ProjectStatus } from './projectStatus'
import { sessionUp } from './connectionDoctor'
import {
  advance,
  initPipeline,
  isHealStep,
  type CheckOutcome,
  type DoctorCommand,
  type PipelineState,
  type ServerOwnership,
} from './doctorPipeline'
import { awaitHealthy, probeModels, probeRuntime, probeServer } from './connectionProbe'

// 순수 머신(`doctorPipeline`)에 **부작용을 실제로 먹이는** 자리.
//
// `ConnectionDoctor` 컴포넌트 안에 있던 루프다. 자가 복구(`useAutoHeal`)가 **팝업이 안 열린
// 상태에서도** 같은 사다리를 타야 해서 밖으로 뗐다 — 설계 §4 의 *"사다리 구동은 기존
// 드라이버 재사용"* 이 이 파일이다. 두 벌로 짜면 화면에서 도는 사다리와 배경에서 도는
// 사다리가 조용히 갈린다.
//
// 판단은 하나도 안 한다: 무엇을 부를지는 `state.next` 가 정하고, 다음이 무엇인지는
// `advance` 가 정한다. 여기 있는 것은 **"그 이름의 부작용을 어떻게 부르나"** 뿐이다.

/** 재연결 재확인 (1초 × N). 떠 있는 서버에 붙는 것뿐이라 길게 기다릴 이유가 없다. */
export const RECONNECT_TRIES = 3

export interface DriverPorts {
  /** 파이프라인이 도는 동안 세션 상태가 바뀐다 — 매번 최신을 읽는다 */
  getStatus(): ProjectStatus
  /** 전이마다 부른다 (화면 갱신) */
  onState(state: PipelineState): void
  /** ping 마다 진단 전체를 준다 (Doctor 의 수동 이슈 판정용) */
  onDiag?(diag: DiagnosticsPayload): void
  /** true 를 돌려주면 그 자리에서 그만둔다 (화면이 닫혔거나 「중지」를 눌렀다) */
  shouldStop(): boolean
  /**
   * 치유 칸을 탈 것인가. **기본은 탄다.**
   *
   * 거짓이면 진단만 재고 사다리 앞에서 멈춘다 — 설계 §2 의 「30초 주기 재측정」이 그것이다.
   * 재측정이 치유까지 하면 자동 사다리 1회 상한이 30초마다 무너진다.
   */
  healing?: boolean
  /**
   * 재확인 폴링 간격. **시험용 이음매다** — 기본 1초로 세 번 기다리면 시험 하나가 3초다.
   * 환경변수가 아니라 주입으로 내는 이유는 `ServerPoolOptions.start` 와 같다: 제품이 안 쓰는
   * 분기는 아무도 안 밟는 채로 낡는다.
   */
  recheckIntervalMs?: number
}

/**
 * 사다리 한 바퀴. 끝난 상태를 돌려준다.
 *
 * 도중에 `shouldStop()` 이 참이 되면 **그때까지의 상태**로 돌아간다 — verdict 는 비어 있다.
 */
export async function driveDoctor(ports: DriverPorts): Promise<PipelineState> {
  const healing = ports.healing ?? true
  let state = initPipeline(sessionUp(ports.getStatus()))
  ports.onState(state)

  while (state.next !== null && !ports.shouldStop()) {
    // 진단만 재는 회전은 치유 칸 앞에서 멈춘다. 여기서 멈추는 것이 "진단 결과는 남기되
    // 무거운 조치는 안 한다" 의 실체다.
    if (!healing && isHealStep(state.next)) break

    const outcome = await runCommand(state.next, ports)
    if (ports.shouldStop()) return state
    // **실패했을 때만 묻는다.** 성공 전이는 ②로 안 내려가므로 주인 판정이 필요 없고,
    // 그 물음은 main 에서 `ps` 를 부른다 (`pidStore.owns`) — 공짜가 아니다.
    const ownership = outcome.ok ? 'theirs' : await currentOwnership()
    state = advance(state, outcome, sessionUp(ports.getStatus()), ownership)
    ports.onState(state)
  }
  return state
}

/**
 * 이 프로젝트의 서버가 우리 것인가. **판정은 main 이 한다** — 여기는 옮기기만 한다.
 * 못 물으면 `theirs` 다 (모르면 남의 것으로 본다).
 */
export async function currentOwnership(): Promise<ServerOwnership> {
  try {
    return (await window.davis.serverStatus()).ours ? 'ours' : 'theirs'
  } catch {
    return 'theirs'
  }
}

async function runCommand(command: DoctorCommand, ports: DriverPorts): Promise<CheckOutcome> {
  switch (command) {
    // 저장된 주소로 본다 — 실제 세션이 쓰는 값이 살아 있는지를 확인해야 한다.
    case 'server':
      return probeServer()
    case 'model':
      return probeModels()
    case 'session':
      return pingRuntime(ports)
    case 'heal-reconnect':
      await window.davis.reconnectProject()
      return recheck(ports, RECONNECT_TRIES)
    // ② — **우리가 띄운 것을 접었다 다시 띄운다.** 남의 프로세스에는 손대지 않는다:
    // main 의 `serverPool.stop` 이 접는 것은 우리 표에 있는 자식뿐이다.
    case 'heal-restart-server':
      return controlServer('restart')
    // ② — 남의 서버(또는 주인을 모르는 서버)는 **그대로 살려 둔다.** 이 프로젝트만
    // 우리가 띄운 서버로 옮긴다 (설계 §1). `start` 는 아무것도 끄지 않는다.
    case 'heal-adopt-server':
      return controlServer('start')
  }
}

/**
 * 서버 조작 한 번. **재확인 폴링이 없다** — main 이 조작 직후 표를 다시 읽어
 * "떠 있어야 성공" 을 이미 판정해서 돌려준다 (`ipc/projectBridge.ts`).
 * 세션이 붙었는지는 이 칸의 물음이 아니라 **③의 물음**이다.
 */
async function controlServer(action: 'start' | 'restart'): Promise<CheckOutcome> {
  const result = await window.davis.controlServer({ action })
  if (!result.ok) {
    // 사유를 그대로 올린다 — 실행 파일을 못 찾았다는 말이 여기로 온다 (`binary.ts`)
    return { ok: false, detail: result.error ?? '서버를 띄우지 못했습니다' }
  }
  return { ok: true, detail: `${result.status.url ?? '주소 미확인'} 에 서버가 떴습니다` }
}

async function pingRuntime(ports: DriverPorts): Promise<CheckOutcome> {
  const { outcome, diag } = await probeRuntime()
  ports.onDiag?.(diag)
  // 이 단계는 "지금 연결됐나" 를 답한다 — 런타임 ping 에 세션 상태를 붙여 보여준다
  if (!outcome.ok) return outcome
  return { ...outcome, detail: `${outcome.detail} · 세션 ${sessionUp(ports.getStatus()) ? '연결됨' : '끊김'}` }
}

/** 치유 액션 뒤 재확인 (공용 awaitHealthy) — 살아나는 즉시 통과. */
function recheck(ports: DriverPorts, tries: number): Promise<CheckOutcome> {
  return awaitHealthy(() => ports.getStatus(), {
    tries,
    ...(ports.recheckIntervalMs === undefined ? {} : { intervalMs: ports.recheckIntervalMs }),
    ...(ports.onDiag ? { onDiag: ports.onDiag } : {}),
    // 중지를 누르면 재확인 폴링도 즉시 그만둔다
    shouldStop: () => ports.shouldStop(),
  })
}
