import type { DiagnosticsPayload } from '../../shared/ipc/channels'
import type { ProjectStatus } from './projectStatus'
import type { DoctorStep, DoctorStepId, PipelineState, ServerOwnership } from './doctorPipeline'

// 연결 진단·복구(Doctor)의 판정 로직.
//
// "어디가 끊겼는지" 에 따라 고치는 법이 다르다:
//   opencode 서버가 없음 → **우리가 띄운다.** 우리 것이면 다시 시작, 아니면 갈아타기
//   모델 설정이 없음     → 설정 파일 안내 (**우리가 못 고치는 유일한 층**)
//   세션만 끊김          → 재연결
//
// **이 자리에 *"davis 때 있던 재시작·재설치는 없다 — 런타임을 우리가 띄우지 않기 때문이다"*
// 라고 적혀 있었다.** 커밋 `c09cac8` 이후 그 전제가 뒤집혔다: opencode 서버는 **프로젝트마다
// 우리가 띄운다**(`electron/opencode/serverPool.ts`). 그래서 재시작이 돌아왔다.
// 재설치는 여전히 없다 — 실행 파일은 우리가 설치하지 않는다 (`binary.ts`).
//
// 순수 함수라 화면 없이 단언한다.

/**
 * 한 번에 실행 가능한 복구 액션.
 *
 * **`'reconnect'` 하나뿐이었다** (위 머리말의 뒤집힌 전제와 같은 뿌리다).
 * 지금은 서버를 되살리는 `'restart-server'` 가 하나 더 있다.
 *
 * **한때 둘이었다** — `restart-server`(우리 것을 접었다 띄운다)와 `adopt-server`(남의 것은
 * 살려 두고 새로 띄운다). 조치 층이 이미 그 둘을 갈라 주고 있었다: `serverPool.stop` 은
 * 우리 표의 자식만 접으므로 남의 서버면 접는 절반이 저절로 no-op 이다. 갈래를 세운 대가로
 * `adopt` 가 고른 `start` 는 세션이 살아 있을 때 **아무 일도 안 했다** (실측 2026-08-16).
 *
 * `ServerStatusPayload.ours` 는 이제 **안내 문장만** 가른다 (`serverIssueFix`).
 */
export type DoctorFix = 'reconnect' | 'restart-server'

export interface DoctorIssue {
  layer: 'opencode 서버' | '모델' | '세션'
  /** 무엇이 잘못됐나 (진단 detail 기반) */
  cause: string
  /** 한 번에 고칠 수 있으면 그 액션 */
  fix?: DoctorFix
  /** 수동으로 해야 하면 안내 한 줄 */
  advice?: string
}

// **`SERVE_ADVICE` 가 여기 있었다** — *"`opencode serve --port 4096` 로 서버를 띄우고,
// 연결 설정의 주소를 확인하세요"*. 사용자가 터미널에서 서버를 치던 시절의 안내다.
// 지금은 앱이 띄우고(`serverPool`), 현장 사용자에게는 터미널이 없다 — 그 문장은 이제
// **못 따라 할 지시**라서 「고치기」 버튼으로 바꿨다. 남은 안내는 아래 둘뿐이다.
const RESTART_ADVICE = '이 프로젝트의 서버를 접었다 다시 띄웁니다'

/**
 * ②가 「우리 것이 아닐 때」 무엇을 하는지 — **창 안내와 배너가 이 한 문장을 나눠 쓴다.**
 *
 * **"이미 떠 있는 다른 서버는 그대로 둡니다" 였다.** 크래시 경로에서 거짓이다 —
 * 뿌리 수정이 죽은 자식을 표에서 지운 뒤라 `owns(null)=false` 가 되고, 이 문장이
 * **지배적으로** 그 경우에 나온다 (QA 실측 2026-08-16: 크래시 사다리에서 ownership 은
 * 언제나 `theirs`). 그때 「다른 서버」는 없다. 두 경우에 다 참인 문장으로 고쳐 썼다.
 *
 * ⚠️ **내보내는 이유가 그 고침의 경위다.** 같은 문장이 여기와 `healNotice.ts` 에 **리터럴
 * 두 벌**로 있었고, 고칠 때 한쪽만 내려가 반쪽이 낡았다 (`3599d87` → `01aa781` 로 두 번
 * 걸렸다). 게다가 낡은 채 남은 쪽이 하필 **더 자주 보이는** 배너였다 — 창 안내는 최종
 * 실패 뒤에야 뜨지만 배너는 ②가 도는 동안 크래시 경로마다 뜬다.
 * 사본을 없애 「그날 두 곳인 걸 기억해야 한다」는 조건 자체를 지운다.
 */
export const ADOPT_ADVICE =
  '이 프로젝트용 서버를 새로 띄웁니다 — 우리가 띄우지 않은 서버는 건드리지 않습니다'

/** 세션이 대화 가능한 상태인가 (doctorPipeline 의 치유 성공 판정도 이것을 쓴다) */
export function sessionUp(status: ProjectStatus): boolean {
  return status === 'ready' || status === 'busy'
}

// **`isHealthy()` 가 여기 있었다 — D4 에서 지웠다.**
// *"모든 계층이 정상인가 — Doctor 버튼은 이게 false 일 때만 활성화된다"* 고 적혀 있었는데
// **그렇게 쓰는 코드가 없었다** (전수 확인). D3(자동 게이트)이 되살릴 자리로 지목돼 기다렸지만,
// 게이트는 반대 물음(`status === 'error'` — **붙어 보고 실패했나**)으로 판정한다.
// 「전부 정상인가」와 「실패했나」는 `idle`·`connecting` 에서 답이 갈려 서로를 대신 못 쓴다.
// 다시 필요해지면 10줄이다 — **없는 배선을 주장하는 주석을 남겨 두는 쪽이 비싸다.**

/**
 * 깨진 계층을 의존 순서(서버 → 세션)로 나열한다.
 * 근본 계층을 먼저 고쳐야 위 계층이 따라 살아나므로 순서가 곧 권장 순서다.
 */
export function diagnoseIssues(
  status: ProjectStatus,
  result: DiagnosticsPayload | null,
  failure?: string,
  ownership: ServerOwnership = 'theirs',
): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const serverDown = result !== null && !result.runtime.ok

  if (serverDown) {
    issues.push({
      layer: 'opencode 서버',
      cause: result.runtime.detail || 'opencode 서버에 닿지 못했습니다',
      // **재시작 버튼을 준다.** 예전에는 안 줬고 근거가 이랬다 — *"사용자가 띄운 남의
      // 프로세스라 우리가 죽였다 살릴 수 없다."* 우리가 띄우게 되면서 절반이 거짓이 됐다:
      // 우리 것이면 죽였다 살릴 수 있고, **남의 것이면 여전히 못 한다** — 그래서 갈아타기다.
      ...serverIssueFix(ownership),
    })
  }

  if (!sessionUp(status) || failure) {
    if (status === 'disconnected') {
      issues.push({ layer: '세션', cause: '연결이 끊겨 재연결을 기다리는 중입니다', fix: 'reconnect' })
    } else if (status === 'error') {
      issues.push({
        layer: '세션',
        cause: serverDown
          ? 'opencode 서버에 닿지 못해 세션을 열지 못했습니다'
          : failure || '세션을 준비하지 못했습니다',
        // 서버가 죽어 있는 동안엔 재연결 버튼을 주지 않는다 — 눌러도 같은 자리에서 또 실패한다.
        // 고칠 수 없는 버튼은 없느니만 못하다.
        // 서버가 죽어 있는 동안엔 재연결 버튼을 주지 않는다 — 눌러도 같은 자리에서 또 실패한다.
        // 그 자리의 조치는 위 「opencode 서버」 이슈가 이미 들고 있다.
        ...(serverDown ? {} : { fix: 'reconnect' as const }),
        ...(serverDown ? {} : { advice: '연결 설정의 서버 주소를 확인하고 다시 연결하세요' }),
      })
    } else if (status === 'idle') {
      // 미연결도 이슈다 — 화면엔 세션 ✗ 로 보이는데 "정상" 이라 하면 모순이다.
      issues.push({
        layer: '세션',
        cause: '세션이 아직 연결되지 않았습니다',
        ...(serverDown ? {} : { fix: 'reconnect' as const }),
      })
    } else if (failure) {
      issues.push({ layer: '세션', cause: failure, ...(serverDown ? {} : { fix: 'reconnect' as const }) })
    }
    // connecting 은 진행 중일 뿐이라 별도 이슈로 세우지 않는다
  }

  return issues
}

/**
 * 파이프라인 자체 판정에서 남은 수동 이슈.
 *
 * diagnoseIssues 는 세션의 시각만 알아서, desktop 직접 ping 실패와 모델 미설정을 모른다.
 * 이 둘은 여기서 안내로 바꾼다 (현재 회전 기준).
 */
export function stepIssues(
  state: PipelineState,
  ownership: ServerOwnership = 'theirs',
): DoctorIssue[] {
  const issues: DoctorIssue[] = []

  const server = lastStep(state.steps, 'server')
  if (server?.status === 'fail') {
    issues.push({
      layer: 'opencode 서버',
      cause: server.detail || 'opencode 서버에 닿지 못했습니다',
      ...serverIssueFix(ownership),
    })
  }

  const model = lastStep(state.steps, 'model')
  if (model?.status === 'fail') {
    issues.push({
      layer: '모델',
      cause: model.detail || '쓸 모델을 찾지 못했습니다',
      advice:
        '`~/.config/opencode/opencode.json` 의 provider·model 설정을 확인하세요 (프록시 키 만료도 여기로 나타납니다)',
    })
  }

  return issues
}

/** 재진단으로 같은 id 가 두 벌일 수 있다 — 항상 마지막(현재 회전) 것을 본다 */
function lastStep(steps: DoctorStep[], id: DoctorStepId): DoctorStep | undefined {
  return [...steps].reverse().find((step) => step.id === id)
}

/**
 * 서버 이슈에 붙일 조치 + 그 조치가 무엇을 하는지 한 줄.
 *
 * **조치는 하나이고 안내만 갈린다.** 사용자가 볼 말이 달라야 하는 이유는 두 경우가 실제로
 * 다른 일이기 때문이다 — 앞은 있던 것을 접었다 띄우고, 뒤는 없던 것을 세운다.
 * 뒤쪽에는 **남의 서버를 살려 둔다**는 사실이 함께 들어간다 (설계 §6 미결 1).
 */
function serverIssueFix(ownership: ServerOwnership): { fix: DoctorFix; advice: string } {
  return {
    fix: 'restart-server',
    advice: ownership === 'ours' ? RESTART_ADVICE : ADOPT_ADVICE,
  }
}

export const FIX_LABEL: Record<DoctorFix, string> = {
  reconnect: '재연결',
  'restart-server': '서버 되살리기',
}

export const FIX_PROGRESS: Record<DoctorFix, string> = {
  reconnect: '재연결 중…',
  'restart-server': '서버를 되살리는 중…',
}
