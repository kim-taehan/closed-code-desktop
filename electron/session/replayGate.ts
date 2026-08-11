// 이력 재생 중 인터럽트 억제.
//
// runtime 은 인터럽트 청크도 원형 그대로 재전송하고 chat 청크에 재생 표식을 달지 않는다 —
// 억제는 IDE 책임이다 (vscode DC-866 이 계약 기준점). 안 거르면 이미 끝난 승인·질문 카드가
// 되살아나 화면에 뜬다.
//
// 상태 하나에 자체 해제 타이머가 딸려 있어 한 덩어리로 묶는다.

/** load_complete 가 유실돼도 이 시간 뒤엔 억제를 푼다 (vscode HISTORY_REPLAY_FALLBACK_MS 미러) */
const REPLAY_FALLBACK_MS = 10_000

export class ReplayGate {
  private active = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly fallbackMs: number = REPLAY_FALLBACK_MS) {}

  /** 재생 중인가 — 이 동안 도착하는 인터럽트는 흘린다 */
  get isReplaying(): boolean {
    return this.active
  }

  begin(): void {
    this.active = true
    // load_complete 가 유실되면(로드 중 오류 등) 억제가 영영 남는다 — 시간이 지나면 스스로 푼다.
    // 재로드 시 타이머를 다시 건다 — 앞선 로드의 짧은 잔여 시간이 새 로드를 조기 해제하면 안 된다.
    this.clear()
    this.timer = setTimeout(() => {
      this.timer = null
      this.end()
    }, this.fallbackMs)
  }

  /** 재생 종료 — 이후 도착하는 인터럽트는 라이브다 */
  end(): void {
    this.active = false
    this.clear()
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
