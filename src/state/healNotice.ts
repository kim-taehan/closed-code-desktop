import { STEP_LABEL, type PipelineState, type ServerOwnership } from './doctorPipeline'
// 창 안내와 **같은 문장**을 쓴다 — 사본을 두면 한쪽만 고쳐 반쪽이 낡는다 (아래 ②의 주석)
import { ADOPT_ADVICE } from './connectionDoctor'

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
 *
 * `ownership` 은 ②의 문구 하나만 가른다. **모르면 `theirs`** — 그쪽 문장이 "죽었거나
 * 남의 것" 을 함께 덮으므로, 안 넘겨도 틀린 말이 나가지 않는다.
 */
export function healNotice(
  state: PipelineState | null,
  ownership: ServerOwnership = 'theirs',
): HealNotice | null {
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

    // ① — **예고가 여기 들어간다.** 다음에 무엇이 일어날지 지금 말해 둔다.
    // 이 칸은 ①에서만 온다 — ③은 `heal-verify` 로 갈렸다 (재연결이 아니라 재확인이다).
    case 'heal-reconnect':
      return { stage: 'statusline', headline: '연결이 끊겨 재연결 중… 실패하면 서버를 다시 띄웁니다' }

    // ⭐ **여기가 `ownership` 이 남은 유일한 자리다.** 조치는 하나(`restart`)로 접혔고,
    // 갈리는 것은 사용자가 볼 말뿐이다 — 두 경우가 실제로 다른 일이기 때문이다:
    // 앞은 있던 것을 접었다 띄우고, 뒤는 없던 것을 세운다. 뒤쪽에는 **남의 프로세스를 안
    // 건드린다**는 사실을 싣는다 (설계 §6 미결 1).
    //
    // ⚠️ **"이미 떠 있는 다른 서버는 그대로 둡니다" 였다 — 크래시 경로에서 거짓이다.**
    // 뿌리 수정이 죽은 자식을 표에서 지운 뒤라 `owns(null)=false` 가 되고, 크래시 사다리는
    // **언제나** 이 갈래로 온다(QA 실측 2026-08-16). 그때 「다른 서버」는 없다.
    //
    // 그 고침이 **한쪽만 내려가 반쪽이 낡았다** — 여기와 `connectionDoctor.ts` 에 리터럴이
    // 두 벌이었고, 배너가 창 안내보다 훨씬 자주 보이는데 낡은 쪽이 배너였다.
    // *"문장을 고칠 때는 사본을 전수로 찾는다"* 고 적어 뒀는데, **기억에 기대는 규칙이라
    // 같은 조건이 그대로 남는다.** 그래서 사본을 없앴다 — 이제 한 벌이고, 배너만 꼬리를 붙인다.
    case 'heal-restart-server':
      return {
        stage: 'banner',
        headline:
          ownership === 'ours'
            ? '재연결이 실패했습니다. 이제 이 프로젝트의 서버를 다시 띄웁니다…'
            : `${ADOPT_ADVICE}…`,
        ...detailOf(state),
      }

    // ③ — 이미 무거운 조치를 했으므로 배너에 남는다. 조치가 아니라 검산 중이라는 것을
    // 말한다 — "붙이는 중" 이라고 하면 하지도 않는 일을 알리는 것이 된다.
    case 'heal-verify':
      return {
        stage: 'banner',
        headline: '서버를 다시 띄웠습니다. 연결이 살아났는지 확인하는 중…',
        ...detailOf(state),
      }
  }
}

/** 근거 한 줄 — **마지막으로 실패한 단계**의 사유를 그대로 쓴다 */
function detailOf(state: PipelineState): { detail?: string } {
  const failed = [...state.steps].reverse().find((step) => step.status === 'fail')
  if (failed?.detail === undefined) return {}
  return { detail: `${STEP_LABEL[failed.id]}: ${failed.detail}` }
}
