import { STEP_LABEL, type PipelineState } from './doctorPipeline'

// 자가 복구가 **화면에 뭐라고 말하나.** 순수 함수라 화면 없이 단언한다.
//
// 축은 **예고**다 (설계 2026-08-16 §3). 세 가지를 다 말하되 순서가 정해져 있다:
//
//   예고 (축)  "재연결이 실패했습니다. **이제 서버를 다시 띄웁니다.**"
//   진행       "서버를 다시 띄우는 중…"
//   근거       "`<internal-llm-ip>` 에 닿지 못했습니다 — 사내망 주소라 VPN 이 끊기면…"
//
// 예고가 앞인 이유: 무거운 조치가 **일어난 뒤에** 알리면 사용자는 자기가 겪은 일을
// 사후에 통보받을 뿐이고, 멈출 기회를 못 가진다.
//
// **어디에 보이나 — 2단 승격.** 가볍게 복구되면 사용자는 거의 모르고 지나가고,
// 무거워질 때만 시선을 가져온다:
//
//   ①만 도는 동안   상태줄 한 줄
//   ② 이상          배너
//   최종 실패        Doctor 창 (이 파일은 `stage: 'doctor'` 로 알리기만 한다)

export type HealStage = 'statusline' | 'banner' | 'doctor'

export interface HealNotice {
  stage: HealStage
  /** 예고를 앞세운 한 줄. 상태줄은 이것만 그린다. */
  headline: string
  /** 근거 — 지금 무엇이 실패했나. 배너·창에서만 보인다. */
  detail?: string
}

/**
 * 지금 사다리 상태를 화면 문구로 옮긴다. 말할 것이 없으면 `null`.
 *
 * `null` 이 되는 두 경우가 뜻이 다르다 — **아직 아무것도 안 돌았다**(pipeline 없음)와
 * **잘 끝났다**(healthy·healed). 둘 다 화면에 낼 말이 없다는 점만 같다.
 */
export function healNotice(state: PipelineState | null): HealNotice | null {
  if (state === null) return null

  if (state.verdict === 'healthy' || state.verdict === 'healed') return null
  if (state.verdict === 'manual') {
    return {
      stage: 'doctor',
      headline: '자동 복구가 실패했습니다 — 무엇이 막혔는지 진단을 열었습니다',
      ...detailOf(state),
    }
  }
  if (state.next === null) return null

  switch (state.next) {
    // 진단 중. 아직 아무것도 안 건드렸다 — 가장 조용한 칸이다.
    case 'server':
    case 'model':
    case 'session':
      return { stage: 'statusline', headline: '연결을 확인하는 중…' }

    case 'heal-reconnect':
      // ③ — 서버까지 되살린 뒤의 재연결이다. 이미 무거운 조치를 했으므로 배너에 남는다.
      if (serverHealed(state)) {
        return { stage: 'banner', headline: '서버를 다시 띄웠습니다. 이제 세션을 다시 붙입니다…', ...detailOf(state) }
      }
      // ① — **예고가 여기 들어간다.** 다음에 무엇이 일어날지 지금 말해 둔다.
      return { stage: 'statusline', headline: '연결이 끊겨 재연결 중… 실패하면 서버를 다시 띄웁니다' }

    case 'heal-restart-server':
      return {
        stage: 'banner',
        headline: '재연결이 실패했습니다. 이제 이 프로젝트의 서버를 다시 띄웁니다…',
        ...detailOf(state),
      }

    // 남의 서버는 **그대로 둔다.** 그 사실을 문구에 싣는다 — 나중에 그 서버가 떠 있는 것을
    // 보고 헷갈릴 수 있는 자리라 여기서 미리 말해 둔다 (설계 §6 미결 1).
    case 'heal-adopt-server':
      return {
        stage: 'banner',
        headline: '이 프로젝트용 서버를 새로 띄웁니다 — 이미 떠 있는 다른 서버는 그대로 둡니다…',
        ...detailOf(state),
      }
  }
}

/** ②를 이미 지나왔나 — ①의 재연결과 ③의 재연결을 가른다 */
function serverHealed(state: PipelineState): boolean {
  return state.steps.some(
    (step) => step.id === 'heal-restart-server' || step.id === 'heal-adopt-server',
  )
}

/** 근거 한 줄 — **마지막으로 실패한 단계**의 사유를 그대로 쓴다 */
function detailOf(state: PipelineState): { detail?: string } {
  const failed = [...state.steps].reverse().find((step) => step.status === 'fail')
  if (failed?.detail === undefined) return {}
  return { detail: `${STEP_LABEL[failed.id]}: ${failed.detail}` }
}
