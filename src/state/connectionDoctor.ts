import type { DiagnosticsPayload } from '../../shared/ipc/channels'
import type { ProjectStatus } from './projectStatus'
import type { DoctorStep, DoctorStepId, PipelineState } from './doctorPipeline'

// 연결 진단·복구(Doctor)의 판정 로직.
//
// "어디가 끊겼는지" 에 따라 고치는 법이 다르다:
//   opencode 서버가 없음 → **우리가 못 고친다.** `opencode serve` 안내
//   모델 설정이 없음     → 설정 파일 안내
//   세션만 끊김          → 재연결 (**우리가 할 수 있는 유일한 조치**)
//
// davis 때 있던 재시작·재설치는 없다 — 런타임을 우리가 띄우지 않기 때문이다.
// 순수 함수라 화면 없이 단언한다.

/** 한 번에 실행 가능한 복구 액션. opencode 에서는 재연결 하나뿐이다. */
export type DoctorFix = 'reconnect'

export interface DoctorIssue {
  layer: 'opencode 서버' | '모델' | '세션'
  /** 무엇이 잘못됐나 (진단 detail 기반) */
  cause: string
  /** 한 번에 고칠 수 있으면 그 액션 */
  fix?: DoctorFix
  /** 수동으로 해야 하면 안내 한 줄 */
  advice?: string
}

const SERVE_ADVICE = '`opencode serve --port 4096` 로 서버를 띄우고, 연결 설정의 주소를 확인하세요'

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
): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const serverDown = result !== null && !result.runtime.ok

  if (serverDown) {
    issues.push({
      layer: 'opencode 서버',
      cause: result.runtime.detail || 'opencode 서버에 닿지 못했습니다',
      // 재시작 버튼을 주지 않는다 — 사용자가 띄운 남의 프로세스라 우리가 죽였다 살릴 수 없다.
      advice: SERVE_ADVICE,
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
        ...(serverDown ? {} : { fix: 'reconnect' as const }),
        advice: serverDown ? SERVE_ADVICE : '연결 설정의 서버 주소를 확인하고 다시 연결하세요',
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
export function stepIssues(state: PipelineState): DoctorIssue[] {
  const issues: DoctorIssue[] = []

  const server = lastStep(state.steps, 'server')
  if (server?.status === 'fail') {
    issues.push({
      layer: 'opencode 서버',
      cause: server.detail || 'opencode 서버에 닿지 못했습니다',
      advice: SERVE_ADVICE,
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

export const FIX_LABEL: Record<DoctorFix, string> = {
  reconnect: '재연결',
}

export const FIX_PROGRESS: Record<DoctorFix, string> = {
  reconnect: '재연결 중…',
}
